import { Router } from 'express';
import { getAddress, isAddress } from 'ethers';
import { z } from 'zod';
import { requireAdmin, requireSuperAdmin, revokeAllSessions } from '../auth/auth.js';
import { audit, verifyAuditChain } from '../audit/audit.js';
import { chainConfig, env, SAMPLE_TOKEN } from '../config/env.js';
import { complianceStatus, depositPolicy, getActiveReceivingWallet } from '../config/compliance.js';
import { getMinConfirmations, setSetting, SETTING_MIN_CONFIRMATIONS } from '../config/settings.js';
import { buildOwnershipChallenge, verifyOwnershipSignature } from '../chain/ownership.js';
import { getChainProvider, getSampleProvider } from '../chain/service.js';
import { mainnetRecentTransfers, mainnetVerifyTx, mainnetWalletStatus } from '../chain/mainnetCheck.js';
import { normalizeTxHash } from './deposits.service.js';
import { getPlatformTotals, getUserBalances, reconcileLedger } from '../ledger/ledger.js';
import { body, h, query, sensitiveLimiter } from '../middleware/http.js';
import { createBackup, exportAll, listBackups } from '../lib/backup.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { formatAmount, parsePositiveAmount, suggestReward } from '../lib/money.js';
import { prisma, withTx } from '../lib/prisma.js';
import { addDepositNote, approveDeposit, assignDeposit, refreshDeposit, refreshOpenDeposits, rejectDeposit, scanReceivingWallet, senderHistory } from './deposits.service.js';
import { adjustBalance, allocateReward, createPlan, endStake, recordPayout, reverseReward, reviewStake, reviewWithdrawal, updatePlan, verifyPayout } from './finance.service.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const actor = (req: Express.Request) => ({ id: req.user!.id, role: req.user!.role, ip: (req as { ip?: string }).ip ?? null });
const id = (req: Express.Request) => String((req as { params: Record<string, string> }).params.id);
const idem = (req: Express.Request) => {
  const k = (req as { headers: Record<string, unknown> }).headers['idempotency-key'];
  return typeof k === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(k) ? k : undefined;
};
const pageQ = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(25) });
const reason = z.string().trim().min(3, 'Please give a reason (min 3 characters)').max(500);
const userSelect = { id: true, email: true, name: true, role: true, status: true } as const;
const parseJson = (s: string | null | undefined) => (s ? JSON.parse(s) : null);

// ── Overview ─────────────────────────────────────────────────────────────────
adminRouter.get(
  '/overview',
  h(async (_req, res) => {
    const [users, activeUsers, verifiedDeposits, unmatched, pendingApprovals, totals, stakedCount, pendingStakes, rewardsCount, wdRequested, wdApproved, wdRecorded] = await Promise.all([
      prisma.user.count({ where: { role: 'USER' } }),
      prisma.user.count({ where: { role: 'USER', status: 'ACTIVE' } }),
      prisma.deposit.aggregate({ where: { blockchainTx: { status: 'CONFIRMED' }, status: { not: 'REJECTED' } }, _sum: { amount: true }, _count: true }),
      prisma.deposit.count({ where: { userId: null, status: { not: 'REJECTED' } } }),
      prisma.deposit.count({ where: { status: 'UNDER_REVIEW' } }),
      getPlatformTotals(),
      prisma.stakingRecord.count({ where: { status: 'ACTIVE' } }),
      prisma.stakingRecord.count({ where: { status: 'REQUESTED' } }),
      prisma.reward.count({ where: { status: 'ALLOCATED' } }),
      prisma.withdrawal.count({ where: { status: 'REQUESTED' } }),
      prisma.withdrawal.count({ where: { status: 'APPROVED' } }),
      prisma.withdrawal.count({ where: { status: 'PAYOUT_RECORDED' } }),
    ]);

    // Reserve check: actual on-chain token balance of the receiving wallet vs internal liabilities.
    let reserve: { walletAddress: string; onchainBalance: bigint | null; liabilities: bigint; shortfall: bigint | null; error?: string } | null = null;
    const wallet = await getActiveReceivingWallet();
    if (wallet) {
      try {
        const bal = await getChainProvider().getTokenBalance(chainConfig().tokenContract, wallet.address);
        reserve = { walletAddress: getAddress(wallet.address), onchainBalance: bal, liabilities: totals.userLiabilities, shortfall: totals.userLiabilities > bal ? totals.userLiabilities - bal : 0n };
      } catch (e) {
        reserve = { walletAddress: getAddress(wallet.address), onchainBalance: null, liabilities: totals.userLiabilities, shortfall: null, error: (e as Error).message };
      }
    }

    // Approved deposits per day (30d)
    const since = new Date(Date.now() - 30 * 86400_000);
    const approved = await prisma.deposit.findMany({ where: { status: 'APPROVED', reviewedAt: { gte: since } }, select: { amount: true, reviewedAt: true } });
    const rewards = await prisma.reward.findMany({ where: { allocatedAt: { gte: since }, status: 'ALLOCATED' }, select: { amount: true, allocatedAt: true } });
    const series: { date: string; deposits: string; rewards: string }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      const dep = approved.filter((a) => a.reviewedAt!.toISOString().slice(0, 10) === d).reduce((s, a) => s + (a.amount ?? 0n), 0n);
      const rew = rewards.filter((a) => a.allocatedAt.toISOString().slice(0, 10) === d).reduce((s, a) => s + a.amount, 0n);
      series.push({ date: d, deposits: formatAmount(dep), rewards: formatAmount(rew) });
    }

    res.json({
      users: { total: users, active: activeUsers },
      deposits: { verifiedTotal: verifiedDeposits._sum.amount ?? 0n, verifiedCount: verifiedDeposits._count, unmatched, pendingApprovals },
      totals,
      staking: { active: stakedCount, pendingRequests: pendingStakes },
      rewards: { count: rewardsCount },
      withdrawals: { requested: wdRequested, approvedAwaitingPayout: wdApproved, payoutRecorded: wdRecorded },
      reserve,
      series,
      compliance: await complianceStatus(),
      chainMode: chainConfig().mode,
    });
  }),
);

