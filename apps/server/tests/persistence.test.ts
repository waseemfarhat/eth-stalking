import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { createBackup, exportAll, importAll, isSqliteFile } from '../src/lib/backup.js';
import { prisma, withTx } from '../src/lib/prisma.js';
import { audit } from '../src/audit/audit.js';
import { makeUser } from './helpers.js';
import { testEnv } from '../vitest.config.js';

describe('database persistence, backup, export & import', () => {
  it('data persists across a fresh client connection (application restart)', async () => {
    const u = await makeUser();
    await prisma.$disconnect();
    const fresh = new PrismaClient();
    expect(await fresh.user.findUnique({ where: { id: u.id } })).not.toBeNull();
    await fresh.$disconnect();
  });

  it('creates a consistent SQLite backup that can be opened and contains the data', async () => {
    const u = await makeUser();
    await withTx((tx) => audit(tx, { action: 'TEST_BACKUP', entityType: 'Test' }));
    const b = await createBackup('test');
    expect(isSqliteFile(b.file)).toBe(true);
    const restored = new PrismaClient({ datasourceUrl: `file:${b.file.split(path.sep).join('/')}` });
    expect(await restored.user.findUnique({ where: { id: u.id } })).not.toBeNull();
    const integrity = (await restored.$queryRawUnsafe('PRAGMA integrity_check')) as { integrity_check: string }[];
    expect(integrity[0].integrity_check).toBe('ok');
    // triggers survive the backup
    await expect(restored.$executeRawUnsafe('DELETE FROM "AuditLog"')).rejects.toThrow();
    await restored.$disconnect();
    fs.rmSync(b.file);
  });

  it('exports to JSON and imports into an empty database with identical content', async () => {
    const json = await exportAll();
    const parsed = JSON.parse(json);
    expect(parsed.format).toBe('eth-stalking-export');

    const target = path.resolve('prisma', 'test-roundtrip.db');
    if (fs.existsSync(target)) fs.rmSync(target);
    execSync('npx prisma migrate deploy', { env: { ...process.env, ...testEnv, DATABASE_URL: 'file:./test-roundtrip.db' }, stdio: 'pipe' });
    const other = new PrismaClient({ datasourceUrl: 'file:./test-roundtrip.db' });
    const counts = await importAll(json, other);
    expect(counts.user).toBe(await prisma.user.count());
    expect(counts.ledgerEntry).toBe(await prisma.ledgerEntry.count());

    const a = await prisma.ledgerAccount.findMany({ orderBy: { key: 'asc' } });
    const b = await other.ledgerAccount.findMany({ orderBy: { key: 'asc' } });
    expect(b.map((x) => [x.key, x.balance])).toEqual(a.map((x) => [x.key, x.balance]));

    // refuses to import into a non-empty database
    await expect(importAll(json, other)).rejects.toThrow(/not empty/);
    await other.$disconnect();
  });
});
