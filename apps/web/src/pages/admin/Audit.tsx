import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { api, useApi } from '../../api/client';
import { Alert, Button, Card, Empty, Input, Loading, PageHeader, Pagination, Select, useAction } from '../../components/ui';
import { dt } from '../../lib/format';

const ENTITY_TYPES = ['', 'User', 'Deposit', 'Withdrawal', 'StakingRecord', 'StakingPlan', 'Reward', 'Wallet', 'PlatformSetting', 'System', 'SampleChain'];

export function AdminAudit() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const qs = new URLSearchParams({ page: String(page), pageSize: '50', entityType, action, entityId }).toString();
  const { data, loading } = useApi(`/admin/audit?${qs}`, [qs]);
  const [chain, setChain] = useState<any>(null);
  const verify = useAction();

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only and hash-chained. Rows cannot be edited or deleted at the database level; any tampering breaks the chain."
        action={<Button variant="secondary" loading={verify.busy} onClick={async () => setChain(await verify.run(() => api('/admin/audit/verify')))}><ShieldCheck className="h-4 w-4" /> Verify chain integrity</Button>}
      />
      {chain && (
        <Alert tone={chain.valid ? 'success' : 'danger'} className="mb-4" title={chain.valid ? 'Audit chain intact' : 'Audit chain BROKEN'}>
          {chain.checked} records verified{chain.brokenAtSeq ? ` · first inconsistency at #${chain.brokenAtSeq}` : ''}.
        </Alert>
      )}
      {verify.error && <Alert tone="danger" className="mb-4">{verify.error}</Alert>}
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-white/[0.06] p-4">
          <Select className="w-48" value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t || 'All entities'}</option>)}
          </Select>
          <Input className="max-w-xs" placeholder="Action contains… (e.g. APPROVED)" value={action} onChange={(e) => { setAction(e.target.value.toUpperCase()); setPage(1); }} />
          <Input className="max-w-xs" placeholder="Entity id" value={entityId} onChange={(e) => { setEntityId(e.target.value); setPage(1); }} />
        </div>
        {loading && !data ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty>No audit records.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data">
                <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th><th>Hash</th></tr></thead>
                <tbody>
                  {data.rows.map((r: any) => (
                    <tr key={r.seq}>
                      <td className="tabular-nums text-slate-500">{r.seq}</td>
                      <td className="whitespace-nowrap text-xs text-slate-400">{dt(r.createdAt)}</td>
                      <td className="text-xs">{r.actor?.email ?? <span className="text-slate-500">{r.actorRole ?? 'system'}</span>}</td>
                      <td className="text-xs font-medium text-slate-200">{r.action}</td>
                      <td className="text-xs text-slate-400">{r.entityType}<p className="mono text-slate-600">{r.entityId}</p></td>
                      <td className="max-w-md"><code className="block truncate text-[11px] text-slate-400" title={JSON.stringify(r.details)}>{JSON.stringify(r.details)}</code></td>
                      <td className="mono text-slate-600">{r.hash.slice(0, 10)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={50} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
