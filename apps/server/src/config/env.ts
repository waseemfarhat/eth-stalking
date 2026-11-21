import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v.toLowerCase() === 'true'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  // Express "trust proxy": 'loopback' locally; set to 1 behind a single cloud proxy (Render, Fly, etc.)
  TRUST_PROXY: z.string().default('loopback'),
  DATABASE_URL: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().positive().default(60),

  CHAIN_MODE: z.enum(['sample', 'sepolia', 'mainnet']).default('sample'),
  ETH_RPC_URL: z.string().optional().default(''),
  CHAIN_ID: z.coerce.number().int().default(31337),
  TOKEN_CONTRACT: z.string().optional().default(''),
  TOKEN_DECIMALS: z.coerce.number().int().min(0).max(36).default(6),
  TOKEN_SYMBOL: z.string().default('USDT'),
  MIN_CONFIRMATIONS: z.coerce.number().int().min(1).default(12),

  CHAIN_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(30000),
  SCANNER_ENABLED: bool(true),
  SCANNER_BLOCK_CHUNK: z.coerce.number().int().min(1).max(10000).default(500),
  DEPOSIT_NOT_FOUND_EXPIRY_HOURS: z.coerce.number().positive().default(24),

  // Read-only "Real network check" (admin tool): mainnet RPC used ONLY for looking up data, never for crediting.
  MAINNET_CHECK_RPC_URL: z.string().optional().default('https://ethereum-rpc.publicnode.com'),

  REAL_DEPOSITS_ENABLED: bool(false),
  COMPLIANCE_ATTESTATION_PATH: z.string().default('../../compliance/attestation.json'),

  // LOCAL REAL-MONEY TEST MODE — mainnet deposits on THIS computer only (see docs/LOCAL_REAL_TEST.md).
  // Never active in production, never reachable from the network, capped amounts.
  LOCAL_REAL_TEST: bool(false),
  LOCAL_REAL_TEST_MAX_DEPOSIT: z.string().default('100'),
  LOCAL_REAL_TEST_MAX_TOTAL: z.string().default('500'),
  HOST: z.string().default('0.0.0.0'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;

/** Official Tether USD contract on Ethereum mainnet. */
export const MAINNET_USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
export const SAMPLE_CHAIN_ID = 31337;
export const SAMPLE_TOKEN = '0x5a5a5a5a00000000000000000000000000005a5a';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '../..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '../..');

/** Effective chain configuration, with safety checks that make misconfiguration fail loudly. */
export function chainConfig() {
  if (env.CHAIN_MODE === 'sample') {
    return { mode: 'sample' as const, chainId: SAMPLE_CHAIN_ID, tokenContract: SAMPLE_TOKEN, decimals: 6, symbol: 'USDT' };
  }
  if (env.CHAIN_MODE === 'mainnet') {
    if (env.CHAIN_ID !== 1) throw new Error('CHAIN_MODE=mainnet requires CHAIN_ID=1');
    const token = (env.TOKEN_CONTRACT || MAINNET_USDT).toLowerCase();
    if (token !== MAINNET_USDT) throw new Error('On mainnet only the official USDT contract is accepted');
    if (env.TOKEN_DECIMALS !== 6) throw new Error('Mainnet USDT has 6 decimals');
    return { mode: 'mainnet' as const, chainId: 1, tokenContract: MAINNET_USDT, decimals: 6, symbol: 'USDT' };
  }
  if (env.CHAIN_ID !== 11155111) throw new Error('CHAIN_MODE=sepolia requires CHAIN_ID=11155111');
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.TOKEN_CONTRACT)) throw new Error('CHAIN_MODE=sepolia requires TOKEN_CONTRACT');
  // The internal ledger uses USDT's 6-decimal base unit; a test token must match so credits are exact.
  if (env.TOKEN_DECIMALS !== 6) throw new Error('The test token must use 6 decimals (like USDT)');
  return {
    mode: 'sepolia' as const,
    chainId: 11155111,
    tokenContract: env.TOKEN_CONTRACT.toLowerCase(),
    decimals: env.TOKEN_DECIMALS,
    symbol: env.TOKEN_SYMBOL,
  };
}

export type ChainConfig = ReturnType<typeof chainConfig>;
