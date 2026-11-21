import { randomUUID } from 'node:crypto';
import { getAddress, isAddress } from 'ethers';
import { audit } from '../audit/audit.js';
import { getMinConfirmations } from '../config/settings.js';
import { inspectTransfer } from '../chain/service.js';
import { post } from '../ledger/ledger.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { StakingStatus as SS, WithdrawalStatus as WS } from '../lib/constants.js';
import { notify } from '../lib/notify.js';
import { formatAmount } from '../lib/money.js';
import { prisma, pushHistory, withTx, type Tx } from '../lib/prisma.js';
import { normalizeTxHash } from './deposits.service.js';

type Actor = { id: string; role: string; ip?: string | null };

async function requireCustomerTarget(tx: Tx, actor: Actor, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId } });
  if (!u) throw notFound('User');
  if (u.role !== 'USER') throw badRequest('INVALID_USER', 'Balances exist only on customer accounts');
  if (u.id === actor.id) throw forbidden('You cannot perform financial operations on your own account');
  return u;
}

// ── Admin balance management ─────────────────────────────────────────────────

export type AdjustKind = 'CREDIT' | 'DEBIT' | 'LOCK' | 'UNLOCK';

export async function adjustBalance(actor: Actor, input: { userId: string; kind: AdjustKind; amount: bigint; reason: string; idempotencyKey?: string }) {
  return withTx(async (tx) => {
    const user = await requireCustomerTarget(tx, actor, input.userId);
    const a = input.amount;
    const legs = {
      CREDIT: [
        { account: { platform: 'ADJUSTMENTS' as const }, amount: -a },
        { account: { user: user.id, type: 'AVAILABLE' as const }, amount: a },
      ],
      DEBIT: [
        { account: { user: user.id, type: 'AVAILABLE' as const }, amount: -a },
        { account: { platform: 'ADJUSTMENTS' as const }, amount: a },
      ],
      LOCK: [
        { account: { user: user.id, type: 'AVAILABLE' as const }, amount: -a },
        { account: { user: user.id, type: 'LOCKED' as const }, amount: a },
      ],
      UNLOCK: [
        { account: { user: user.id, type: 'LOCKED' as const }, amount: -a },
        { account: { user: user.id, type: 'AVAILABLE' as const }, amount: a },
      ],
    }[input.kind];
    const journal = await post(tx, {
      reference: `ADMIN_${input.kind}:${input.idempotencyKey ?? randomUUID()}`,
      type: `ADMIN_${input.kind}`,
      description: `Administrator ${input.kind.toLowerCase()}: ${input.reason}`,
      userId: user.id,
      createdById: actor.id,
      legs,
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: `BALANCE_${input.kind}`, entityType: 'User', entityId: user.id, details: { amount: a, reason: input.reason, ledgerTxId: journal.id }, ip: actor.ip });
    const verb = { CREDIT: 'credited to', DEBIT: 'debited from', LOCK: 'locked in', UNLOCK: 'unlocked in' }[input.kind];
    await notify(tx, user.id, 'BALANCE', `Balance ${input.kind.toLowerCase()}`, `${formatAmount(a)} USDT was ${verb} your internal account by an administrator. Reason: ${input.reason}`);
    return journal;
  });
}

// ── Staking plans & records (internal records — NOT on-chain staking) ──────────

export async function createPlan(actor: Actor, p: { name: string; description: string; durationDays: number; minAmount: bigint; maxAmount: bigint; indicativeRewardBps: number; rewardRule: string }) {
  if (p.maxAmount < p.minAmount) throw badRequest('INVALID_PLAN', 'Maximum must be ≥ minimum');
  return withTx(async (tx) => {
    const plan = await tx.stakingPlan.create({ data: { ...p, createdById: actor.id } });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'STAKING_PLAN_CREATED', entityType: 'StakingPlan', entityId: plan.id, details: p, ip: actor.ip });
    return plan;
  });
}

