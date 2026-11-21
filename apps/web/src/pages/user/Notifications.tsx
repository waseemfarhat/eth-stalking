import { Bell, CheckCheck } from 'lucide-react';
import { post, useApi } from '../../api/client';
import { Button, Card, Empty, PageHeader } from '../../components/ui';
import { ago, dt } from '../../lib/format';

export function NotificationsPage() {
  const { data, reload } = useApi('/me/notifications');
  return (
    <>
      <PageHeader
        title="Notifications"
        action={
          <Button variant="secondary" onClick={async () => { await post('/me/notifications/read', {}); void reload(); }} disabled={!data?.unread}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        }
      />
      <Card padded={false}>
        {!data?.rows.length ? (
          <Empty>No notifications.</Empty>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {data.rows.map((n: any) => (
              <li key={n.id} className={`flex gap-4 px-5 py-4 ${n.readAt ? 'opacity-60' : ''}`}>
                <div className={`mt-0.5 rounded-lg p-2 ${n.readAt ? 'bg-white/5 text-slate-500' : 'bg-emerald-500/15 text-emerald-300'}`}><Bell className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-slate-100">{n.title}</p>
                    <span className="text-xs text-slate-500" title={dt(n.createdAt)}>{ago(n.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-400">{n.body}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
