import { useState } from 'react';
import { Download } from 'lucide-react';
import { useApi } from '../../api/client';
import { Alert, Card, Empty, KindTag, Loading, PageHeader, Pagination, Stat } from '../../components/ui';
import { dt, humanize, usdt } from '../../lib/format';
import { accountLabel } from './Overview';

export function WalletPage() {
  const ov = useApi('/me/overview');
  const [page, setPage] = useState(1);
  const ledger = useApi(`/me/ledger?page=${page}&pageSize=25`, [page]);
  const b = ov.data?.balances;

  return (
    <>
      <PageHeader
        title="Internal wallet"
        subtitle="Your internal platform account. This is a ledger record held by the platform — not a separate on-chain wallet in your name."
        action={
          <a href="/api/me/ledger/export.csv" className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm text-slate-100 hover:bg-white/[0.08]">
            <Download className="h-4 w-4" /> Export ledger (CSV)
          </a>
        }
      />
      {!b ? (
        <Loading />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Available" value={usdt(b.available)} tone="emerald" tag={<KindTag kind="internal" />} hint="Can be staked or withdrawn" />
          <Stat label="Locked" value={usdt(b.locked)} tone="amber" tag={<KindTag kind="internal" />} hint="Held by an administrator" />
          <Stat label="Reserved" value={usdt(b.pending)} tone="sky" tag={<KindTag kind="internal" />} hint="Pending withdrawal / staking requests" />
          <Stat label="Staked" value={usdt(b.staked)} tone="violet" tag={<KindTag kind="staking" />} hint="In internal staking records" />
          <Stat label="Total" value={usdt(b.total)} tone="slate" hint="USDT liability recorded to you" />
        </div>
      )}

      <Alert tone="info" className="mt-4">
        Every change to your balance appears below with its reason: verified deposits, administrator adjustments, staking records, reward allocations and withdrawals. History is never edited — corrections appear as new entries.
      </Alert>

      <Card className="mt-4" title="Ledger" subtitle="Complete history of internal balance movements" padded={false}>
        {ledger.loading && !ledger.data ? (
          <Loading />
        ) : !ledger.data?.rows.length ? (
          <Empty>No ledger entries yet.</Empty>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Account</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.rows.map((r: any) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-xs text-slate-400">{dt(r.createdAt)}</td>
                      <td className="whitespace-nowrap text-xs">{humanize(r.transaction.type)}</td>
                      <td className="max-w-md text-sm text-slate-300">
                        {r.transaction.description}
                        {r.transaction.isSample && <span className="ml-2"><KindTag kind="sample" /></span>}
                      </td>
                      <td className="text-xs text-slate-400">{accountLabel[r.account] ?? r.account}</td>
                      <td className={`text-right tabular-nums ${r.amount.startsWith('-') ? 'text-rose-300' : 'text-emerald-300'}`}>{usdt(r.amount, { sign: true })}</td>
                      <td className="text-right tabular-nums text-slate-400">{usdt(r.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={ledger.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
