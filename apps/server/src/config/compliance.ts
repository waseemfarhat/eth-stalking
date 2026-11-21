import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { chainConfig, env, SERVER_ROOT } from './env.js';
import { prisma } from '../lib/prisma.js';

/**
 * LEGAL & COMPLIANCE GATE
 *
 * Real customer deposits are accepted only when every check below passes. All inputs are
 * server-side deployment configuration — there is deliberately no API or UI that can flip this.
 * The attestation is a documented confirmation by the business; this software cannot itself
 * determine legal compliance. See docs/COMPLIANCE.md.
 */

const nonEmpty = z.string().trim().min(3);

export const attestationSchema = z.object({
  businessLegalName: nonEmpty,
  jurisdictions: z.array(nonEmpty).min(1),
  licences: z
    .array(z.object({ regulator: nonEmpty, licenceType: nonEmpty, licenceNumber: nonEmpty }))
    .min(1),
  customerDueDiligence: z.object({ kycProcedure: nonEmpty, provider: nonEmpty }),
  amlCft: z.object({ complianceOfficer: nonEmpty, policyDocument: nonEmpty }),
  transactionMonitoring: nonEmpty,
  sanctionsScreening: nonEmpty,
  customerDisclosures: z.object({ termsUrl: nonEmpty, riskDisclosureUrl: nonEmpty }),
  safeguarding: nonEmpty,
  recordRetention: nonEmpty,
  legalCounsel: nonEmpty,
  attestedBy: z.object({ name: nonEmpty, title: nonEmpty }),
  attestedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
});

export type Attestation = z.infer<typeof attestationSchema>;

export interface GateCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export function readAttestation(): { ok: boolean; detail: string; data?: Attestation } {
  const p = path.resolve(SERVER_ROOT, env.COMPLIANCE_ATTESTATION_PATH);
  if (!fs.existsSync(p)) return { ok: false, detail: `No attestation file at ${path.relative(SERVER_ROOT, p)}` };
  try {
    const parsed = attestationSchema.safeParse(JSON.parse(fs.readFileSync(p, 'utf8')));
    if (!parsed.success) {
      return { ok: false, detail: `Attestation incomplete: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}` };
    }
    if (new Date(parsed.data.expiresAt).getTime() < Date.now()) return { ok: false, detail: 'Attestation has expired' };
    return { ok: true, detail: `Attested by ${parsed.data.attestedBy.name} (${parsed.data.attestedBy.title}) — expires ${parsed.data.expiresAt}`, data: parsed.data };
  } catch (e) {
    return { ok: false, detail: `Attestation unreadable: ${(e as Error).message}` };
  }
}

export async function getActiveReceivingWallet() {
  const cfg = chainConfig();
  return prisma.wallet.findFirst({
    where: { chainId: cfg.chainId, isActive: true, status: 'VERIFIED', purpose: 'DEPOSIT_RECEIVING', currency: 'USDT' },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function complianceStatus() {
  const cfg = chainConfig();
  const att = readAttestation();
  const wallet = await getActiveReceivingWallet();
  const checks: GateCheck[] = [
    {
      id: 'env_flag',
      label: 'Server flag REAL_DEPOSITS_ENABLED=true',
      ok: env.REAL_DEPOSITS_ENABLED,
      detail: env.REAL_DEPOSITS_ENABLED ? 'Enabled in deployment configuration' : 'Disabled (default)',
    },
    { id: 'mainnet', label: 'Ethereum mainnet with official USDT', ok: cfg.mode === 'mainnet', detail: `CHAIN_MODE=${cfg.mode}, chain id ${cfg.chainId}` },
    { id: 'attestation', label: 'Regulatory & AML/CFT attestation on file', ok: att.ok, detail: att.detail },
    {
      id: 'wallet',
      label: 'Receiving wallet ownership proven by signature',
      ok: !!wallet && cfg.mode === 'mainnet' && !wallet.isSample,
      detail: wallet ? `${wallet.label} ${wallet.address}` : 'No verified, active receiving wallet for this chain',
    },
  ];
  const realDepositsEnabled = checks.every((c) => c.ok);
  return { realDepositsEnabled, checks };
}

/**
 * What the deposit page may offer right now.
 *  sample  – accepting SAMPLE deposits (no real value), clearly labelled
 *  sepolia – accepting TESTNET deposits (no real value), clearly labelled
 *  mainnet – accepting only if the compliance gate is fully open
 */
export async function depositPolicy() {
  const cfg = chainConfig();
  const wallet = await getActiveReceivingWallet();
  if (cfg.mode === 'mainnet') {
    if (localRealTestActive()) {
      return {
        mode: cfg.mode,
        accepting: !!wallet,
        realFunds: true,
        localTest: true,
        reason: wallet ? null : 'Verify and activate the receiving wallet (Admin → Wallets & compliance) to start accepting deposits.',
        wallet,
      };
    }
    const gate = await complianceStatus();
    return {
      mode: cfg.mode,
      accepting: gate.realDepositsEnabled,
      realFunds: true,
      localTest: false,
      reason: gate.realDepositsEnabled ? null : 'Real deposits are not enabled on this platform yet. Do not send funds.',
      wallet: gate.realDepositsEnabled ? wallet : null,
    };
  }
  return {
    mode: cfg.mode,
    accepting: !!wallet,
    realFunds: false,
    localTest: false,
    reason: wallet ? null : 'No verified receiving wallet is configured for this network.',
    wallet,
  };
}

/**
 * LOCAL REAL-MONEY TEST MODE
 * Real mainnet USDT deposits for the operator's own testing on their own computer.
 * Active only when: LOCAL_REAL_TEST=true, CHAIN_MODE=mainnet, and NODE_ENV is not production.
 * The server then binds to 127.0.0.1 and rejects every request that is not from this machine
 * (see localOnlyGuard), and per-deposit / total credit caps apply.
 */
export function localRealTestActive() {
  return env.LOCAL_REAL_TEST && env.NODE_ENV !== 'production' && chainConfig().mode === 'mainnet';
}

export function localRealTestLimits() {
  const toUnits = (s: string) => BigInt(Math.round(Number(s) * 1e6));
  return { maxDeposit: toUnits(env.LOCAL_REAL_TEST_MAX_DEPOSIT), maxTotal: toUnits(env.LOCAL_REAL_TEST_MAX_TOTAL) };
}
