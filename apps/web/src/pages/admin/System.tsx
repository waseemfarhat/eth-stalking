import { useState } from 'react';
import { Database, Download, FlaskConical, Pickaxe, RefreshCw, Scale } from 'lucide-react';
import { api, post, useApi } from '../../api/client';
import { Alert, Button, Card, CopyButton, Empty, Field, Input, KindTag, PageHeader, Select, useAction } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { dt, fromUnits, shortHash, usdt } from '../../lib/format';

export function AdminSystem() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPERADMIN';
  const settings = useApi('/admin/settings');
  const backups = useApi<any[]>(isSuper ? '/admin/system/backups' : null);
  const [recon, setRecon] = useState<any>(null);
  const [conf, setConf] = useState('');
  const act = useAction();
  const isSample = settings.data?.chainMode === 'sample';

  return (
    <>
      <PageHeader title="System" subtitle="Settings, integrity checks, backups and development tools." />
      {act.error && <Alert tone="danger" className="mb-4">{act.error}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Blockchain settings">
          {settings.data && (
            <div className="space-y-4 text-sm">
              <p className="text-slate-400">Chain mode <b className="text-slate-100">{settings.data.chainMode}</b> · poll every {settings.data.pollIntervalMs / 1000}s · scanner {settings.data.scannerEnabled ? 'on' : 'off'}</p>
              <div className="flex items-end gap-3">
                <Field label="Required confirmations" hint={`Deployment floor: ${settings.data.minConfirmationsFloor} (cannot go lower)`}>
                  <Input type="number" min={settings.data.minConfirmationsFloor} placeholder={String(settings.data.minConfirmations)} value={conf} onChange={(e) => setConf(e.target.value)} disabled={!isSuper} />
                </Field>
                <Button disabled={!isSuper || !conf} loading={act.busy} onClick={async () => { const r = await act.run(() => api('/admin/settings/min-confirmations', { method: 'PUT', body: { value: conf } })); if (r) { setConf(''); void settings.reload(); } }}>Save</Button>
              </div>
              <p className="text-xs text-slate-500">Current: {settings.data.minConfirmations} confirmations</p>
            </div>
          )}
        </Card>

        <Card title="Integrity check" subtitle="Ledger reconciliation and audit-chain verification" action={<Button size="sm" variant="secondary" loading={act.busy} onClick={async () => setRecon(await act.run(() => api('/admin/system/reconcile')))}><Scale className="h-3.5 w-3.5" /> Run</Button>}>
          {!recon ? (
            <p className="text-sm text-slate-500">Checks that every cached balance equals the sum of its ledger entries, every journal balances to zero, no user balance is negative, and the audit hash-chain is intact.</p>
          ) : (
            <div className="space-y-2">
              <Alert tone={recon.ledger.ok ? 'success' : 'danger'} title={recon.ledger.ok ? 'Ledger reconciles' : 'Ledger mismatch'}>
                {recon.ledger.mismatches.length} balance mismatch(es) · {recon.ledger.unbalanced.length} unbalanced journal(s) · {recon.ledger.negativeUser.length} negative user balance(s)
              </Alert>
              <Alert tone={recon.audit.valid ? 'success' : 'danger'} title={recon.audit.valid ? 'Audit chain intact' : 'Audit chain broken'}>{recon.audit.checked} records verified</Alert>
            </div>
          )}
        </Card>

        {isSuper && (
          <Card title="Backup & export" subtitle="SQLite snapshot (safe while running) and portable JSON export" action={<Database className="h-4 w-4 text-slate-500" />}>
            <div className="flex flex-wrap gap-2">
              <Button loading={act.busy} onClick={async () => { await act.run(() => post('/admin/system/backup')); void backups.reload(); }}>Create backup now</Button>
              <a href="/api/admin/system/export" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-slate-100 hover:bg-white/[0.08]"><Download className="h-4 w-4" /> Download JSON export</a>
            </div>
            <p className="mt-3 text-xs text-slate-500">Restore and import are CLI-only (server stopped): <span className="mono">npm run db:restore -- &lt;file&gt;</span> · <span className="mono">npm run db:import -- &lt;file&gt;</span></p>
            <div className="mt-4 max-h-56 overflow-y-auto">
              {!backups.data?.length ? (
                <Empty>No backups yet.</Empty>
              ) : (
                <ul className="divide-y divide-white/[0.05] text-sm">
                  {backups.data.map((b) => (
                    <li key={b.name} className="flex justify-between gap-3 py-2">
                      <span className="mono truncate text-slate-300">{b.name}</span>
                      <span className="whitespace-nowrap text-xs text-slate-500">{(b.size / 1024).toFixed(0)} KiB · {dt(b.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}

        {isSample && <SampleChainTools />}
      </div>
    </>
  );
}

function SampleChainTools() {
  const list = useApi('/admin/sample/transfers');
  const [f, setF] = useState({ amount: '100', token: 'USDT', status: 'success', to: '' });
  const act = useAction();

  return (
    <Card className="lg:col-span-2" title={<span className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-orange-300" /> Sample chain (development only)</span>} subtitle="Simulate ERC-20 transfers to exercise verification, confirmations, the scanner and payouts. These have no real value." action={<KindTag kind="sample" />}>
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="Amount (USDT)"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Token">
          <Select value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })}>
            <option value="USDT">Accepted USDT</option>
            <option value="OTHER">Wrong token (test)</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="success">Success</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed (reverted)</option>
          </Select>
        </Field>
        <div className="sm:col-span-2"><Field label="To (blank = receiving wallet)"><Input className="font-mono" placeholder="0x… (e.g. a withdrawal destination)" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button loading={act.busy} onClick={async () => { await act.run(() => post('/admin/sample/transfers', { amount: f.amount, token: f.token, status: f.status, ...(f.to ? { to: f.to } : {}) })); void list.reload(); }}>Create sample transfer</Button>
        <Button variant="secondary" loading={act.busy} onClick={async () => { await act.run(() => post('/admin/sample/mine', { blocks: 12 })); void list.reload(); }}><Pickaxe className="h-4 w-4" /> Mine 12 blocks</Button>
        <Button variant="ghost" loading={act.busy} onClick={async () => { await act.run(() => post('/admin/system/run-jobs')); void list.reload(); }}><RefreshCw className="h-4 w-4" /> Run scanner & confirmations</Button>
      </div>
      {act.error && <Alert tone="danger" className="mt-3">{act.error}</Alert>}
      <p className="mt-4 text-xs text-slate-500">Head block: {list.data?.head}</p>
      <div className="mt-2 max-h-72 overflow-auto">
        {!list.data?.transfers.length ? (
          <Empty>No sample transfers.</Empty>
        ) : (
          <table className="data">
            <thead><tr><th>Created</th><th>Tx hash</th><th>To</th><th>Amount</th><th>Block</th><th>Status</th></tr></thead>
            <tbody>
              {list.data.transfers.map((t: any) => (
                <tr key={t.txHash}>
                  <td className="text-xs text-slate-400">{dt(t.createdAt)}</td>
                  <td><div className="flex items-center gap-2"><span className="mono">{shortHash(t.txHash)}</span><CopyButton value={t.txHash} /></div></td>
                  <td className="mono text-slate-400">{shortHash(t.transfers[0]?.to, 8, 4)}</td>
                  <td className="tabular-nums">{usdt(fromUnits(t.transfers[0]?.amount))}{t.transfers[0]?.token !== '0x5a5a5a5a00000000000000000000000000005a5a' && <span className="ml-1 text-xs text-rose-300">(wrong token)</span>}</td>
                  <td className="tabular-nums text-slate-400">{t.blockNumber ?? '—'}</td>
                  <td className="text-xs">{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
