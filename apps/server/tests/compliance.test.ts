import fs from 'node:fs';
import path from 'node:path';
import { Wallet } from 'ethers';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { complianceStatus, depositPolicy, readAttestation } from '../src/config/compliance.js';
import { setChainProvider } from '../src/chain/service.js';
import type { ChainProvider } from '../src/chain/types.js';
import { submitDeposit } from '../src/modules/deposits.service.js';
import { prisma } from '../src/lib/prisma.js';
import { asNewUser, ensureSampleWallet, makeUser } from './helpers.js';

const ATTESTATION = path.resolve('tests/.tmp/attestation.json');
const validAttestation = () => ({
  businessLegalName: 'Example Holdings Ltd',
  jurisdictions: ['Exampleland'],
  licences: [{ regulator: 'Example Financial Authority', licenceType: 'Virtual Asset Service Provider', licenceNumber: 'VASP-0001' }],
  customerDueDiligence: { kycProcedure: 'Documented CDD/EDD procedure v1', provider: 'Example KYC Vendor' },
  amlCft: { complianceOfficer: 'Jane Compliance (MLRO)', policyDocument: 'AML/CFT policy v1' },
  transactionMonitoring: 'Example monitoring tool',
  sanctionsScreening: 'Example screening provider',
  customerDisclosures: { termsUrl: 'https://example.test/terms', riskDisclosureUrl: 'https://example.test/risk' },
  safeguarding: 'Segregated client asset arrangement',
  recordRetention: '7-year retention policy',
  legalCounsel: 'Example Law LLP',
  attestedBy: { name: 'A. Director', title: 'Managing Director' },
  attestedAt: '2026-01-01T00:00:00Z',
  expiresAt: '2099-01-01T00:00:00Z',
});

const saved = { ...env };
afterEach(() => {
  Object.assign(env, saved);
  setChainProvider(null);
  if (fs.existsSync(ATTESTATION)) fs.rmSync(ATTESTATION);
});

beforeAll(async () => {
  await ensureSampleWallet();
});

const fakeMainnet: ChainProvider = {
  name: 'fake-mainnet',
  getChainId: async () => 1,
  getBlockNumber: async () => 100,
  lookupTransaction: async () => ({ chainId: 1, status: 'not_found', blockNumber: null, blockHash: null, transfers: [] }),
  findTransfersTo: async () => [],
  getTokenBalance: async () => 0n,
};

