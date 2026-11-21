/**
 * REAL NETWORK CHECK — read-only verification against Ethereum mainnet.
 *
 * Lets administrators confirm that real USDT transfers to a configured receiving wallet are
 * detected and verified correctly, using the exact same provider + verifier code as deposits.
 * It never creates deposits, never touches the ledger and does not depend on (or open) the
 * compliance gate.
 */
import { env, MAINNET_USDT } from '../config/env.js';
import { RpcChainProvider } from './providers/rpc.js';
import type { ChainProvider } from './types.js';
import { verifyTransfer } from './verifier.js';
import { AppError } from '../lib/errors.js';

let provider: ChainProvider | null = null;

export function getMainnetCheckProvider(): ChainProvider {
  if (!provider) {
    if (!env.MAINNET_CHECK_RPC_URL) throw new AppError(503, 'NO_MAINNET_RPC', 'MAINNET_CHECK_RPC_URL is not configured');
    provider = new RpcChainProvider(env.MAINNET_CHECK_RPC_URL, 1);
  }
  return provider;
}

export function setMainnetCheckProvider(p: ChainProvider | null) {
  provider = p;
}

async function assertMainnet(p: ChainProvider) {
  const id = await p.getChainId();
  if (id !== 1) throw new AppError(503, 'RPC_WRONG_NETWORK', `Check RPC is on chain ${id}, not Ethereum mainnet`);
}

export async function mainnetWalletStatus(address: string) {
  const p = getMainnetCheckProvider();
  await assertMainnet(p);
  const [balance, head] = await Promise.all([p.getTokenBalance(MAINNET_USDT, address), p.getBlockNumber()]);
  return { chainId: 1, tokenContract: MAINNET_USDT, address, usdtBalance: balance, headBlock: head, checkedAt: new Date().toISOString() };
}

export async function mainnetVerifyTx(txHash: string, address: string, minConfirmations: number) {
  const p = getMainnetCheckProvider();
  await assertMainnet(p);
  const [lookup, head] = await Promise.all([p.lookupTransaction(txHash), p.getBlockNumber()]);
  const result = verifyTransfer(lookup, { expectedChainId: 1, tokenContract: MAINNET_USDT, destination: address, minConfirmations, currentBlock: head });
  return {
    ...result,
    txHash,
    destination: address,
    // every Transfer log in the tx, so the admin can see why something did or did not match
    allTransfers: lookup.transfers,
  };
}

/** Recent incoming USDT transfers to the address, scanned backwards in small chunks (public RPC friendly). */
export async function mainnetRecentTransfers(address: string, blocks: number, chunk = 500) {
  const p = getMainnetCheckProvider();
  await assertMainnet(p);
  const head = await p.getBlockNumber();
  const from = Math.max(0, head - blocks + 1);
  const out = [];
  for (let end = head; end >= from; end -= chunk) {
    const start = Math.max(from, end - chunk + 1);
    out.push(...(await p.findTransfersTo(MAINNET_USDT, address, start, end)));
  }
  out.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  return { headBlock: head, fromBlock: from, transfers: out.map((t) => ({ ...t, confirmations: head - t.blockNumber + 1 })) };
}
