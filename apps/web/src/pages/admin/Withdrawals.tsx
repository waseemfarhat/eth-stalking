import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { api, post, useApi } from '../../api/client';
import { Alert, Button, Card, CopyButton, Empty, Field, Input, KindTag, Loading, Modal, PageHeader, Pagination, StatusBadge, Tabs, Textarea, Timeline, useAction } from '../../components/ui';
import { useConfig } from '../../lib/config';
import { ago, dt, explorerTx, shortHash, usdt } from '../../lib/format';

export function AdminWithdrawals() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'REQUESTED';
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), status }).toString();
  const list = useApi(`/admin/withdrawals?${qs}`, [qs]);
  const [open, setOpen] = useState<any>(null);

  return (
    <>
      <PageHeader title="Withdrawal management" subtitle="Manual payout workflow. There is no automated signing and no private-key handling in this platform." />
      <Alert tone="info" className="mb-4">
        Approving a request does <b>not</b> pay it. Send the payout from your own wallet, record the transaction hash, then verify it — the request is marked paid only once the transfer of the exact amount to the destination is confirmed on-chain.
      </Alert>
      <div className="mb-3">
        <Tabs value={status} onChange={(v) => { setPage(1); setParams(v ? { status: v } : { status: '' }); }} items={[{ value: 'REQUESTED', label: 'Requested' }, { value: 'APPROVED', label: 'Approved · to pay' }, { value: 'PAYOUT_RECORDED', label: 'To verify' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'REJECTED', label: 'Rejected' }, { value: '', label: 'All' }]} />
      </div>
      <Card padded={false}>
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.rows.length ? (
          <Empty>No withdrawals.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>Requested</th><th>User</th><th className="text-right">Amount</th><th>Destination</th><th>Payout tx</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {list.data.rows.map((w: any) => (
                    <tr key={w.id}>
                      <td className="text-xs text-slate-400">{dt(w.createdAt)}<p className="text-slate-600">{ago(w.createdAt)}</p></td>
                      <td className="text-sm">{w.user.email}</td>
                      <td className="text-right tabular-nums">{usdt(w.amount)} {w.currency}</td>
                      <td className="mono">{shortHash(w.destinationAddress, 8, 6)}</td>
                      <td className="mono text-slate-400">{w.payoutTxHash ? shortHash(w.payoutTxHash) : '—'}</td>
                      <td><StatusBadge status={w.status} label={w.status === 'APPROVED' ? 'Approved · not yet paid' : undefined} /></td>
                      <td className="text-right"><Button size="sm" variant="secondary" onClick={() => setOpen(w)}>Process</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      {open && <Process w0={open} onClose={() => setOpen(null)} onChanged={() => list.reload()} />}
    </>
  );
}

function Process({ w0, onClose, onChanged }: { w0: any; onClose: () => void; onChanged: () => void }) {
  const { config } = useConfig();
  const [w, setW] = useState(w0);
  const [note, setNote] = useState('');
  const [hash, setHash] = useState(w0.payoutTxHash ?? '');
  const [mode, setMode] = useState<'none' | 'reject'>('none');
  const [verification, setVerification] = useState<any>(w0.payoutVerification);
  const act = useAction();

  const refresh = async () => {
    const updated = await api(`/admin/withdrawals/${w.id}`);
    setW(updated);
    setVerification(updated.payoutVerification);
    onChanged();
  };
  const run = async (fn: () => Promise<any>) => {
    const r = await act.run(fn);
    if (r !== undefined) {
      if (r?.verification) setVerification(r.verification);
      setMode('none');
      await refresh();
    }
  };

  return (
    <Modal open onClose={onClose} title="Process withdrawal" wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={w.status} label={w.status === 'APPROVED' ? 'Approved · not yet paid' : undefined} /><KindTag kind="payout" /></div>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div><p className="label">User</p><p>{w.user.name} · {w.user.email}</p></div>
          <div><p className="label">Amount</p><p className="text-lg font-semibold tabular-nums text-white">{usdt(w.amount)} {w.currency}</p></div>
          <div className="sm:col-span-2">
            <p className="label">Destination (Ethereum ERC-20)</p>
            <div className="flex flex-wrap items-center gap-3"><p className="break-all font-mono text-sm text-white">{w.destinationAddress}</p><CopyButton value={w.destinationAddress} /></div>
          </div>
        </div>

        {verification && (
          <Alert tone={verification.outcome === 'CONFIRMED' ? 'success' : 'warning'} title={`Payout verification: ${verification.outcome}`}>
            {verification.message}{verification.confirmations ? ` · ${verification.confirmations}/${verification.requiredConfirmations} confirmations` : ''} · checked {dt(verification.checkedAt)}
          </Alert>
        )}
        {w.rejectionReason && <Alert tone="danger" title="Rejected">{w.rejectionReason}</Alert>}
        {act.error && <Alert tone="danger">{act.error}</Alert>}

        {w.status === 'REQUESTED' && mode === 'none' && (
          <div className="space-y-3">
            <Field label="Note (optional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="danger" onClick={() => setMode('reject')}>Reject</Button>
              <Button variant="success" loading={act.busy} onClick={() => run(() => post(`/admin/withdrawals/${w.id}/review`, { decision: 'APPROVE', note: note || undefined }))}>Approve (queue for payout)</Button>
            </div>
          </div>
        )}

        {(w.status === 'APPROVED' || w.status === 'PAYOUT_RECORDED') && mode === 'none' && (
          <div className="space-y-3 rounded-xl border border-white/10 p-4">
            <p className="text-sm text-slate-300">1. Send exactly <b className="text-white">{usdt(w.amount)} USDT</b> on Ethereum to the destination above from your treasury wallet. 2. Record the transaction hash. 3. Verify on-chain.</p>
            <Field label="Payout transaction hash"><Input className="font-mono" placeholder="0x…" value={hash} onChange={(e) => setHash(e.target.value)} /></Field>
            <Field label="Payout note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <div className="flex flex-wrap justify-end gap-2">
              {w.status === 'APPROVED' && <Button variant="danger" onClick={() => setMode('reject')}>Reject</Button>}
              <Button variant="secondary" loading={act.busy} disabled={!hash.trim() || hash === w.payoutTxHash} onClick={() => run(() => post(`/admin/withdrawals/${w.id}/payout`, { txHash: hash.trim(), note: note || undefined }))}>Record payout hash</Button>
              {w.status === 'PAYOUT_RECORDED' && <Button variant="success" loading={act.busy} onClick={() => run(() => post(`/admin/withdrawals/${w.id}/verify-payout`))}>Verify on-chain & complete</Button>}
            </div>
            {w.payoutTxHash && explorerTx(w.payoutTxHash, config?.chain.chainId ?? 0) && (
              <a href={explorerTx(w.payoutTxHash, config!.chain.chainId)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400">View on explorer <ExternalLink className="h-3 w-3" /></a>
            )}
          </div>
        )}

        {mode === 'reject' && (
          <div className="space-y-3 rounded-xl border border-rose-500/30 p-4">
            <Field label="Rejection reason (required, shown to user)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            <p className="text-xs text-slate-400">The reserved amount returns to the user's available balance.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMode('none')}>Back</Button>
              <Button variant="danger" loading={act.busy} disabled={!note.trim()} onClick={() => run(() => post(`/admin/withdrawals/${w.id}/review`, { decision: 'REJECT', note }))}>Reject withdrawal</Button>
            </div>
          </div>
        )}

        <div>
          <p className="label">History</p>
          <Timeline items={w.history} />
        </div>
      </div>
    </Modal>
  );
}