describe('legal & compliance gate', () => {
  it('is closed by default and REAL_DEPOSITS_ENABLED defaults to false', async () => {
    expect(env.REAL_DEPOSITS_ENABLED).toBe(false);
    const s = await complianceStatus();
    expect(s.realDepositsEnabled).toBe(false);
  });

  it('sample mode accepts only clearly-labelled non-real deposits', async () => {
    const p = await depositPolicy();
    expect(p).toMatchObject({ mode: 'sample', accepting: true, realFunds: false });
    expect(p.wallet?.isSample).toBe(true);
  });

  it('on mainnet, deposits are refused while any gate check fails — even with the env flag set', async () => {
    Object.assign(env, { CHAIN_MODE: 'mainnet', CHAIN_ID: 1, TOKEN_CONTRACT: '', REAL_DEPOSITS_ENABLED: true });
    setChainProvider(fakeMainnet);
    const s = await complianceStatus();
    expect(s.realDepositsEnabled).toBe(false);
    expect(s.checks.find((c) => c.id === 'attestation')!.ok).toBe(false);
    expect(s.checks.find((c) => c.id === 'wallet')!.ok).toBe(false);
    const policy = await depositPolicy();
    expect(policy.accepting).toBe(false);
    expect(policy.wallet).toBeNull(); // the address is not even shown
    const u = await makeUser();
    await expect(submitDeposit({ id: u.id, role: 'USER' }, '0x' + 'cd'.repeat(32))).rejects.toMatchObject({ code: 'DEPOSITS_DISABLED' });
  });

  it('requires a complete, unexpired attestation', () => {
    Object.assign(env, { COMPLIANCE_ATTESTATION_PATH: './tests/.tmp/attestation.json' });
    expect(readAttestation().ok).toBe(false);
    fs.writeFileSync(ATTESTATION, JSON.stringify({ ...validAttestation(), licences: [] }));
    expect(readAttestation().ok).toBe(false);
    fs.writeFileSync(ATTESTATION, JSON.stringify({ ...validAttestation(), expiresAt: '2020-01-01T00:00:00Z' }));
    expect(readAttestation().detail).toMatch(/expired/);
    fs.writeFileSync(ATTESTATION, JSON.stringify(validAttestation()));
    expect(readAttestation().ok).toBe(true);
  });

  it('opens only when flag + mainnet + attestation + verified wallet all pass', async () => {
    Object.assign(env, { CHAIN_MODE: 'mainnet', CHAIN_ID: 1, TOKEN_CONTRACT: '', REAL_DEPOSITS_ENABLED: true });
    setChainProvider(fakeMainnet);
    fs.writeFileSync(ATTESTATION, JSON.stringify(validAttestation()));
    const owner = Wallet.createRandom();
    const w = await prisma.wallet.create({ data: { label: 'Gate test', provider: 'Test', currency: 'USDT', network: 'ETHEREUM_ERC20', chainId: 1, address: owner.address.toLowerCase(), tokenContract: '0xdac17f958d2ee523a2206206994597c13d831ec7', status: 'VERIFIED', isActive: true } });
    expect((await complianceStatus()).realDepositsEnabled).toBe(true);
    Object.assign(env, { REAL_DEPOSITS_ENABLED: false });
    expect((await complianceStatus()).realDepositsEnabled).toBe(false);
    await prisma.wallet.delete({ where: { id: w.id } });
  });

  it('refuses mainnet mode with a non-official token contract', async () => {
    Object.assign(env, { CHAIN_MODE: 'mainnet', CHAIN_ID: 1, TOKEN_CONTRACT: '0x1111111111111111111111111111111111111111' });
    await expect(complianceStatus()).rejects.toThrow(/official USDT/);
  });

  it('there is no API to enable real deposits', async () => {
    const s = await asNewUser('SUPERADMIN');
    for (const url of ['/api/admin/settings/real-deposits', '/api/admin/compliance/enable']) {
      expect((await s.post(url).send({ enabled: true })).status).toBe(404);
    }
  });
});

describe('wallet ownership verification (signed message, no private keys)', () => {
  it('verifies a correct signature, rejects a wrong signer, and requires verification before activation', async () => {
    const s = await asNewUser('SUPERADMIN');
    const owner = Wallet.createRandom();
    const created = await s.post('/api/admin/wallets').send({ label: 'Test wallet', provider: 'Test', address: owner.address, chainId: 31337 });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('UNVERIFIED');

    expect((await s.post(`/api/admin/wallets/${created.body.id}/activate`).send({ active: true })).status).toBe(409);

    const ch = await s.post(`/api/admin/wallets/${created.body.id}/challenge`).send({});
    expect(ch.body.message).toContain(owner.address);
    expect(ch.body.message).toMatch(/Never share your private key/);

    const impostor = Wallet.createRandom();
    const bad = await s.post(`/api/admin/wallets/${created.body.id}/verify`).send({ signature: await impostor.signMessage(ch.body.message) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('SIGNATURE_MISMATCH');

    const good = await s.post(`/api/admin/wallets/${created.body.id}/verify`).send({ signature: await owner.signMessage(ch.body.message) });
    expect(good.status).toBe(200);
    expect(good.body.status).toBe('VERIFIED');

    // the schema has no field capable of holding a private key or seed phrase
    const cols = (await prisma.$queryRawUnsafe(`PRAGMA table_info("Wallet")`)) as { name: string }[];
    expect(cols.map((c) => c.name).some((n) => /private|seed|mnemonic|phrase|secret/i.test(n))).toBe(false);

    // reactivate the original sample wallet so other tests are unaffected
    await prisma.wallet.update({ where: { id: created.body.id }, data: { isActive: false } });
  });
});
