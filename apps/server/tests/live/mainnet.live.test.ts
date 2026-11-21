/**
 * LIVE, READ-ONLY verification against real Ethereum mainnet data.
 * Run with: npm run test:live   (optionally LIVE_RPC_URL=<your endpoint>)
 *
 * Picks a real, recent USDT Transfer from mainnet and runs it through the exact same
 * provider + verifier code path used for deposits. No funds move, no keys are used,
 * and the client's wallet is not involved.
 */
import { JsonRpcProvider } from 'ethers';
import { describe, expect, it } from 'vitest';
import { RpcChainProvider } from '../../src/chain/providers/rpc.js';
import { TRANSFER_TOPIC } from '../../src/chain/types.js';
import { verifyTransfer } from '../../src/chain/verifier.js';

const RPC = process.env.LIVE_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';

describe('LIVE mainnet USDT verification (read-only)', () => {
  it('verifies a real USDT transfer: chain id, status, token contract, destination, amount, confirmations', async () => {
    const raw = new JsonRpcProvider(RPC, 1, { staticNetwork: true });
    const provider = new RpcChainProvider(RPC, 1);

    expect(await provider.getChainId()).toBe(1);
    const head = await provider.getBlockNumber();
    const target = head - 30; // ~30 confirmations

    const logs = await raw.getLogs({ address: USDT, topics: [TRANSFER_TOPIC], fromBlock: target, toBlock: target });
    expect(logs.length).toBeGreaterThan(0);
    const log = logs[0];
    const to = ('0x' + log.topics[2].slice(26)).toLowerCase();
    const amount = BigInt(log.data);
    console.log(`  real tx ${log.transactionHash} block ${log.blockNumber} → ${to} amount ${amount} (base units)`);

    const lookup = await provider.lookupTransaction(log.transactionHash);
    expect(lookup.chainId).toBe(1);
    expect(lookup.status).toBe('success');

    const ok = verifyTransfer(lookup, { expectedChainId: 1, tokenContract: USDT, destination: to, minConfirmations: 12, currentBlock: await provider.getBlockNumber() });
    expect(ok.outcome).toBe('CONFIRMED');
    expect(ok.confirmations).toBeGreaterThanOrEqual(12);
    expect(ok.matches.some((m) => m.logIndex === log.index && m.amount === amount)).toBe(true);

    // Same real transaction, different destination → must be rejected
    const wrongDest = verifyTransfer(lookup, { expectedChainId: 1, tokenContract: USDT, destination: '0x000000000000000000000000000000000000dead', minConfirmations: 12, currentBlock: head });
    expect(['WRONG_DESTINATION']).toContain(wrongDest.outcome);

    // Same real transaction, wrong token contract → must be rejected
    const wrongToken = verifyTransfer(lookup, { expectedChainId: 1, tokenContract: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', destination: to, minConfirmations: 12, currentBlock: head });
    expect(['INVALID_TOKEN', 'NO_TRANSFER']).toContain(wrongToken.outcome);

    // Claiming more confirmations than exist → insufficient
    const tooMany = verifyTransfer(lookup, { expectedChainId: 1, tokenContract: USDT, destination: to, minConfirmations: 1_000_000, currentBlock: head });
    expect(tooMany.outcome).toBe('INSUFFICIENT_CONFIRMATIONS');

    // Scanner path: find the same transfer by destination filter
    const found = await provider.findTransfersTo(USDT, to, target, target);
    expect(found.some((f) => f.txHash === log.transactionHash.toLowerCase() && f.logIndex === log.index)).toBe(true);
  });

  it('reports a non-existent transaction hash as NOT_FOUND', async () => {
    const provider = new RpcChainProvider(RPC, 1);
    const lookup = await provider.lookupTransaction('0x' + '00'.repeat(31) + '01');
    expect(lookup.status).toBe('not_found');
  });
});