// ── Users ────────────────────────────────────────────────────────────────────
adminRouter.get(
  '/users',
  h(async (req, res) => {
    const q = query(pageQ.extend({ q: z.string().optional(), status: z.string().optional(), role: z.string().optional() }), req);
    const where = {
      ...(q.q ? { OR: [{ email: { contains: q.q } }, { name: { contains: q.q } }, { id: q.q }] } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.role ? { role: q.role } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: { ...userSelect, createdAt: true, lastLoginAt: true } }),
    ]);
    const withBalances = await Promise.all(rows.map(async (u) => ({ ...u, balances: u.role === 'USER' ? await getUserBalances(u.id) : null })));
    res.json({ total, page: q.page, pageSize: q.pageSize, rows: withBalances });
  }),
);

adminRouter.get(
  '/users/:id',
  h(async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: id(req) }, select: { ...userSelect, createdAt: true, lastLoginAt: true, failedLogins: true, lockedUntil: true } });
    if (!u) throw notFound('User');
    const [balances, deposits, staking, rewards, withdrawals, transactions] = await Promise.all([
      getUserBalances(u.id),
      prisma.deposit.findMany({ where: { userId: u.id }, orderBy: { submittedAt: 'desc' }, include: { blockchainTx: true } }),
      prisma.stakingRecord.findMany({ where: { userId: u.id }, orderBy: { requestedAt: 'desc' }, include: { plan: true } }),
      prisma.reward.findMany({ where: { userId: u.id }, orderBy: { allocatedAt: 'desc' }, include: { allocatedBy: { select: userSelect } } }),
      prisma.withdrawal.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' } }),
      prisma.transaction.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 200, include: { entries: { include: { account: true } }, createdBy: { select: userSelect } } }),
    ]);
    res.json({
      user: u,
      balances,
      deposits: deposits.map((d) => ({ ...d, history: JSON.parse(d.history) })),
      staking: staking.map((s) => ({ ...s, history: JSON.parse(s.history) })),
      rewards,
      withdrawals: withdrawals.map((w) => ({ ...w, history: JSON.parse(w.history) })),
      transactions: transactions.map((t) => ({ ...t, entries: t.entries.map((e) => ({ account: e.account.key.startsWith('USER') ? e.account.type : `PLATFORM:${e.account.type}`, amount: e.amount, balanceAfter: e.balanceAfter })) })),
    });
  }),
);