export async function updatePlan(actor: Actor, id: string, p: Partial<{ name: string; description: string; durationDays: number; minAmount: bigint; maxAmount: bigint; indicativeRewardBps: number; rewardRule: string; status: string }>) {
  return withTx(async (tx) => {
    const cur = await tx.stakingPlan.findUnique({ where: { id } });
    if (!cur) throw notFound('Plan');
    const min = p.minAmount ?? cur.minAmount;
    const max = p.maxAmount ?? cur.maxAmount;
    if (max < min) throw badRequest('INVALID_PLAN', 'Maximum must be ≥ minimum');
    const plan = await tx.stakingPlan.update({ where: { id }, data: p });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'STAKING_PLAN_UPDATED', entityType: 'StakingPlan', entityId: id, details: { before: cur, after: p }, ip: actor.ip });
    return plan;
  });
}

export async function requestStake(actor: Actor, planId: string, amount: bigint) {
  return withTx(async (tx) => {
    const plan = await tx.stakingPlan.findUnique({ where: { id: planId } });
    if (!plan || plan.status !== 'ACTIVE') throw badRequest('PLAN_UNAVAILABLE', 'This plan is not available');
    if (amount < plan.minAmount || amount > plan.maxAmount) {
      throw badRequest('AMOUNT_OUT_OF_RANGE', `Amount must be between ${formatAmount(plan.minAmount)} and ${formatAmount(plan.maxAmount)} USDT`);
    }
    const rec = await tx.stakingRecord.create({
      data: { userId: actor.id, planId, amount, status: SS.REQUESTED, history: pushHistory('[]', { status: SS.REQUESTED, by: actor.id }) },
    });
    const j = await post(tx, {
      reference: `STAKE_RESERVE:${rec.id}`,
      type: 'STAKE_RESERVE',
      description: `Reserved for internal staking request (${plan.name})`,
      userId: actor.id,
      createdById: actor.id,
      legs: [
        { account: { user: actor.id, type: 'AVAILABLE' }, amount: -amount },
        { account: { user: actor.id, type: 'PENDING' }, amount },
      ],
    });
    await tx.stakingRecord.update({ where: { id: rec.id }, data: { reserveLedgerTxId: j.id } });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'STAKE_REQUESTED', entityType: 'StakingRecord', entityId: rec.id, details: { planId, amount }, ip: actor.ip });
    return rec;
  });
}

export async function cancelStakeRequest(actor: Actor, recordId: string) {
  return withTx(async (tx) => {
    const r = await tx.stakingRecord.findUnique({ where: { id: recordId } });
    if (!r || r.userId !== actor.id) throw notFound('Staking record');
    if (r.status !== SS.REQUESTED) throw conflict('INVALID_STATE', 'Only pending requests can be cancelled');
    const j = await post(tx, {
      reference: `STAKE_RELEASE:${r.id}`,
      type: 'STAKE_RELEASE',
      description: 'Staking request cancelled — funds returned to available balance',
      userId: r.userId,
      createdById: actor.id,
      legs: [
        { account: { user: r.userId, type: 'PENDING' }, amount: -r.amount },
        { account: { user: r.userId, type: 'AVAILABLE' }, amount: r.amount },
      ],
    });
    const u = await tx.stakingRecord.update({ where: { id: r.id }, data: { status: 'CANCELLED', releaseLedgerTxId: j.id, endedAt: new Date(), history: pushHistory(r.history, { status: 'CANCELLED', by: actor.id }) } });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'STAKE_CANCELLED', entityType: 'StakingRecord', entityId: r.id, ip: actor.ip });
    return u;
  });
}

