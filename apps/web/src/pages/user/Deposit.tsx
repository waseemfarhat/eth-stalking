import { useState, type FormEvent, type ReactNode } from 'react';
import { ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import { post, useApi } from '../../api/client';
import { Alert, Button, Card, CopyButton, Empty, Field, Input, KindTag, Modal, PageHeader, StatusBadge, Timeline, useAction } from '../../components/ui';
import { useConfig } from '../../lib/config';
import { dt, explorerTx, shortHash, usdt } from '../../lib/format';

const steps = [
  'Send USDT on the Ethereum (ERC-20) network only, to the address below.',
  'Wait for your wallet to show the transfer as sent, then copy its transaction hash (0x…).',
  'Paste the transaction hash below. We independently verify it on-chain — screenshots are not accepted.',
  'After the required confirmations, an administrator reviews the attribution and credits your internal balance.',
];

export function DepositPage() {
  const { config } = useConfig();
  const deposits = useApi<any[]>('/me/deposits');
  const [hash, setHash] = useState('');
  const [result, setResult] = useState<any[] | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const act = useAction();
  const refresher = useAction();

  const w = config?.deposits.wallet;
  const accepting = config?.deposits.accepting && w;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await act.run(() => post<any[]>('/me/deposits', { txHash: hash.trim() }));
    if (r) {
      setResult(r);
      setHash('');
      void deposits.reload();
    }
  };

  const refresh = async (id: string) => {
    const r = await refresher.run(() => post(`/me/deposits/${id}/refresh`));
    if (r) {
      void deposits.reload();
      if (detail?.id === id) setDetail(r);
    }
  };

  return (
    <>
      <PageHeader title="Deposit USDT" subtitle="Deposits are credited only after independent blockchain verification and administrator approval." />

      {!accepting ? (
        <Alert tone="warning" title="Deposits are not available">
          {config?.deposits.reason ?? 'Deposits are currently disabled.'} No deposit address is shown while deposits are disabled.
        </Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3" title="Receiving address" subtitle={`${w!.currency} · Ethereum ERC-20 · chain id ${w!.chainId}`}>
            {w!.isSample && (
              <Alert tone="warning" className="mb-4" title="Sample address — not a real wallet">
                This address exists only on the simulated development chain. Never send real funds to it.
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-lg bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-300 ring-1 ring-sky-400/30">USDT</span>
              <span className="rounded-lg bg-violet-500/10 px-2 py-1 text-xs font-semibold text-violet-300 ring-1 ring-violet-400/30">Ethereum · ERC-20</span>
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-navy-950 p-4">
              <p className="break-all font-mono text-[15px] tracking-tight text-white">{w!.address}</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">{w!.provider} · {w!.label}</p>
              <CopyButton value={w!.address} label="Copy address" />
            </div>
            <Alert tone="danger" className="mt-5" title="Only send USDT on Ethereum (ERC-20)">
              Tokens sent on other networks (TRON, BNB Chain, Polygon…) or other tokens cannot be credited and may be permanently lost. This is a shared receiving address — you must submit your transaction hash below.
            </Alert>
          </Card>

          <Card className="lg:col-span-2" title="How it works">
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-300">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/30 to-violet-500/30 text-xs font-semibold text-white">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-slate-500">Required confirmations: {config?.minConfirmations}</p>
          </Card>

          <Card className="lg:col-span-5" title="Submit your transaction hash">
            <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Field label="Transaction hash" error={act.error}>
                  <Input placeholder="0x…" value={hash} onChange={(e) => setHash(e.target.value)} className="font-mono" spellCheck={false} />
                </Field>
              </div>
              <Button type="submit" loading={act.busy} disabled={!hash.trim()}>Submit for verification</Button>
            </form>
            {result && (
              <Alert tone="success" className="mt-4" title="Submitted">
                {result.map((r) => (
                  <span key={r.id} className="block">
                    Status: <b>{r.status.replace(/_/g, ' ').toLowerCase()}</b>
                    {r.amount ? ` · ${usdt(r.amount)} USDT detected on-chain` : ''}
                    {r.verificationError ? ` · ${r.verificationError}` : ''}. Nothing is credited until an administrator approves it.
                  </span>
                ))}
              </Alert>
            )}
          </Card>
        </div>
      )}

      <Card className="mt-4" title="Deposit history" padded={false} action={<Button variant="ghost" size="sm" onClick={() => deposits.reload()}><RefreshCw className="h-3.5 w-3.5" />Refresh</Button>}>
        {!deposits.data?.length ? (
          <Empty>No deposits submitted yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Transaction</th>
                  <th>On-chain amount</th>
                  <th>Confirmations</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deposits.data.map((d) => (
                  <tr key={d.id}>
                    <td className="text-xs text-slate-400">{dt(d.submittedAt)}</td>
                    <td>
                      <span className="mono text-slate-200">{shortHash(d.txHash)}</span>
                      {d.isSample && <span className="ml-2"><KindTag kind="sample" /></span>}
                    </td>
                    <td className="tabular-nums">{d.amount ? `${usdt(d.amount)} USDT` : '—'}</td>
                    <td className="tabular-nums text-slate-400">{d.blockchainTx ? `${d.blockchainTx.confirmations}/${config?.minConfirmations}` : '—'}</td>
                    <td>
                      <StatusBadge status={d.status} />
                      {d.verificationError && <p className="mt-1 max-w-xs text-xs text-rose-300">{d.verificationError}</p>}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        {['SUBMITTED', 'AWAITING_VERIFICATION', 'AWAITING_CONFIRMATIONS'].includes(d.status) && (
                          <Button variant="ghost" size="sm" onClick={() => refresh(d.id)} loading={refresher.busy}>Re-check</Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => setDetail(d)}>Details</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Deposit details" wide>
        {detail && (
          <div className="space-y-5">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Info k="Status" v={<StatusBadge status={detail.status} />} />
              <Info k="Amount (on-chain)" v={detail.amount ? `${usdt(detail.amount)} USDT` : '—'} />
              <Info
                k="Transaction hash"
                v={
                  <span className="flex items-center gap-2 break-all font-mono text-xs">
                    {detail.txHash}
                    {explorerTx(detail.txHash, detail.chainId) && (
                      <a href={explorerTx(detail.txHash, detail.chainId)!} target="_blank" rel="noreferrer" className="text-emerald-400"><ExternalLink className="h-3.5 w-3.5" /></a>
                    )}
                  </span>
                }
              />
              <Info k="From address" v={<span className="break-all font-mono text-xs">{detail.blockchainTx?.fromAddress ?? '—'}</span>} />
              <Info k="Block" v={detail.blockchainTx?.blockNumber ?? '—'} />
              <Info k="Confirmations" v={detail.blockchainTx ? `${detail.blockchainTx.confirmations} (required ${config?.minConfirmations})` : '—'} />
            </div>
            {detail.blockchainTx?.verification && (
              <Alert tone={detail.blockchainTx.verification.outcome === 'CONFIRMED' ? 'success' : 'info'} title="Independent verification">
                {detail.blockchainTx.verification.message} · checked {dt(detail.blockchainTx.verification.checkedAt)}
              </Alert>
            )}
            {detail.status === 'UNDER_REVIEW' && (
              <Alert tone="info" title="Awaiting administrator review">
                <ShieldAlert className="mr-1 inline h-3.5 w-3.5" /> The transfer is verified on-chain. It will be credited after an administrator confirms it belongs to your account.
              </Alert>
            )}
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

export function Info({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-navy-900/60 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{k}</p>
      <div className="mt-1 text-slate-200">{v}</div>
    </div>
  );
}