adminRouter.post(
  '/users/:id/status',
  h(async (req, res) => {
    const { status, reason: why } = body(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason }), req);
    const a = actor(req);
    const target = await prisma.user.findUnique({ where: { id: id(req) } });
    if (!target) throw notFound('User');
    if (target.id === a.id) throw forbidden('You cannot change your own account status');
    if (target.role !== 'USER' && a.role !== 'SUPERADMIN') throw forbidden('Only a super-administrator can manage administrator accounts');
    const u = await withTx(async (tx) => {
      const u = await tx.user.update({ where: { id: target.id }, data: { status }, select: userSelect });
      await audit(tx, { actorId: a.id, actorRole: a.role, action: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_ACTIVATED', entityType: 'User', entityId: target.id, details: { reason: why }, ip: a.ip });
      return u;
    });
    if (status === 'SUSPENDED') await revokeAllSessions(target.id);
    res.json(u);
  }),
);

adminRouter.post(
  '/users/:id/role',
  requireSuperAdmin,
  h(async (req, res) => {
    const { role, reason: why } = body(z.object({ role: z.enum(['USER', 'ADMIN', 'SUPERADMIN']), reason }), req);
    const a = actor(req);
    const target = await prisma.user.findUnique({ where: { id: id(req) } });
    if (!target) throw notFound('User');
    if (target.id === a.id) throw forbidden('You cannot change your own role');
    if (role !== 'USER') {
      const bal = await getUserBalances(target.id);
      if (bal.total !== 0n) throw conflict('HAS_BALANCE', 'An account holding a balance cannot become an administrator (segregation of duties)');
    }
    const u = await withTx(async (tx) => {
      const u = await tx.user.update({ where: { id: target.id }, data: { role }, select: userSelect });
      await audit(tx, { actorId: a.id, actorRole: a.role, action: 'USER_ROLE_CHANGED', entityType: 'User', entityId: target.id, details: { from: target.role, to: role, reason: why }, ip: a.ip });
      return u;
    });
    await revokeAllSessions(target.id);
    res.json(u);
  }),
);

adminRouter.post(
  '/users/:id/balance',
  sensitiveLimiter,
  h(async (req, res) => {
    const input = body(z.object({ kind: z.enum(['CREDIT', 'DEBIT', 'LOCK', 'UNLOCK']), amount: z.string().or(z.number()), reason }), req);
    const j = await adjustBalance(actor(req), { userId: id(req), kind: input.kind, amount: parsePositiveAmount(input.amount), reason: input.reason, idempotencyKey: idem(req) });
    res.status(201).json({ transactionId: j.id, balances: await getUserBalances(id(req)) });
  }),
);

// ── Deposits ─────────────────────────────────────────────────────────────────
adminRouter.get(
  '/deposits',
  h(async (req, res) => {
    const q = query(pageQ.extend({ status: z.string().optional(), unmatched: z.string().optional(), q: z.string().optional() }), req);
    const where = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.unmatched === 'true' ? { userId: null } : {}),
      ...(q.q ? { OR: [{ txHash: { contains: q.q.toLowerCase() } }, { user: { email: { contains: q.q } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.deposit.count({ where }),
      prisma.deposit.findMany({ where, orderBy: { submittedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: userSelect }, blockchainTx: true, reviewedBy: { select: userSelect } } }),
    ]);
    res.json({ total, page: q.page, pageSize: q.pageSize, rows: rows.map((d) => ({ ...d, history: JSON.parse(d.history), blockchainTx: d.blockchainTx ? { ...d.blockchainTx, verification: parseJson(d.blockchainTx.verification) } : null })) });
  }),
);

adminRouter.get(
  '/deposits/:id',
  h(async (req, res) => {
    const d = await prisma.deposit.findUnique({ where: { id: id(req) }, include: { user: { select: userSelect }, blockchainTx: true, reviewedBy: { select: userSelect }, wallet: true, ledgerTx: { include: { entries: true } } } });
    if (!d) throw notFound('Deposit');
    const senders = d.blockchainTx ? await senderHistory(d.blockchainTx.fromAddress, d.id) : [];
    res.json({ ...d, history: JSON.parse(d.history), blockchainTx: d.blockchainTx ? { ...d.blockchainTx, verification: parseJson(d.blockchainTx.verification) } : null, senderHistory: senders });
  }),
);

adminRouter.post('/deposits/:id/refresh', sensitiveLimiter, h(async (req, res) => res.json(await refreshDeposit(id(req)))));
adminRouter.post(
  '/deposits/:id/assign',
  h(async (req, res) => {
    const input = body(z.object({ userId: z.string().min(1), note: z.string().max(500).optional() }), req);
    res.json(await assignDeposit(actor(req), id(req), input.userId, input.note));
  }),
);
adminRouter.post(
  '/deposits/:id/approve',
  sensitiveLimiter,
  h(async (req, res) => {
    const input = body(z.object({ note: z.string().max(500).optional() }), req);
    res.json(await approveDeposit(actor(req), id(req), input.note));
  }),
);
adminRouter.post(
  '/deposits/:id/reject',
  h(async (req, res) => {
    const input = body(z.object({ reason }), req);
    res.json(await rejectDeposit(actor(req), id(req), input.reason));
  }),
);
adminRouter.post(
  '/deposits/:id/note',
  h(async (req, res) => {
    const input = body(z.object({ note: z.string().trim().min(1).max(1000) }), req);
    res.json(await addDepositNote(actor(req), id(req), input.note));
  }),
);

// ── Staking ──────────────────────────────────────────────────────────────────
const planSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(5).max(1000),
  durationDays: z.coerce.number().int().min(1).max(3650),
  minAmount: z.string().or(z.number()),
  maxAmount: z.string().or(z.number()),
  indicativeRewardBps: z.coerce.number().int().min(0).max(10000),
  rewardRule: z.string().trim().min(5).max(1000),
});

