import { Router } from 'express';
import { z } from 'zod';
import { requireCustomer } from '../auth/auth.js';
import { body, h, query, sensitiveLimiter } from '../middleware/http.js';
import { getUserBalances } from '../ledger/ledger.js';
import { formatAmount, parsePositiveAmount } from '../lib/money.js';
import { prisma } from '../lib/prisma.js';
import { DepositStatus } from '../lib/constants.js';
import { refreshDeposit, submitDeposit } from './deposits.service.js';
import { cancelStakeRequest, cancelWithdrawal, requestStake, requestWithdrawal } from './finance.service.js';
import { notFound } from '../lib/errors.js';

export const userRouter = Router();
userRouter.use(requireCustomer);

const actor = (req: Express.Request) => ({ id: req.user!.id, role: req.user!.role, ip: (req as { ip?: string }).ip ?? null });
const page = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });

const depositView = <T extends { history: string; blockchainTx?: { verification: string } | null }>(d: T) => ({
  ...d,
  history: JSON.parse(d.history),
  blockchainTx: d.blockchainTx ? { ...d.blockchainTx, verification: JSON.parse(d.blockchainTx.verification) } : null,
});

// ── Overview ─────────────────────────────────────────────────────────────────
userRouter.get(
  '/overview',
  h(async (req, res) => {
    const userId = req.user!.id;
    const [balances, approved, onchainVerified, rewards, withdrawals, recent, stakes] = await Promise.all([
      getUserBalances(userId),
      prisma.deposit.aggregate({ where: { userId, status: DepositStatus.APPROVED }, _sum: { amount: true }, _count: true }),
      prisma.deposit.aggregate({ where: { userId, blockchainTx: { status: 'CONFIRMED' }, status: { not: 'REJECTED' } }, _sum: { amount: true } }),
      prisma.reward.aggregate({ where: { userId, status: 'ALLOCATED' }, _sum: { amount: true }, _count: true }),
      prisma.withdrawal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.transaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 8, include: { entries: { include: { account: true } } } }),
      prisma.stakingRecord.count({ where: { userId, status: 'ACTIVE' } }),
    ]);

    // Balance history (total internal balance at end of each day, last 30 days) from ledger entries.
    const since = new Date(Date.now() - 30 * 86400_000);
    const entries = await prisma.ledgerEntry.findMany({
      where: { account: { userId } },
      orderBy: { createdAt: 'asc' },
      select: { amount: true, createdAt: true },
    });
    let running = 0n;
    const byDay = new Map<string, bigint>();
    for (const e of entries) {
      running += e.amount;
      byDay.set(e.createdAt.toISOString().slice(0, 10), running);
    }
    const history: { date: string; total: string }[] = [];
    // balance carried into the 30-day window
    let last = entries.filter((e) => e.createdAt < since).reduce((s, e) => s + e.amount, 0n);
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      if (byDay.has(d)) last = byDay.get(d)!;
      history.push({ date: d, total: formatAmount(last) });
    }

    res.json({
      balances,
      deposits: { approvedTotal: approved._sum.amount ?? 0n, approvedCount: approved._count, onchainVerifiedTotal: onchainVerified._sum.amount ?? 0n },
      rewards: { total: rewards._sum.amount ?? 0n, count: rewards._count },
      activeStakes: stakes,
      withdrawals,
      recentTransactions: recent.map((t) => ({
        id: t.id,
        type: t.type,
        description: t.description,
        createdAt: t.createdAt,
        isSample: t.isSample,
        entries: t.entries.filter((e) => e.account.userId === userId).map((e) => ({ account: e.account.type, amount: e.amount })),
      })),
      balanceHistory: history,
    });
  }),
);

// ── Ledger (full, transparent history of every internal balance movement) ──────
userRouter.get(
  '/ledger',
  h(async (req, res) => {
    const { page: p, pageSize } = query(page, req);
    const userId = req.user!.id;
    const where = { account: { userId } };
    const [total, rows] = await Promise.all([
      prisma.ledgerEntry.count({ where }),
      prisma.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * pageSize,
        take: pageSize,
        include: { account: { select: { type: true } }, transaction: { select: { id: true, reference: true, type: true, description: true, isSample: true } } },
      }),
    ]);
    res.json({ total, page: p, pageSize, rows: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, account: r.account.type, amount: r.amount, balanceAfter: r.balanceAfter, transaction: r.transaction })) });
  }),
);

