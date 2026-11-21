import { beforeAll, describe, expect, it } from 'vitest';
import { asNewUser, ensureSampleWallet, mine, randomAddress, sampleTransfer, usdt } from './helpers.js';
import { getUserBalances, reconcileLedger } from '../src/ledger/ledger.js';
import { prisma } from '../src/lib/prisma.js';
import { verifyAuditChain } from '../src/audit/audit.js';

type Session = Awaited<ReturnType<typeof asNewUser>>;
let admin: Session;
let superadmin: Session;

async function fundedUser(amount = 1000) {
  const u = await asNewUser();
  const r = await admin.post(`/api/admin/users/${u.user.id}/balance`).send({ kind: 'CREDIT', amount: String(amount), reason: 'Test funding' });
  expect(r.status).toBe(201);
  return u;
}

beforeAll(async () => {
  await ensureSampleWallet();
  admin = await asNewUser('ADMIN');
  superadmin = await asNewUser('SUPERADMIN');
});

describe('admin balance management', () => {
  it('credits, debits, locks and unlocks with ledger entries and reasons', async () => {
    const u = await fundedUser(100);
    const id = u.user.id;
    await admin.post(`/api/admin/users/${id}/balance`).send({ kind: 'DEBIT', amount: '10', reason: 'Fee correction' });
    await admin.post(`/api/admin/users/${id}/balance`).send({ kind: 'LOCK', amount: '20', reason: 'Compliance hold' });
    let b = await getUserBalances(id);
    expect(b).toMatchObject({ available: usdt(70), locked: usdt(20), total: usdt(90) });
    await admin.post(`/api/admin/users/${id}/balance`).send({ kind: 'UNLOCK', amount: '5', reason: 'Partial release' });
    b = await getUserBalances(id);
    expect(b).toMatchObject({ available: usdt(75), locked: usdt(15) });

    // cannot over-debit / over-unlock
    expect((await admin.post(`/api/admin/users/${id}/balance`).send({ kind: 'DEBIT', amount: '1000', reason: 'too much' })).status).toBe(422);
    expect((await admin.post(`/api/admin/users/${id}/balance`).send({ kind: 'UNLOCK', amount: '16', reason: 'too much' })).status).toBe(422);
    // a reason is mandatory
    expect((await admin.post(`/api/admin/users/${id}/balance`).send({ kind: 'CREDIT', amount: '1' })).status).toBe(400);

    // the user sees every movement in their ledger
    const ledger = await u.get('/api/me/ledger');
    expect(ledger.body.total).toBeGreaterThanOrEqual(6);
    const csv = await u.get('/api/me/ledger/export.csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Compliance hold');
  });

  it('idempotency key prevents double-submitted credits', async () => {
    const u = await asNewUser();
    const key = 'abcdef12-test-key-0001';
    const r1 = await admin.post(`/api/admin/users/${u.user.id}/balance`).set('Idempotency-Key', key).send({ kind: 'CREDIT', amount: '5', reason: 'once' });
    const r2 = await admin.post(`/api/admin/users/${u.user.id}/balance`).set('Idempotency-Key', key).send({ kind: 'CREDIT', amount: '5', reason: 'once' });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(409);
    expect((await getUserBalances(u.user.id)).available).toBe(usdt(5));
  });

  it('admins cannot credit their own (or another admin) account', async () => {
    expect((await admin.post(`/api/admin/users/${admin.user.id}/balance`).send({ kind: 'CREDIT', amount: '5', reason: 'self' })).status).toBe(400);
    expect((await admin.post(`/api/admin/users/${superadmin.user.id}/balance`).send({ kind: 'CREDIT', amount: '5', reason: 'x' })).status).toBe(400);
  });
});

