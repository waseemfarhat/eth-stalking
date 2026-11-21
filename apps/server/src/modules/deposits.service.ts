import type { Deposit } from '@prisma/client';
import { chainConfig, env } from '../config/env.js';
import { complianceStatus, depositPolicy } from '../config/compliance.js';
import { getMinConfirmations, getSetting, setSetting } from '../config/settings.js';
import { getChainProvider, inspectTransfer } from '../chain/service.js';
import { TX_HASH_RE } from '../chain/types.js';
import type { VerificationResult } from '../chain/verifier.js';
import { audit } from '../audit/audit.js';
import { post } from '../ledger/ledger.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { DepositStatus as S } from '../lib/constants.js';
import { notify } from '../lib/notify.js';
import { prisma, pushHistory, withTx, type Tx } from '../lib/prisma.js';
import { formatAmount } from '../lib/money.js';

type Actor = { id: string; role: string; ip?: string | null };

const OPEN_STATUSES: string[] = [S.SUBMITTED, S.AWAITING_VERIFICATION, S.AWAITING_CONFIRMATIONS];
const creditRefOf = (chainId: number, txHash: string, logIndex: number) => `${chainId}:${txHash}:${logIndex}`;
const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export function normalizeTxHash(input: string) {
  const h = input.trim().toLowerCase();
  if (!TX_HASH_RE.test(h)) throw badRequest('INVALID_TX_HASH', 'Transaction hash must be 0x followed by 64 hexadecimal characters');
  return h;
}

/**
 * Step 4 of the workflow: the user submits a transaction hash.
 * A submission is only a CLAIM — nothing is credited until the transfer is independently verified
 * on-chain AND an administrator approves the attribution.
 */
export async function submitDeposit(actor: Actor, rawHash: string) {
  const txHash = normalizeTxHash(rawHash);
  const policy = await depositPolicy();
  if (!policy.accepting || !policy.wallet) throw new AppError(403, 'DEPOSITS_DISABLED', policy.reason ?? 'Deposits are not being accepted');
  const wallet = policy.wallet;
  const cfg = chainConfig();

  const created = await withTx(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (user.status !== 'ACTIVE') throw forbidden('Account is not active');

    const existing = await tx.deposit.findMany({ where: { chainId: cfg.chainId, txHash } });
    if (existing.length > 0) {
      const claimable = existing.every((d) => d.userId === null && d.status !== S.APPROVED && d.status !== S.REJECTED);
      if (!claimable) {
        throw conflict('DUPLICATE_TRANSACTION', 'This transaction hash has already been submitted. Each transaction can be credited to one account only. Contact support if you believe this is an error.');
      }
      // The scanner already found this transfer but nobody had claimed it: attach the claimant.
      // An administrator still has to review and approve the attribution.
      const claimed: Deposit[] = [];
      for (const d of existing) {
        const nextStatus = d.status === S.VERIFIED ? S.UNDER_REVIEW : d.status;
        claimed.push(
          await tx.deposit.update({
            where: { id: d.id },
            data: { userId: actor.id, status: nextStatus, history: pushHistory(d.history, { status: nextStatus, event: 'CLAIMED', by: actor.id }) },
          }),
        );
        await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'DEPOSIT_CLAIMED', entityType: 'Deposit', entityId: d.id, details: { txHash }, ip: actor.ip });
      }
      return claimed;
    }

    const d = await tx.deposit.create({
      data: {
        userId: actor.id,
        walletId: wallet.id,
        chainId: cfg.chainId,
        txHash,
        status: S.SUBMITTED,
        isSample: cfg.mode !== 'mainnet',
        history: pushHistory('[]', { status: S.SUBMITTED, by: actor.id }),
      },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'DEPOSIT_SUBMITTED', entityType: 'Deposit', entityId: d.id, details: { txHash, chainId: cfg.chainId }, ip: actor.ip });
    return [d];
  });

  // Verify immediately (outside the write lock — this is network I/O).
  const results = [];
  for (const d of created) results.push(await refreshDeposit(d.id).catch(() => d));
  return results;
}

/**
 * Re-check a deposit against the chain and move it through the status machine.
 * Safe to call repeatedly (idempotent); used by submission, the background job and admins.
 */
export async function refreshDeposit(depositId: string) {
  const d0 = await prisma.deposit.findUnique({ where: { id: depositId }, include: { wallet: true, blockchainTx: true } });
  if (!d0) throw notFound('Deposit');
  if (d0.status === S.APPROVED || d0.status === S.REJECTED) return d0;

  const minConf = await getMinConfirmations();
  const result = await inspectTransfer(d0.txHash, d0.wallet.address, minConf);
  return applyVerification(depositId, result);
}

