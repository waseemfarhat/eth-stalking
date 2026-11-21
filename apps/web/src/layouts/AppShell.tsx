import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Bell,
  BookOpen,
  Coins,
  FileClock,
  Globe,
  Gift,
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  Scale,
  ServerCog,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useConfig } from '../lib/config';
import { api } from '../api/client';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/favicon.svg" alt="" className="h-8 w-8" />
      {!compact && (
        <div className="leading-tight">
          <p className="text-sm font-bold tracking-[0.18em] text-white">ETH STALKING</p>
          <p className="text-[10px] uppercase tracking-widest text-slate-500">USDT · ERC-20</p>
        </div>
      )}
    </div>
  );
}

export function ModeBanner() {
  const { config } = useConfig();
  if (!config) return null;
  if (config.chain.mode === 'mainnet' && config.deposits.accepting) return null;
  const text =
    config.chain.mode === 'sample'
      ? 'SAMPLE MODE — simulated blockchain for development. No real funds are involved. Do not send real USDT to any address shown here.'
      : config.chain.mode === 'sepolia'
        ? 'TESTNET MODE (Sepolia) — test tokens only, no real value.'
        : 'Real deposits are DISABLED on this platform. Do not send funds.';
  return <div className="border-b border-orange-500/30 bg-orange-500/10 px-4 py-2 text-center text-xs font-medium text-orange-200">{text}</div>;
}

type NavItem = { to: string; label: string; icon: ReactNode; end?: boolean };

const userNav: NavItem[] = [
  { to: '/app', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" />, end: true },
  { to: '/app/deposit', label: 'Deposit', icon: <ArrowDownToLine className="h-4 w-4" /> },
  { to: '/app/wallet', label: 'Internal wallet', icon: <Wallet className="h-4 w-4" /> },
  { to: '/app/staking', label: 'Staking records', icon: <Layers className="h-4 w-4" /> },
  { to: '/app/rewards', label: 'Rewards', icon: <Gift className="h-4 w-4" /> },
  { to: '/app/withdraw', label: 'Withdrawals', icon: <ArrowUpFromLine className="h-4 w-4" /> },
  { to: '/app/notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
  { to: '/terms', label: 'Terms & disclosures', icon: <BookOpen className="h-4 w-4" /> },
];

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" />, end: true },
  { to: '/admin/users', label: 'Users & balances', icon: <Users className="h-4 w-4" /> },
  { to: '/admin/deposits', label: 'Deposits', icon: <ArrowDownToLine className="h-4 w-4" /> },
  { to: '/admin/staking', label: 'Staking', icon: <Layers className="h-4 w-4" /> },
  { to: '/admin/rewards', label: 'Rewards', icon: <Gift className="h-4 w-4" /> },
  { to: '/admin/withdrawals', label: 'Withdrawals', icon: <ArrowUpFromLine className="h-4 w-4" /> },
  { to: '/admin/real-network', label: 'Real network check', icon: <Globe className="h-4 w-4" /> },
  { to: '/admin/compliance', label: 'Wallets & compliance', icon: <ShieldCheck className="h-4 w-4" /> },
  { to: '/admin/audit', label: 'Audit log', icon: <FileClock className="h-4 w-4" /> },
  { to: '/admin/system', label: 'System', icon: <ServerCog className="h-4 w-4" /> },
];

export function AppShell({ variant }: { variant: 'user' | 'admin' }) {
  const { user, logout } = useAuth();
  const nav = variant === 'admin' ? adminNav : userNav;
  const navigate = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (variant !== 'user') return;
    let alive = true;
    const load = () => api<{ unread: number }>('/me/notifications').then((r) => alive && setUnread(r.unread)).catch(() => undefined);
    void load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [variant, loc.pathname]);

  const sidebar = (
    <aside className="flex h-full w-64 flex-col border-r border-white/[0.06] bg-navy-900/95 backdrop-blur">
      <div className="flex items-center justify-between px-5 py-5">
        <Logo />
        <button className="lg:hidden text-slate-400" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      {variant === 'admin' && (
        <div className="mx-4 mb-3 rounded-lg bg-gradient-to-r from-violet-600/30 to-fuchsia-600/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-violet-200 ring-1 ring-violet-500/30">
          <Scale className="mr-1.5 inline h-3.5 w-3.5" />
          Administration
        </div>
      )}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive ? 'bg-gradient-to-r from-emerald-500/15 to-violet-500/10 text-white ring-1 ring-inset ring-white/10' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200'}`
            }
          >
            {n.icon}
            <span className="flex-1">{n.label}</span>
            {n.to === '/app/notifications' && unread > 0 && <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-navy-950">{unread}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/[0.06] p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full gradient-brand text-sm font-semibold text-white">{user?.name?.[0]?.toUpperCase()}</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-100">{user?.name}</p>
            <p className="truncate text-xs text-slate-500">{user?.role === 'USER' ? user.email : user?.role}</p>
          </div>
        </div>
        <button
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
        >
          <LogOut className="h-3.5 w-3.5" /> Sign out
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex h-full flex-col">
      <ModeBanner />
      <div className="flex min-h-0 flex-1">
        <div className="hidden lg:block">{sidebar}</div>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
            <div className="relative h-full">{sidebar}</div>
          </div>
        )}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3 lg:hidden">
            <button onClick={() => setOpen(true)} className="text-slate-300" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </button>
            <Logo compact />
            <Coins className="h-5 w-5 text-transparent" />
          </div>
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
