import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setMainnetCheckProvider } from '../src/chain/mainnetCheck.js';
import type { ChainProvider } from '../src/chain/types.js';
import { prisma } from '../src/lib/prisma.js';
import { asNewUser } from './helpers.js';

const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const OURS = '0xc9cb644cf3a0bed41109b04ded765fd58e3bca94';
const GOOD = '0x' + 'a1'.repeat(32);
const SENDER = '0x' + '42'.repeat(20);

const fake: ChainProvider = {
  name: 'fake-mainnet',
  getChainId: async () => 1,
  getBlockNumber: async () => 20_000_100,
  lookupTransaction: async (h) =>
    h === GOOD
      ? { chainId: 1, status: 'success', blockNumber: 20_000_000, blockHash: '0xb', transfers: [{ logIndex: 7, token: USDT, from: SENDER, to: OURS, amount: 5_000000n }] }
      : { chainId: 1, status: 'not_found', blockNumber: null, blockHash: null, transfers: [] },
  findTransfersTo: async (_t, to, from, toB) => (from <= 20_000_000 && toB >= 20_000_000 ? [{ txHash: GOOD, logIndex: 7, blockNumber: 20_000_000, token: USDT, from: SENDER, to, amount: 5_000000n }] : []),
  getTokenBalance: async () => 12_340000n,
};

let walletId: string;
beforeAll(async () => {
  setMainnetCheckProvider(fake);
  const w = await prisma.wallet.create({ data: { label: 'Client', provider: 'Bitget Wallet', currency: 'USDT', network: 'ETHEREUM_ERC20', chainId: 1, address: OURS, tokenContract: USDT } });
  walletId = w.id;
});
afterAll(async () => {
  setMainnetCheckProvider(null);
  await prisma.wallet.delete({ where: { id: walletId } });
});

describe('real network check (read-only)', () => {
  it('shows the real USDT balance, recent transfers and verifies a real tx without crediting anything', async () => {
    const admin = await asNewUser('ADMIN');
    const [depBefore, ledgerBefore] = await Promise.all([prisma.deposit.count(), prisma.ledgerEntry.count()]);

    const st = await admin.get(`/api/admin/mainnet-check/status?walletId=${walletId}`);
    expect(st.status).toBe(200);
    expect(st.body.usdtBalance).toBe('12.340000');

    const rec = await admin.get(`/api/admin/mainnet-check/recent?walletId=${walletId}&blocks=1000`);
    expect(rec.body.transfers).toHaveLength(1);
    expect(rec.body.transfers[0]).toMatchObject({ txHash: GOOD, amount: '5.000000', confirmations: 101 });

    const v = await admin.post('/api/admin/mainnet-check/verify').send({ txHash: GOOD, walletId });
    expect(v.body.outcome).toBe('CONFIRMED');
    expect(v.body.matches[0].amount).toBe('5.000000');

    const nf = await admin.post('/api/admin/mainnet-check/verify').send({ txHash: '0x' + 'b2'.repeat(32), walletId });
    expect(nf.body.outcome).toBe('NOT_FOUND');

    // Read-only: no deposits and no ledger entries were created
    expect(await prisma.deposit.count()).toBe(depBefore);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
    // ...but the check itself is audited
    expect(await prisma.auditLog.count({ where: { action: 'MAINNET_CHECK_VERIFY' } })).toBe(2);
  });

  it('is admin-only', async () => {
    const u = await asNewUser('USER');
    expect((await u.get('/api/admin/mainnet-check/status')).status).toBe(403);
  });
});