export async function reviewStake(actor: Actor, recordId: string, decision: 'APPROVE' | 'REJECT', note?: string) {
  return withTx(async (tx) => {
    const r = await tx.stakingRecord.findUnique({ where: { id: recordId }, include: { plan: true } });
    if (!r) throw notFound('Staking record');
    if (r.userId === actor.id) throw forbidden('You cannot review your own staking request');
    if (r.status !== SS.REQUESTED) throw conflict('INVALID_STATE', `Record is ${r.status}`);
    if (decision === 'APPROVE') {
      const j = await post(tx, {
        reference: `STAKE_ACTIVATE:${r.id}`,
        type: 'STAKE_ACTIVATE',
        description: `Internal staking record activated (${r.plan.name})`,
        userId: r.userId,
        createdById: actor.id,
        legs: [
          { account: { user: r.userId, type: 'PENDING' }, amount: -r.amount },
          { account: { user: r.userId, type: 'STAKED' }, amount: r.amount },
        ],
      });
      const now = new Date();
      const u = await tx.stakingRecord.update({
        where: { id: r.id },
        data: {
          status: SS.ACTIVE,
          reviewedById: actor.id,
          reviewedAt: now,
          startsAt: now,
          endsAt: new Date(now.getTime() + r.plan.durationDays * 86400_000),
          note,
          activateLedgerTxId: j.id,
          history: pushHistory(r.history, { status: SS.ACTIVE, by: actor.id, note }),
        },
      });
      await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'STAKE_APPROVED', entityType: 'StakingRecord', entityId: r.id, details: { note }, ip: actor.ip });
      await notify(tx, r.userId, 'STAKING', 'Staking request approved', `${formatAmount(r.amount)} USDT is now recorded in the internal "${r.plan.name}" plan.`);
      return u;
    }
    const j = await post(tx, {
      reference: `STAKE_RELEASE:${r.id}`,
      type: 'STAKE_REJECT',
      description: 'Staking request rejected — funds returned to available balance',
      userId: r.userId,
      createdById: actor.id,
      legs: [
        { account: { user: r.userId, type: 'PENDING' }, amount: -r.amount },
        { account: { user: r.userId, type: 'AVAILABLE' }, amount: r.amount },
      ],
    });
    const u = await tx.stakingRecord.update({
      where: { id: r.id },
      data: { status: SS.REJECTED, reviewedById: actor.id, reviewedAt: new Date(), note, releaseLedgerTxId: j.id, history: pushHistory(r.history, { status: SS.REJECTED, by: actor.id, note }) },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'STAKE_REJECTED', entityType: 'StakingRecord', entityId: r.id, details: { note }, ip: actor.ip });
    await notify(tx, r.userId, 'STAKING', 'Staking request rejected', `Your request was rejected${note ? `: ${note}` : ''}. ${formatAmount(r.amount)} USDT returned to your available balance.`);
    return u;
  });
}

export async function endStake(actor: Actor, recordId: string, note?: string) {
  return withTx(async (tx) => {
    const r = await tx.stakingRecord.findUnique({ where: { id: recordId }, include: { plan: true } });
    if (!r) throw notFound('Staking record');
    if (r.userId === actor.id) throw forbidden('You cannot manage your own staking record');
    if (r.status !== SS.ACTIVE) throw conflict('INVALID_STATE', `Record is ${r.status}`);
    const j = await post(tx, {
      reference: `STAKE_RELEASE:${r.id}`,
      type: 'STAKE_RELEASE',
      description: `Internal staking record ended (${r.plan.name}) — principal returned to available balance`,
      userId: r.userId,
      createdById: actor.id,
      legs: [
        { account: { user: r.userId, type: 'STAKED' }, amount: -r.amount },
        { account: { user: r.userId, type: 'AVAILABLE' }, amount: r.amount },
      ],
    });
    const u = await tx.stakingRecord.update({
      where: { id: r.id },
      data: { status: SS.ENDED, endedAt: new Date(), note: note ?? r.note, releaseLedgerTxId: j.id, history: pushHistory(r.history, { status: SS.ENDED, by: actor.id, note }) },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'STAKE_ENDED', entityType: 'StakingRecord', entityId: r.id, details: { note }, ip: actor.ip });
    await notify(tx, r.userId, 'STAKING', 'Staking record ended', `${formatAmount(r.amount)} USDT from "${r.plan.name}" has been returned to your available balance.`);
    return u;
  });
}

// ── Rewards (administrator-allocated, discretionary) ──────────────────────────

