import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Input } from './ui';

type U = { id: string; email: string; name: string };

/** Search-as-you-type picker for customer accounts. */
export function UserPicker({ value, onChange }: { value: U | null; onChange: (u: U | null) => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<U[]>([]);
  useEffect(() => {
    if (!q.trim()) return setRows([]);
    const t = setTimeout(() => {
      api(`/admin/users?role=USER&status=ACTIVE&pageSize=8&q=${encodeURIComponent(q.trim())}`).then((r) => setRows(r.rows)).catch(() => setRows([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-sm">
        <span>
          <span className="text-white">{value.name}</span> <span className="text-slate-400">{value.email}</span>
        </span>
        <button className="text-xs text-slate-300 hover:text-white" onClick={() => onChange(null)} type="button">Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input placeholder="Search customer by email, name or id" value={q} onChange={(e) => setQ(e.target.value)} />
      {rows.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-white/10 bg-navy-900 shadow-xl">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="w-full px-3.5 py-2 text-left text-sm hover:bg-white/5" onClick={() => { onChange(r); setQ(''); }}>
                <span className="text-white">{r.name}</span> <span className="text-xs text-slate-400">{r.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