adminRouter.get('/staking/plans', h(async (_req, res) => res.json(await prisma.stakingPlan.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { records: true } } } }))));
adminRouter.post(
  '/staking/plans',
  h(async (req, res) => {
    const p = body(planSchema, req);
    res.status(201).json(await createPlan(actor(req), { ...p, minAmount: parsePositiveAmount(p.minAmount), maxAmount: parsePositiveAmount(p.maxAmount) }));
  }),
);
adminRouter.patch(
  '/staking/plans/:id',
  h(async (req, res) => {
    const p = body(planSchema.partial().extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }), req);
    const { minAmount, maxAmount, ...rest } = p;
    res.json(
      await updatePlan(actor(req), id(req), {
        ...rest,
        ...(minAmount !== undefined ? { minAmount: parsePositiveAmount(minAmount) } : {}),
        ...(maxAmount !== undefined ? { maxAmount: parsePositiveAmount(maxAmount) } : {}),
      }),
    );
  }),
);
adminRouter.get(
  '/staking/records',
  h(async (req, res) => {
    const q = query(pageQ.extend({ status: z.string().optional(), userId: z.string().optional() }), req);
    const where = { ...(q.status ? { status: q.status } : {}), ...(q.userId ? { userId: q.userId } : {}) };
    const [total, rows] = await Promise.all([
      prisma.stakingRecord.count({ where }),
      prisma.stakingRecord.findMany({ where, orderBy: { requestedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: userSelect }, plan: true, rewards: true, reviewedBy: { select: userSelect } } }),
    ]);
    res.json({ total, page: q.page, pageSize: q.pageSize, rows: rows.map((r) => ({ ...r, history: JSON.parse(r.history) })) });
  }),
);
adminRouter.post(
  '/staking/records/:id/review',
  h(async (req, res) => {
    const input = body(z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(500).optional() }), req);
    if (input.decision === 'REJECT' && !input.note?.trim()) throw badRequest('REASON_REQUIRED', 'A rejection reason is required');
    res.json(await reviewStake(actor(req), id(req), input.decision, input.note));
  }),
);
adminRouter.post(
  '/staking/records/:id/end',
  h(async (req, res) => {
    const input = body(z.object({ note: z.string().max(500).optional() }), req);
    res.json(await endStake(actor(req), id(req), input.note));
  }),
);
adminRouter.get(
  '/staking/records/:id/suggested-reward',
  h(async (req, res) => {
    const r = await prisma.stakingRecord.findUnique({ where: { id: id(req) }, include: { plan: true } });
    if (!r) throw notFound('Staking record');
    const start = r.startsAt ?? r.requestedAt;
    const end = r.endedAt ?? new Date(Math.min(Date.now(), (r.endsAt ?? new Date()).getTime()));
    const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400_000));
    res.json({
      days,
      indicativeRewardBps: r.plan.indicativeRewardBps,
      suggestedAmount: suggestReward(r.amount, r.plan.indicativeRewardBps, days),
      note: 'Suggestion only. Rewards are discretionary administrator allocations and are never automatic or guaranteed.',
    });
  }),
);

