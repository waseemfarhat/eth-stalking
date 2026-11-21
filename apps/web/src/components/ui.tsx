import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Info, Loader2, X, XCircle } from 'lucide-react';
import { humanize } from '../lib/format';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Card({ children, className, title, subtitle, action, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; padded?: boolean }) {
  return (
    <section className={cx('card animate-in', className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

type Tone = 'emerald' | 'violet' | 'amber' | 'sky' | 'rose' | 'slate';
const toneRing: Record<Tone, string> = {
  emerald: 'from-emerald-500/20 text-emerald-300',
  violet: 'from-violet-500/20 text-violet-300',
  amber: 'from-amber-500/20 text-amber-300',
  sky: 'from-sky-500/20 text-sky-300',
  rose: 'from-rose-500/20 text-rose-300',
  slate: 'from-slate-500/20 text-slate-300',
};

export function Stat({ label, value, hint, icon, tone = 'emerald', tag }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone; tag?: ReactNode }) {
  return (
    <div className="card animate-in relative overflow-hidden p-5">
      <div className={cx('pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br to-transparent blur-2xl', toneRing[tone])} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
        {icon && <div className={cx('rounded-lg bg-gradient-to-br to-transparent p-2', toneRing[tone])}>{icon}</div>}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        {tag}
        {hint}
      </div>
    </div>
  );
}

export function Button({ variant = 'primary', size = 'md', loading, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'; size?: 'sm' | 'md'; loading?: boolean }) {
  const v = {
    primary: 'gradient-brand text-white shadow-lg shadow-violet-900/30 hover:brightness-110',
    success: 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg shadow-emerald-900/30',
    secondary: 'border border-white/10 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]',
    ghost: 'text-slate-300 hover:bg-white/[0.06]',
    danger: 'bg-rose-600/90 text-white hover:bg-rose-500',
  }[variant];
  const s = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm';
  return (
    <button className={cx('inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50', v, s, className)} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-400">{error}</span>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx('input', p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx('input', p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx('input', p.className)} />;

const statusTone: Record<string, string> = {
  APPROVED: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  VERIFIED: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  CONFIRMED: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  ALLOCATED: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  UNDER_REVIEW: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  PAYOUT_RECORDED: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  SUBMITTED: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  REQUESTED: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  AWAITING_VERIFICATION: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  AWAITING_CONFIRMATIONS: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  PENDING: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  UNVERIFIED: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  FAILED: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  SUSPENDED: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  REVERSED: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  CANCELLED: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  ENDED: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
  INACTIVE: 'bg-slate-500/15 text-slate-300 ring-slate-500/30',
};
const statusLabel: Record<string, string> = {
  APPROVED: 'Approved · credited',
  APPROVED_WITHDRAWAL: 'Approved · not yet paid',
  PAYOUT_RECORDED: 'Payout recorded · verifying',
  COMPLETED: 'Paid · verified on-chain',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset', statusTone[status] ?? 'bg-slate-500/15 text-slate-300 ring-slate-500/30')}>
      {label ?? statusLabel[status] ?? humanize(status)}
    </span>
  );
}

/** Labels that distinguish the nature of a figure — required throughout the UI. */
export function KindTag({ kind }: { kind: 'onchain' | 'internal' | 'staking' | 'reward' | 'payout' | 'sample' }) {
  const m = {
    onchain: ['Blockchain-verified', 'bg-sky-500/10 text-sky-300 ring-sky-400/30'],
    internal: ['Internal balance', 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30'],
    staking: ['Internal staking record', 'bg-violet-500/10 text-violet-300 ring-violet-400/30'],
    reward: ['Admin-allocated', 'bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-400/30'],
    payout: ['Manual payout', 'bg-amber-500/10 text-amber-300 ring-amber-400/30'],
    sample: ['SAMPLE / TEST', 'bg-orange-500/15 text-orange-300 ring-orange-400/40'],
  }[kind];
  return <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset', m[1])}>{m[0]}</span>;
}

export function Alert({ tone = 'info', title, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const m = {
    info: ['border-sky-500/30 bg-sky-500/[0.07] text-sky-200', Info],
    warning: ['border-amber-500/30 bg-amber-500/[0.07] text-amber-100', AlertTriangle],
    danger: ['border-rose-500/30 bg-rose-500/[0.07] text-rose-100', XCircle],
    success: ['border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-100', CheckCircle2],
  }[tone] as [string, typeof Info];
  const Icon = m[1];
  return (
    <div className={cx('flex gap-3 rounded-xl border p-4 text-sm', m[0], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-[13px] leading-relaxed opacity-90">{children}</div>}
      </div>
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      }}
    >
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {ok ? 'Copied' : label}
    </Button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('card animate-in w-full', wide ? 'max-w-3xl' : 'max-w-lg')} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <h3 className="font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children = 'Nothing here yet.' }: { children?: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}

export function ErrorText({ error }: { error: { message: string } | null | undefined }) {
  if (!error) return null;
  return <Alert tone="danger">{error.message}</Alert>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl border border-white/[0.06] bg-navy-900 p-1">
      {items.map((i) => (
        <button key={i.value} onClick={() => onChange(i.value)} className={cx('rounded-lg px-3 py-1.5 text-xs font-medium transition', value === i.value ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200')}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between px-5 py-3 text-xs text-slate-400">
      <span>
        {total} record{total === 1 ? '' : 's'}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function Timeline({ items }: { items: { status?: string; event?: string; at: string; by?: string; note?: string }[] }) {
  return (
    <ol className="relative space-y-3 border-l border-white/10 pl-5">
      {items.map((h, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full bg-gradient-to-br from-emerald-400 to-violet-500 ring-4 ring-navy-850" />
          <div className="flex flex-wrap items-center gap-2">
            {h.status && <StatusBadge status={h.status} />}
            {h.event && <span className="text-xs font-medium text-slate-300">{humanize(h.event)}</span>}
            <span className="text-xs text-slate-500">{new Date(h.at).toLocaleString()}</span>
            {h.by && <span className="text-[11px] text-slate-500">by {h.by === 'SYSTEM' || h.by === 'SCANNER' ? h.by.toLowerCase() : 'account ' + h.by.slice(0, 8)}</span>}
          </div>
          {h.note && <p className="mt-1 text-xs text-slate-400">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}

export function useForm<T extends Record<string, any>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const set = (k: keyof T) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));
  return { values, setValues, set, reset: () => setValues(initial) };
}

/** Run an async action with loading + error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
