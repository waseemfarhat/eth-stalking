import { useApi } from '../../api/client';
import { Alert, Card, Empty, KindTag, PageHeader, Stat, StatusBadge } from '../../components/ui';
import { dt, pct, sumDec, usdt } from '../../lib/format';

export function RewardsPage() {
  const { data } = useApi<any[]>('/me/rewards');
  const active = (data ?? []).filter((r) => r.status === 'ALLOCATED');
  const total = sumDec(active.map((r) => r.amount));

  return (
    <>
      <PageHeader title="Rewards" subtitle="Rewards allocated to your internal balance by administrators." />
      <Alert tone="warning" title="Discretionary, not guaranteed">
        Rewards are manual allocations made by administrators. They are not automatically generated, not investment profits, and are not guaranteed in amount or timing. An incorrect allocation may be reversed with a visible corrective entry.
      </Alert>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Stat label="Total allocated (active)" value={`${usdt(total)} USDT`} tone="rose" tag={<KindTag kind="reward" />} />
        <Stat label="Allocations" value={active.length} tone="violet" hint={`${(data ?? []).length - active.length} reversed`} />
      </div>
      <Card className="mt-4" title="Allocation history" padded={false}>
        {!data?.length ? (
          <Empty>No rewards have been allocated to you.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr><th>Allocated</th><th>Description</th><th>Related plan</th><th>Rate used</th><th className="text-right">Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td className="text-xs text-slate-400">{dt(r.allocatedAt)}</td>
                    <td className="text-slate-200">
                      {r.description}
                      {r.reversalReason && <p className="text-xs text-rose-300">Reversed: {r.reversalReason}</p>}
                    </td>
                    <td className="text-xs text-slate-400">{r.stakingRecord?.plan?.name ?? '—'}</td>
                    <td className="text-xs text-slate-400">{r.rateBps != null ? pct(r.rateBps) : '—'}</td>
                    <td className={`text-right tabular-nums ${r.status === 'REVERSED' ? 'text-slate-500 line-through' : 'text-fuchsia-300'}`}>{usdt(r.amount)} {r.currency}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