// ── Rewards ──────────────────────────────────────────────────────────────────
adminRouter.get(
  '/rewards',
  h(async (req, res) => {
    const q = query(pageQ.extend({ userId: z.string().optional(), status: z.string().optional() }), req);
    const where = { ...(q.userId ? { userId: q.userId } : {}), ...(q.status ? { status: q.status } : {}) };
    const [total, rows, sum] = await Promise.all([
      prisma.reward.count({ where }),
      prisma.reward.findMany({ where, orderBy: { allocatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: userSelect }, allocatedBy: { select: userSelect }, reversedBy: { select: userSelect }, stakingRecord: { include: { plan: { select: { name: true } } } } } }),
      prisma.reward.aggregate({ where: { ...where, status: 'ALLOCATED' }, _sum: { amount: true } }),
    ]);
    res.json({ total, page: q.page, pageSize: q.pageSize, activeTotal: sum._sum.amount ?? 0n, rows });
  }),
);
adminRouter.post(
  '/rewards',
  sensitiveLimiter,
  h(async (req, res) => {
    const input = body(
      z.object({ userId: z.string().min(1), amount: z.string().or(z.number()), description: z.string().trim().min(3).max(300), stakingRecordId: z.string().optional(), rateBps: z.coerce.number().int().min(0).max(100000).optional() }),
      req,
    );
    res.status(201).json(await allocateReward(actor(req), { ...input, amount: parsePositiveAmount(input.amount), idempotencyKey: idem(req) }));
  }),
);
adminRouter.post(
  '/rewards/:id/reverse',
  h(async (req, res) => {
    const input = body(z.object({ reason }), req);
    res.json(await reverseReward(actor(req), id(req), input.reason));
  }),
);

// ── Withdrawals ──────────────────────────────────────────────────────────────
adminRouter.get(
  '/withdrawals',
  h(async (req, res) => {
    const q = query(pageQ.extend({ status: z.string().optional() }), req);
    const where = q.status ? { status: q.status } : {};
    const [total, rows] = await Promise.all([
      prisma.withdrawal.count({ where }),
      prisma.withdrawal.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { user: { select: userSelect }, reviewedBy: { select: userSelect } } }),
    ]);
    res.json({ total, page: q.page, pageSize: q.pageSize, rows: rows.map((w) => ({ ...w, history: JSON.parse(w.history), payoutVerification: parseJson(w.payoutVerification) })) });
  }),
);
adminRouter.get(
  '/withdrawals/:id',
  h(async (req, res) => {
    const w = await prisma.withdrawal.findUnique({ where: { id: id(req) }, include: { user: { select: userSelect }, reviewedBy: { select: userSelect } } });
    if (!w) throw notFound('Withdrawal');
    res.json({ ...w, history: JSON.parse(w.history), payoutVerification: parseJson(w.payoutVerification) });
  }),
);
adminRouter.post(
  '/withdrawals/:id/review',
  h(async (req, res) => {
    const input = body(z.object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().max(500).optional() }), req);
    res.json(await reviewWithdrawal(actor(req), id(req), input.decision, input.note));
  }),
);
adminRouter.post(
  '/withdrawals/:id/payout',
  h(async (req, res) => {
    const input = body(z.object({ txHash: z.string().min(1).max(100), note: z.string().max(500).optional() }), req);
    res.json(await recordPayout(actor(req), id(req), input.txHash, input.note));
  }),
);
adminRouter.post('/withdrawals/:id/verify-payout', sensitiveLimiter, h(async (req, res) => res.json(await verifyPayout(actor(req), id(req)))));

