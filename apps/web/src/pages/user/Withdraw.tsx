import { useState, type FormEvent } from 'react';
import { ExternalLink } from 'lucide-react';
import { post, useApi } from '../../api/client';
import { Alert, Button, Card, Empty, Field, Input, KindTag, Modal, PageHeader, Select, StatusBadge, Timeline, useAction } from '../../components/ui';
import { useConfig } from '../../lib/config';
import { dt, explorerTx, shortHash, usdt } from '../../lib/format';

const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

export function WithdrawPage() {
  const { config } = useConfig();
  const ov = useApi('/me/overview');
  const list = useApi<any[]>('/me/withdrawals');
  const [f, setF] = useState({ asset: 'USDT|ETHEREUM_ERC20', amount: '', destinationAddress: '' });
  const [confirm, setConfirm] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const act = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!confirm) return act.setError('Please confirm the destination address and network');
    const [currency, network] = f.asset.split('|');
    const r = await act.run(() => post('/me/withdrawals', { currency, network, amount: f.amount, destinationAddress: f.destinationAddress.trim() }));
    if (r) {
      setF({ ...f, amount: '', destinationAddress: '' });
      setConfirm(false);
      void list.reload();
      void ov.reload();
    }
  };

  return (
    <>
      <PageHeader title="Withdrawals" subtitle="Withdrawal requests are reviewed and paid manually by the platform." />
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Request a withdrawal">
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Currency & network">
                <Select value={f.asset} onChange={(e) => setF({ ...f, asset: e.target.value })}>
                  {(config?.assets ?? []).map((a) => (
                    <option key={a.label} value={`${a.currency}|${a.network}`}>{a.label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount (USDT)" hint={`Available: ${usdt(ov.data?.balances.available)} USDT`}>
                <div className="flex gap-2">
                  <Input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="0.00" />
                  <Button type="button" variant="secondary" size="sm" onClick={() => setF({ ...f, amount: ov.data?.balances.available ?? '' })}>Max</Button>
                </div>
              </Field>
            </div>
            <Field label="Destination address (Ethereum)" error={f.destinationAddress && !isAddr(f.destinationAddress) ? 'Not a valid Ethereum address' : null}>
              <Input className="font-mono" spellCheck={false} placeholder="0x…" value={f.destinationAddress} onChange={(e) => setF({ ...f, destinationAddress: e.target.value })} />
            </Field>
            <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-navy-900 p-3 text-xs text-slate-300">
              <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              I confirm this address can receive USDT on Ethereum (ERC-20). On-chain payments are irreversible.
            </label>
            {act.error && <Alert tone="danger">{act.error}</Alert>}
            <Button type="submit" loading={act.busy} disabled={!f.amount || !isAddr(f.destinationAddress)}>Submit request</Button>
          </form>
        </Card>
        <Card className="lg:col-span-2" title="How withdrawals work">
          <ol className="space-y-3 text-sm text-slate-300">
            <li><b className="text-white">Requested</b> — the amount is reserved from your available balance.</li>
            <li><b className="text-white">Approved</b> — an administrator approved it. <span className="text-amber-300">It is not paid yet.</span></li>
            <li><b className="text-white">Payout recorded</b> — the payout transaction hash has been entered and is being verified on-chain.</li>
            <li><b className="text-white">Paid</b> — the payout was independently verified on Ethereum.</li>
            <li><b className="text-white">Rejected</b> — you'll see the reason and the reserved amount returns to your available balance.</li>
          </ol>
          <div className="mt-4"><KindTag kind="payout" /></div>
        </Card>
      </div>

      <Card className="mt-4" title="Withdrawal history" padded={false}>
        {!list.data?.length ? (
          <Empty>No withdrawal requests yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr><th>Requested</th><th>Amount</th><th>Destination</th><th>Payout tx</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {list.data.map((w) => (
                  <tr key={w.id}>
                    <td className="text-xs text-slate-400">{dt(w.createdAt)}</td>
                    <td className="tabular-nums text-white">{usdt(w.amount)} {w.currency}</td>
                    <td className="mono text-slate-400">{shortHash(w.destinationAddress, 8, 6)}</td>
                    <td className="mono text-slate-400">{w.payoutTxHash ? shortHash(w.payoutTxHash) : '—'}</td>
                    <td>
                      <StatusBadge status={w.status} label={w.status === 'APPROVED' ? 'Approved · not yet paid' : undefined} />
                      {w.rejectionReason && w.status === 'REJECTED' && <p className="mt-1 text-xs text-rose-300">{w.rejectionReason}</p>}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        {w.status === 'REQUESTED' && (
                          <Button size="sm" variant="ghost" onClick={async () => { await act.run(() => post(`/me/withdrawals/${w.id}/cancel`)); void list.reload(); void ov.reload(); }}>Cancel</Button>
                        )}
                        <Button size="sm" variant="secondary" onClick={() => setDetail(w)}>Details</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Withdrawal details" wide>
        {detail && (
          <div className="space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><p className="label">Amount</p><p className="tabular-nums text-white">{usdt(detail.amount)} {detail.currency}</p></div>
              <div><p className="label">Network</p><p>Ethereum (ERC-20)</p></div>
              <div className="sm:col-span-2"><p className="label">Destination</p><p className="break-all font-mono text-xs">{detail.destinationAddress}</p></div>
              {detail.payoutTxHash && (
                <div className="sm:col-span-2">
                  <p className="label">Payout transaction</p>
                  <p className="flex items-center gap-2 break-all font-mono text-xs">
                    {detail.payoutTxHash}
                    {explorerTx(detail.payoutTxHash, config?.chain.chainId ?? 0) && <a href={explorerTx(detail.payoutTxHash, config!.chain.chainId)!} target="_blank" rel="noreferrer" className="text-emerald-400"><ExternalLink className="h-3.5 w-3.5" /></a>}
                  </p>
                </div>
              )}
            </div>
            {detail.status === 'APPROVED' && <Alert tone="warning">Approved by an administrator, but not yet paid. You will be notified when the on-chain payout has been verified.</Alert>}
            <div>
              <p className="label">Status history</p>
              <Timeline items={detail.history} />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
