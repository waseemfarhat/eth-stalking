import { describe, expect, it } from 'vitest';
import { getUserBalances, post, reconcileLedger } from '../src/ledger/ledger.js';
import { prisma, withTx } from '../src/lib/prisma.js';
import { makeUser } from './helpers.js';
import { audit } from '../src/audit/audit.js';

describe('double-entry ledger', () => {
  it('posts balanced transactions and maintains balances', async () => {
    const u = await makeUser();
    await withTx((tx) =>
      post(tx, {
        reference: `T1:${u.id}`,
        type: 'ADMIN_CREDIT',
        description: 'test',
        userId: u.id,
        legs: [
          { account: { platform: 'ADJUSTMENTS' }, amount: -100_000000n },
          { account: { user: u.id, type: 'AVAILABLE' }, amount: 100_000000n },
        ],
      }),
    );
    await withTx((tx) =>
      post(tx, {
        reference: `T2:${u.id}`,
        type: 'ADMIN_LOCK',
        description: 'test',
        userId: u.id,
        legs: [
          { account: { user: u.id, type: 'AVAILABLE' }, amount: -30_000000n },
          { account: { user: u.id, type: 'LOCKED' }, amount: 30_000000n },
        ],
      }),
    );
    const b = await getUserBalances(u.id);
    expect(b).toMatchObject({ available: 70_000000n, locked: 30_000000n, total: 100_000000n });
  });

  it('rejects unbalanced transactions', async () => {
    const u = await makeUser();
    await expect(
      withTx((tx) => post(tx, { reference: `U:${u.id}`, type: 'X', description: 'x', legs: [{ account: { platform: 'ADJUSTMENTS' }, amount: -1n }, { account: { user: u.id, type: 'AVAILABLE' }, amount: 2n }] })),
    ).rejects.toThrow(/Unbalanced/);
  });

  it('never lets a user balance go negative, and rolls back atomically', async () => {
    const u = await makeUser();
    await expect(
      withTx((tx) => post(tx, { reference: `N:${u.id}`, type: 'ADMIN_DEBIT', description: 'x', userId: u.id, legs: [{ account: { user: u.id, type: 'AVAILABLE' }, amount: -1n }, { account: { platform: 'ADJUSTMENTS' }, amount: 1n }] })),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    // the journal header created before the failure was rolled back with the transaction
    expect(await prisma.transaction.findUnique({ where: { reference: `N:${u.id}` } })).toBeNull();
  });

  it('rejects a reused reference (idempotency)', async () => {
    const u = await makeUser();
    const legs = [
      { account: { platform: 'ADJUSTMENTS' as const }, amount: -5n },
      { account: { user: u.id, type: 'AVAILABLE' as const }, amount: 5n },
    ];
    await withTx((tx) => post(tx, { reference: `I:${u.id}`, type: 'X', description: 'x', legs }));
    await expect(withTx((tx) => post(tx, { reference: `I:${u.id}`, type: 'X', description: 'x', legs }))).rejects.toMatchObject({ code: 'DUPLICATE_LEDGER_REFERENCE' });
    expect((await getUserBalances(u.id)).available).toBe(5n);
  });

  it('serialises concurrent debits so a balance cannot be double-spent', async () => {
    const u = await makeUser();
    await withTx((tx) => post(tx, { reference: `C0:${u.id}`, type: 'X', description: 'x', legs: [{ account: { platform: 'ADJUSTMENTS' }, amount: -10n }, { account: { user: u.id, type: 'AVAILABLE' }, amount: 10n }] }));
    const attempts = Array.from({ length: 5 }, (_, i) =>
      withTx((tx) => post(tx, { reference: `C${i + 1}:${u.id}`, type: 'X', description: 'x', legs: [{ account: { user: u.id, type: 'AVAILABLE' }, amount: -4n }, { account: { platform: 'ADJUSTMENTS' }, amount: 4n }] })),
    );
    const results = await Promise.allSettled(attempts);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect((await getUserBalances(u.id)).available).toBe(2n);
  });

  it('ledger entries, journals and audit logs are immutable at the database level', async () => {
    await withTx((tx) => audit(tx, { action: 'TEST', entityType: 'Test' }));
    const entry = await prisma.ledgerEntry.findFirstOrThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "LedgerEntry" SET "amount" = 999 WHERE "id" = '${entry.id}'`)).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "id" = '${entry.id}'`)).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "Transaction" SET "description" = 'x'`)).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow(/immutable/);
  });

  it('reconciles: cached balances equal the sum of entries', async () => {
    const r = await reconcileLedger();
    expect(r).toMatchObject({ ok: true, mismatches: [], unbalanced: [], negativeUser: [] });
  });
});