userRouter.get(
  '/ledger/export.csv',
  h(async (req, res) => {
    const rows = await prisma.ledgerEntry.findMany({
      where: { account: { userId: req.user!.id } },
      orderBy: { createdAt: 'asc' },
      include: { account: true, transaction: true },
    });
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const lines = ['date,account,amount_usdt,balance_after_usdt,type,reference,description'];
    for (const r of rows) {
      lines.push([r.createdAt.toISOString(), r.account.type, formatAmount(r.amount), formatAmount(r.balanceAfter), r.transaction.type, esc(r.transaction.reference), esc(r.transaction.description)].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eth-stalking-ledger.csv"');
    res.send(lines.join('\n'));
  }),
);

// ── Deposits ─────────────────────────────────────────────────────────────────
userRouter.get(
  '/deposits',
  h(async (req, res) => {
    const rows = await prisma.deposit.findMany({ where: { userId: req.user!.id }, orderBy: { submittedAt: 'desc' }, include: { blockchainTx: true } });
    res.json(rows.map(depositView));
  }),
);

userRouter.post(
  '/deposits',
  sensitiveLimiter,
  h(async (req, res) => {
    const { txHash } = body(z.object({ txHash: z.string().min(1).max(100) }), req);
    const result = await submitDeposit(actor(req), txHash);
    const rows = await prisma.deposit.findMany({ where: { id: { in: result.map((r) => r.id) } }, include: { blockchainTx: true } });
    res.status(201).json(rows.map(depositView));
  }),
);

userRouter.post(
  '/deposits/:id/refresh',
  sensitiveLimiter,
  h(async (req, res) => {
    const d = await prisma.deposit.findUnique({ where: { id: String(req.params.id) } });
    if (!d || d.userId !== req.user!.id) throw notFound('Deposit');
    await refreshDeposit(d.id);
    const row = await prisma.deposit.findUniqueOrThrow({ where: { id: d.id }, include: { blockchainTx: true } });
    res.json(depositView(row));
  }),
);

// ── Staking (internal records) ───────────────────────────────────────────────
userRouter.get(
  '/staking/plans',
  h(async (_req, res) => {
    res.json(await prisma.stakingPlan.findMany({ where: { status: 'ACTIVE' }, orderBy: { durationDays: 'asc' } }));
  }),
);

userRouter.get(
  '/staking',
  h(async (req, res) => {
    const rows = await prisma.stakingRecord.findMany({ where: { userId: req.user!.id }, orderBy: { requestedAt: 'desc' }, include: { plan: true, rewards: true } });
    res.json(rows.map((r) => ({ ...r, history: JSON.parse(r.history) })));
  }),
);

userRouter.post(
  '/staking',
  sensitiveLimiter,
  h(async (req, res) => {
    const input = body(z.object({ planId: z.string().min(1), amount: z.string().or(z.number()) }), req);
    const rec = await requestStake(actor(req), input.planId, parsePositiveAmount(input.amount));
    res.status(201).json(rec);
  }),
);

userRouter.post(
  '/staking/:id/cancel',
  h(async (req, res) => {
    res.json(await cancelStakeRequest(actor(req), String(req.params.id)));
  }),
);

// ── Rewards ──────────────────────────────────────────────────────────────────
userRouter.get(
  '/rewards',
  h(async (req, res) => {
    res.json(
      await prisma.reward.findMany({
        where: { userId: req.user!.id },
        orderBy: { allocatedAt: 'desc' },
        include: { stakingRecord: { include: { plan: { select: { name: true } } } } },
      }),
    );
  }),
);

// ── Withdrawals ──────────────────────────────────────────────────────────────
userRouter.get(
  '/withdrawals',
  h(async (req, res) => {
    const rows = await prisma.withdrawal.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
    res.json(rows.map((w) => ({ ...w, history: JSON.parse(w.history), payoutVerification: w.payoutVerification ? JSON.parse(w.payoutVerification) : null })));
  }),
);

userRouter.post(
  '/withdrawals',
  sensitiveLimiter,
  h(async (req, res) => {
    const input = body(
      z.object({ amount: z.string().or(z.number()), currency: z.string().default('USDT'), network: z.string().default('ETHEREUM_ERC20'), destinationAddress: z.string().trim().min(1).max(100) }),
      req,
    );
    const w = await requestWithdrawal(actor(req), { ...input, amount: parsePositiveAmount(input.amount) });
    res.status(201).json(w);
  }),
);

userRouter.post(
  '/withdrawals/:id/cancel',
  h(async (req, res) => {
    res.json(await cancelWithdrawal(actor(req), String(req.params.id)));
  }),
);

// ── Notifications ────────────────────────────────────────────────────────────
userRouter.get(
  '/notifications',
  h(async (req, res) => {
    const [rows, unread] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    ]);
    res.json({ unread, rows });
  }),
);

userRouter.post(
  '/notifications/read',
  h(async (req, res) => {
    const { ids } = body(z.object({ ids: z.array(z.string()).optional() }), req);
    await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);
