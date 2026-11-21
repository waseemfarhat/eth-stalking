import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownToLine, Gift, Layers, Lock, Wallet } from 'lucide-react';
import { useApi } from '../../api/client';
import { Card, Empty, ErrorText, KindTag, Loading, PageHeader, Stat, StatusBadge } from '../../components/ui';
import { dt, humanize, num, shortHash, sumDec, usdt } from '../../lib/format';

export const accountLabel: Record<string, string> = { AVAILABLE: 'Available', LOCKED: 'Locked', PENDING: 'Reserved', STAKED: 'Staked' };

export const ChartTooltip = ({ active, payload, label }: any) =>
  active && payload?.length ? (
    <div className="rounded-xl border border-white/10 bg-navy-900/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 text-slate-400">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="tabular-nums text-white">
          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: {usdt(String(p.value))} USDT
        </p>
      ))}
    </div>
  ) : null;

export function UserOverview() {
  const { data, error, loading } = useApi('/me/overview');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorText error={error} />;
  const d = data!;
  const b = d.balances;
  const chart = d.balanceHistory.map((p: any) => ({ date: p.date.slice(5), total: num(p.total) }));

  return (
    <>
      <PageHeader title="Overview" subtitle="Your internal platform account. Blockchain-verified deposits and internal balances are shown separately." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Available balance" value={`${usdt(b.available)} USDT`} icon={<Wallet className="h-4 w-4" />} tone="emerald" tag={<KindTag kind="internal" />} />
        <Stat label="Locked & reserved" value={`${usdt(sumDec([b.locked, b.pending]))} USDT`} icon={<Lock className="h-4 w-4" />} tone="amber" tag={<KindTag kind="internal" />} hint={`${usdt(b.locked)} locked · ${usdt(b.pending)} reserved`} />
        <Stat label="Staked" value={`${usdt(b.staked)} USDT`} icon={<Layers className="h-4 w-4" />} tone="violet" tag={<KindTag kind="staking" />} hint={`${d.activeStakes} active record(s)`} />
        <Stat label="Rewards allocated" value={`${usdt(d.rewards.total)} USDT`} icon={<Gift className="h-4 w-4" />} tone="rose" tag={<KindTag kind="reward" />} hint={`${d.rewards.count} allocation(s)`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Total internal balance — last 30 days" subtitle="Derived from your ledger entries (available + locked + reserved + staked)">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="gBal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="total" name="Total" stroke="#10b981" strokeWidth={2} fill="url(#gBal)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Blockchain-verified deposits" subtitle="Actual USDT transfers verified on Ethereum">
          <div className="space-y-4">
            <div>
              <p className="text-xs text-slate-400">Verified on-chain (all statuses)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{usdt(d.deposits.onchainVerifiedTotal)} <span className="text-sm text-slate-400">USDT</span></p>
              <div className="mt-1"><KindTag kind="onchain" /></div>
            </div>
            <div className="border-t border-white/5 pt-4">
              <p className="text-xs text-slate-400">Approved & credited to your internal balance</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-300">{usdt(d.deposits.approvedTotal)} USDT</p>
              <p className="text-xs text-slate-500">{d.deposits.approvedCount} deposit(s)</p>
            </div>
            <Link to="/app/deposit" className="gradient-brand inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium text-white">
              <ArrowDownToLine className="h-4 w-4" /> Make a deposit
            </Link>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Recent transactions" subtitle="Internal ledger movements" padded={false} action={<Link to="/app/wallet" className="text-xs text-emerald-400 hover:underline">View all</Link>}>
          {d.recentTransactions.length === 0 ? (
            <Empty />
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {d.recentTransactions.map((t: any) => (
                <li key={t.id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{t.description}</p>
                      <p className="text-xs text-slate-500">{humanize(t.type)} · {dt(t.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      {t.entries.map((e: any, i: number) => (
                        <p key={i} className={`text-sm tabular-nums ${e.amount.startsWith('-') ? 'text-rose-300' : 'text-emerald-300'}`}>
                          {usdt(e.amount, { sign: true })} <span className="text-[10px] text-slate-500">{accountLabel[e.account]}</span>
                        </p>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Withdrawal history" subtitle="Manually processed payouts" padded={false} action={<Link to="/app/withdraw" className="text-xs text-emerald-400 hover:underline">Manage</Link>}>
          {d.withdrawals.length === 0 ? (
            <Empty>No withdrawals yet.</Empty>
          ) : (
            <table className="data">
              <tbody>
                {d.withdrawals.map((w: any) => (
                  <tr key={w.id}>
                    <td>
                      <p className="tabular-nums text-white">{usdt(w.amount)} USDT</p>
                      <p className="mono text-slate-500">→ {shortHash(w.destinationAddress, 8, 4)}</p>
                    </td>
                    <td className="text-xs text-slate-400">{dt(w.createdAt)}</td>
                    <td className="text-right">
                      <StatusBadge status={w.status} label={w.status === 'APPROVED' ? 'Approved · not yet paid' : undefined} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
