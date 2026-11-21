import { useEffect, useState } from 'react';
import { ExternalLink, Globe, RefreshCw, Search } from 'lucide-react';
import { api, post, useApi } from '../../api/client';
import { Alert, Button, Card, CopyButton, Empty, Field, Input, KindTag, Loading, PageHeader, Select, StatusBadge, useAction } from '../../components/ui';
import { dt, shortHash, usdt } from '../../lib/format';

const outcomeTone = (o: string) => (o === 'CONFIRMED' ? 'success' : o === 'INSUFFICIENT_CONFIRMATIONS' || o === 'PENDING' || o === 'NOT_FOUND' ? 'warning' : 'danger');

export function AdminRealNetwork() {
  const wallets = useApi<any[]>('/admin/mainnet-check/wallets');
  const [walletId, setWalletId] = useState('');
  const [status, setStatus] = useState<any>(null);
  const [recent, setRecent] = useState<any>(null);
  const [blocks, setBlocks] = useState('5000');
  const [hash, setHash] = useState('');
  const [result, setResult] = useState<any>(null);
  const st = useAction();
  const rc = useAction();
  const vf = useAction();

  useEffect(() => {
    if (!walletId && wallets.data?.length) setWalletId(wallets.data[0].id);
  }, [wallets.data, walletId]);

  const loadStatus = async () => setStatus(await st.run(() => api(`/admin/mainnet-check/status?walletId=${walletId}`)));
  const loadRecent = async () => setRecent(await rc.run(() => api(`/admin/mainnet-check/recent?walletId=${walletId}&blocks=${blocks}`)));
  const verify = async (h = hash) => {
    setHash(h);
    setResult(await vf.run(() => post('/admin/mainnet-check/verify', { txHash: h.trim(), walletId })));
  };

  useEffect(() => {
    if (walletId) {
      setResult(null);
      setRecent(null);
      void loadStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletId]);

  return (
    <>
      <PageHeader title="Real network check" subtitle="Test that real USDT sent to your wallet on Ethereum mainnet is detected and verified — using the same verification code as deposits." />
      <Alert tone="info" title="Read-only" className="mb-4">
        This page only <b>reads</b> the real blockchain. It never credits any account, never creates deposits, and does not switch on customer deposits. Each verification is recorded in the audit log.
      </Alert>

      {wallets.loading && !wallets.data ? (
        <Loading />
      ) : !wallets.data?.length ? (
        <Alert tone="warning">No Ethereum mainnet wallet is configured. Add one under Wallets & compliance (chain id 1).</Alert>
      ) : (
        <>
          <Card title={<span className="flex items-center gap-2"><Globe className="h-4 w-4 text-emerald-400" /> Ethereum mainnet · real USDT</span>} action={<Button size="sm" variant="secondary" loading={st.busy} onClick={loadStatus}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>}>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Wallet">
                <Select value={walletId} onChange={(e) => setWalletId(e.target.value)}>
                  {wallets.data.map((w) => <option key={w.id} value={w.id}>{w.label} · {w.provider}</option>)}
                </Select>
              </Field>
              <div className="md:col-span-2">
                <p className="label">Address</p>
                {status && (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="break-all font-mono text-sm text-white">{status.wallet.address}</span>
                    <CopyButton value={status.wallet.address} />
                    <a href={`https://etherscan.io/address/${status.wallet.address}#tokentxns`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400">Etherscan <ExternalLink className="h-3 w-3" /></a>
                    <StatusBadge status={status.wallet.status} />
                  </div>
                )}
              </div>
            </div>
            {st.error && <Alert tone="danger" className="mt-4">Could not reach the Ethereum network: {st.error}</Alert>}
            {status && (
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-white/[0.06] bg-navy-900/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Real USDT balance</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{usdt(status.usdtBalance)} <span className="text-sm text-slate-400">USDT</span></p>
                  <div className="mt-1"><KindTag kind="onchain" /></div>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-navy-900/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Latest block</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{status.headBlock.toLocaleString()}</p>
                  <p className="text-xs text-slate-500">checked {dt(status.checkedAt)}</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-navy-900/60 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Required confirmations</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{status.minConfirmations}</p>
                  <p className="break-all text-xs text-slate-500">Token {shortHash(status.tokenContract, 8, 6)} (official USDT)</p>
                </div>
              </div>
            )}
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Verify a real transaction" subtitle="Paste the transaction hash from Bitget Wallet / Etherscan after sending USDT to the address above">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex-1"><Field label="Transaction hash"><Input className="font-mono" placeholder="0x…" value={hash} onChange={(e) => setHash(e.target.value)} spellCheck={false} /></Field></div>
                <Button loading={vf.busy} disabled={!hash.trim()} onClick={() => verify()}><Search className="h-4 w-4" /> Verify</Button>
              </div>
              {vf.error && <Alert tone="danger" className="mt-4">{vf.error}</Alert>}
              {result && (
                <div className="mt-4 space-y-3">
                  <Alert tone={outcomeTone(result.outcome) as any} title={result.outcome.replace(/_/g, ' ')}>
                    {result.message}
                    {result.blockNumber ? ` · block ${result.blockNumber.toLocaleString()}` : ''}
                    {result.blockNumber ? ` · ${result.confirmations}/${result.requiredConfirmations} confirmations` : ''}
                  </Alert>
                  {result.matches.map((m: any) => (
                    <div key={m.logIndex} className="grid gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 text-sm sm:grid-cols-2">
                      <div><p className="text-xs text-slate-500">Amount received</p><p className="text-lg font-semibold tabular-nums text-emerald-300">{usdt(m.amount)} USDT</p></div>
                      <div><p className="text-xs text-slate-500">From</p><p className="break-all font-mono text-xs">{m.from}</p></div>
                    </div>
                  ))}
                  {result.matches.length === 0 && result.allTransfers?.length > 0 && (
                    <div className="text-xs text-slate-400">
                      <p className="mb-1">Token transfers found in this transaction (none matched):</p>
                      {result.allTransfers.map((t: any) => (
                        <p key={t.logIndex} className="font-mono">{shortHash(t.token, 8, 4)} → {shortHash(t.to, 8, 4)} · {t.amount} base units</p>
                      ))}
                    </div>
                  )}
                  <a href={`https://etherscan.io/tx/${result.txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-400">Open on Etherscan <ExternalLink className="h-3 w-3" /></a>
                </div>
              )}
            </Card>

            <Card title="Recent incoming USDT" subtitle="Real transfers to this address found by scanning recent blocks" action={
              <div className="flex items-center gap-2">
                <Select className="w-36 py-1.5 text-xs" value={blocks} onChange={(e) => setBlocks(e.target.value)}>
                  <option value="1000">~3 hours</option>
                  <option value="5000">~17 hours</option>
                  <option value="10000">~1.4 days</option>
                  <option value="20000">~2.8 days</option>
                </Select>
                <Button size="sm" variant="secondary" loading={rc.busy} onClick={loadRecent}>Scan</Button>
              </div>
            } padded={false}>
              {rc.error && <div className="p-4"><Alert tone="danger">{rc.error}</Alert></div>}
              {!recent ? (
                <Empty>Click Scan to search recent blocks. Larger ranges take longer on the free public RPC.</Empty>
              ) : recent.transfers.length === 0 ? (
                <Empty>No incoming USDT in blocks {recent.fromBlock.toLocaleString()}–{recent.headBlock.toLocaleString()}.</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data">
                    <thead><tr><th>Block</th><th>From</th><th className="text-right">Amount</th><th>Conf.</th><th></th></tr></thead>
                    <tbody>
                      {recent.transfers.map((t: any) => (
                        <tr key={t.txHash + t.logIndex}>
                          <td className="tabular-nums text-xs text-slate-400">{t.blockNumber.toLocaleString()}</td>
                          <td className="mono text-slate-400">{shortHash(t.from, 8, 4)}</td>
                          <td className="text-right tabular-nums text-emerald-300">{usdt(t.amount)}</td>
                          <td className="tabular-nums text-xs">{t.confirmations}</td>
                          <td className="text-right"><Button size="sm" variant="ghost" onClick={() => verify(t.txHash)}>Verify</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card className="mt-4" title="How to test with real money (safely)">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
              <li>From <b>another wallet you own</b>, send a small amount (e.g. 1–2 USDT) on the <b>Ethereum (ERC-20)</b> network to the address above. The sender needs a little ETH for the network fee.</li>
              <li>Copy the transaction hash from the sending wallet and paste it into <b>Verify a real transaction</b>. It will show <i>pending / waiting for confirmations</i> at first.</li>
              <li>After ~3 minutes (12 confirmations) verify again — it should show <b>CONFIRMED</b> with the exact amount and sender. The balance above will also increase.</li>
              <li>Also try <b>Scan</b> to see it detected automatically, and paste a hash of a transfer to a <i>different</i> address to see it correctly rejected.</li>
            </ol>
          </Card>
        </>
      )}
    </>
  );
}