// ── Wallets & compliance ─────────────────────────────────────────────────────
adminRouter.get(
  '/wallets',
  h(async (_req, res) => {
    const rows = await prisma.wallet.findMany({ orderBy: { createdAt: 'asc' } });
    res.json(rows.map((w) => ({ ...w, address: getAddress(w.address), ownershipSignature: w.ownershipSignature ? `${w.ownershipSignature.slice(0, 14)}…` : null })));
  }),
);
adminRouter.post(
  '/wallets',
  requireSuperAdmin,
  h(async (req, res) => {
    const input = body(
      z.object({ label: z.string().trim().min(2).max(80), provider: z.string().trim().min(2).max(80), address: z.string().trim(), chainId: z.coerce.number().int(), notes: z.string().max(500).optional() }),
      req,
    );
    if (!isAddress(input.address)) throw badRequest('INVALID_ADDRESS', 'Not a valid Ethereum address');
    const cfg = chainConfig();
    const token = input.chainId === cfg.chainId ? cfg.tokenContract : input.chainId === 1 ? '0xdac17f958d2ee523a2206206994597c13d831ec7' : null;
    if (!token) throw badRequest('UNSUPPORTED_CHAIN', 'Only the configured chain or Ethereum mainnet are supported');
    const a = actor(req);
    const w = await withTx(async (tx) => {
      const w = await tx.wallet.create({
        data: { label: input.label, provider: input.provider, currency: 'USDT', network: 'ETHEREUM_ERC20', chainId: input.chainId, address: input.address.toLowerCase(), tokenContract: token, notes: input.notes, createdById: a.id, isSample: input.chainId === 31337 },
      });
      await audit(tx, { actorId: a.id, actorRole: a.role, action: 'WALLET_CREATED', entityType: 'Wallet', entityId: w.id, details: { address: w.address, chainId: w.chainId }, ip: a.ip });
      return w;
    });
    res.status(201).json(w);
  }),
);
adminRouter.post(
  '/wallets/:id/challenge',
  requireSuperAdmin,
  h(async (req, res) => {
    const a = actor(req);
    const w = await prisma.wallet.findUnique({ where: { id: id(req) } });
    if (!w) throw notFound('Wallet');
    const message = buildOwnershipChallenge(getAddress(w.address), w.chainId);
    await withTx(async (tx) => {
      await tx.wallet.update({ where: { id: w.id }, data: { ownershipChallenge: message } });
      await audit(tx, { actorId: a.id, actorRole: a.role, action: 'WALLET_CHALLENGE_ISSUED', entityType: 'Wallet', entityId: w.id, ip: a.ip });
    });
    res.json({ message });
  }),
);
adminRouter.post(
  '/wallets/:id/verify',
  requireSuperAdmin,
  h(async (req, res) => {
    const { signature } = body(z.object({ signature: z.string().trim().regex(/^0x[0-9a-fA-F]{130}$/, 'Signature must be a 65-byte hex string') }), req);
    const a = actor(req);
    const w = await prisma.wallet.findUnique({ where: { id: id(req) } });
    if (!w) throw notFound('Wallet');
    if (!w.ownershipChallenge) throw conflict('NO_CHALLENGE', 'Issue a challenge message first');
    const r = verifyOwnershipSignature(w.ownershipChallenge, signature, w.address);
    const updated = await withTx(async (tx) => {
      await audit(tx, { actorId: a.id, actorRole: a.role, action: r.ok ? 'WALLET_OWNERSHIP_VERIFIED' : 'WALLET_OWNERSHIP_FAILED', entityType: 'Wallet', entityId: w.id, details: { recovered: r.recovered } , ip: a.ip });
      if (!r.ok) return null;
      return tx.wallet.update({ where: { id: w.id }, data: { status: 'VERIFIED', ownershipSignature: signature, ownershipVerifiedAt: new Date() } });
    });
    if (!updated) throw badRequest('SIGNATURE_MISMATCH', `Signature was produced by ${r.recovered ?? 'an unknown key'}, not by ${getAddress(w.address)}`);
    res.json(updated);
  }),
);
adminRouter.post(
  '/wallets/:id/activate',
  requireSuperAdmin,
  h(async (req, res) => {
    const { active } = body(z.object({ active: z.boolean() }), req);
    const a = actor(req);
    const out = await withTx(async (tx) => {
      const w = await tx.wallet.findUnique({ where: { id: id(req) } });
      if (!w) throw notFound('Wallet');
      if (active && w.status !== 'VERIFIED') throw conflict('NOT_VERIFIED', 'Wallet ownership must be verified before activation');
      if (active) await tx.wallet.updateMany({ where: { chainId: w.chainId, purpose: w.purpose, id: { not: w.id } }, data: { isActive: false } });
      const u = await tx.wallet.update({ where: { id: w.id }, data: { isActive: active } });
      await audit(tx, { actorId: a.id, actorRole: a.role, action: active ? 'WALLET_ACTIVATED' : 'WALLET_DEACTIVATED', entityType: 'Wallet', entityId: w.id, ip: a.ip });
      return u;
    });
    res.json(out);
  }),
);
adminRouter.get(
  '/compliance',
  h(async (_req, res) => {
    const cfg = chainConfig();
    res.json({ ...(await complianceStatus()), chain: cfg, policy: await depositPolicy(), scannerEnabled: env.SCANNER_ENABLED });
  }),
);

