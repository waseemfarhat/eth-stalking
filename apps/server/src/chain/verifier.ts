import type { TransferLog, TxLookup } from './types.js';

export type VerificationOutcome =
  | 'NOT_FOUND'
  | 'PENDING'
  | 'FAILED'
  | 'WRONG_CHAIN'
  | 'NO_TRANSFER'
  | 'INVALID_TOKEN'
  | 'WRONG_DESTINATION'
  | 'AMOUNT_MISMATCH'
  | 'INSUFFICIENT_CONFIRMATIONS'
  | 'CONFIRMED';

/** Outcomes that can never change by waiting — the deposit can be rejected. */
export const TERMINAL_FAILURES: VerificationOutcome[] = ['FAILED', 'WRONG_CHAIN', 'NO_TRANSFER', 'INVALID_TOKEN', 'WRONG_DESTINATION', 'AMOUNT_MISMATCH'];

export interface VerifyParams {
  expectedChainId: number;
  tokenContract: string;
  destination: string;
  minConfirmations: number;
  currentBlock: number;
  /** if set, at least one matching transfer must be for exactly this amount (used for payouts) */
  expectedAmount?: bigint;
}

export interface VerificationResult {
  outcome: VerificationOutcome;
  terminal: boolean;
  message: string;
  chainId: number;
  blockNumber: number | null;
  blockHash: string | null;
  confirmations: number;
  requiredConfirmations: number;
  matches: TransferLog[];
  checkedAt: string;
}

const messages: Record<VerificationOutcome, string> = {
  NOT_FOUND: 'Transaction not found on the network yet',
  PENDING: 'Transaction is pending (not yet included in a block)',
  FAILED: 'Transaction failed (reverted) on-chain — no tokens were transferred',
  WRONG_CHAIN: 'Transaction is on a different network',
  NO_TRANSFER: 'Transaction contains no ERC-20 token transfer',
  INVALID_TOKEN: 'Transfer was not made with the accepted USDT token contract',
  WRONG_DESTINATION: 'Transfer was not sent to the platform receiving address',
  AMOUNT_MISMATCH: 'Transfer amount does not match the expected amount',
  INSUFFICIENT_CONFIRMATIONS: 'Waiting for more block confirmations',
  CONFIRMED: 'Transfer independently verified on-chain',
};

/**
 * Pure verification logic — no I/O, fully unit-tested.
 * Takes the node's view of a transaction and decides whether it is a valid, confirmed
 * transfer of the accepted token to the expected destination.
 */
export function verifyTransfer(lookup: TxLookup, p: VerifyParams): VerificationResult {
  const token = p.tokenContract.toLowerCase();
  const dest = p.destination.toLowerCase();
  const base = {
    chainId: lookup.chainId,
    blockNumber: lookup.blockNumber,
    blockHash: lookup.blockHash,
    requiredConfirmations: p.minConfirmations,
    checkedAt: new Date().toISOString(),
  };
  const result = (outcome: VerificationOutcome, extra: Partial<VerificationResult> = {}): VerificationResult => ({
    ...base,
    confirmations: 0,
    matches: [],
    ...extra,
    outcome,
    terminal: TERMINAL_FAILURES.includes(outcome),
    message: messages[outcome],
  });

  if (lookup.chainId !== p.expectedChainId) return result('WRONG_CHAIN');
  if (lookup.status === 'not_found') return result('NOT_FOUND');
  if (lookup.status === 'pending' || lookup.blockNumber === null) return result('PENDING');
  if (lookup.status === 'failed') return result('FAILED');
  if (lookup.transfers.length === 0) return result('NO_TRANSFER');

  const toUs = lookup.transfers.filter((t) => t.to.toLowerCase() === dest);
  const tokenTransfers = lookup.transfers.filter((t) => t.token.toLowerCase() === token);
  if (tokenTransfers.length === 0) return result(toUs.length > 0 ? 'INVALID_TOKEN' : 'NO_TRANSFER');

  let matches = tokenTransfers.filter((t) => t.to.toLowerCase() === dest && t.amount > 0n);
  if (matches.length === 0) return result('WRONG_DESTINATION');

  if (p.expectedAmount !== undefined) {
    matches = matches.filter((t) => t.amount === p.expectedAmount);
    if (matches.length === 0) return result('AMOUNT_MISMATCH');
  }

  const confirmations = Math.max(0, p.currentBlock - lookup.blockNumber + 1);
  if (confirmations < p.minConfirmations) return result('INSUFFICIENT_CONFIRMATIONS', { confirmations, matches });
  return result('CONFIRMED', { confirmations, matches });
}
