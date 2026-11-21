import { useState } from 'react';
import { Clock, Layers } from 'lucide-react';
import { post, useApi } from '../../api/client';
import { Alert, Button, Card, Empty, Field, Input, KindTag, Modal, PageHeader, StatusBadge, useAction } from '../../components/ui';
import { dt, pct, sumDec, usdt } from '../../lib/format';

export function StakingPage() {
  const plans = useApi<any[]>('/me/staking/plans');
  const records = useApi<any[]>('/me/staking');
  const ov = useApi('/me/overview');
  const [plan, setPlan] = useState<any | null>(null);
  const [amount, setAmount] = useState('');
  const act = useAction();

  const submit = async () => {
    const r = await act.run(() => post('/me/staking', { planId: plan.id, amount }));
    if (r) {
      setPlan(null);
      setAmount('');
      void records.reload();
      void ov.reload();
    }
  };
  const cancel = async (id: string) => {
    await act.run(() => post(`/me/staking/${id}/cancel`));
    void records.reload();
    void ov.reload();
  };

  return (
    <>
      <PageHeader title="Staking records" subtitle="Internal staking plans managed by administrators." />
      <Alert tone="warning" title="Internal platform records — not on-chain staking">
        Staking on ETH STALKING is an internal record of funds you commit to a plan. Nothing is staked on Ethereum, no protocol rewards are earned, and committed funds cannot be withdrawn until the record ends. Indicative rates are not promises: any reward is allocated at an administrator's discretion and is never guaranteed.
      </Alert>

      <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">Available plans</h2>
      {!plans.data?.length ? (
        <Card><Empty>No plans are currently available.</Empty></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.data.map((p) => (
            <div key={p.id} className="card animate-in flex flex-col p-6">
              <div className="flex items-start justify-between">
                <div className="rounded-xl bg-gradient-to-br from-violet-500/25 to-emerald-500/10 p-2.5 text-violet-200"><Layers className="h-5 w-5" /></div>
                <KindTag kind="staking" />
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{p.name}</h3>
              <p className="mt-1 text-sm text-slate-400">{p.description}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-slate-500">Duration</dt><dd className="text-slate-200"><Clock className="mr-1 inline h-3.5 w-3.5" />{p.durationDays} days</dd></div>
                <div><dt className="text-xs text-slate-500">Indicative rate*</dt><dd className="text-slate-200">{pct(p.indicativeRewardBps)} p.a.</dd></div>
                <div><dt className="text-xs text-slate-500">Minimum</dt><dd className="tabular-nums text-slate-200">{usdt(p.minAmount)}</dd></div>
                <div><dt className="text-xs text-slate-500">Maximum</dt><dd className="tabular-nums text-slate-200">{usdt(p.maxAmount)}</dd></div>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">* {p.rewardRule}</p>
              <Button className="mt-5" onClick={() => setPlan(p)}>Request staking record</Button>
            </div>
          ))}
        </div>
      )}

      <Card className="mt-6" title="My staking records" padded={false}>
        {!records.data?.length ? (
          <Empty>No staking records yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr><th>Plan</th><th>Amount</th><th>Requested</th><th>Term</th><th>Rewards allocated</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {records.data.map((r) => (
                  <tr key={r.id}>
                    <td className="text-slate-200">{r.plan.name}</td>
                    <td className="tabular-nums">{usdt(r.amount)} USDT</td>
                    <td className="text-xs text-slate-400">{dt(r.requestedAt)}</td>
                    <td className="text-xs text-slate-400">{r.startsAt ? `${dt(r.startsAt)} → ${dt(r.endsAt)}` : '—'}</td>
                    <td className="tabular-nums text-fuchsia-300">{usdt(sumDec(r.rewards.filter((x: any) => x.status === 'ALLOCATED').map((x: any) => x.amount)))}</td>
                    <td>
                      <StatusBadge status={r.status} />
                      {r.note && <p className="mt-1 text-xs text-slate-500">{r.note}</p>}
                    </td>
                    <td className="text-right">{r.status === 'REQUESTED' && <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>Cancel</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!plan} onClose={() => setPlan(null)} title={`Request: ${plan?.name}`}>
        {plan && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">Available balance: <b className="tabular-nums text-white">{usdt(ov.data?.balances.available)} USDT</b></p>
            <Field label="Amount (USDT)" hint={`Between ${usdt(plan.minAmount)} and ${usdt(plan.maxAmount)}`} error={act.error}>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            <Alert tone="info">The amount is reserved from your available balance now. If an administrator rejects the request, it is returned in full. Once approved, it is held as an internal staking record for {plan.durationDays} days.</Alert>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPlan(null)}>Cancel</Button>
              <Button onClick={submit} loading={act.busy} disabled={!amount}>Submit request</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