export async function allocateReward(actor: Actor, input: { userId: string; amount: bigint; description: string; stakingRecordId?: string; rateBps?: number; idempotencyKey?: string }) {
  return withTx(async (tx) => {
    const user = await requireCustomerTarget(tx, actor, input.userId);
    if (input.stakingRecordId) {
      const r = await tx.stakingRecord.findUnique({ where: { id: input.stakingRecordId } });
      if (!r || r.userId !== user.id) throw badRequest('INVALID_RECORD', 'Staking record does not belong to this user');
    }
    const journal = await post(tx, {
      reference: `REWARD:${input.idempotencyKey ?? randomUUID()}`,
      type: 'REWARD',
      description: `Administrator-allocated reward: ${input.description}`,
      userId: user.id,
      createdById: actor.id,
      legs: [
        { account: { platform: 'REWARD_FUNDING' }, amount: -input.amount },
        { account: { user: user.id, type: 'AVAILABLE' }, amount: input.amount },
      ],
    });
    const reward = await tx.reward.create({
      data: {
        userId: user.id,
        stakingRecordId: input.stakingRecordId ?? null,
        amount: input.amount,
        description: input.description,
        rateBps: input.rateBps ?? null,
        allocatedById: actor.id,
        ledgerTxId: journal.id,
      },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'REWARD_ALLOCATED', entityType: 'Reward', entityId: reward.id, details: { userId: user.id, amount: input.amount, description: input.description, ledgerTxId: journal.id }, ip: actor.ip });
    await notify(tx, user.id, 'REWARD', 'Reward allocated', `An administrator allocated ${formatAmount(input.amount)} USDT to your internal balance: ${input.description}`);
    return reward;
  });
}

export async function reverseReward(actor: Actor, rewardId: string, reason: string) {
  return withTx(async (tx) => {
    const r = await tx.reward.findUnique({ where: { id: rewardId } });
    if (!r) throw notFound('Reward');
    if (r.status === 'REVERSED') throw conflict('ALREADY_REVERSED', 'Reward already reversed');
    if (r.userId === actor.id) throw forbidden('You cannot reverse your own reward');
    const journal = await post(tx, {
      reference: `REWARD_REVERSAL:${r.id}`,
      type: 'REWARD_REVERSAL',
      description: `Correction — reversal of reward: ${reason}`,
      userId: r.userId,
      createdById: actor.id,
      legs: [
        { account: { user: r.userId, type: 'AVAILABLE' }, amount: -r.amount },
        { account: { platform: 'REWARD_FUNDING' }, amount: r.amount },
      ],
    });
    const u = await tx.reward.update({ where: { id: r.id }, data: { status: 'REVERSED', reversedById: actor.id, reversedAt: new Date(), reversalReason: reason, reversalLedgerTxId: journal.id } });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'REWARD_REVERSED', entityType: 'Reward', entityId: r.id, details: { reason, ledgerTxId: journal.id }, ip: actor.ip });
    await notify(tx, r.userId, 'REWARD', 'Reward corrected', `A reward of ${formatAmount(r.amount)} USDT was reversed by a corrective entry. Reason: ${reason}`);
    return u;
  });
}

// ── Withdrawals (manual payout, no key handling) ─────────────────────────────

export async function requestWithdrawal(actor: Actor, input: { amount: bigint; currency: string; network: string; destinationAddress: string }) {
  if (input.currency !== 'USDT' || input.network !== 'ETHEREUM_ERC20') throw badRequest('UNSUPPORTED_ASSET', 'Only USDT on Ethereum (ERC-20) is supported');
  if (!isAddress(input.destinationAddress)) throw badRequest('INVALID_ADDRESS', 'Destination is not a valid Ethereum address');
  const dest = getAddress(input.destinationAddress).toLowerCase();
  if (/^0x0{40}$/.test(dest)) throw badRequest('INVALID_ADDRESS', 'Destination cannot be the zero address');
  const platformWallet = await prisma.wallet.findFirst({ where: { address: dest } });
  if (platformWallet) throw badRequest('INVALID_ADDRESS', 'Destination cannot be a platform receiving address');

  return withTx(async (tx) => {
    const w = await tx.withdrawal.create({
      data: { userId: actor.id, currency: input.currency, network: input.network, amount: input.amount, destinationAddress: dest, status: WS.REQUESTED, history: pushHistory('[]', { status: WS.REQUESTED, by: actor.id, note: 'Funds reserved from available balance' }) },
    });
    const j = await post(tx, {
      reference: `WITHDRAWAL_RESERVE:${w.id}`,
      type: 'WITHDRAWAL_RESERVE',
      description: `Reserved for withdrawal request to ${dest.slice(0, 8)}…${dest.slice(-4)}`,
      userId: actor.id,
      createdById: actor.id,
      legs: [
        { account: { user: actor.id, type: 'AVAILABLE' }, amount: -input.amount },
        { account: { user: actor.id, type: 'PENDING' }, amount: input.amount },
      ],
    });
    const u = await tx.withdrawal.update({ where: { id: w.id }, data: { reserveLedgerTxId: j.id } });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'WITHDRAWAL_REQUESTED', entityType: 'Withdrawal', entityId: w.id, details: { amount: input.amount, destination: dest }, ip: actor.ip });
    return u;
  });
}

