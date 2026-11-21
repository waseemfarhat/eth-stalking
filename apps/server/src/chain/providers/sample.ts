import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SAMPLE_CHAIN_ID } from '../../config/env.js';
import type { ChainProvider, FoundTransfer, TxLookup } from '../types.js';

/**
 * SAMPLE chain — a clearly labelled, simulated ledger of token transfers for local development
 * and automated tests. It has its own chain id (31337) and token address, so a sample
 * transaction can never be mistaken for, or accepted as, a mainnet transaction.
 *
 * Blocks advance with wall-clock time (one per 12 s) and can be "mined" on demand from the admin console.
 */
interface SampleTx {
  txHash: string;
  status: 'pending' | 'success' | 'failed';
  blockNumber: number | null;
  transfers: { logIndex: number; token: string; from: string; to: string; amount: string }[];
  createdAt: string;
  note?: string;
}

interface SampleState {
  genesisMs: number;
  extraBlocks: number;
  txs: SampleTx[];
}

const BLOCK_MS = 12_000;
const BASE_BLOCK = 1_000;

export class SampleChainProvider implements ChainProvider {
  readonly name = 'sample';
  private state: SampleState;

  constructor(private file: string | null) {
    this.state = this.load();
  }

  private load(): SampleState {
    if (this.file && fs.existsSync(this.file)) {
      return JSON.parse(fs.readFileSync(this.file, 'utf8')) as SampleState;
    }
    return { genesisMs: Date.now(), extraBlocks: 0, txs: [] };
  }

  private save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 2));
  }

  private head() {
    return BASE_BLOCK + Math.floor((Date.now() - this.state.genesisMs) / BLOCK_MS) + this.state.extraBlocks;
  }

  async getChainId() {
    return SAMPLE_CHAIN_ID;
  }

  async getBlockNumber() {
    return this.head();
  }

  async lookupTransaction(txHash: string): Promise<TxLookup> {
    const tx = this.state.txs.find((t) => t.txHash === txHash.toLowerCase());
    if (!tx) return { chainId: SAMPLE_CHAIN_ID, status: 'not_found', blockNumber: null, blockHash: null, transfers: [] };
    if (tx.status === 'pending' || tx.blockNumber === null) {
      return { chainId: SAMPLE_CHAIN_ID, status: 'pending', blockNumber: null, blockHash: null, transfers: [] };
    }
    return {
      chainId: SAMPLE_CHAIN_ID,
      status: tx.status,
      blockNumber: tx.blockNumber,
      blockHash: '0x' + tx.txHash.slice(2, 10).padEnd(64, '0'),
      // A failed (reverted) transaction emits no logs, exactly like a real one.
      transfers: tx.status === 'failed' ? [] : tx.transfers.map((t) => ({ ...t, amount: BigInt(t.amount) })),
    };
  }

  async findTransfersTo(token: string, to: string, fromBlock: number, toBlock: number): Promise<FoundTransfer[]> {
    const out: FoundTransfer[] = [];
    for (const tx of this.state.txs) {
      if (tx.status !== 'success' || tx.blockNumber === null) continue;
      if (tx.blockNumber < fromBlock || tx.blockNumber > toBlock) continue;
      for (const t of tx.transfers) {
        if (t.token === token.toLowerCase() && t.to === to.toLowerCase()) {
          out.push({ ...t, amount: BigInt(t.amount), txHash: tx.txHash, blockNumber: tx.blockNumber });
        }
      }
    }
    return out;
  }

  async getTokenBalance(token: string, address: string): Promise<bigint> {
    let bal = 0n;
    const a = address.toLowerCase();
    for (const tx of this.state.txs) {
      if (tx.status !== 'success' || tx.blockNumber === null) continue;
      for (const t of tx.transfers) {
        if (t.token !== token.toLowerCase()) continue;
        if (t.to === a) bal += BigInt(t.amount);
        if (t.from === a) bal -= BigInt(t.amount);
      }
    }
    return bal;
  }

  // ── sample-only controls (admin dev console + tests) ──────────────────────

  createTransfer(input: { token: string; from?: string; to: string; amount: bigint; status?: 'pending' | 'success' | 'failed'; note?: string }) {
    const txHash = '0x' + randomBytes(32).toString('hex');
    const status = input.status ?? 'success';
    const tx: SampleTx = {
      txHash,
      status,
      blockNumber: status === 'pending' ? null : this.head(),
      transfers: [
        {
          logIndex: 0,
          token: input.token.toLowerCase(),
          from: (input.from ?? '0x' + randomBytes(20).toString('hex')).toLowerCase(),
          to: input.to.toLowerCase(),
          amount: input.amount.toString(),
        },
      ],
      createdAt: new Date().toISOString(),
      note: input.note,
    };
    this.state.txs.push(tx);
    this.save();
    return tx;
  }

  /** Advance the chain by n blocks and include any pending transactions. */
  mine(n: number) {
    for (const tx of this.state.txs) {
      if (tx.status === 'pending') {
        tx.status = 'success';
        tx.blockNumber = this.head() + 1;
      }
    }
    this.state.extraBlocks += n;
    this.save();
    return this.head();
  }

  list() {
    return [...this.state.txs].reverse();
  }
}
