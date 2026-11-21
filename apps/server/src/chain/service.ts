import path from 'node:path';
import { chainConfig, env, REPO_ROOT } from '../config/env.js';
import { RpcChainProvider } from './providers/rpc.js';
import { SampleChainProvider } from './providers/sample.js';
import type { ChainProvider } from './types.js';
import { verifyTransfer, type VerificationResult } from './verifier.js';
import { AppError } from '../lib/errors.js';

let provider: ChainProvider | null = null;

export function getChainProvider(): ChainProvider {
  if (provider) return provider;
  const cfg = chainConfig();
  if (cfg.mode === 'sample') {
    const file = env.NODE_ENV === 'test' ? null : path.join(REPO_ROOT, 'data', 'sample-chain.json');
    provider = new SampleChainProvider(file);
  } else {
    provider = new RpcChainProvider(env.ETH_RPC_URL, cfg.chainId);
  }
  return provider;
}

/** Test hook: inject a provider. */
export function setChainProvider(p: ChainProvider | null) {
  provider = p;
}

export function getSampleProvider(): SampleChainProvider {
  const p = getChainProvider();
  if (!(p instanceof SampleChainProvider)) throw new AppError(403, 'NOT_SAMPLE_MODE', 'Sample chain tools are only available in CHAIN_MODE=sample');
  return p;
}

/**
 * Independently inspect a transaction on the configured chain.
 * Verifies: network/chain id, success status, official token contract, destination, amount (optional), confirmations.
 */
export async function inspectTransfer(txHash: string, destination: string, minConfirmations: number, expectedAmount?: bigint): Promise<VerificationResult> {
  const cfg = chainConfig();
  const p = getChainProvider();
  const nodeChainId = await p.getChainId();
  if (nodeChainId !== cfg.chainId) {
    throw new AppError(503, 'RPC_WRONG_NETWORK', `RPC endpoint is on chain ${nodeChainId}, expected ${cfg.chainId}. Verification refused.`);
  }
  const [lookup, currentBlock] = await Promise.all([p.lookupTransaction(txHash), p.getBlockNumber()]);
  return verifyTransfer(lookup, {
    expectedChainId: cfg.chainId,
    tokenContract: cfg.tokenContract,
    destination,
    minConfirmations,
    currentBlock,
    expectedAmount,
  });
}
