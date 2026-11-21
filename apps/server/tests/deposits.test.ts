import { beforeAll, describe, expect, it } from 'vitest';
import { asNewUser, ensureSampleWallet, mine, randomAddress, sampleTransfer, usdt } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';
import { scanReceivingWallet } from '../src/modules/deposits.service.js';
import { getUserBalances } from '../src/ledger/ledger.js';

type Session = Awaited<ReturnType<typeof asNewUser>>;
let admin: Session;

beforeAll(async () => {
  await ensureSampleWallet();
  admin = await asNewUser('ADMIN');
});

describe('deposit verification & approval workflow', () => {
  it('runs the full flow: submit → awaiting confirmations → verified/under review → approved → credited', async () => {
    const alice = await asNewUser();
    const tx = sampleTransfer(usdt(250));

    // MIN_CONFIRMATIONS=3 in tests; a freshly included tx has 1 confirmation
    const sub = await alice.post('/api/me/deposits').send({ txHash: tx.txHash });
    expect(sub.status).toBe(201);
    expect(sub.body[0].status).toBe('AWAITING_CONFIRMATIONS');
    expect(sub.body[0].amount).toBe('250.000000');

    // Nothing credited yet
    expect((await getUserBalances(alice.user.id)).available).toBe(0n);

    // Admin cannot approve before confirmations
    const early = await admin.post(`/api/admin/deposits/${sub.body[0].id}/approve`).send({});
    expect(early.status).toBe(409);

    mine(5);
    const ref = await alice.post(`/api/me/deposits/${sub.body[0].id}/refresh`).send({});
    expect(ref.body.status).toBe('UNDER_REVIEW');
    expect(ref.body.history.map((h: { status: string }) => h.status)).toEqual(['SUBMITTED', 'AWAITING_CONFIRMATIONS', 'VERIFIED', 'UNDER_REVIEW']);
    expect(ref.body.blockchainTx.status).toBe('CONFIRMED');

    // User cannot approve their own deposit (no access to admin API at all)
    expect((await alice.post(`/api/admin/deposits/${sub.body[0].id}/approve`).send({})).status).toBe(403);

    const ok = await admin.post(`/api/admin/deposits/${sub.body[0].id}/approve`).send({ note: 'matched' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('APPROVED');
    expect(ok.body.creditRef).toBe(`31337:${tx.txHash}:0`);

    const bal = await getUserBalances(alice.user.id);
    expect(bal.available).toBe(usdt(250));

    // Approving again must not double-credit
    expect((await admin.post(`/api/admin/deposits/${sub.body[0].id}/approve`).send({})).status).toBe(409);
    expect((await getUserBalances(alice.user.id)).available).toBe(usdt(250));

    // A ledger journal exists with the unique credit reference
    const j = await prisma.transaction.findUniqueOrThrow({ where: { reference: `DEPOSIT_CREDIT:31337:${tx.txHash}:0` }, include: { entries: true } });
    expect(j.entries.reduce((s, e) => s + e.amount, 0n)).toBe(0n);

    // Overview reflects verified deposit and balance
    const ov = await alice.get('/api/me/overview');
    expect(ov.body.balances.available).toBe('250.000000');
    expect(ov.body.deposits.approvedTotal).toBe('250.000000');
  });

  it('rejects duplicate transaction hashes across accounts', async () => {
    const a = await asNewUser();
    const b = await asNewUser();
    const tx = sampleTransfer(usdt(10));
    expect((await a.post('/api/me/deposits').send({ txHash: tx.txHash })).status).toBe(201);
    const dup = await b.post('/api/me/deposits').send({ txHash: tx.txHash });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_TRANSACTION');
    // same user re-submitting is also a duplicate
    expect((await a.post('/api/me/deposits').send({ txHash: tx.txHash.toUpperCase().replace('0X', '0x') })).status).toBe(409);
  });

  it('a transaction hash can never be credited to two accounts, even via re-attribution', async () => {
    const a = await asNewUser();
    const b = await asNewUser();
    const tx = sampleTransfer(usdt(40));
    mine(5);
    const sub = await a.post('/api/me/deposits').send({ txHash: tx.txHash });
    expect((await admin.post(`/api/admin/deposits/${sub.body[0].id}/approve`).send({})).status).toBe(200);
    const re = await admin.post(`/api/admin/deposits/${sub.body[0].id}/assign`).send({ userId: b.user.id });
    expect(re.status).toBe(409);
    expect((await getUserBalances(b.user.id)).available).toBe(0n);
    // DB-level guard: a credited deposit cannot be edited
    // (SQLite trigger RAISE(ABORT) surfaces through Prisma as a constraint violation)
    await expect(prisma.deposit.update({ where: { id: sub.body[0].id }, data: { userId: b.user.id } })).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "Deposit" SET "userId" = '${b.user.id}' WHERE "id" = '${sub.body[0].id}'`)).rejects.toThrow(/cannot be modified/);
    expect((await prisma.deposit.findUniqueOrThrow({ where: { id: sub.body[0].id } })).userId).toBe(a.user.id);
  });

  it('rejects transfers of the wrong token contract', async () => {
    const u = await asNewUser();
    const tx = sampleTransfer(usdt(99), { token: '0x0bad0bad0bad0bad0bad0bad0bad0bad0bad0bad' });
    const r = await u.post('/api/me/deposits').send({ txHash: tx.txHash });
    expect(r.body[0].status).toBe('REJECTED');
    expect(r.body[0].verificationError).toMatch(/^INVALID_TOKEN/);
  });

  it('rejects transfers to an incorrect destination address', async () => {
    const u = await asNewUser();
    const tx = sampleTransfer(usdt(99), { to: randomAddress() });
    const r = await u.post('/api/me/deposits').send({ txHash: tx.txHash });
    expect(r.body[0].status).toBe('REJECTED');
    expect(r.body[0].verificationError).toMatch(/^WRONG_DESTINATION/);
  });

  it('rejects failed (reverted) transactions', async () => {
    const u = await asNewUser();
    const tx = sampleTransfer(usdt(99), { status: 'failed' });
    const r = await u.post('/api/me/deposits').send({ txHash: tx.txHash });
    expect(r.body[0].status).toBe('REJECTED');
    expect(r.body[0].verificationError).toMatch(/^FAILED/);
  });

  it('keeps unknown hashes awaiting verification and pending txs awaiting confirmations', async () => {
    const u = await asNewUser();
    const unknown = await u.post('/api/me/deposits').send({ txHash: '0x' + 'ab'.repeat(32) });
    expect(unknown.body[0].status).toBe('AWAITING_VERIFICATION');
    const pend = sampleTransfer(usdt(5), { status: 'pending' });
    const p = await u.post('/api/me/deposits').send({ txHash: pend.txHash });
    expect(p.body[0].status).toBe('AWAITING_CONFIRMATIONS');
    mine(5);
    const after = await u.post(`/api/me/deposits/${p.body[0].id}/refresh`).send({});
    expect(after.body.status).toBe('UNDER_REVIEW');
  });

  it('rejects malformed hashes', async () => {
    const u = await asNewUser();
    expect((await u.post('/api/me/deposits').send({ txHash: '0x1234' })).status).toBe(400);
    expect((await u.post('/api/me/deposits').send({ txHash: 'screenshot.png' })).status).toBe(400);
  });

  it('scanner detects unmatched deposits; admin attributes and approves them', async () => {
    const u = await asNewUser();
    const tx = sampleTransfer(usdt(77));
    mine(5);
    await scanReceivingWallet();
    const d = await prisma.deposit.findFirstOrThrow({ where: { txHash: tx.txHash } });
    expect(d.userId).toBeNull();

    const list = await admin.get('/api/admin/deposits?unmatched=true');
    expect(list.body.rows.some((r: { id: string }) => r.id === d.id)).toBe(true);

    // cannot approve unmatched
    await admin.post(`/api/admin/deposits/${d.id}/refresh`).send({});
    expect((await admin.post(`/api/admin/deposits/${d.id}/approve`).send({})).status).toBe(409);
    // cannot attribute to an admin account
    expect((await admin.post(`/api/admin/deposits/${d.id}/assign`).send({ userId: admin.user.id })).status).toBe(400);

    const as = await admin.post(`/api/admin/deposits/${d.id}/assign`).send({ userId: u.user.id, note: 'Matched by support ticket #12' });
    expect(as.body.status).toBe('UNDER_REVIEW');
    expect((await admin.post(`/api/admin/deposits/${d.id}/approve`).send({})).status).toBe(200);
    expect((await getUserBalances(u.user.id)).available).toBe(usdt(77));
  });

  it('a user can claim a scanner-detected transfer, but it still needs admin approval', async () => {
    const u = await asNewUser();
    const tx = sampleTransfer(usdt(12));
    mine(5);
    await scanReceivingWallet();
    const claim = await u.post('/api/me/deposits').send({ txHash: tx.txHash });
    expect(claim.status).toBe(201);
    expect(claim.body[0].userId).toBe(u.user.id);
    expect(['UNDER_REVIEW', 'AWAITING_CONFIRMATIONS']).toContain(claim.body[0].status);
    expect((await getUserBalances(u.user.id)).available).toBe(0n);
  });

  it('admin can reject a deposit with a reason and re-attribute a confirmed transfer', async () => {
    const wrong = await asNewUser();
    const right = await asNewUser();
    const tx = sampleTransfer(usdt(15));
    mine(5);
    const sub = await wrong.post('/api/me/deposits').send({ txHash: tx.txHash });
    const rej = await admin.post(`/api/admin/deposits/${sub.body[0].id}/reject`).send({ reason: 'Sender address belongs to another customer' });
    expect(rej.body.status).toBe('REJECTED');
    const re = await admin.post(`/api/admin/deposits/${sub.body[0].id}/assign`).send({ userId: right.user.id, note: 'Correct owner' });
    expect(re.body.status).toBe('UNDER_REVIEW');
    await admin.post(`/api/admin/deposits/${sub.body[0].id}/approve`).send({});
    expect((await getUserBalances(right.user.id)).available).toBe(usdt(15));
    expect((await getUserBalances(wrong.user.id)).available).toBe(0n);
    const n = await admin.post(`/api/admin/deposits/${sub.body[0].id}/note`).send({ note: 'Post-approval note' });
    expect(n.status).toBe(200);
  });

  it('handles multiple USDT transfers to us inside one transaction as separate credits', async () => {
    const { getSampleProvider } = await import('../src/chain/service.js');
    const { SAMPLE_TOKEN } = await import('../src/config/env.js');
    const p = getSampleProvider();
    const tx = p.createTransfer({ token: SAMPLE_TOKEN, to: '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0001', amount: usdt(1) });
    // add a second log to the same tx
    const state = (p as unknown as { state: { txs: { txHash: string; transfers: unknown[] }[] } }).state;
    state.txs.find((t) => t.txHash === tx.txHash)!.transfers.push({ logIndex: 1, token: SAMPLE_TOKEN, from: '0x' + '9'.repeat(40), to: '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0001', amount: usdt(2).toString() });
    mine(5);
    const u = await asNewUser();
    await u.post('/api/me/deposits').send({ txHash: tx.txHash });
    const rows = await prisma.deposit.findMany({ where: { txHash: tx.txHash }, include: { blockchainTx: true } });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.amount).sort()).toEqual([usdt(1), usdt(2)]);
  });
});