describe('internal staking', () => {
  it('plan CRUD, request → approve → end moves balances correctly', async () => {
    const plan = await admin.post('/api/admin/staking/plans').send({ name: 'Test 7', description: 'Seven day internal record', durationDays: 7, minAmount: '10', maxAmount: '500', indicativeRewardBps: 400, rewardRule: 'Discretionary allocation at term end' });
    expect(plan.status).toBe(201);
    const u = await fundedUser(300);

    expect((await u.post('/api/me/staking').send({ planId: plan.body.id, amount: '5' })).status).toBe(400); // below min
    expect((await u.post('/api/me/staking').send({ planId: plan.body.id, amount: '501' })).status).toBe(400); // above max
    expect((await u.post('/api/me/staking').send({ planId: plan.body.id, amount: '400' })).status).toBe(422); // more than available

    const req = await u.post('/api/me/staking').send({ planId: plan.body.id, amount: '200' });
    expect(req.status).toBe(201);
    expect(await getUserBalances(u.user.id)).toMatchObject({ available: usdt(100), pending: usdt(200) });

    // cannot over-commit a second request
    expect((await u.post('/api/me/staking').send({ planId: plan.body.id, amount: '150' })).status).toBe(422);

    const ap = await admin.post(`/api/admin/staking/records/${req.body.id}/review`).send({ decision: 'APPROVE', note: 'ok' });
    expect(ap.body.status).toBe('ACTIVE');
    expect(await getUserBalances(u.user.id)).toMatchObject({ available: usdt(100), pending: 0n, staked: usdt(200) });

    const sug = await admin.get(`/api/admin/staking/records/${req.body.id}/suggested-reward`);
    expect(sug.body.note).toMatch(/never automatic or guaranteed/);

    const end = await admin.post(`/api/admin/staking/records/${req.body.id}/end`).send({ note: 'term complete' });
    expect(end.body.status).toBe('ENDED');
    expect(await getUserBalances(u.user.id)).toMatchObject({ available: usdt(300), staked: 0n });

    // deactivate plan → no more requests
    await admin.patch(`/api/admin/staking/plans/${plan.body.id}`).send({ status: 'INACTIVE' });
    expect((await u.post('/api/me/staking').send({ planId: plan.body.id, amount: '20' })).status).toBe(400);
  });

  it('rejection and cancellation return reserved funds', async () => {
    const plan = await prisma.stakingPlan.create({ data: { name: 'R', description: 'r', durationDays: 1, minAmount: 1n, maxAmount: usdt(1000), indicativeRewardBps: 0, rewardRule: 'none', createdById: admin.user.id } });
    const u = await fundedUser(50);
    const r1 = await u.post('/api/me/staking').send({ planId: plan.id, amount: '20' });
    expect((await admin.post(`/api/admin/staking/records/${r1.body.id}/review`).send({ decision: 'REJECT' })).status).toBe(400); // reason needed
    await admin.post(`/api/admin/staking/records/${r1.body.id}/review`).send({ decision: 'REJECT', note: 'KYC incomplete' });
    const r2 = await u.post('/api/me/staking').send({ planId: plan.id, amount: '30' });
    await u.post(`/api/me/staking/${r2.body.id}/cancel`).send({});
    expect(await getUserBalances(u.user.id)).toMatchObject({ available: usdt(50), pending: 0n });
  });
});

