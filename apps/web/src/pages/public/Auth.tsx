import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Field, Input } from '../../components/ui';
import { isAdmin, useAuth } from '../../lib/auth';
import { Logo, ModeBanner } from '../../layouts/AppShell';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <ModeBanner />
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 flex justify-center">
            <Logo />
          </Link>
          <div className="card animate-in p-7">
            <h1 className="text-xl font-semibold text-white">{title}</h1>
            <p className="mb-6 mt-1 text-sm text-slate-400">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={isAdmin(user) ? '/admin' : '/app'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      nav(isAdmin(u) ? '/admin' : '/app');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle={<>New here? <Link to="/register" className="text-emerald-400 hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} className="w-full">Sign in</Button>
      </form>
    </AuthLayout>
  );
}

export function Register() {
  const { register, user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={isAdmin(user) ? '/admin' : '/app'} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError('Passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await register({ name: f.name, email: f.email, password: f.password, acceptTerms: accept });
      nav('/app');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Create your account" subtitle={<>Already registered? <Link to="/login" className="text-emerald-400 hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name">
          <Input required autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Password" hint="At least 10 characters with letters and numbers">
          <Input type="password" required autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Confirm password">
          <Input type="password" required autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-navy-900 p-3 text-xs leading-relaxed text-slate-300">
          <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          <span>
            I have read the <Link to="/terms" target="_blank" className="text-emerald-400 underline">terms & risk disclosures</Link>. I understand that internal balances and staking records are platform records (not on-chain holdings), rewards are discretionary and not guaranteed, and withdrawals are processed manually.
          </span>
        </label>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button type="submit" loading={busy} disabled={!accept} className="w-full">Create account</Button>
      </form>
    </AuthLayout>
  );
}
