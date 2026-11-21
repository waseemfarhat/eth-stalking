import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, post, useApi } from '../../api/client';
import { Alert, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Pagination, Select, StatusBadge, Tabs, Textarea, useAction } from '../../components/ui';
import { dt, pct, usdt } from '../../lib/format';

const blankPlan = { name: '', description: '', durationDays: '30', minAmount: '', maxAmount: '', indicativeRewardBps: '0', rewardRule: 'Administrator may allocate a discretionary reward at or after the end of the term. The indicative rate is not a promise or guarantee.' };

export function AdminStaking() {
  const plans = useApi<any[]>('/admin/staking/plans');
  const [filter, setFilter] = useState('REQUESTED');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), status: filter }).toString();
  const records = useApi(`/admin/staking/records?${qs}`, [qs]);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>(blankPlan);
  const [acting, setActing] = useState<{ rec: any; kind: 'APPROVE' | 'REJECT' | 'END' | 'REWARD' } | null>(null);
  const [note, setNote] = useState('');
  const [reward, setReward] = useState({ amount: '', description: '', rateBps: '' });
  const [suggest, setSuggest] = useState<any>(null);
  const act = useAction();

  const openPlan = (p: any | null) => {
    setEditing(p ?? {});
    setForm(p ? { ...p, durationDays: String(p.durationDays), indicativeRewardBps: String(p.indicativeRewardBps) } : blankPlan);
  };
  const savePlan = async () => {
    const body = { name: form.name, description: form.description, durationDays: form.durationDays, minAmount: form.minAmount, maxAmount: form.maxAmount, indicativeRewardBps: form.indicativeRewardBps, rewardRule: form.rewardRule, ...(editing?.id ? { status: form.status } : {}) };
    const r = await act.run(() => (editing?.id ? api(`/admin/staking/plans/${editing.id}`, { method: 'PATCH', body }) : post('/admin/staking/plans', body)));
    if (r) {
      setEditing(null);
      void plans.reload();
    }
  };
  const openAction = async (rec: any, kind: 'APPROVE' | 'REJECT' | 'END' | 'REWARD') => {
    setActing({ rec, kind });
    setNote('');
    act.setError(null);
    if (kind === 'REWARD') {
      const s = await api(`/admin/staking/records/${rec.id}/suggested-reward`);
      setSuggest(s);
      setReward({ amount: s.suggestedAmount, description: `${rec.plan.name} — discretionary reward`, rateBps: String(rec.plan.indicativeRewardBps) });
    }
  };
  const doAction = async () => {
    if (!acting) return;
    const { rec, kind } = acting;
    const r = await act.run(() =>
      kind === 'END'
        ? post(`/admin/staking/records/${rec.id}/end`, { note: note || undefined })
        : kind === 'REWARD'
          ? post('/admin/rewards', { userId: rec.userId, stakingRecordId: rec.id, amount: reward.amount, description: reward.description, rateBps: reward.rateBps || undefined }, true)
          : post(`/admin/staking/records/${rec.id}/review`, { decision: kind, note: note || undefined }),
    );
    if (r) {
      setActing(null);
      void records.reload();
    }
  };

  return (
    <>
      <PageHeader title="Internal staking" subtitle="Plans and records are internal platform records — not on-chain staking." action={<Button onClick={() => openPlan(null)}><Plus className="h-4 w-4" /> New plan</Button>} />

      <Card title="Plans" padded={false}>
        {!plans.data?.length ? (
          <Empty>No plans.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Name</th><th>Duration</th><th>Min – max</th><th>Indicative rate</th><th>Records</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {plans.data.map((p) => (
                  <tr key={p.id}>
                    <td><p className="text-slate-100">{p.name}</p><p className="max-w-xs truncate text-xs text-slate-500">{p.description}</p></td>
                    <td>{p.durationDays} days</td>
                    <td className="tabular-nums">{usdt(p.minAmount)} – {usdt(p.maxAmount)}</td>
                    <td>{pct(p.indicativeRewardBps)}</td>
                    <td>{p._count.records}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-right"><Button size="sm" variant="secondary" onClick={() => openPlan(p)}>Edit</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mb-3 mt-6">
        <Tabs value={filter} onChange={(v) => { setFilter(v); setPage(1); }} items={[{ value: 'REQUESTED', label: 'Requests' }, { value: 'ACTIVE', label: 'Active' }, { value: 'ENDED', label: 'Ended' }, { value: 'REJECTED', label: 'Rejected' }, { value: '', label: 'All' }]} />
      </div>
      <Card padded={false}>
        {records.loading && !records.data ? (
          <Loading />
        ) : !records.data?.rows.length ? (
          <Empty>No records.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>User</th><th>Plan</th><th className="text-right">Amount</th><th>Requested</th><th>Term</th><th>Rewards</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {records.data.rows.map((r: any) => (
                    <tr key={r.id}>
                      <td className="text-sm">{r.user.email}</td>
                      <td>{r.plan.name}</td>
                      <td className="text-right tabular-nums">{usdt(r.amount)}</td>
                      <td className="text-xs text-slate-400">{dt(r.requestedAt)}</td>
                      <td className="text-xs text-slate-400">{r.startsAt ? `${dt(r.startsAt)} → ${dt(r.endsAt)}` : '—'}</td>
                      <td className="text-xs">{r.rewards.length}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          {r.status === 'REQUESTED' && (
                            <>
                              <Button size="sm" variant="success" onClick={() => openAction(r, 'APPROVE')}>Approve</Button>
                              <Button size="sm" variant="danger" onClick={() => openAction(r, 'REJECT')}>Reject</Button>
                            </>
                          )}
                          {r.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => openAction(r, 'END')}>End</Button>}
                          {(r.status === 'ACTIVE' || r.status === 'ENDED') && <Button size="sm" variant="secondary" onClick={() => openAction(r, 'REWARD')}>Allocate reward</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={records.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit plan' : 'New staking plan'} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Duration (days)"><Input type="number" min={1} value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: e.target.value })} /></Field>
          <Field label="Minimum (USDT)"><Input inputMode="decimal" value={form.minAmount} onChange={(e) => setForm({ ...form, minAmount: e.target.value })} /></Field>
          <Field label="Maximum (USDT)"><Input inputMode="decimal" value={form.maxAmount} onChange={(e) => setForm({ ...form, maxAmount: e.target.value })} /></Field>
          <Field label="Indicative rate (basis points p.a.)" hint={`${pct(Number(form.indicativeRewardBps) || 0)} — shown to users as indicative only`}>
            <Input type="number" min={0} value={form.indicativeRewardBps} onChange={(e) => setForm({ ...form, indicativeRewardBps: e.target.value })} />
          </Field>
          {editing?.id && (
            <Field label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2"><Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Reward rule (shown to users)"><Textarea value={form.rewardRule} onChange={(e) => setForm({ ...form, rewardRule: e.target.value })} /></Field></div>
        </div>
        <Alert tone="info" className="mt-4">Do not describe rewards as guaranteed or automatic. Rewards are always allocated manually.</Alert>
        {act.error && <Alert tone="danger" className="mt-4">{act.error}</Alert>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          <Button onClick={savePlan} loading={act.busy}>Save plan</Button>
        </div>
      </Modal>

      <Modal open={!!acting} onClose={() => setActing(null)} title={acting ? { APPROVE: 'Approve staking request', REJECT: 'Reject staking request', END: 'End staking record', REWARD: 'Allocate discretionary reward' }[acting.kind] : ''}>
        {acting && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">{acting.rec.user.email} · {acting.rec.plan.name} · <b className="text-white">{usdt(acting.rec.amount)} USDT</b></p>
            {acting.kind === 'REWARD' ? (
              <>
                {suggest && <Alert tone="info">Suggestion: {usdt(suggest.suggestedAmount)} USDT for {suggest.days} day(s) at {pct(suggest.indicativeRewardBps)}. {suggest.note}</Alert>}
                <Field label="Amount (USDT)"><Input inputMode="decimal" value={reward.amount} onChange={(e) => setReward({ ...reward, amount: e.target.value })} /></Field>
                <Field label="Description (shown to user)"><Input value={reward.description} onChange={(e) => setReward({ ...reward, description: e.target.value })} /></Field>
                <Field label="Rate used (bps, optional)"><Input type="number" value={reward.rateBps} onChange={(e) => setReward({ ...reward, rateBps: e.target.value })} /></Field>
              </>
            ) : (
              <Field label={acting.kind === 'REJECT' ? 'Reason (required, shown to user)' : 'Note (optional)'}><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            )}
            {act.error && <Alert tone="danger">{act.error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setActing(null)}>Cancel</Button>
              <Button variant={acting.kind === 'REJECT' ? 'danger' : 'success'} loading={act.busy} onClick={doAction} disabled={acting.kind === 'REJECT' && !note.trim()}>Confirm</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