// ── Audit ────────────────────────────────────────────────────────────────────
adminRouter.get(
  '/audit',
  h(async (req, res) => {
    const q = query(pageQ.extend({ entityType: z.string().optional(), entityId: z.string().optional(), actorId: z.string().optional(), action: z.string().optional() }), req);
    const where = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { contains: q.action } } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { seq: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { actor: { select: userSelect } } }),
    ]);
    res.json({ total, page: q.page, pageSize: q.pageSize, rows: rows.map((r) => ({ ...r, details: JSON.parse(r.details) })) });
  }),
);
adminRouter.get('/audit/verify', h(async (_req, res) => res.json(await verifyAuditChain())));

// ── Settings & system ────────────────────────────────────────────────────────
adminRouter.get(
  '/settings',
  h(async (_req, res) => {
    res.json({ minConfirmations: await getMinConfirmations(), minConfirmationsFloor: env.MIN_CONFIRMATIONS, chainMode: chainConfig().mode, pollIntervalMs: env.CHAIN_POLL_INTERVAL_MS, scannerEnabled: env.SCANNER_ENABLED });
  }),
);
adminRouter.put(
  '/settings/min-confirmations',
  requireSuperAdmin,
  h(async (req, res) => {
    const { value } = body(z.object({ value: z.coerce.number().int().min(1).max(1000) }), req);
    if (value < env.MIN_CONFIRMATIONS) throw badRequest('BELOW_FLOOR', `Cannot be lower than the deployment floor of ${env.MIN_CONFIRMATIONS}`);
    const a = actor(req);
    await withTx(async (tx) => {
      await setSetting(tx, SETTING_MIN_CONFIRMATIONS, String(value), a.id);
      await audit(tx, { actorId: a.id, actorRole: a.role, action: 'SETTING_CHANGED', entityType: 'PlatformSetting', entityId: SETTING_MIN_CONFIRMATIONS, details: { value }, ip: a.ip });
    });
    res.json({ minConfirmations: await getMinConfirmations() });
  }),
);
adminRouter.get('/system/reconcile', h(async (_req, res) => res.json({ ledger: await reconcileLedger(), audit: await verifyAuditChain() })));
adminRouter.get('/system/backups', requireSuperAdmin, h(async (_req, res) => res.json(listBackups())));
adminRouter.post(
  '/system/backup',
  requireSuperAdmin,
  h(async (req, res) => {
    const a = actor(req);
    const b = await createBackup('admin');
    await withTx((tx) => audit(tx, { actorId: a.id, actorRole: a.role, action: 'DB_BACKUP_CREATED', entityType: 'System', details: { file: b.name, size: b.size }, ip: a.ip }));
    res.status(201).json({ name: b.name, size: b.size });
  }),
);
adminRouter.get(
  '/system/export',
  requireSuperAdmin,
  h(async (req, res) => {
    const a = actor(req);
    await withTx((tx) => audit(tx, { actorId: a.id, actorRole: a.role, action: 'DB_EXPORTED', entityType: 'System', ip: a.ip }));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="eth-stalking-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(await exportAll());
  }),
);
adminRouter.post(
  '/system/run-jobs',
  sensitiveLimiter,
  h(async (_req, res) => {
    const scan = env.SCANNER_ENABLED ? await scanReceivingWallet() : { skipped: 'Scanner disabled' };
    const refreshed = await refreshOpenDeposits();
    res.json({ scan, refreshed });
  }),
);