describe('administrator-allocated rewards', () => {
  it('allocates with full metadata and reverses via corrective entry', async () => {
    const u = await asNewUser();
    const r = await admin.post('/api/admin/rewards').send({ userId: u.user.id, amount: '12.345678', description: 'Q3 discretionary reward', rateBps: 300 });
    expect(r.status).toBe(201);
    const reward = await prisma.reward.findUniqueOrThrow({ where: { id: r.body.id }, include: { ledgerTx: { include: { entries: { include: { account: true } } } } } });
    expect(reward).toMatchObject({ userId: u.user.id, amount: 12_345678n, currency: 'USDT', allocatedById: admin.user.id, description: 'Q3 discretionary reward' });
    expect(reward.ledgerTx.entries.find((e) => e.account.type === 'REWARD_FUNDING')!.amount).toBe(-12_345678n);
    expect((await getUserBalances(u.user.id)).available).toBe(12_345678n);

    const rev = await admin.post(`/api/admin/rewards/${r.body.id}/reverse`).send({ reason: 'Allocated to wrong account' });
    expect(rev.body.status).toBe('REVERSED');
    expect((await getUserBalances(u.user.id)).available).toBe(0n);
    // original entries remain (history is never deleted)
    expect(await prisma.ledgerEntry.count({ where: { transactionId: reward.ledgerTxId } })).toBe(2);
    expect((await admin.post(`/api/admin/rewards/${r.body.id}/reverse`).send({ reason: 'again' })).status).toBe(409);

    const mine_ = await u.get('/api/me/rewards');
    expect(mine_.body[0].status).toBe('REVERSED');
  });

  it('cannot reward an admin or reward yourself', async () => {
    expect((await admin.post('/api/admin/rewards').send({ userId: admin.user.id, amount: '1', description: 'self' })).status).toBe(400);
  });
});

describe('withdrawals with manual payout verification', () => {
  it('request → approve (not paid) → record payout → verify on-chain → completed', async () => {
    const u = await fundedUser(100);
    const dest = randomAddress();
    const req = await u.post('/api/me/withdrawals').send({ amount: '60', currency: 'USDT', network: 'ETHEREUM_ERC20', destinationAddress: dest });
    expect(req.status).toBe(201);
    expect(await getUserBalances(u.user.id)).toMatchObject({ available: usdt(40), pending: usdt(60) });

    const ap = await admin.post(`/api/admin/withdrawals/${req.body.id}/review`).send({ decision: 'APPROVE' });
    expect(ap.body.status).toBe('APPROVED');
    // Approval does not mean paid: still pending in the ledger
    expect((await getUserBalances(u.user.id)).pending).toBe(usdt(60));

    // Wrong amount on-chain → not completed
    const wrongTx = sampleTransfer(usdt(59), { to: dest, from: '0x' + '7'.repeat(40) });
    await admin.post(`/api/admin/withdrawals/${req.body.id}/payout`).send({ txHash: wrongTx.txHash });
    mine(5);
    const v1 = await admin.post(`/api/admin/withdrawals/${req.body.id}/verify-payout`).send({});
    expect(v1.body.completed).toBe(false);
    expect(v1.body.verification.outcome).toBe('AMOUNT_MISMATCH');

    // Correct payout
    const payTx = sampleTransfer(usdt(60), { to: dest, from: '0x' + '7'.repeat(40) });
    await admin.post(`/api/admin/withdrawals/${req.body.id}/payout`).send({ txHash: payTx.txHash, note: 'Paid from treasury' });
    const tooEarly = await admin.post(`/api/admin/withdrawals/${req.body.id}/verify-payout`).send({});
    expect(tooEarly.body.verification.outcome).toBe('INSUFFICIENT_CONFIRMATIONS');
    mine(5);
    const v2 = await admin.post(`/api/admin/withdrawals/${req.body.id}/verify-payout`).send({});
    expect(v2.body.completed).toBe(true);
    expect(await getUserBalances(u.user.id)).toMatchObject({ available: usdt(40), pending: 0n, total: usdt(40) });

    const w = (await u.get('/api/me/withdrawals')).body[0];
    expect(w.status).toBe('COMPLETED');
    expect(w.payoutTxHash).toBe(payTx.txHash);

    // the same payout hash cannot settle a second withdrawal
    const req2 = await u.post('/api/me/withdrawals').send({ amount: '10', destinationAddress: dest });
    await admin.post(`/api/admin/withdrawals/${req2.body.id}/review`).send({ decision: 'APPROVE' });
    expect((await admin.post(`/api/admin/withdrawals/${req2.body.id}/payout`).send({ txHash: payTx.txHash })).status).toBe(409);
  });

  it('validates withdrawal input and balance', async () => {
    const u = await fundedUser(10);
    expect((await u.post('/api/me/withdrawals').send({ amount: '5', destinationAddress: 'not-an-address' })).status).toBe(400);
    expect((await u.post('/api/me/withdrawals').send({ amount: '5', destinationAddress: '0x' + '0'.repeat(40) })).status).toBe(400);
    expect((await u.post('/api/me/withdrawals').send({ amount: '5', network: 'TRON', destinationAddress: randomAddress() })).status).toBe(400);
    expect((await u.post('/api/me/withdrawals').send({ amount: '11', destinationAddress: randomAddress() })).status).toBe(422);
    expect((await u.post('/api/me/withdrawals').send({ amount: '1', destinationAddress: '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0001' })).status).toBe(400);
  });

  it('rejection requires a reason, is shown to the user and releases the reserve', async () => {
    const u = await fundedUser(30);
    const req = await u.post('/api/me/withdrawals').send({ amount: '30', destinationAddress: randomAddress() });
    expect((await admin.post(`/api/admin/withdrawals/${req.body.id}/review`).send({ decision: 'REJECT' })).status).toBe(400);
    await admin.post(`/api/admin/withdrawals/${req.body.id}/review`).send({ decision: 'REJECT', note: 'Destination failed screening' });
    expect((await getUserBalances(u.user.id)).available).toBe(usdt(30));
    const w = (await u.get('/api/me/withdrawals')).body[0];
    expect(w.rejectionReason).toBe('Destination failed screening');
    const n = await u.get('/api/me/notifications');
    expect(n.body.rows.some((x: { body: string }) => x.body.includes('Destination failed screening'))).toBe(true);
  });

  it('user can cancel before approval', async () => {
    const u = await fundedUser(10);
    const req = await u.post('/api/me/withdrawals').send({ amount: '10', destinationAddress: randomAddress() });
    expect((await u.post(`/api/me/withdrawals/${req.body.id}/cancel`).send({})).body.status).toBe('CANCELLED');
    expect((await getUserBalances(u.user.id)).available).toBe(usdt(10));
  });
});

