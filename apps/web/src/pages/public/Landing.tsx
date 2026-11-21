import { Link } from 'react-router-dom';
import { ArrowRight, FileCheck2, Fingerprint, Layers, Link2, ShieldCheck, Wallet } from 'lucide-react';
import { Logo, ModeBanner } from '../../layouts/AppShell';

const features = [
  { icon: Link2, title: 'Blockchain-verified deposits', body: 'Every USDT deposit is independently checked on Ethereum — network, official token contract, destination, amount and confirmations — before it can be reviewed.' },
  { icon: Wallet, title: 'Transparent internal ledger', body: 'Your balance is an internal platform record backed by a double-entry ledger. Every movement is visible to you, with its reason, and exportable.' },
  { icon: Layers, title: 'Internal staking records', body: 'Staking here is an internal record managed by administrators. It is not on-chain Ethereum staking and does not generate automatic returns.' },
  { icon: FileCheck2, title: 'Manual, verified withdrawals', body: 'Withdrawals are reviewed and paid manually. A request is only marked paid after the payout transaction is verified on-chain.' },
  { icon: Fingerprint, title: 'Tamper-evident audit trail', body: 'Financial actions are written to an append-only, hash-chained audit log. Ledger history can never be edited — only corrected with new entries.' },
  { icon: ShieldCheck, title: 'Compliance-gated', body: 'Real-money deposits stay disabled until regulatory authorisation and AML/CFT controls are documented by the operator.' },
];

export function Landing() {
  return (
    <div className="min-h-full">
      <ModeBanner />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <div className="flex items-center gap-3">
          <Link to="/terms" className="hidden text-sm text-slate-400 hover:text-white sm:block">Terms & disclosures</Link>
          <Link to="/login" className="rounded-xl px-4 py-2 text-sm text-slate-200 hover:bg-white/5">Sign in</Link>
          <Link to="/register" className="gradient-brand rounded-xl px-4 py-2 text-sm font-medium text-white">Create account</Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-16 pt-12 text-center sm:pt-20">
        <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> USDT · Ethereum ERC-20
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-6xl">
          A transparent <span className="gradient-text">USDT account</span> with verifiable deposits
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base text-slate-400">
          ETH STALKING verifies every deposit on Ethereum, keeps your internal balance in an auditable ledger, and shows you exactly what is blockchain-verified, what is an internal record, and what is administrator-allocated.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link to="/register" className="gradient-brand inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-medium text-white shadow-lg shadow-violet-900/40">
            Get started <ArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/terms" className="rounded-xl border border-white/10 px-6 py-3 text-sm text-slate-200 hover:bg-white/5">Read the risk disclosures</Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="card p-6">
            <div className="mb-4 inline-flex rounded-xl bg-gradient-to-br from-emerald-500/20 to-violet-500/20 p-2.5 text-emerald-300">
              <f.icon className="h-5 w-5" />
            </div>
            <h3 className="font-semibold text-white">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-white/[0.06] px-6 py-8 text-center text-xs leading-relaxed text-slate-500">
        Internal balances, staking records and rewards are platform records, not on-chain holdings. Rewards are discretionary and never guaranteed. Digital assets carry risk of loss.
      </footer>
    </div>
  );
}
