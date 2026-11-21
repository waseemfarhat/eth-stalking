import type { Tx } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import type { PlatformAccountType, UserAccountType } from '../lib/constants.js';

/**
 * Double-entry ledger.
 *
 * - Every movement is one `Transaction` (journal header) with ≥2 `LedgerEntry` rows summing to 0.
 * - USER accounts are platform liabilities to the user and may never go negative.
 * - PLATFORM accounts are counterparts that record where money came from / went to:
 *     DEPOSIT_CLEARING   −  verified on-chain deposits credited to users
 *     REWARD_FUNDING     −  rewards allocated by administrators (shows total discretionary rewards)
 *     ADJUSTMENTS        ±  manual admin credits / debits
 *     WITHDRAWAL_PAYOUTS +  funds paid out on-chain to users
 * - `LedgerAccount.balance` is a cache updated only here, in the same DB transaction.
 * - `Transaction.reference` is unique: replaying the same operation is rejected (idempotency).
 */

export const userAccountKey = (userId: string, type: UserAccountType, currency = 'USDT') => `USER:${userId}:${type}:${currency}`;
export const platformAccountKey = (type: PlatformAccountType, currency = 'USDT') => `PLATFORM:${type}:${currency}`;

export type AccountRef = { user: string; type: UserAccountType } | { platform: PlatformAccountType };

async function resolveAccount(tx: Tx, ref: AccountRef, currency: string) {
  const isUser = 'user' in ref;
  const key = isUser ? userAccountKey(ref.user, ref.type, currency) : platformAccountKey(ref.platform, currency);
  const existing = await tx.ledgerAccount.findUnique({ where: { key } });
  if (existing) return existing;
  return tx.ledgerAccount.create({
    data: isUser
      ? { key, ownerType: 'USER', userId: ref.user, type: ref.type, currency }
      : { key, ownerType: 'PLATFORM', type: ref.platform, currency },
  });
}

export interface PostInput {
  reference: string;
  type: string;
  description: string;
  currency?: string;
  userId?: string | null;
  createdById?: string | null;
  isSample?: boolean;
  legs: { account: AccountRef; amount: bigint }[];
}

export async function post(tx: Tx, input: PostInput) {
  const currency = input.currency ?? 'USDT';
  if (input.legs.length < 2) throw new Error('A ledger transaction needs at least two legs');
  const sum = input.legs.reduce((s, l) => s + l.amount, 0n);
  if (sum !== 0n) throw new Error(`Unbalanced ledger transaction (${sum})`);
  if (input.legs.some((l) => l.amount === 0n)) throw new Error('Zero-amount ledger leg');

  const dup = await tx.transaction.findUnique({ where: { reference: input.reference } });
  if (dup) throw new AppError(409, 'DUPLICATE_LEDGER_REFERENCE', `Ledger reference already used: ${input.reference}`);

  const journal = await tx.transaction.create({
    data: {
      reference: input.reference,
      type: input.type,
      description: input.description,
      currency,
      userId: input.userId ?? null,
      createdById: input.createdById ?? null,
      isSample: input.isSample ?? false,
    },
  });

  for (const leg of input.legs) {
    const account = await resolveAccount(tx, leg.account, currency);
    let balanceAfter: bigint;
    if (account.ownerType === 'USER' && leg.amount < 0n) {
      // Atomic guarded decrement: only succeeds if the balance covers it.
      const res = await tx.ledgerAccount.updateMany({
        where: { id: account.id, balance: { gte: -leg.amount } },
        data: { balance: { increment: leg.amount } },
      });
      if (res.count !== 1) {
        throw new AppError(422, 'INSUFFICIENT_BALANCE', `Insufficient ${account.type.toLowerCase()} balance`);
      }
      balanceAfter = (await tx.ledgerAccount.findUniqueOrThrow({ where: { id: account.id } })).balance;
    } else {
      const updated = await tx.ledgerAccount.update({
        where: { id: account.id },
        data: { balance: { increment: leg.amount } },
      });
      balanceAfter = updated.balance;
    }
    await tx.ledgerEntry.create({
      data: { transactionId: journal.id, accountId: account.id, amount: leg.amount, balanceAfter },
    });
  }
  return journal;
}

export interface UserBalances {
  available: bigint;
  locked: bigint;
  pending: bigint;
  staked: bigint;
  total: bigint;
}

export async function getUserBalances(userId: string, currency = 'USDT', client: Tx | typeof prisma = prisma): Promise<UserBalances> {
  const accounts = await client.ledgerAccount.findMany({ where: { userId, currency } });
  const get = (t: string) => accounts.find((a) => a.type === t)?.balance ?? 0n;
  const b = { available: get('AVAILABLE'), locked: get('LOCKED'), pending: get('PENDING'), staked: get('STAKED') };
  return { ...b, total: b.available + b.locked + b.pending + b.staked };
}

/** Totals used for the admin liabilities / reserve view. */
export async function getPlatformTotals(currency = 'USDT') {
  const groups = await prisma.ledgerAccount.groupBy({
    by: ['ownerType', 'type'],
    where: { currency },
    _sum: { balance: true },
  });
  const out: Record<string, bigint> = {};
  for (const g of groups) out[`${g.ownerType}:${g.type}`] = g._sum.balance ?? 0n;
  const v = (k: string) => out[k] ?? 0n;
  const userLiabilities = v('USER:AVAILABLE') + v('USER:LOCKED') + v('USER:PENDING') + v('USER:STAKED');
  return {
    userAvailable: v('USER:AVAILABLE'),
    userLocked: v('USER:LOCKED'),
    userPending: v('USER:PENDING'),
    userStaked: v('USER:STAKED'),
    userLiabilities,
    depositsCredited: -v('PLATFORM:DEPOSIT_CLEARING'),
    rewardsAllocated: -v('PLATFORM:REWARD_FUNDING'),
    netAdjustments: -v('PLATFORM:ADJUSTMENTS'),
    withdrawalsPaid: v('PLATFORM:WITHDRAWAL_PAYOUTS'),
  };
}

/**
 * Integrity check: cached balances equal the sum of entries, and every journal sums to zero.
 */
export async function reconcileLedger() {
  const sums = await prisma.ledgerEntry.groupBy({ by: ['accountId'], _sum: { amount: true } });
  const accounts = await prisma.ledgerAccount.findMany();
  const mismatches: { key: string; cached: string; computed: string }[] = [];
  for (const a of accounts) {
    const computed = sums.find((s) => s.accountId === a.id)?._sum.amount ?? 0n;
    if (computed !== a.balance) mismatches.push({ key: a.key, cached: a.balance.toString(), computed: computed.toString() });
  }
  const journals = await prisma.ledgerEntry.groupBy({ by: ['transactionId'], _sum: { amount: true } });
  const unbalanced = journals.filter((j) => (j._sum.amount ?? 0n) !== 0n).map((j) => j.transactionId);
  const negativeUser = accounts.filter((a) => a.ownerType === 'USER' && a.balance < 0n).map((a) => a.key);
  return { ok: mismatches.length === 0 && unbalanced.length === 0 && negativeUser.length === 0, mismatches, unbalanced, negativeUser };
}