async function upsertChainTx(tx: Tx, d: Deposit, result: VerificationResult, m: VerificationResult['matches'][number], source: string) {
  const status = result.outcome === 'CONFIRMED' ? 'CONFIRMED' : 'PENDING';
  const data = {
    blockNumber: result.blockNumber,
    blockHash: result.blockHash,
    status,
    confirmations: result.confirmations,
    verification: JSON.stringify(result, replacer),
    lastCheckedAt: new Date(),
  };
  return tx.blockchainTransaction.upsert({
    where: { chainId_txHash_logIndex: { chainId: d.chainId, txHash: d.txHash, logIndex: m.logIndex } },
    create: {
      chainId: d.chainId,
      txHash: d.txHash,
      logIndex: m.logIndex,
      fromAddress: m.from,
      toAddress: m.to,
      tokenContract: m.token,
      amount: m.amount,
      source,
      isSample: d.isSample,
      walletId: d.walletId,
      ...data,
    },
    update: data,
  });
}

export async function applyVerification(depositId: string, result: VerificationResult) {
  return withTx(async (tx) => {
    const d = await tx.deposit.findUniqueOrThrow({ where: { id: depositId } });
    if (d.status === S.APPROVED || d.status === S.REJECTED) return d;
    const sys = { actorId: null, actorRole: 'SYSTEM' };

    const reject = async (reason: string, code: string) => {
      const u = await tx.deposit.update({
        where: { id: d.id },
        data: { status: S.REJECTED, verificationError: `${code}: ${reason}`, history: pushHistory(d.history, { status: S.REJECTED, by: 'SYSTEM', note: reason }) },
      });
      await audit(tx, { ...sys, action: 'DEPOSIT_VERIFICATION_FAILED', entityType: 'Deposit', entityId: d.id, details: { outcome: code, reason } });
      if (d.userId) await notify(tx, d.userId, 'DEPOSIT', 'Deposit could not be verified', `Transaction ${d.txHash.slice(0, 12)}…: ${reason}`);
      return u;
    };

    if (result.terminal) return reject(result.message, result.outcome);

    if (result.outcome === 'NOT_FOUND' || result.outcome === 'PENDING') {
      const ageH = (Date.now() - d.submittedAt.getTime()) / 3600_000;
      if (result.outcome === 'NOT_FOUND' && ageH > env.DEPOSIT_NOT_FOUND_EXPIRY_HOURS) {
        return reject(`Transaction was not found on-chain within ${env.DEPOSIT_NOT_FOUND_EXPIRY_HOURS} hours`, 'NOT_FOUND_EXPIRED');
      }
      const next = result.outcome === 'NOT_FOUND' ? S.AWAITING_VERIFICATION : S.AWAITING_CONFIRMATIONS;
      if (d.status === next) return d;
      return tx.deposit.update({ where: { id: d.id }, data: { status: next, history: pushHistory(d.history, { status: next, by: 'SYSTEM', note: result.message }) } });
    }

    // INSUFFICIENT_CONFIRMATIONS or CONFIRMED: there is at least one valid matching transfer.
    let current = d;
    const [first, ...others] = result.matches;
    const linked = await tx.blockchainTransaction.findUnique({
      where: { chainId_txHash_logIndex: { chainId: d.chainId, txHash: d.txHash, logIndex: first.logIndex } },
      include: { deposit: true },
    });
    if (linked?.deposit && linked.deposit.id !== d.id) {
      return reject('This on-chain transfer is already attached to another deposit record', 'DUPLICATE_TRANSACTION');
    }
    const bt = await upsertChainTx(tx, d, result, first, d.userId ? 'USER_SUBMITTED' : 'SCANNER');

    // Additional matching transfers in the same tx become their own deposit records (one credit per transfer).
    for (const m of others) {
      const exists = await tx.blockchainTransaction.findUnique({ where: { chainId_txHash_logIndex: { chainId: d.chainId, txHash: d.txHash, logIndex: m.logIndex } } });
      if (exists) continue;
      const extra = await tx.deposit.create({
        data: { userId: d.userId, walletId: d.walletId, chainId: d.chainId, txHash: d.txHash, isSample: d.isSample, status: S.AWAITING_CONFIRMATIONS, history: pushHistory('[]', { status: S.SUBMITTED, by: 'SYSTEM', note: `Additional transfer (log ${m.logIndex}) in the same transaction` }) },
      });
      const ebt = await upsertChainTx(tx, extra, result, m, 'USER_SUBMITTED');
      await tx.deposit.update({ where: { id: extra.id }, data: { blockchainTxId: ebt.id, amount: m.amount } });
    }

    if (result.outcome === 'INSUFFICIENT_CONFIRMATIONS') {
      const changed = current.status !== S.AWAITING_CONFIRMATIONS;
      current = await tx.deposit.update({
        where: { id: d.id },
        data: {
          blockchainTxId: bt.id,
          amount: first.amount,
          status: S.AWAITING_CONFIRMATIONS,
          ...(changed ? { history: pushHistory(d.history, { status: S.AWAITING_CONFIRMATIONS, by: 'SYSTEM', note: `${result.confirmations}/${result.requiredConfirmations} confirmations` }) } : {}),
        },
      });
      return current;
    }

    // CONFIRMED
    if (current.status === S.VERIFIED || current.status === S.UNDER_REVIEW) {
      return tx.deposit.update({ where: { id: d.id }, data: { blockchainTxId: bt.id, amount: first.amount } });
    }
    let history = pushHistory(d.history, { status: S.VERIFIED, by: 'SYSTEM', note: `${result.confirmations} confirmations · ${formatAmount(first.amount)} USDT` });
    let status: string = S.VERIFIED;
    if (d.userId) {
      status = S.UNDER_REVIEW;
      history = pushHistory(history, { status: S.UNDER_REVIEW, by: 'SYSTEM', note: 'Awaiting administrator review' });
    }
    current = await tx.deposit.update({
      where: { id: d.id },
      data: { blockchainTxId: bt.id, amount: first.amount, status, verifiedAt: new Date(), verificationError: null, history },
    });
    await audit(tx, {
      ...sys,
      action: 'DEPOSIT_VERIFIED_ONCHAIN',
      entityType: 'Deposit',
      entityId: d.id,
      details: { txHash: d.txHash, logIndex: first.logIndex, amount: first.amount, from: first.from, confirmations: result.confirmations, blockNumber: result.blockNumber },
    });
    if (d.userId) {
      await notify(tx, d.userId, 'DEPOSIT', 'Deposit verified on-chain', `${formatAmount(first.amount)} USDT was verified on-chain and is now awaiting administrator review. It has not been credited yet.`);
    }
    return current;
  });
}

