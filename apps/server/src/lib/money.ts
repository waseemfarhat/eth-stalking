import { AppError } from './errors.js';

/**
 * Parse a user-entered decimal string into integer base units, exactly (no floating point).
 * "12.5" with 6 decimals -> 12_500_000n
 */
export function parseAmount(input: string | number, decimals = 6): bigint {
  const s = String(input).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be a positive decimal number');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) throw new AppError(400, 'INVALID_AMOUNT', `At most ${decimals} decimal places are allowed`);
  const v = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
  return v;
}

export function parsePositiveAmount(input: string | number, decimals = 6): bigint {
  const v = parseAmount(input, decimals);
  if (v <= 0n) throw new AppError(400, 'INVALID_AMOUNT', 'Amount must be greater than zero');
  return v;
}

/** Format base units into a fixed decimal string: 12_500_000n -> "12.500000" */
export function formatAmount(v: bigint, decimals = 6): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0');
  return `${neg ? '-' : ''}${whole}${decimals ? '.' + frac : ''}`;
}

/** amount * bps / 10000 * days / 365, rounded down — used only to SUGGEST a discretionary reward. */
export function suggestReward(amount: bigint, bps: number, days: number): bigint {
  return (amount * BigInt(bps) * BigInt(days)) / (10000n * 365n);
}
