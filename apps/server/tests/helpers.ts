import request from 'supertest';
import { Wallet } from 'ethers';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth/auth.js';
import { prisma } from '../src/lib/prisma.js';
import { SAMPLE_CHAIN_ID, SAMPLE_TOKEN } from '../src/config/env.js';
import { getSampleProvider } from '../src/chain/service.js';

export const app = createApp();
export const PASSWORD = 'TestPassw0rd-123';
let n = 0;

export async function makeUser(role: 'USER' | 'ADMIN' | 'SUPERADMIN' = 'USER', status = 'ACTIVE') {
  n++;
  const email = `${role.toLowerCase()}${n}-${Date.now()}@test.local`;
  return prisma.user.create({ data: { email, name: `${role} ${n}`, role, status, passwordHash: await hashPassword(PASSWORD) } });
}

/** Logged-in supertest agent that automatically sends the CSRF token. */
export async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const csrf = res.body.csrfToken as string;
  const wrap = (m: 'post' | 'put' | 'patch' | 'delete') => (url: string) => agent[m](url).set('x-csrf-token', csrf);
  return { agent, csrf, get: (url: string) => agent.get(url), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), del: wrap('delete') };
}

export async function asNewUser(role: 'USER' | 'ADMIN' | 'SUPERADMIN' = 'USER') {
  const user = await makeUser(role);
  return { user, ...(await login(user.email)) };
}

export const SAMPLE_WALLET = '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0001';

export async function ensureSampleWallet() {
  const w = await prisma.wallet.findFirst({ where: { chainId: SAMPLE_CHAIN_ID } });
  if (w) return w;
  return prisma.wallet.create({
    data: { label: 'Sample', provider: 'Sample chain', currency: 'USDT', network: 'ETHEREUM_ERC20', chainId: SAMPLE_CHAIN_ID, address: SAMPLE_WALLET, tokenContract: SAMPLE_TOKEN, status: 'VERIFIED', isActive: true, isSample: true },
  });
}

export function sampleTransfer(amountUnits: bigint, opts: { to?: string; token?: string; status?: 'success' | 'failed' | 'pending'; from?: string } = {}) {
  return getSampleProvider().createTransfer({ token: opts.token ?? SAMPLE_TOKEN, to: opts.to ?? SAMPLE_WALLET, amount: amountUnits, status: opts.status, from: opts.from });
}

export const mine = (n = 5) => getSampleProvider().mine(n);
export const usdt = (n: number) => BigInt(Math.round(n * 1_000_000));
export const randomAddress = () => Wallet.createRandom().address;