/** Admin: attribute a verified (possibly unmatched) deposit to a customer account. */
export async function assignDeposit(actor: Actor, depositId: string, userId: string, note?: string) {
  return withTx(async (tx) => {
    const d = await tx.deposit.findUnique({ where: { id: depositId }, include: { blockchainTx: true } });
    if (!d) throw notFound('Deposit');
    if (d.status === S.APPROVED || d.creditRef) throw conflict('ALREADY_CREDITED', 'This deposit has already been credited and cannot be reassigned');
    const reopen = d.status === S.REJECTED;
    if (reopen && d.blockchainTx?.status !== 'CONFIRMED') {
      throw conflict('NOT_VERIFIED', 'Only deposits backed by a confirmed on-chain transfer can be re-attributed');
    }
    const target = await tx.user.findUnique({ where: { id: userId } });
    if (!target || target.role !== 'USER') throw badRequest('INVALID_USER', 'Deposits can only be attributed to customer accounts');
    if (target.status !== 'ACTIVE') throw badRequest('INVALID_USER', 'Target account is suspended');
    if (target.id === actor.id) throw forbidden('You cannot attribute a deposit to your own account');

    const status = d.blockchainTx?.status === 'CONFIRMED' ? S.UNDER_REVIEW : d.status === S.REJECTED ? S.AWAITING_CONFIRMATIONS : d.status;
    const u = await tx.deposit.update({
      where: { id: d.id },
      data: {
        userId,
        status,
        verificationError: reopen ? null : d.verificationError,
        reviewNote: note ?? d.reviewNote,
        history: pushHistory(d.history, { status, event: 'ATTRIBUTED', by: actor.id, note: note ?? `Attributed to ${target.email}` }),
      },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'DEPOSIT_ATTRIBUTED', entityType: 'Deposit', entityId: d.id, details: { fromUserId: d.userId, toUserId: userId, note }, ip: actor.ip });
    return u;
  });
}

