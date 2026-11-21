import request from 'supertest';
import { Wallet } from 'ethers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { depositPolicy, localRealTestActive } from '../src/config/compliance.js';
import { setChainProvider } from '../src/chain/service.js';
import type { ChainProvider, TxLookup } from '../src/chain/types.js';
import { getUserBalances } from '../src/ledger/ledger.js';
import { prisma } from '../src/lib/prisma.js';
import { app, asNewUser } from './helpers.js';

const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const owner = Wallet.createRandom();
const OURS = owner.address.toLowerCase();
const txs = new Map<string, TxLookup>();
const realTransfer = (amount: bigint) => {
  const h = '0x' + Buffer.from(Wallet.createRandom().privateKey.slice(2), 'hex').toString('hex');
  txs.set(h, { chainId: 1, status: 'success', blockNumber: 1000, blockHash: '0xb', transfers: [{ logIndex: 0, token: USDT, from: '0x' + '42'.repeat(20), to: OURS, amount }] });
  return h;
};
const fakeMainnet: ChainProvider = {
  name: 'fake-mainnet',
  getChainId: async () => 1,
  getBlockNumber: async () => 1100,
  lookupTransaction: async (h) => txs.get(h) ?? { chainId: 1, status: 'not_found', blockNumber: null, blockHash: null, transfers: [] },
  findTransfersTo: async () => [],
  getTokenBalance: async () => 0n,
};

const saved = { ...env };
let walletId: string;

beforeAll(async () => {
  Object.assign(env, { CHAIN_MODE: 'mainnet', CHAIN_ID: 1, TOKEN_CONTRACT: '', LOCAL_REAL_TEST: true, LOCAL_REAL_TEST_MAX_DEPOSIT: '100', LOCAL_REAL_TEST_MAX_TOTAL: '120' });
  setChainProvider(fakeMainnet);
  // only one active mainnet wallet for this test
  await prisma.wallet.updateMany({ where: { chainId: 1 }, data: { isActive: false } });
  const w = await prisma.wallet.create({ data: { label: 'Client (test)', provider: 'Bitget Wallet', currency: 'USDT', network: 'ETHEREUM_ERC20', chainId: 1, address: OURS, tokenContract: USDT, status: 'VERIFIED', isActive: true } });
  walletId = w.id;
});

afterAll(async () => {
  Object.assign(env, saved);
  setChainProvider(null);
  await prisma.wallet.update({ where: { id: walletId }, data: { isActive: false } });
});

describe('local real-money test mode', () => {
  it('shows the real receiving wallet and accepts real deposits', async () => {
    expect(localRealTestActive()).toBe(true);
    const p = await depositPolicy();
    expect(p).toMatchObject({ mode: 'mainnet', accepting: true, realFunds: true, localTest: true });
    expect(p.wallet?.address).toBe(OURS);
    const cfg = await request(app).get('/api/config');
    expect(cfg.body.deposits.wallet.isSample).toBe(false);
    expect(cfg.body.deposits.limits).toEqual({ maxDeposit: '100.000000', maxTotal: '120.000000' });
  });

  it('verifies a real deposit on-chain and credits it after admin approval', async () => {
    const user = await asNewUser();
    const admin = await asNewUser('ADMIN');
    const h = realTransfer(50_000000n);
    const sub = await user.post('/api/me/deposits').send({ txHash: h });
    expect(sub.status).toBe(201);
    expect(sub.body[0]).toMatchObject({ status: 'UNDER_REVIEW', amount: '50.000000', isSample: false });
    const ap = await admin.post(`/api/admin/deposits/${sub.body[0].id}/approve`).send({});
    expect(ap.status).toBe(200);
    expect((await getUserBalances(user.user.id)).available).toBe(50_000000n);
  });

  it('enforces the per-deposit and total limits', async () => {
    const user = await asNewUser();
    const admin = await asNewUser('ADMIN');
    const big = await user.post('/api/me/deposits').send({ txHash: realTransfer(150_000000n) });
    const r1 = await admin.post(`/api/admin/deposits/${big.body[0].id}/approve`).send({});
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('LOCAL_TEST_LIMIT');
    // 50 already credited above; 80 more would exceed the 120 total
    const over = await user.post('/api/me/deposits').send({ txHash: realTransfer(80_000000n) });
    const r2 = await admin.post(`/api/admin/deposits/${over.body[0].id}/approve`).send({});
    expect(r2.status).toBe(409);
    expect(r2.body.error.message).toMatch(/total/);
    expect((await getUserBalances(user.user.id)).available).toBe(0n);
  });

  it('rejects any request that is not from this computer', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/health').set('Host', 'eth-stalking.onrender.com')).status).toBe(403);
    expect((await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.9')).status).toBe(403);
    expect((await request(app).get('/').set('Host', 'random.trycloudflare.com').set('Cf-Connecting-Ip', '203.0.113.9')).status).toBe(403);
  });

  it('is never active in production', async () => {
    Object.assign(env, { NODE_ENV: 'production' });
    try {
      expect(localRealTestActive()).toBe(false);
      const p = await depositPolicy();
      expect(p.accepting).toBe(false);
      expect(p.wallet).toBeNull();
    } finally {
      Object.assign(env, { NODE_ENV: 'test' });
    }
  });
});