// ── Real network check (READ-ONLY mainnet lookups; never credits anything) ─────
async function mainnetWallet(walletId?: string) {
  const w = walletId
    ? await prisma.wallet.findFirst({ where: { id: walletId, chainId: 1 } })
    : await prisma.wallet.findFirst({ where: { chainId: 1, purpose: 'DEPOSIT_RECEIVING' }, orderBy: { createdAt: 'asc' } });
  if (!w) throw notFound('Mainnet wallet');
  return w;
}
adminRouter.get(
  '/mainnet-check/wallets',
  h(async (_req, res) => {
    const rows = await prisma.wallet.findMany({ where: { chainId: 1 }, orderBy: { createdAt: 'asc' } });
    res.json(rows.map((w) => ({ id: w.id, label: w.label, provider: w.provider, address: getAddress(w.address), status: w.status, isActive: w.isActive })));
  }),
);
adminRouter.get(
  '/mainnet-check/status',
  sensitiveLimiter,
  h(async (req, res) => {
    const { walletId } = query(z.object({ walletId: z.string().optional() }), req);
    const w = await mainnetWallet(walletId);
    res.json({ wallet: { id: w.id, label: w.label, address: getAddress(w.address), status: w.status }, ...(await mainnetWalletStatus(w.address)), minConfirmations: await getMinConfirmations() });
  }),
);
adminRouter.get(
  '/mainnet-check/recent',
  sensitiveLimiter,
  h(async (req, res) => {
    const { walletId, blocks } = query(z.object({ walletId: z.string().optional(), blocks: z.coerce.number().int().min(100).max(20000).default(5000) }), req);
    const w = await mainnetWallet(walletId);
    res.json(await mainnetRecentTransfers(w.address, blocks));
  }),
);
adminRouter.post(
  '/mainnet-check/verify',
  sensitiveLimiter,
  h(async (req, res) => {
    const input = body(z.object({ txHash: z.string().min(1).max(100), walletId: z.string().optional() }), req);
    const txHash = normalizeTxHash(input.txHash);
    const w = await mainnetWallet(input.walletId);
    const result = await mainnetVerifyTx(txHash, w.address, await getMinConfirmations());
    const a = actor(req);
    await withTx((tx) => audit(tx, { actorId: a.id, actorRole: a.role, action: 'MAINNET_CHECK_VERIFY', entityType: 'Wallet', entityId: w.id, details: { txHash, outcome: result.outcome, amount: result.matches[0]?.amount ?? null }, ip: a.ip }));
    res.json(result);
  }),
);

// ── Sample chain (development / test only) ───────────────────────────────────
adminRouter.get('/sample/transfers', h(async (_req, res) => {
  const p = getSampleProvider();
  res.json({ head: await p.getBlockNumber(), transfers: p.list() });
}));
adminRouter.post(
  '/sample/transfers',
  h(async (req, res) => {
    const input = body(
      z.object({
        amount: z.string().or(z.number()),
        to: z.string().optional(),
        from: z.string().optional(),
        token: z.enum(['USDT', 'OTHER']).default('USDT'),
        status: z.enum(['success', 'failed', 'pending']).default('success'),
        note: z.string().max(200).optional(),
      }),
      req,
    );
    const p = getSampleProvider();
    const wallet = await getActiveReceivingWallet();
    const to = input.to ?? wallet?.address;
    if (!to || !isAddress(to)) throw badRequest('INVALID_ADDRESS', 'Destination address required');
    if (input.from && !isAddress(input.from)) throw badRequest('INVALID_ADDRESS', 'Invalid sender address');
    const tx = p.createTransfer({
      token: input.token === 'USDT' ? SAMPLE_TOKEN : '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad',
      to,
      from: input.from,
      amount: parsePositiveAmount(input.amount),
      status: input.status,
      note: input.note,
    });
    const a = actor(req);
    await withTx((t) => audit(t, { actorId: a.id, actorRole: a.role, action: 'SAMPLE_TRANSFER_CREATED', entityType: 'SampleChain', entityId: tx.txHash, details: { to, amount: input.amount, token: input.token, status: input.status } }));
    res.status(201).json(tx);
  }),
);
adminRouter.post(
  '/sample/mine',
  h(async (req, res) => {
    const { blocks } = body(z.object({ blocks: z.coerce.number().int().min(1).max(1000).default(12) }), req);
    res.json({ head: getSampleProvider().mine(blocks) });
  }),
);