/**
 * Admin approval. Re-verifies on-chain at approval time, then credits the ledger exactly once
 * (Deposit.creditRef and Transaction.reference are both UNIQUE).
 */
export async function approveDeposit(actor: Actor, depositId: string, note?: string) {
  const pre = await prisma.deposit.findUnique({ where: { id: depositId } });
  if (!pre) throw notFound('Deposit');
  if (pre.status === S.APPROVED) throw conflict('ALREADY_APPROVED', 'Deposit already approved and credited');
  if (pre.userId === actor.id) throw forbidden('You cannot approve your own deposit');

  // Fresh independent verification right before crediting.
  await refreshDeposit(depositId);

  const cfg = chainConfig();
  if (cfg.mode === 'mainnet') {
    const gate = await complianceStatus();
    if (!gate.realDepositsEnabled) throw new AppError(403, 'COMPLIANCE_GATE_CLOSED', 'Real deposits are disabled by the compliance gate');
  }

  return withTx(async (tx) => {
    const d = await tx.deposit.findUniqueOrThrow({ where: { id: depositId }, include: { blockchainTx: true } });
    if (d.status === S.APPROVED || d.creditRef) throw conflict('ALREADY_APPROVED', 'Deposit already approved and credited');
    if (!d.userId) throw conflict('UNMATCHED', 'Attribute this deposit to a user before approving');
    if (d.userId === actor.id) throw forbidden('You cannot approve your own deposit');
    if (d.status !== S.UNDER_REVIEW) throw conflict('NOT_READY', `Deposit is ${d.status}; only verified deposits under review can be approved`);
    const bt = d.blockchainTx;
    const minConf = await getMinConfirmations(tx);
    if (!bt || bt.status !== 'CONFIRMED' || bt.confirmations < minConf) throw conflict('NOT_CONFIRMED', 'On-chain transfer is not sufficiently confirmed');
    if (bt.chainId !== cfg.chainId) throw conflict('WRONG_CHAIN', 'Deposit belongs to a different network than the one configured');
    if (d.isSample !== (cfg.mode !== 'mainnet')) throw conflict('MODE_MISMATCH', 'Sample/testnet deposits cannot be credited in this mode');
    const user = await tx.user.findUniqueOrThrow({ where: { id: d.userId } });
    if (user.status !== 'ACTIVE') throw conflict('USER_SUSPENDED', 'Account is suspended');

    const creditRef = creditRefOf(bt.chainId, bt.txHash, bt.logIndex);
    const journal = await post(tx, {
      reference: `DEPOSIT_CREDIT:${creditRef}`,
      type: 'DEPOSIT_CREDIT',
      description: `Verified USDT deposit ${bt.txHash.slice(0, 10)}…${bt.txHash.slice(-6)}${d.isSample ? ' [SAMPLE/TEST]' : ''}`,
      userId: d.userId,
      createdById: actor.id,
      isSample: d.isSample,
      legs: [
        { account: { platform: 'DEPOSIT_CLEARING' }, amount: -bt.amount },
        { account: { user: d.userId, type: 'AVAILABLE' }, amount: bt.amount },
      ],
    });
    const u = await tx.deposit.update({
      where: { id: d.id },
      data: {
        status: S.APPROVED,
        creditRef,
        ledgerTxId: journal.id,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewNote: note ?? d.reviewNote,
        history: pushHistory(d.history, { status: S.APPROVED, by: actor.id, note: note ?? 'Credited to internal balance' }),
      },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'DEPOSIT_APPROVED', entityType: 'Deposit', entityId: d.id, details: { userId: d.userId, amount: bt.amount, creditRef, ledgerTxId: journal.id, note }, ip: actor.ip });
    await notify(tx, d.userId, 'DEPOSIT', 'Deposit approved', `${formatAmount(bt.amount)} USDT has been credited to your internal available balance.`);
    return u;
  });
}

export async function rejectDeposit(actor: Actor, depositId: string, reason: string) {
  return withTx(async (tx) => {
    const d = await tx.deposit.findUnique({ where: { id: depositId } });
    if (!d) throw notFound('Deposit');
    if (d.status === S.APPROVED) throw conflict('ALREADY_APPROVED', 'An approved deposit cannot be rejected; use a corrective ledger adjustment');
    if (d.status === S.REJECTED) throw conflict('ALREADY_REJECTED', 'Deposit already rejected');
    const u = await tx.deposit.update({
      where: { id: d.id },
      data: { status: S.REJECTED, reviewedById: actor.id, reviewedAt: new Date(), reviewNote: reason, history: pushHistory(d.history, { status: S.REJECTED, by: actor.id, note: reason }) },
    });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'DEPOSIT_REJECTED', entityType: 'Deposit', entityId: d.id, details: { reason }, ip: actor.ip });
    if (d.userId) await notify(tx, d.userId, 'DEPOSIT', 'Deposit rejected', `Your deposit ${d.txHash.slice(0, 12)}… was rejected: ${reason}`);
    return u;
  });
}

