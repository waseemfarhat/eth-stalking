import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import { api, post, useApi } from '../../api/client';
import { Alert, Button, Card, Empty, Field, Input, KindTag, Loading, Modal, PageHeader, Pagination, Select, StatusBadge, Tabs, Textarea, Timeline, useAction } from '../../components/ui';
import { UserPicker } from '../../components/UserPicker';
import { useConfig } from '../../lib/config';
import { dt, explorerTx, shortHash, usdt } from '../../lib/format';
import { Info } from '../user/Deposit';

const STATUSES = ['SUBMITTED', 'AWAITING_VERIFICATION', 'AWAITING_CONFIRMATIONS', 'VERIFIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'];

export function AdminDeposits() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const unmatched = params.get('unmatched') === 'true';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), status, q, ...(unmatched ? { unmatched: 'true' } : {}) }).toString();
  const list = useApi(`/admin/deposits?${qs}`, [qs]);
  const [openId, setOpenId] = useState<string | null>(null);
  const jobs = useAction();

  const view = unmatched ? 'unmatched' : status === 'UNDER_REVIEW' ? 'review' : 'all';
  const setView = (v: string) => {
    setPage(1);
    if (v === 'unmatched') setParams({ unmatched: 'true' });
    else if (v === 'review') setParams({ status: 'UNDER_REVIEW' });
    else setParams({});
  };

  return (
    <>
      <PageHeader
        title="Deposit management"
        subtitle="Verification is automatic and independent; crediting requires your approval. A transfer can be credited to one account only."
        action={
          <Button variant="secondary" loading={jobs.busy} onClick={async () => { await jobs.run(() => post('/admin/system/run-jobs')); void list.reload(); }}>
            <RefreshCw className="h-4 w-4" /> Scan & re-verify now
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={view} onChange={setView} items={[{ value: 'all', label: 'All deposits' }, { value: 'review', label: 'Awaiting approval' }, { value: 'unmatched', label: 'Unmatched' }]} />
        {view === 'all' && (
          <Select className="w-56" value={status} onChange={(e) => { setPage(1); setParams(e.target.value ? { status: e.target.value } : {}); }}>
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>)}
          </Select>
        )}
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
          <Input className="pl-9" placeholder="Search tx hash or user email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
      </div>
      {jobs.error && <Alert tone="danger" className="mb-4">{jobs.error}</Alert>}

      <Card padded={false}>
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.rows.length ? (
          <Empty>No deposits match.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr><th>Submitted</th><th>User</th><th>Transaction</th><th>From</th><th className="text-right">Amount</th><th>Conf.</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {list.data.rows.map((d: any) => (
                    <tr key={d.id}>
                      <td className="text-xs text-slate-400">{dt(d.submittedAt)}</td>
                      <td>{d.user ? <span className="text-sm">{d.user.email}</span> : <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-300">Unmatched</span>}</td>
                      <td className="mono">{shortHash(d.txHash)} {d.isSample && <KindTag kind="sample" />}</td>
                      <td className="mono text-slate-500">{d.blockchainTx ? shortHash(d.blockchainTx.fromAddress, 8, 4) : '—'}</td>
                      <td className="text-right tabular-nums">{d.amount ? usdt(d.amount) : '—'}</td>
                      <td className="tabular-nums text-slate-400">{d.blockchainTx?.confirmations ?? '—'}</td>
                      <td><StatusBadge status={d.status} /></td>
                      <td className="text-right"><Button size="sm" variant="secondary" onClick={() => setOpenId(d.id)}>Review</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {openId && <DepositReview id={openId} onClose={() => setOpenId(null)} onChanged={() => list.reload()} />}
    </>
  );
}

function DepositReview({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { config } = useConfig();
  const { data: d, reload, setData } = useApi(`/admin/deposits/${id}`, [id]);
  const [assignee, setAssignee] = useState<any>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<'none' | 'reject' | 'assign' | 'note'>('none');
  const act = useAction();

  const run = async (fn: () => Promise<unknown>) => {
    const r = await act.run(fn);
    if (r !== undefined) {
      setMode('none');
      setNote('');
      setReason('');
      setAssignee(null);
      setData(await api(`/admin/deposits/${id}`));
      onChanged();
    }
  };

  const v = d?.blockchainTx?.verification;
  const canApprove = d && d.status === 'UNDER_REVIEW' && d.userId;
  const canAssign = d && d.status !== 'APPROVED' && (d.status !== 'REJECTED' || d.blockchainTx?.status === 'CONFIRMED');

  return (
    <Modal open onClose={onClose} title="Deposit review" wide>
      {!d ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} />
            {d.isSample && <KindTag kind="sample" />}
            <KindTag kind="onchain" />
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Info k="Attributed user" v={d.user ? `${d.user.name} · ${d.user.email}` : <span className="text-amber-300">Unmatched — no account attributed</span>} />
            <Info k="Amount (on-chain)" v={d.amount ? `${usdt(d.amount)} USDT` : '—'} />
            <Info
              k="Transaction hash"
              v={
                <span className="flex items-center gap-2 break-all font-mono text-xs">
                  {d.txHash}
                  {explorerTx(d.txHash, d.chainId) && <a href={explorerTx(d.txHash, d.chainId)!} target="_blank" rel="noreferrer" className="text-emerald-400"><ExternalLink className="h-3.5 w-3.5" /></a>}
                </span>
              }
            />
            <Info k="Log index / block" v={d.blockchainTx ? `${d.blockchainTx.logIndex} · block ${d.blockchainTx.blockNumber}` : '—'} />
            <Info k="From" v={<span className="break-all font-mono text-xs">{d.blockchainTx?.fromAddress ?? '—'}</span>} />
            <Info k="To (receiving wallet)" v={<span className="break-all font-mono text-xs">{d.blockchainTx?.toAddress ?? d.wallet.address}</span>} />
            <Info k="Token contract" v={<span className="break-all font-mono text-xs">{d.blockchainTx?.tokenContract ?? '—'}</span>} />
            <Info k="Confirmations" v={d.blockchainTx ? `${d.blockchainTx.confirmations} / ${config?.minConfirmations} required` : '—'} />
          </div>

          {v && <Alert tone={v.outcome === 'CONFIRMED' ? 'success' : v.terminal ? 'danger' : 'info'} title={`Verification: ${v.outcome}`}>{v.message} · chain {v.chainId} · checked {dt(v.checkedAt)}</Alert>}
          {d.verificationError && <Alert tone="danger">{d.verificationError}</Alert>}
          {d.creditRef && <Alert tone="success" title="Credited">Credit reference <span className="mono">{d.creditRef}</span> · ledger tx <span className="mono">{d.ledgerTxId}</span> · by {d.reviewedBy?.email} on {dt(d.reviewedAt)}</Alert>}

          {d.senderHistory?.length > 0 && (
            <div>
              <p className="label">Previous approved deposits from this sender address</p>
              <ul className="space-y-1 text-sm">
                {d.senderHistory.map((s: any) => (
                  <li key={s.depositId} className="flex justify-between rounded-lg bg-navy-900/60 px-3 py-2">
                    <span>{s.user?.email}</span>
                    <span className="tabular-nums text-slate-400">{usdt(s.amount)} USDT · <span className="mono">{shortHash(s.txHash)}</span></span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-slate-500">A hint for attribution on the shared address — not proof of ownership.</p>
            </div>
          )}

          <div>
            <p className="label">History</p>
            <Timeline items={d.history} />
            {d.reviewNote && <p className="mt-2 text-xs text-slate-400">Latest note: {d.reviewNote}</p>}
          </div>

          {act.error && <Alert tone="danger">{act.error}</Alert>}

          {mode === 'assign' && (
            <div className="space-y-3 rounded-xl border border-white/10 p-4">
              <Field label="Attribute to customer"><UserPicker value={assignee} onChange={setAssignee} /></Field>
              <Field label="Note (evidence used for attribution)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setMode('none')}>Cancel</Button>
                <Button disabled={!assignee} loading={act.busy} onClick={() => run(() => post(`/admin/deposits/${id}/assign`, { userId: assignee.id, note: note || undefined }))}>Attribute</Button>
              </div>
            </div>
          )}
          {mode === 'reject' && (
            <div className="space-y-3 rounded-xl border border-rose-500/30 p-4">
              <Field label="Rejection reason (shown to the user)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setMode('none')}>Cancel</Button>
                <Button variant="danger" disabled={reason.trim().length < 3} loading={act.busy} onClick={() => run(() => post(`/admin/deposits/${id}/reject`, { reason }))}>Reject deposit</Button>
              </div>
            </div>
          )}
          {mode === 'note' && (
            <div className="space-y-3 rounded-xl border border-white/10 p-4">
              <Field label="Administrative note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setMode('none')}>Cancel</Button>
                <Button disabled={!note.trim()} loading={act.busy} onClick={() => run(() => post(`/admin/deposits/${id}/note`, { note }))}>Save note</Button>
              </div>
            </div>
          )}

          {mode === 'none' && (
            <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.06] pt-4">
              {d.status !== 'APPROVED' && d.status !== 'REJECTED' && (
                <Button variant="ghost" loading={act.busy} onClick={() => run(async () => { await post(`/admin/deposits/${id}/refresh`); await reload(); return true; })}>
                  <RefreshCw className="h-4 w-4" /> Re-verify on-chain
                </Button>
              )}
              <Button variant="secondary" onClick={() => setMode('note')}>Add note</Button>
              {canAssign && <Button variant="secondary" onClick={() => setMode('assign')}>{d.userId ? 'Re-attribute' : 'Attribute to user'}</Button>}
              {d.status !== 'APPROVED' && d.status !== 'REJECTED' && <Button variant="danger" onClick={() => setMode('reject')}>Reject</Button>}
              {canApprove && (
                <Button variant="success" loading={act.busy} onClick={() => run(() => post(`/admin/deposits/${id}/approve`, { note: note || undefined }))}>
                  Approve & credit {usdt(d.amount)} USDT
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
