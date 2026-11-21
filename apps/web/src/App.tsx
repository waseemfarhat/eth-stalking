import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './layouts/AppShell';
import { isAdmin, useAuth } from './lib/auth';
import { Loading } from './components/ui';
import { Landing } from './pages/public/Landing';
import { Login, Register } from './pages/public/Auth';
import { Terms } from './pages/public/Terms';
import { UserOverview } from './pages/user/Overview';
import { DepositPage } from './pages/user/Deposit';
import { WalletPage } from './pages/user/Wallet';
import { StakingPage } from './pages/user/Staking';
import { RewardsPage } from './pages/user/Rewards';
import { WithdrawPage } from './pages/user/Withdraw';
import { NotificationsPage } from './pages/user/Notifications';
import { AdminOverview } from './pages/admin/Overview';
import { AdminUsers, AdminUserDetail } from './pages/admin/Users';
import { AdminDeposits } from './pages/admin/Deposits';
import { AdminStaking } from './pages/admin/Staking';
import { AdminRewards } from './pages/admin/Rewards';
import { AdminWithdrawals } from './pages/admin/Withdrawals';
import { AdminCompliance } from './pages/admin/Compliance';
import { AdminAudit } from './pages/admin/Audit';
import { AdminSystem } from './pages/admin/System';
import { AdminRealNetwork } from './pages/admin/RealNetwork';

function Guard({ need, children }: { need: 'user' | 'admin' | 'any'; children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (need === 'admin' && !isAdmin(user)) return <Navigate to="/app" replace />;
  if (need === 'user' && isAdmin(user)) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading />;
  if (!user) return <Landing />;
  return <Navigate to={isAdmin(user) ? '/admin' : '/app'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/terms" element={<Terms />} />

      <Route path="/app" element={<Guard need="user"><AppShell variant="user" /></Guard>}>
        <Route index element={<UserOverview />} />
        <Route path="deposit" element={<DepositPage />} />
        <Route path="wallet" element={<WalletPage />} />
        <Route path="staking" element={<StakingPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="withdraw" element={<WithdrawPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>

      <Route path="/admin" element={<Guard need="admin"><AppShell variant="admin" /></Guard>}>
        <Route index element={<AdminOverview />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="users/:id" element={<AdminUserDetail />} />
        <Route path="deposits" element={<AdminDeposits />} />
        <Route path="staking" element={<AdminStaking />} />
        <Route path="rewards" element={<AdminRewards />} />
        <Route path="withdrawals" element={<AdminWithdrawals />} />
        <Route path="compliance" element={<AdminCompliance />} />
        <Route path="real-network" element={<AdminRealNetwork />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="system" element={<AdminSystem />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
