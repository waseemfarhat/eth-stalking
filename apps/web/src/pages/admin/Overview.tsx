import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, CircleSlash, Gift, HelpCircle, Layers, Scale, Users } from 'lucide-react';
import { useApi } from '../../api/client';
import { Alert, Card, ErrorText, KindTag, Loading, PageHeader, Stat } from '../../components/ui';
import { num, usdt } from '../../lib/format';
import { ChartTooltip } from '../user/Overview';

function Queue({ to, label, count, tone }: { to: string; label: string; count: number; tone: string }) {
  return (
    <Link to={to} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-navy-900/60 px-4 py-3 transition hover:border-white/20">
      <span className="text-sm text-slate-300">{label}</span>
      <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${count > 0 ? tone : 'bg-white/5 text-slate-500'}`}>{count}</span>
    </Link>
  );
}

export function AdminOverview() {
  const { data, error, loading } = useApi('/admin/overview');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorText error={error} />;
  const d = data!;
  const t = d.totals;
  const composition = [
    { name: 'Available', value: num(t.userAvailable), color: '#10b981' },
    { name: 'Locked', value: num(t.userLocked), color: '#f59e0b' },
    { name: 'Reserved', value: num(t.userPending), color: '#38bdf8' },
    { name: 'Staked', value: num(t.userStaked), color: '#8b5cf6' },
  ].filter((x) => x.value > 0);
  const series = d.series.map((s: any) => ({ date: s.date.slice(5), deposits: num(s.deposits), rewards: num(s.rewards) }));

  return (
    <>
      <PageHeader title="Admin overview" subtitle={`Chain mode: ${d.chainMode.toUpperCase()} · Real deposits ${d.compliance.realDepositsEnabled ? 'ENABLED' : 'DISABLED'}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Registered users" value={d.users.total} icon={<Users className="h-4 w-4" />} tone="sky" hint={`${d.users.active} active`} />
        <Stat label="Verified deposits" value={`${usdt(d.deposits.verifiedTotal)}`} icon={<ArrowDownToLine className="h-4 w-4" />} tone="emerald" tag={<KindTag kind="onchain" />} hint={`${d.deposits.verifiedCount} transfers`} />
        <Stat label="Internal liabilities" value={`${usdt(t.userLiabilities)}`} icon={<Scale className="h-4 w-4" />} tone="amber" tag={<KindTag kind="internal" />} hint="Total owed to users" />
        <Stat label="Rewards allocated" value={`${usdt(t.rewardsAllocated)}`} icon={<Gift className="h-4 w-4" />} tone="rose" tag={<KindTag kind="reward" />} hint={`${d.rewards.count} active allocations`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="Reserve check" subtitle="On-chain balance of the active receiving wallet vs. internal liabilities">
          {!d.reserve ? (
            <Alert tone="warning">No active, verified receiving wallet for this chain.</Alert>
          ) : d.reserve.onchainBalance === null ? (
            <Alert tone="danger" title="Could not read on-chain balance">{d.reserve.error}</Alert>
          ) : (
            <div className="space-y-3 text-sm">
              <Row k="On-chain wallet balance" v={`${usdt(d.reserve.onchainBalance)} USDT`} />
              <Row k="Internal user liabilities" v={`${usdt(d.reserve.liabilities)} USDT`} />
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${num(d.reserve.shortfall) > 0 ? 'bg-rose-500/10 text-rose-200 ring-1 ring-rose-500/30' : 'bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30'}`}>
                {num(d.reserve.shortfall) > 0 ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                {num(d.reserve.shortfall) > 0 ? `Shortfall of ${usdt(d.reserve.shortfall)} USDT — liabilities exceed the receiving wallet` : 'Receiving wallet covers internal liabilities'}
              </div>
              <p className="text-xs text-slate-500">Funds moved to other treasury wallets are not included. Rewards and manual credits increase liabilities without adding on-chain funds.</p>
            </div>
          )}
        </Card>

        <Card title="Action queues">
          <div className="space-y-2">
            <Queue to="/admin/deposits?status=UNDER_REVIEW" label="Deposits awaiting approval" count={d.deposits.pendingApprovals} tone="bg-violet-500/20 text-violet-200" />
            <Queue to="/admin/deposits?unmatched=true" label="Unmatched deposits" count={d.deposits.unmatched} tone="bg-amber-500/20 text-amber-200" />
            <Queue to="/admin/staking" label="Staking requests" count={d.staking.pendingRequests} tone="bg-violet-500/20 text-violet-200" />
            <Queue to="/admin/withdrawals?status=REQUESTED" label="Withdrawal requests" count={d.withdrawals.requested} tone="bg-amber-500/20 text-amber-200" />
            <Queue to="/admin/withdrawals?status=APPROVED" label="Approved — awaiting payout" count={d.withdrawals.approvedAwaitingPayout} tone="bg-sky-500/20 text-sky-200" />
            <Queue to="/admin/withdrawals?status=PAYOUT_RECORDED" label="Payouts to verify" count={d.withdrawals.payoutRecorded} tone="bg-sky-500/20 text-sky-200" />
          </div>
        </Card>

        <Card title="Liability composition" subtitle="Internal balances by type">
          {composition.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">No balances yet.</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={composition} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                    {composition.map((c) => (
                      <Cell key={c.name} fill={c.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Approved deposits vs. allocated rewards — 30 days">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} interval={4} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
                <Bar dataKey="deposits" name="Deposits credited" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="rewards" name="Rewards allocated" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Platform ledger totals">
          <div className="space-y-2.5 text-sm">
            <Row k="Deposits credited" v={usdt(t.depositsCredited)} />
            <Row k="Rewards allocated" v={usdt(t.rewardsAllocated)} />
            <Row k="Net admin adjustments" v={usdt(t.netAdjustments)} />
            <Row k="Withdrawals paid" v={usdt(t.withdrawalsPaid)} />
            <div className="border-t border-white/5 pt-2.5" />
            <Row k="Staked (internal)" v={usdt(t.userStaked)} icon={<Layers className="h-3.5 w-3.5 text-violet-300" />} />
            <Row k="Reserved for requests" v={usdt(t.userPending)} icon={<ArrowUpFromLine className="h-3.5 w-3.5 text-sky-300" />} />
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Compliance gate" subtitle="Real deposits require every check — configured on the server, not in this UI" action={<Link to="/admin/compliance" className="text-xs text-emerald-400 hover:underline">Details</Link>}>
        <ul className="grid gap-2 md:grid-cols-2">
          {d.compliance.checks.map((c: any) => (
            <li key={c.id} className="flex items-start gap-2 text-sm">
              {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" /> : c.id === 'env_flag' ? <CircleSlash className="mt-0.5 h-4 w-4 text-slate-500" /> : <HelpCircle className="mt-0.5 h-4 w-4 text-amber-400" />}
              <span>
                <span className="text-slate-200">{c.label}</span>
                <span className="block text-xs text-slate-500">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Row({ k, v, icon }: { k: string; v: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-slate-400">{icon}{k}</span>
      <span className="tabular-nums text-slate-100">{v}</span>
    </div>
  );
}