export async function addDepositNote(actor: Actor, depositId: string, note: string) {
  return withTx(async (tx) => {
    const d = await tx.deposit.findUnique({ where: { id: depositId } });
    if (!d) throw notFound('Deposit');
    const u = await tx.deposit.update({ where: { id: d.id }, data: { reviewNote: note, history: pushHistory(d.history, { event: 'NOTE', by: actor.id, note }) } });
    await audit(tx, { actorId: actor.id, actorRole: actor.role, action: 'DEPOSIT_NOTE', entityType: 'Deposit', entityId: d.id, details: { note }, ip: actor.ip });
    return u;
  });
}

/** Other deposits from the same sending address — a hint for attribution review on a shared address. */
export async function senderHistory(fromAddress: string, excludeDepositId: string) {
  const rows = await prisma.deposit.findMany({
    where: { blockchainTx: { fromAddress }, id: { not: excludeDepositId }, status: S.APPROVED },
    include: { user: { select: { id: true, email: true, name: true } } },
    take: 20,
    orderBy: { submittedAt: 'desc' },
  });
  return rows.map((r) => ({ depositId: r.id, txHash: r.txHash, amount: r.amount, user: r.user }));
}

// ── Background jobs ──────────────────────────────────────────────────────────

export async function refreshOpenDeposits() {
  const open = await prisma.deposit.findMany({
    where: { OR: [{ status: { in: OPEN_STATUSES } }, { status: { in: [S.VERIFIED, S.UNDER_REVIEW] }, blockchainTx: { status: 'PENDING' } }] },
    select: { id: true },
    take: 200,
  });
  let n = 0;
  for (const { id } of open) {
    try {
      await refreshDeposit(id);
      n++;
    } catch (e) {
      console.warn(`[deposits] refresh ${id} failed: ${(e as Error).message}`);
    }
  }
  return n;
}

/**
 * Scanner: detect incoming USDT transfers to the receiving wallet that nobody submitted,
 * so administrators can resolve them as "unmatched deposits".
 */
export async function scanReceivingWallet() {
  const policy = await depositPolicy();
  if (!policy.accepting || !policy.wallet) return { scanned: 0, found: 0, skipped: policy.reason };
  const wallet = policy.wallet;
  const cfg = chainConfig();
  const p = getChainProvider();
  const key = `scanner.lastBlock.${cfg.chainId}.${wallet.address}`;
  const head = await p.getBlockNumber();
  const lastStr = await getSetting(key);
  const from = lastStr ? Number(lastStr) + 1 : Math.max(0, head - env.SCANNER_BLOCK_CHUNK);
  if (from > head) return { scanned: 0, found: 0 };
  const to = Math.min(head, from + env.SCANNER_BLOCK_CHUNK - 1);
  const transfers = await p.findTransfersTo(cfg.tokenContract, wallet.address, from, to);

  let found = 0;
  await withTx(async (tx) => {
    for (const t of transfers) {
      const exists = await tx.deposit.findFirst({ where: { chainId: cfg.chainId, txHash: t.txHash } });
      if (exists) continue;
      const d = await tx.deposit.create({
        data: {
          userId: null,
          walletId: wallet.id,
          chainId: cfg.chainId,
          txHash: t.txHash,
          isSample: cfg.mode !== 'mainnet',
          amount: t.amount,
          status: S.AWAITING_CONFIRMATIONS,
          history: pushHistory('[]', { status: S.AWAITING_CONFIRMATIONS, by: 'SCANNER', note: `Detected incoming transfer in block ${t.blockNumber}` }),
        },
      });
      await audit(tx, { actorId: null, actorRole: 'SYSTEM', action: 'DEPOSIT_DETECTED_UNMATCHED', entityType: 'Deposit', entityId: d.id, details: { txHash: t.txHash, amount: t.amount, from: t.from, block: t.blockNumber } });
      found++;
    }
    await setSetting(tx, key, String(to), null);
  });
  return { scanned: to - from + 1, found, from, to };
}
