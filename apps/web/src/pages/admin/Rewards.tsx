import { useState } from 'react';
import { post, useApi } from '../../api/client';
import { Alert, Button, Card, Empty, Field, Input, KindTag, Loading, Modal, PageHeader, Pagination, StatusBadge, Tabs, Textarea, useAction } from '../../components/ui';
import { UserPicker } from '../../components/UserPicker';
import { dt, pct, usdt } from '../../lib/format';

export function AdminRewards() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [filterUser, setFilterUser] = useState<any>(null);
  const qs = new URLSearchParams({ page: String(page), status, ...(filterUser ? { userId: filterUser.id } : {}) }).toString();
  const list = useApi(`/admin/rewards?${qs}`, [qs]);
  const [user, setUser] = useState<any>(null);
  const [f, setF] = useState({ amount: '', description: '', rateBps: '' });
  const [reverse, setReverse] = useState<any>(null);
  const [reason, setReason] = useState('');
  const act = useAction();
  const rev = useAction();

  const allocate = async () => {
    const r = await act.run(() => post('/admin/rewards', { userId: user.id, amount: f.amount, description: f.description, rateBps: f.rateBps || undefined }, true));
    if (r) {
      setF({ amount: '', description: '', rateBps: '' });
      setUser(null);
      void list.reload();
    }
  };

  return (
    <>
      <PageHeader title="Reward management" subtitle="Rewards are discretionary, manually allocated credits — never automatic, never guaranteed." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Allocate reward" subtitle="Creates a ledger entry from the platform reward-funding account">
          <div className="space-y-4">
            <Field label="Customer"><UserPicker value={user} onChange={setUser} /></Field>
            <Field label="Amount (USDT)"><Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
            <Field label="Description (shown to user)"><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Q4 discretionary reward" /></Field>
            <Field label="Percentage used (bps, optional)" hint={f.rateBps ? pct(Number(f.rateBps)) : 'For your records only'}><Input type="number" value={f.rateBps} onChange={(e) => setF({ ...f, rateBps: e.target.value })} /></Field>
            {act.error && <Alert tone="danger">{act.error}</Alert>}
            <Button className="w-full" loading={act.busy} disabled={!user || !f.amount || f.description.trim().length < 3} onClick={allocate}>Allocate reward</Button>
          </div>
        </Card>

        <Card className="lg:col-span-2" padded={false} title="Allocation history" subtitle={list.data ? `Active total in view: ${usdt(list.data.activeTotal)} USDT` : undefined} action={<KindTag kind="reward" />}>
          <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] p-4">
            <Tabs value={status} onChange={(v) => { setStatus(v); setPage(1); }} items={[{ value: '', label: 'All' }, { value: 'ALLOCATED', label: 'Allocated' }, { value: 'REVERSED', label: 'Reversed' }]} />
            <div className="min-w-[240px] flex-1"><UserPicker value={filterUser} onChange={(u) => { setFilterUser(u); setPage(1); }} /></div>
          </div>
          {list.loading && !list.data ? (
            <Loading />
          ) : !list.data?.rows.length ? (
            <Empty>No rewards.</Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="data">
                  <thead><tr><th>Date</th><th>User</th><th>Description</th><th className="text-right">Amount</th><th>By</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {list.data.rows.map((r: any) => (
                      <tr key={r.id}>
                        <td className="text-xs text-slate-400">{dt(r.allocatedAt)}</td>
                        <td className="text-sm">{r.user.email}</td>
                        <td className="max-w-xs text-sm">
                          {r.description}
                          {r.stakingRecord && <p className="text-xs text-slate-500">Plan: {r.stakingRecord.plan.name}</p>}
                          {r.reversalReason && <p className="text-xs text-rose-300">Reversed by {r.reversedBy?.email}: {r.reversalReason}</p>}
                          <p className="mono text-slate-600">ledger {r.ledgerTxId}</p>
                        </td>
                        <td className="text-right tabular-nums text-fuchsia-300">{usdt(r.amount)} {r.currency}</td>
                        <td className="text-xs text-slate-400">{r.allocatedBy.email}</td>
                        <td><StatusBadge status={r.status} /></td>
                        <td className="text-right">{r.status === 'ALLOCATED' && <Button size="sm" variant="ghost" onClick={() => { setReverse(r); setReason(''); }}>Reverse</Button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
            </>
          )}
        </Card>
      </div>

      <Modal open={!!reverse} onClose={() => setReverse(null)} title="Reverse reward">
        {reverse && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">Reverses {usdt(reverse.amount)} USDT allocated to {reverse.user.email} with a corrective ledger entry. The original entry is kept.</p>
            <Field label="Reason (shown to user)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            {rev.error && <Alert tone="danger">{rev.error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReverse(null)}>Cancel</Button>
              <Button variant="danger" loading={rev.busy} disabled={reason.trim().length < 3} onClick={async () => { const r = await rev.run(() => post(`/admin/rewards/${reverse.id}/reverse`, { reason })); if (r) { setReverse(null); void list.reload(); } }}>Reverse reward</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
