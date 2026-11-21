import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Search } from 'lucide-react';
import { post, useApi } from '../../api/client';
import { Alert, Button, Card, Empty, ErrorText, Field, Input, KindTag, Loading, Modal, PageHeader, Pagination, Select, Stat, StatusBadge, Tabs, Textarea, useAction } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { dt, humanize, shortHash, usdt } from '../../lib/format';

export function AdminUsers() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('USER');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), q, status, role }).toString();
  const { data, loading } = useApi(`/admin/users?${qs}`, [qs]);

  return (
    <>
      <PageHeader title="Users & balances" subtitle="Search accounts, review balances and history, and manage account status." />
      <Card padded={false}>
        <div className="flex flex-wrap gap-3 border-b border-white/[0.06] p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
            <Input className="pl-9" placeholder="Search email, name or id" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <Select className="w-40" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
            <option value="">All roles</option>
            <option value="USER">Customers</option>
            <option value="ADMIN">Admins</option>
            <option value="SUPERADMIN">Super-admins</option>
          </Select>
          <Select className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : !data?.rows.length ? (
          <Empty>No users found.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr><th>User</th><th>Role</th><th>Status</th><th className="text-right">Available</th><th className="text-right">Locked / reserved</th><th className="text-right">Staked</th><th>Joined</th><th></th></tr>
                </thead>
                <tbody>
                  {data.rows.map((u: any) => (
                    <tr key={u.id}>
                      <td>
                        <p className="text-slate-100">{u.name}</p>
                        <p className="text-xs text-slate-500">{u.email}</p>
                      </td>
                      <td className="text-xs">{u.role}</td>
                      <td><StatusBadge status={u.status} /></td>
                      <td className="text-right tabular-nums">{u.balances ? usdt(u.balances.available) : '—'}</td>
                      <td className="text-right tabular-nums text-slate-400">{u.balances ? `${usdt(u.balances.locked)} / ${usdt(u.balances.pending)}` : '—'}</td>
                      <td className="text-right tabular-nums text-violet-300">{u.balances ? usdt(u.balances.staked) : '—'}</td>
                      <td className="text-xs text-slate-400">{dt(u.createdAt)}</td>
                      <td className="text-right"><Link to={`/admin/users/${u.id}`} className="text-xs text-emerald-400 hover:underline">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

type Tab = 'transactions' | 'deposits' | 'staking' | 'rewards' | 'withdrawals';

export function AdminUserDetail() {
  const { id } = useParams();
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useApi(`/admin/users/${id}`, [id]);
  const [tab, setTab] = useState<Tab>('transactions');
  const [adjust, setAdjust] = useState<null | 'CREDIT' | 'DEBIT' | 'LOCK' | 'UNLOCK'>(null);
  const [form, setForm] = useState({ amount: '', reason: '' });
  const [statusModal, setStatusModal] = useState(false);
  const [statusReason, setStatusReason] = useState('');
  const [roleModal, setRoleModal] = useState(false);
  const [newRole, setNewRole] = useState('ADMIN');
  const act = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorText error={error} />;
  const { user, balances } = data!;
  const isCustomer = user.role === 'USER';

  const doAdjust = async () => {
    const r = await act.run(() => post(`/admin/users/${id}/balance`, { kind: adjust, ...form }, true));
    if (r) {
      setAdjust(null);
      setForm({ amount: '', reason: '' });
      void reload();
    }
  };
  const doStatus = async () => {
    const r = await act.run(() => post(`/admin/users/${id}/status`, { status: user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', reason: statusReason }));
    if (r) {
      setStatusModal(false);
      setStatusReason('');
      void reload();
    }
  };
  const doRole = async () => {
    const r = await act.run(() => post(`/admin/users/${id}/role`, { role: newRole, reason: statusReason }));
    if (r) {
      setRoleModal(false);
      setStatusReason('');
      void reload();
    }
  };

  return (
    <>
      <Link to="/admin/users" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> Users</Link>
      <PageHeader
        title={user.name}
        subtitle={<>{user.email} · {user.role} · joined {dt(user.createdAt)} · last login {dt(user.lastLoginAt)} · <span className="mono">{user.id}</span></>}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={user.status} />
            {me?.id !== user.id && (
              <Button variant={user.status === 'ACTIVE' ? 'danger' : 'success'} size="sm" onClick={() => setStatusModal(true)}>{user.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</Button>
            )}
            {me?.role === 'SUPERADMIN' && me.id !== user.id && <Button variant="secondary" size="sm" onClick={() => setRoleModal(true)}>Change role</Button>}
          </div>
        }
      />

      {isCustomer ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label="Available" value={usdt(balances.available)} tone="emerald" tag={<KindTag kind="internal" />} />
            <Stat label="Locked" value={usdt(balances.locked)} tone="amber" />
            <Stat label="Reserved" value={usdt(balances.pending)} tone="sky" />
            <Stat label="Staked" value={usdt(balances.staked)} tone="violet" tag={<KindTag kind="staking" />} />
            <Stat label="Total liability" value={usdt(balances.total)} tone="slate" />
          </div>
          <Card className="mt-4" title="Balance management" subtitle="Every change creates a ledger entry with your reason, visible to the user and recorded in the audit log.">
            <div className="flex flex-wrap gap-2">
              <Button variant="success" onClick={() => setAdjust('CREDIT')}>Credit</Button>
              <Button variant="danger" onClick={() => setAdjust('DEBIT')}>Debit</Button>
              <Button variant="secondary" onClick={() => setAdjust('LOCK')}>Lock</Button>
              <Button variant="secondary" onClick={() => setAdjust('UNLOCK')}>Unlock</Button>
            </div>
          </Card>
        </>
      ) : (
        <Alert tone="info">Administrator accounts do not hold platform balances (segregation of duties).</Alert>
      )}

      <div className="mt-6 mb-3">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'transactions', label: `Transactions (${data!.transactions.length})` },
            { value: 'deposits', label: `Deposits (${data!.deposits.length})` },
            { value: 'staking', label: `Staking (${data!.staking.length})` },
            { value: 'rewards', label: `Rewards (${data!.rewards.length})` },
            { value: 'withdrawals', label: `Withdrawals (${data!.withdrawals.length})` },
          ]}
        />
      </div>

      <Card padded={false}>
        <div className="overflow-x-auto">
          {tab === 'transactions' &&
            (data!.transactions.length ? (
              <table className="data">
                <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Entries</th><th>By</th></tr></thead>
                <tbody>
                  {data!.transactions.map((t: any) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-xs text-slate-400">{dt(t.createdAt)}</td>
                      <td className="text-xs">{humanize(t.type)}</td>
                      <td className="max-w-sm text-sm text-slate-300">{t.description}<p className="mono text-slate-600">{t.reference}</p></td>
                      <td className="text-xs">
                        {t.entries.map((e: any, i: number) => (
                          <p key={i} className="tabular-nums"><span className="text-slate-500">{e.account}</span> <span className={e.amount.startsWith('-') ? 'text-rose-300' : 'text-emerald-300'}>{usdt(e.amount, { sign: true })}</span></p>
                        ))}
                      </td>
                      <td className="text-xs text-slate-400">{t.createdBy?.email ?? 'system'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty />)}
          {tab === 'deposits' &&
            (data!.deposits.length ? (
              <table className="data">
                <thead><tr><th>Submitted</th><th>Tx</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {data!.deposits.map((d: any) => (
                    <tr key={d.id}>
                      <td className="text-xs text-slate-400">{dt(d.submittedAt)}</td>
                      <td className="mono">{shortHash(d.txHash)} {d.isSample && <KindTag kind="sample" />}</td>
                      <td className="tabular-nums">{d.amount ? usdt(d.amount) : '—'}</td>
                      <td><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty />)}
          {tab === 'staking' &&
            (data!.staking.length ? (
              <table className="data">
                <thead><tr><th>Plan</th><th>Amount</th><th>Requested</th><th>Ends</th><th>Status</th></tr></thead>
                <tbody>
                  {data!.staking.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.plan.name}</td>
                      <td className="tabular-nums">{usdt(s.amount)}</td>
                      <td className="text-xs text-slate-400">{dt(s.requestedAt)}</td>
                      <td className="text-xs text-slate-400">{dt(s.endsAt)}</td>
                      <td><StatusBadge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty />)}
          {tab === 'rewards' &&
            (data!.rewards.length ? (
              <table className="data">
                <thead><tr><th>Allocated</th><th>Description</th><th>Amount</th><th>By</th><th>Status</th></tr></thead>
                <tbody>
                  {data!.rewards.map((r: any) => (
                    <tr key={r.id}>
                      <td className="text-xs text-slate-400">{dt(r.allocatedAt)}</td>
                      <td>{r.description}</td>
                      <td className="tabular-nums text-fuchsia-300">{usdt(r.amount)}</td>
                      <td className="text-xs text-slate-400">{r.allocatedBy.email}</td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty />)}
          {tab === 'withdrawals' &&
            (data!.withdrawals.length ? (
              <table className="data">
                <thead><tr><th>Requested</th><th>Amount</th><th>Destination</th><th>Status</th></tr></thead>
                <tbody>
                  {data!.withdrawals.map((w: any) => (
                    <tr key={w.id}>
                      <td className="text-xs text-slate-400">{dt(w.createdAt)}</td>
                      <td className="tabular-nums">{usdt(w.amount)}</td>
                      <td className="mono">{shortHash(w.destinationAddress, 8, 6)}</td>
                      <td><StatusBadge status={w.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty />)}
        </div>
      </Card>

      <Modal open={!!adjust} onClose={() => setAdjust(null)} title={`${adjust ? humanize(adjust) : ''} internal balance`}>
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            {adjust === 'CREDIT' && 'Adds to the available balance (counterpart: platform adjustments account).'}
            {adjust === 'DEBIT' && 'Removes from the available balance.'}
            {adjust === 'LOCK' && 'Moves funds from available to locked. Locked funds cannot be withdrawn or staked.'}
            {adjust === 'UNLOCK' && 'Moves funds from locked back to available.'}
          </p>
          <Field label="Amount (USDT)">
            <Input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
          </Field>
          <Field label="Reason (shown to the user)">
            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Correction for support ticket #123" />
          </Field>
          {act.error && <Alert tone="danger">{act.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdjust(null)}>Cancel</Button>
            <Button onClick={doAdjust} loading={act.busy} disabled={!form.amount || form.reason.trim().length < 3}>Confirm</Button>
          </div>
        </div>
      </Modal>

      <Modal open={statusModal} onClose={() => setStatusModal(false)} title={user.status === 'ACTIVE' ? 'Suspend account' : 'Activate account'}>
        <div className="space-y-4">
          {user.status === 'ACTIVE' && <Alert tone="warning">Suspension signs the user out immediately and blocks login. Balances are unaffected.</Alert>}
          <Field label="Reason"><Textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)} /></Field>
          {act.error && <Alert tone="danger">{act.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStatusModal(false)}>Cancel</Button>
            <Button variant={user.status === 'ACTIVE' ? 'danger' : 'success'} onClick={doStatus} loading={act.busy} disabled={statusReason.trim().length < 3}>Confirm</Button>
          </div>
        </div>
      </Modal>

      <Modal open={roleModal} onClose={() => setRoleModal(false)} title="Change role">
        <div className="space-y-4">
          <Field label="New role">
            <Select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="USER">USER</option>
              <option value="ADMIN">ADMIN</option>
              <option value="SUPERADMIN">SUPERADMIN</option>
            </Select>
          </Field>
          <Field label="Reason"><Textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)} /></Field>
          <Alert tone="info">Accounts holding a balance cannot be promoted to administrator.</Alert>
          {act.error && <Alert tone="danger">{act.error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRoleModal(false)}>Cancel</Button>
            <Button onClick={doRole} loading={act.busy} disabled={statusReason.trim().length < 3}>Confirm</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
