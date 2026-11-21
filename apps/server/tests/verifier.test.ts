import { describe, expect, it } from 'vitest';
import { verifyTransfer } from '../src/chain/verifier.js';
import type { TxLookup } from '../src/chain/types.js';
import { formatAmount, parseAmount, suggestReward } from '../src/lib/money.js';

const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const US = '0xc9cb644cf3a0bed41109b04ded765fd58e3bca94';
const OTHER = '0x1111111111111111111111111111111111111111';
const params = { expectedChainId: 1, tokenContract: USDT, destination: US, minConfirmations: 12, currentBlock: 1000 };

const lookup = (over: Partial<TxLookup> = {}): TxLookup => ({
  chainId: 1,
  status: 'success',
  blockNumber: 980,
  blockHash: '0xabc',
  transfers: [{ logIndex: 4, token: USDT, from: OTHER, to: US, amount: 250_000000n }],
  ...over,
});

describe('blockchain transfer verifier', () => {
  it('confirms a valid USDT transfer with enough confirmations', () => {
    const r = verifyTransfer(lookup(), params);
    expect(r.outcome).toBe('CONFIRMED');
    expect(r.confirmations).toBe(21);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].amount).toBe(250_000000n);
  });

  it('tracks insufficient confirmations (not terminal)', () => {
    const r = verifyTransfer(lookup({ blockNumber: 995 }), params);
    expect(r.outcome).toBe('INSUFFICIENT_CONFIRMATIONS');
    expect(r.confirmations).toBe(6);
    expect(r.terminal).toBe(false);
  });

  it('counts exactly minConfirmations as confirmed', () => {
    expect(verifyTransfer(lookup({ blockNumber: 989 }), params).outcome).toBe('CONFIRMED');
    expect(verifyTransfer(lookup({ blockNumber: 990 }), params).outcome).toBe('INSUFFICIENT_CONFIRMATIONS');
  });

  it('rejects a transaction on the wrong chain', () => {
    const r = verifyTransfer(lookup({ chainId: 11155111 }), params);
    expect(r.outcome).toBe('WRONG_CHAIN');
    expect(r.terminal).toBe(true);
  });

  it('reports not-found and pending transactions as non-terminal', () => {
    expect(verifyTransfer(lookup({ status: 'not_found', blockNumber: null }), params)).toMatchObject({ outcome: 'NOT_FOUND', terminal: false });
    expect(verifyTransfer(lookup({ status: 'pending', blockNumber: null }), params)).toMatchObject({ outcome: 'PENDING', terminal: false });
  });

  it('rejects failed (reverted) transactions', () => {
    expect(verifyTransfer(lookup({ status: 'failed', transfers: [] }), params)).toMatchObject({ outcome: 'FAILED', terminal: true });
  });

  it('rejects a transfer of a different (fake) token to our address', () => {
    const r = verifyTransfer(lookup({ transfers: [{ logIndex: 0, token: OTHER, from: OTHER, to: US, amount: 1_000000n }] }), params);
    expect(r.outcome).toBe('INVALID_TOKEN');
  });

  it('rejects USDT sent to a different destination', () => {
    const r = verifyTransfer(lookup({ transfers: [{ logIndex: 0, token: USDT, from: OTHER, to: OTHER, amount: 1_000000n }] }), params);
    expect(r.outcome).toBe('WRONG_DESTINATION');
  });

  it('rejects a transaction with no token transfer', () => {
    expect(verifyTransfer(lookup({ transfers: [] }), params).outcome).toBe('NO_TRANSFER');
  });

  it('ignores zero-amount transfers', () => {
    const r = verifyTransfer(lookup({ transfers: [{ logIndex: 0, token: USDT, from: OTHER, to: US, amount: 0n }] }), params);
    expect(r.outcome).toBe('WRONG_DESTINATION');
  });

  it('is case-insensitive on addresses', () => {
    const r = verifyTransfer(lookup(), { ...params, destination: '0xC9cb644CF3a0BeD41109b04deD765FD58E3bcA94', tokenContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7' });
    expect(r.outcome).toBe('CONFIRMED');
  });

  it('returns every matching transfer in a multi-transfer transaction', () => {
    const r = verifyTransfer(
      lookup({
        transfers: [
          { logIndex: 1, token: USDT, from: OTHER, to: US, amount: 5_000000n },
          { logIndex: 2, token: USDT, from: OTHER, to: OTHER, amount: 7_000000n },
          { logIndex: 3, token: USDT, from: OTHER, to: US, amount: 9_000000n },
        ],
      }),
      params,
    );
    expect(r.matches.map((m) => m.logIndex)).toEqual([1, 3]);
  });

  it('enforces an exact expected amount (payout verification)', () => {
    expect(verifyTransfer(lookup(), { ...params, expectedAmount: 250_000000n }).outcome).toBe('CONFIRMED');
    expect(verifyTransfer(lookup(), { ...params, expectedAmount: 250_000001n }).outcome).toBe('AMOUNT_MISMATCH');
  });
});

describe('money helpers (exact integer arithmetic)', () => {
  it('parses and formats without floating point error', () => {
    expect(parseAmount('0.1') + parseAmount('0.2')).toBe(parseAmount('0.3'));
    expect(parseAmount('12.5')).toBe(12_500000n);
    expect(formatAmount(12_500000n)).toBe('12.500000');
    expect(formatAmount(-1n)).toBe('-0.000001');
  });
  it('rejects invalid input', () => {
    expect(() => parseAmount('1.1234567')).toThrow();
    expect(() => parseAmount('-1')).toThrow();
    expect(() => parseAmount('1e6')).toThrow();
    expect(() => parseAmount('abc')).toThrow();
  });
  it('suggests discretionary rewards proportionally', () => {
    expect(suggestReward(1000_000000n, 500, 365)).toBe(50_000000n);
  });
});
