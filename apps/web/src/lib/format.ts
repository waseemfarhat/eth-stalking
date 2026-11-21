/** Format an exact decimal string from the API ("1234.500000") for display without float rounding. */
export function usdt(v: string | null | undefined, opts: { min?: number; max?: number; sign?: boolean } = {}) {
  if (v === null || v === undefined || v === '') return '—';
  const min = opts.min ?? 2;
  const max = opts.max ?? 6;
  const neg = v.startsWith('-');
  const [w, f = ''] = (neg ? v.slice(1) : v).split('.');
  let frac = f.slice(0, max).replace(/0+$/, '');
  if (frac.length < min) frac = frac.padEnd(min, '0');
  const whole = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = `${whole}${frac ? '.' + frac : ''}`;
  return `${neg ? '−' : opts.sign && v !== '0.000000' ? '+' : ''}${s}`;
}

export const num = (v: string | null | undefined) => (v ? Number(v) : 0);

export function shortHash(h?: string | null, a = 10, b = 6) {
  if (!h) return '—';
  return h.length > a + b + 1 ? `${h.slice(0, a)}…${h.slice(-b)}` : h;
}

export function dt(v?: string | null) {
  if (!v) return '—';
  return new Date(v).toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ago(v?: string | null) {
  if (!v) return '—';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

export function explorerTx(hash: string, chainId: number) {
  if (chainId === 1) return `https://etherscan.io/tx/${hash}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`;
  return null;
}

export const humanize = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

/** Exact sum of 6-decimal strings (no floating point). */
export function sumDec(values: (string | null | undefined)[]) {
  let t = 0n;
  for (const v of values) {
    if (!v) continue;
    const neg = v.startsWith('-');
    const [w, f = ''] = (neg ? v.slice(1) : v).split('.');
    const units = BigInt(w) * 1_000_000n + BigInt((f + '000000').slice(0, 6));
    t += neg ? -units : units;
  }
  const neg = t < 0n;
  const a = neg ? -t : t;
  return `${neg ? '-' : ''}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, '0')}`;
}

/** Integer base units (6 decimals) → decimal string, exactly. */
export function fromUnits(units: string | null | undefined) {
  if (!units) return '0.000000';
  const s = units.replace(/^-/, '').padStart(7, '0');
  return `${units.startsWith('-') ? '-' : ''}${s.slice(0, -6)}.${s.slice(-6)}`;
}
