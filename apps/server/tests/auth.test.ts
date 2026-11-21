import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app, asNewUser, login, makeUser, PASSWORD } from './helpers.js';
import { prisma } from '../src/lib/prisma.js';

describe('registration & login', () => {
  it('registers a customer, sets HttpOnly session cookie and hashes the password', async () => {
    const email = `new-${Date.now()}@test.local`;
    const res = await request(app).post('/api/auth/register').send({ email, name: 'New User', password: 'Abcdef12345', acceptTerms: true });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, role: 'USER' });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.find((c) => c.startsWith('es_session='))).toMatch(/HttpOnly/i);
    expect(cookies.find((c) => c.startsWith('es_session='))).toMatch(/SameSite=Strict/i);
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(u.passwordHash).not.toContain('Abcdef12345');
  });

  it('cannot self-register as admin; role field is ignored', async () => {
    const email = `sneaky-${Date.now()}@test.local`;
    const res = await request(app).post('/api/auth/register').send({ email, name: 'Sneaky', password: 'Abcdef12345', acceptTerms: true, role: 'SUPERADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('USER');
  });

  it('validates input and rejects weak passwords, duplicates and missing consent', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'bad', name: 'x', password: 'short', acceptTerms: true })).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send({ email: `x${Date.now()}@t.local`, name: 'Xx', password: 'Abcdef12345' })).status).toBe(400);
    const u = await makeUser();
    expect((await request(app).post('/api/auth/register').send({ email: u.email, name: 'Dup', password: 'Abcdef12345', acceptTerms: true })).status).toBe(409);
  });

  it('logs in, returns /me and logs out', async () => {
    const u = await makeUser();
    const s = await login(u.email);
    const me = await s.get('/api/auth/me');
    expect(me.body.user.email).toBe(u.email);
    await s.post('/api/auth/logout');
    expect((await s.get('/api/auth/me')).body.user).toBeNull();
    expect((await s.get('/api/me/overview')).status).toBe(401);
  });

  it('rejects wrong passwords with a generic error and locks after repeated failures', async () => {
    const u = await makeUser();
    const r1 = await request(app).post('/api/auth/login').send({ email: u.email, password: 'wrong-password-1' });
    expect(r1.status).toBe(401);
    const r2 = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'x' });
    expect(r2.body.error.message).toBe(r1.body.error.message);
    for (let i = 0; i < 4; i++) await request(app).post('/api/auth/login').send({ email: u.email, password: 'wrong' });
    const locked = await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD });
    expect(locked.status).toBe(429);
  });

  it('blocks suspended accounts', async () => {
    const u = await makeUser('USER', 'SUSPENDED');
    expect((await request(app).post('/api/auth/login').send({ email: u.email, password: PASSWORD })).status).toBe(403);
  });

  it('expires idle and expired sessions', async () => {
    const u = await makeUser();
    const s = await login(u.email);
    await prisma.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await s.get('/api/me/overview')).status).toBe(401);
  });
});

describe('authorisation & CSRF', () => {
  it('requires a CSRF token for authenticated state-changing requests', async () => {
    const s = await asNewUser();
    const noToken = await s.agent.post('/api/me/deposits').send({ txHash: '0x' + '1'.repeat(64) });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_FAILED');
    const badToken = await s.agent.post('/api/me/deposits').set('x-csrf-token', 'nope').send({ txHash: '0x' + '1'.repeat(64) });
    expect(badToken.status).toBe(403);
  });

  it('rejects cross-origin state-changing requests', async () => {
    const res = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').send({ email: 'a', password: 'b' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BAD_ORIGIN');
  });

  it('ordinary users cannot access any admin API', async () => {
    const s = await asNewUser('USER');
    for (const url of ['/api/admin/overview', '/api/admin/users', '/api/admin/deposits', '/api/admin/audit']) {
      expect((await s.get(url)).status).toBe(403);
    }
    const target = await makeUser();
    const res = await s.post(`/api/admin/users/${target.id}/balance`).send({ kind: 'CREDIT', amount: '1000', reason: 'free money' });
    expect(res.status).toBe(403);
  });

  it('admins cannot use customer-only endpoints (no self-dealing balances)', async () => {
    const s = await asNewUser('ADMIN');
    expect((await s.post('/api/me/deposits').send({ txHash: '0x' + '2'.repeat(64) })).status).toBe(403);
    expect((await s.get('/api/me/overview')).status).toBe(403);
  });

  it('only super-admins can change roles or manage wallets', async () => {
    const s = await asNewUser('ADMIN');
    const u = await makeUser();
    expect((await s.post(`/api/admin/users/${u.id}/role`).send({ role: 'ADMIN', reason: 'promote' })).status).toBe(403);
    expect((await s.post('/api/admin/wallets').send({ label: 'x', provider: 'x', address: '0x' + '1'.repeat(40), chainId: 1 })).status).toBe(403);
  });

  it('admins cannot suspend themselves', async () => {
    const s = await asNewUser('SUPERADMIN');
    expect((await s.post(`/api/admin/users/${s.user.id}/status`).send({ status: 'SUSPENDED', reason: 'test' })).status).toBe(403);
  });

  it('suspending a user revokes their sessions immediately', async () => {
    const admin = await asNewUser('ADMIN');
    const u = await asNewUser('USER');
    expect((await u.get('/api/me/overview')).status).toBe(200);
    expect((await admin.post(`/api/admin/users/${u.user.id}/status`).send({ status: 'SUSPENDED', reason: 'compliance hold' })).status).toBe(200);
    expect((await u.get('/api/me/overview')).status).toBe(401);
  });
});