async function releaseWithdrawal(tx: Tx, actor: Actor, w: { id: string; userId: string; amount: bigint; history: string }, status: 'REJECTED' | 'CANCELLED', reason: string) {
  const j = await post(tx, {
    reference: `WITHDRAWAL_RELEASE:${w.id}`,
    type: 'WITHDRAWAL_RELEASE',
    description: `Withdrawal ${status.toLowerCase()} — funds returned to available balance`,
    userId: w.userId,
    createdById: actor.id,
    legs: [
      { account: { user: w.userId, type: 'PENDING' }, amount: -w.amount },
      { account: { user: w.userId, type: 'AVAILABLE' }, amount: w.amount },
    ],
  });
  return tx.withdrawal.update({
    where: { id: w.id },
    data: { status, rejectionReason: reason, releaseLedgerTxId: j.id, reviewedById: status === 'REJECTED' ? actor.id : undefined, reviewedAt: new Date(), history: pushHistory(w.history, { status, by: actor.id, note: reason }) },
  });
}

export async function cancelWithdrawal(actor: Actor, id: string) {
  return withTx(async (tx) => {
    const w = await tx.withdrawal.findUnique({ where: { id } });
    if (!w || w.userId !== actor.id) throw notFound('Withdrawal');
    if (w.status !== WS.REQUESTED) throw conflict('INVALID_STATE', 'Only requests that have not been approved can be cancelled');
    const u = await releaseWithdrawal(tx, actor, w, 'CANCELLED', 'Cancelled by user');
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'WITHDRAWAL_CANCELLED', entityType: 'Withdrawal', entityId: id, ip: actor.ip });
    return u;
  });
}

export async function reviewWithdrawal(actor: Actor, id: string, decision: 'APPROVE' | 'REJECT', note: string | undefined) {
  return withTx(async (tx) => {
    const w = await tx.withdrawal.findUnique({ where: { id } });
    if (!w) throw notFound('Withdrawal');
    if (w.userId === actor.id) throw forbidden('You cannot review your own withdrawal');
    if (decision === 'REJECT') {
      if (!note?.trim()) throw badRequest('REASON_REQUIRED', 'A rejection reason is required and will be shown to the user');
      if (w.status !== WS.REQUESTED && w.status !== WS.APPROVED) throw conflict('INVALID_STATE', `Withdrawal is ${w.status}`);
      const u = await releaseWithdrawal(tx, actor, w, 'REJECTED', note);
      await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'WITHDRAWAL_REJECTED', entityType: 'Withdrawal', entityId: id, details: { reason: note }, ip: actor.ip });
      await notify(tx, w.userId, 'WITHDRAWAL', 'Withdrawal rejected', `Your withdrawal of ${formatAmount(w.amount)} USDT was rejected: ${note}. The funds were returned to your available balance.`);
      return u;
    }
    if (w.status !== WS.REQUESTED) throw conflict('INVALID_STATE', `Withdrawal is ${w.status}`);
    const u = await tx.withdrawal.update({
      where: { id },
      data: { status: WS.APPROVED, reviewedById: actor.id, reviewedAt: new Date(), adminNote: note, history: pushHistory(w.history, { status: WS.APPROVED, by: actor.id, note: note ?? 'Approved — awaiting manual payout (not yet paid)' }) },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'WITHDRAWAL_APPROVED', entityType: 'Withdrawal', entityId: id, details: { note }, ip: actor.ip });
    await notify(tx, w.userId, 'WITHDRAWAL', 'Withdrawal approved', `Your withdrawal of ${formatAmount(w.amount)} USDT was approved and is queued for manual payout. It has NOT been paid yet — you will be notified once the on-chain payout is verified.`);
    return u;
  });
}

