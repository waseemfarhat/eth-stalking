import { useState } from 'react';
import { CheckCircle2, Lock, Plus, XCircle } from 'lucide-react';
import { post, useApi } from '../../api/client';
import { Alert, Button, Card, CopyButton, Empty, Field, Input, KindTag, Loading, Modal, PageHeader, StatusBadge, Textarea, useAction } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useConfig } from '../../lib/config';
import { dt } from '../../lib/format';

export function AdminCompliance() {
  const { user } = useAuth();
  const { reload: reloadConfig } = useConfig();
  const comp = useApi('/admin/compliance');
  const wallets = useApi<any[]>('/admin/wallets');
  const isSuper = user?.role === 'SUPERADMIN';
  const [verifyFor, setVerifyFor] = useState<any>(null);
  const [challenge, setChallenge] = useState('');
  const [signature, setSignature] = useState('');
  const [adding, setAdding] = useState(false);
  const [nw, setNw] = useState({ label: '', provider: '', address: '', chainId: '1', notes: '' });
  const act = useAction();

  const reloadAll = () => {
    void comp.reload();
    void wallets.reload();
    reloadConfig();
  };

  const startVerify = async (w: any) => {
    setVerifyFor(w);
    setSignature('');
    const r = await act.run(() => post('/admin/wallets/' + w.id + '/challenge'));
    if (r) setChallenge(r.message);
  };

  return (
    <>
      <PageHeader title="Wallets & compliance" subtitle="Receiving-wallet configuration, ownership proof and the legal/compliance gate for real deposits." />

      {comp.loading && !comp.data ? (
        <Loading />
      ) : (
        comp.data && (
          <Card
            title={
              <span className="flex items-center gap-2">
                <Lock className="h-4 w-4" /> Real-deposit gate:{' '}
                {comp.data.realDepositsEnabled ? <span className="text-emerald-400">OPEN</span> : <span className="text-rose-400">CLOSED</span>}
              </span>
            }
            subtitle="All four checks must pass. They are controlled by server deployment configuration — this page is read-only by design."
          >
            <ul className="space-y-3">
              {comp.data.checks.map((c: any) => (
                <li key={c.id} className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-navy-900/50 p-3">
                  {c.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" /> : <XCircle className="mt-0.5 h-5 w-5 text-rose-400" />}
                  <div>
                    <p className="text-sm font-medium text-slate-100">{c.label}</p>
                    <p className="text-xs text-slate-400">{c.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid gap-3 text-xs text-slate-400 sm:grid-cols-3">
              <p>Chain mode: <b className="text-slate-200">{comp.data.chain.mode}</b> (id {comp.data.chain.chainId})</p>
              <p className="break-all">Token: <span className="mono text-slate-200">{comp.data.chain.tokenContract}</span></p>
              <p>Scanner: <b className="text-slate-200">{comp.data.scannerEnabled ? 'enabled' : 'disabled'}</b> {comp.data.policy.accepting ? '' : '(idle while deposits are not accepted)'}</p>
            </div>
            <Alert tone="info" className="mt-4">
              To enable real deposits, an authorised operator must: obtain the applicable regulatory authorisations; implement CDD, AML/CFT, transaction monitoring, sanctions screening, disclosures, safeguarding and record retention; place a signed attestation file on the server; verify the receiving wallet below; and deploy with <span className="mono">CHAIN_MODE=mainnet</span> and <span className="mono">REAL_DEPOSITS_ENABLED=true</span>. See <span className="mono">docs/COMPLIANCE.md</span>.
            </Alert>
          </Card>
        )
      )}

      <Card className="mt-4" title="Receiving wallets" subtitle="No private keys, seed or recovery phrases are ever requested or stored. Ownership is proven by signing a message." padded={false} action={isSuper && <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add wallet</Button>}>
        {!wallets.data?.length ? (
          <Empty />
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead><tr><th>Wallet</th><th>Address</th><th>Network</th><th>Ownership</th><th>Active</th><th></th></tr></thead>
              <tbody>
                {wallets.data.map((w) => (
                  <tr key={w.id}>
                    <td>
                      <p className="text-slate-100">{w.label}</p>
                      <p className="text-xs text-slate-500">{w.provider}</p>
                      {w.isSample && <KindTag kind="sample" />}
                    </td>
                    <td><p className="break-all font-mono text-xs">{w.address}</p>{w.notes && <p className="mt-1 max-w-md text-xs text-slate-500">{w.notes}</p>}</td>
                    <td className="text-xs">{w.currency} · chain {w.chainId}</td>
                    <td><StatusBadge status={w.status} />{w.ownershipVerifiedAt && <p className="mt-1 text-[11px] text-slate-500">{dt(w.ownershipVerifiedAt)}</p>}</td>
                    <td>{w.isActive ? <StatusBadge status="ACTIVE" /> : <StatusBadge status="INACTIVE" />}</td>
                    <td className="text-right">
                      {isSuper && (
                        <div className="flex justify-end gap-1">
                          {w.status !== 'VERIFIED' && <Button size="sm" variant="secondary" onClick={() => startVerify(w)}>Verify ownership</Button>}
                          {w.status === 'VERIFIED' && !w.isActive && <Button size="sm" variant="success" onClick={async () => { await act.run(() => post(`/admin/wallets/${w.id}/activate`, { active: true })); reloadAll(); }}>Activate</Button>}
                          {w.isActive && <Button size="sm" variant="ghost" onClick={async () => { await act.run(() => post(`/admin/wallets/${w.id}/activate`, { active: false })); reloadAll(); }}>Deactivate</Button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {act.error && !verifyFor && <div className="p-4"><Alert tone="danger">{act.error}</Alert></div>}
      </Card>

      <Modal open={!!verifyFor} onClose={() => setVerifyFor(null)} title="Verify wallet ownership" wide>
        {verifyFor && (
          <div className="space-y-4">
            <Alert tone="warning" title="Never enter a private key or recovery phrase">
              The wallet owner signs the message below in their wallet app (for Bitget Wallet: use the "Sign message" / personal_sign feature with the address {verifyFor.address}). Signing costs no gas and authorises no transaction. Paste only the resulting signature (0x…, 132 characters).
            </Alert>
            <div>
              <div className="mb-1.5 flex items-center justify-between"><span className="label mb-0">Message to sign</span>{challenge && <CopyButton value={challenge} label="Copy message" />}</div>
              <pre className="whitespace-pre-wrap rounded-xl border border-white/10 bg-navy-950 p-4 font-mono text-xs text-slate-200">{challenge || 'Generating…'}</pre>
            </div>
            <Field label="Signature"><Textarea className="font-mono text-xs" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="0x…" /></Field>
            {act.error && <Alert tone="danger">{act.error}</Alert>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setVerifyFor(null)}>Cancel</Button>
              <Button loading={act.busy} disabled={!signature.trim()} onClick={async () => { const r = await act.run(() => post(`/admin/wallets/${verifyFor.id}/verify`, { signature: signature.trim() })); if (r) { setVerifyFor(null); reloadAll(); } }}>Verify signature</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add receiving wallet">
        <div className="space-y-4">
          <Field label="Label"><Input value={nw.label} onChange={(e) => setNw({ ...nw, label: e.target.value })} /></Field>
          <Field label="Provider"><Input value={nw.provider} onChange={(e) => setNw({ ...nw, provider: e.target.value })} placeholder="e.g. Bitget Wallet" /></Field>
          <Field label="Address (USDT ERC-20)"><Input className="font-mono" value={nw.address} onChange={(e) => setNw({ ...nw, address: e.target.value })} /></Field>
          <Field label="Chain id" hint="1 = Ethereum mainnet"><Input type="number" value={nw.chainId} onChange={(e) => setNw({ ...nw, chainId: e.target.value })} /></Field>
          <Field label="Notes"><Textarea value={nw.notes} onChange={(e) => setNw({ ...nw, notes: e.target.value })} /></Field>
          <Alert tone="info">New wallets start unverified and inactive.</Alert>
          {act.error && <Alert tone="danger">{act.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button loading={act.busy} onClick={async () => { const r = await act.run(() => post('/admin/wallets', { ...nw, notes: nw.notes || undefined })); if (r) { setAdding(false); reloadAll(); } }}>Add wallet</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