describe('integrity', () => {
  it('ledger reconciles and the audit hash-chain verifies after all operations', async () => {
    expect((await reconcileLedger()).ok).toBe(true);
    const chain = await verifyAuditChain();
    expect(chain.valid).toBe(true);
    expect(chain.checked).toBeGreaterThan(20);
    const r = await admin.get('/api/admin/system/reconcile');
    expect(r.body.ledger.ok).toBe(true);
  });

  it('records audit entries for financial actions with actor ids', async () => {
    const logs = await prisma.auditLog.findMany({ where: { action: { in: ['BALANCE_CREDIT', 'REWARD_ALLOCATED', 'WITHDRAWAL_COMPLETED', 'STAKE_APPROVED'] } } });
    const actions = new Set(logs.map((l) => l.action));
    expect(actions).toEqual(new Set(['BALANCE_CREDIT', 'REWARD_ALLOCATED', 'WITHDRAWAL_COMPLETED', 'STAKE_APPROVED']));
    expect(logs.every((l) => l.actorId)).toBe(true);
  });

  it('detects tampering with the audit chain', async () => {
    // Bypass the immutability trigger deliberately to prove tampering is detectable.
    await prisma.$executeRawUnsafe('DROP TRIGGER "AuditLog_no_update"');
    const row = await prisma.auditLog.findFirstOrThrow({ orderBy: { seq: 'asc' }, skip: 3 });
    await prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "details" = '{"tampered":true}' WHERE "seq" = ${row.seq}`);
    const chain = await verifyAuditChain();
    expect(chain.valid).toBe(false);
    expect(chain.brokenAtSeq).toBe(row.seq);
    // restore
    await prisma.$executeRawUnsafe(`UPDATE "AuditLog" SET "details" = '${row.details.replace(/'/g, "''")}' WHERE "seq" = ${row.seq}`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'AuditLog is immutable'); END;`);
    expect((await verifyAuditChain()).valid).toBe(true);
  });
});