export async function recordPayout(actor: Actor, id: string, rawHash: string, note?: string) {
  const txHash = normalizeTxHash(rawHash);
  return withTx(async (tx) => {
    const w = await tx.withdrawal.findUnique({ where: { id } });
    if (!w) throw notFound('Withdrawal');
    if (w.status !== WS.APPROVED && w.status !== WS.PAYOUT_RECORDED) throw conflict('INVALID_STATE', 'Payout can only be recorded for approved withdrawals');
    const usedByOther = await tx.withdrawal.findFirst({ where: { payoutTxHash: txHash, id: { not: id } } });
    const usedAsDeposit = await tx.deposit.findFirst({ where: { txHash } });
    if (usedByOther || usedAsDeposit) throw conflict('DUPLICATE_TRANSACTION', 'This transaction hash is already used by another record');
    const u = await tx.withdrawal.update({
      where: { id },
      data: { status: WS.PAYOUT_RECORDED, payoutTxHash: txHash, payoutRecordedAt: new Date(), adminNote: note ?? w.adminNote, payoutVerification: null, history: pushHistory(w.history, { status: WS.PAYOUT_RECORDED, by: actor.id, note: `Payout tx ${txHash} recorded — pending on-chain verification` }) },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'WITHDRAWAL_PAYOUT_RECORDED', entityType: 'Withdrawal', entityId: id, details: { txHash, note }, ip: actor.ip });
    return u;
  });
}

/** Completes a withdrawal ONLY if the payout tx is independently verified on-chain. */
export async function verifyPayout(actor: Actor, id: string) {
  const w0 = await prisma.withdrawal.findUnique({ where: { id } });
  if (!w0) throw notFound('Withdrawal');
  if (w0.status !== WS.PAYOUT_RECORDED || !w0.payoutTxHash) throw conflict('INVALID_STATE', 'Record a payout transaction hash first');
  const minConf = await getMinConfirmations();
  const result = await inspectTransfer(w0.payoutTxHash, w0.destinationAddress, minConf, w0.amount);
  const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

  return withTx(async (tx) => {
    const w = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
    if (w.status !== WS.PAYOUT_RECORDED || w.payoutTxHash !== w0.payoutTxHash) throw conflict('INVALID_STATE', 'Withdrawal changed during verification; retry');
    const verification = JSON.stringify(result, replacer);
    if (result.outcome !== 'CONFIRMED') {
      await tx.withdrawal.update({ where: { id }, data: { payoutVerification: verification } });
      await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'WITHDRAWAL_PAYOUT_UNVERIFIED', entityType: 'Withdrawal', entityId: id, details: { outcome: result.outcome, message: result.message } });
      return { completed: false, verification: result };
    }
    const j = await post(tx, {
      reference: `WITHDRAWAL_PAYOUT:${w.id}`,
      type: 'WITHDRAWAL_PAYOUT',
      description: `Withdrawal paid on-chain (${w.payoutTxHash!.slice(0, 10)}…)`,
      userId: w.userId,
      createdById: actor.id,
      legs: [
        { account: { user: w.userId, type: 'PENDING' }, amount: -w.amount },
        { account: { platform: 'WITHDRAWAL_PAYOUTS' }, amount: w.amount },
      ],
    });
    await tx.withdrawal.update({
      where: { id },
      data: { status: WS.COMPLETED, payoutVerification: verification, payoutVerifiedAt: new Date(), completedAt: new Date(), releaseLedgerTxId: j.id, history: pushHistory(w.history, { status: WS.COMPLETED, by: actor.id, note: `Payout verified on-chain with ${result.confirmations} confirmations` }) },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'WITHDRAWAL_COMPLETED', entityType: 'Withdrawal', entityId: id, details: { txHash: w.payoutTxHash, confirmations: result.confirmations, ledgerTxId: j.id } });
    await notify(tx, w.userId, 'WITHDRAWAL', 'Withdrawal paid', `${formatAmount(w.amount)} USDT was paid to ${w.destinationAddress} in transaction ${w.payoutTxHash}. Payout verified on-chain.`);
    return { completed: true, verification: result };
  });
}

export function assertRole(role: string, allowed: string[]) {
  if (!allowed.includes(role)) throw new AppError(403, 'FORBIDDEN', 'Not permitted');
}
