import fs from 'node:fs';
import path from 'node:path';
import { env, REPO_ROOT, SERVER_ROOT } from '../config/env.js';
import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma.js';

/** Absolute path of the SQLite file (DATABASE_URL is relative to prisma/schema.prisma). */
export function dbFilePath() {
  const url = env.DATABASE_URL;
  if (!url.startsWith('file:')) throw new Error('Backup/restore scripts support SQLite file databases only');
  const p = url.slice('file:'.length).split('?')[0];
  return path.isAbsolute(p) ? p : path.resolve(SERVER_ROOT, 'prisma', p);
}

export const BACKUP_DIR = path.join(REPO_ROOT, 'backups');
export const EXPORT_DIR = path.join(REPO_ROOT, 'exports');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** Consistent online snapshot using SQLite's VACUUM INTO (safe while the server is running). */
export async function createBackup(label = 'manual') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `eth-stalking-${stamp()}-${label.replace(/[^a-z0-9-]/gi, '')}.db`);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const size = fs.statSync(file).size;
  return { file, name: path.basename(file), size };
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, size: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isSqliteFile(file: string) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  return buf.toString('latin1') === 'SQLite format 3\u0000';
}

// Tables in foreign-key dependency order (parents first).
export const TABLE_ORDER = [
  'user',
  'session',
  'wallet',
  'platformSetting',
  'blockchainTransaction',
  'transaction',
  'ledgerAccount',
  'ledgerEntry',
  'deposit',
  'withdrawal',
  'stakingPlan',
  'stakingRecord',
  'reward',
  'notification',
  'auditLog',
] as const;

type Delegate = { findMany: (a?: unknown) => Promise<Record<string, unknown>[]>; createMany: (a: { data: unknown[] }) => Promise<unknown>; count: () => Promise<number> };
const delegate = (name: string, client: PrismaClient = prisma) => (client as unknown as Record<string, Delegate>)[name];

const BIGINT_FIELDS = new Set(['amount', 'minAmount', 'maxAmount', 'balance', 'balanceAfter']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Portable JSON export of every table (BigInt as string tagged with "$bigint"). */
export async function exportAll(client: PrismaClient = prisma) {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLE_ORDER) data[t] = await delegate(t, client).findMany();
  const json = JSON.stringify(
    { format: 'eth-stalking-export', version: 1, exportedAt: new Date().toISOString(), tables: data },
    (_k, v) => (typeof v === 'bigint' ? { $bigint: v.toString() } : v),
  );
  return json;
}

export async function writeExport() {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const file = path.join(EXPORT_DIR, `eth-stalking-export-${stamp()}.json`);
  fs.writeFileSync(file, await exportAll());
  return file;
}

/** Import into an EMPTY database (e.g. a fresh SQLite or a new PostgreSQL instance). */
export async function importAll(json: string, client: PrismaClient = prisma) {
  const parsed = JSON.parse(json, (k, v) => {
    if (v && typeof v === 'object' && '$bigint' in v) return BigInt((v as { $bigint: string }).$bigint);
    if (typeof v === 'string' && DATE_RE.test(v) && !BIGINT_FIELDS.has(k)) return new Date(v);
    return v;
  }) as { format: string; tables: Record<string, unknown[]> };
  if (parsed.format !== 'eth-stalking-export') throw new Error('Not an ETH STALKING export file');
  const users = await delegate('user', client).count();
  if (users > 0) throw new Error('Target database is not empty. Import only into a freshly migrated database.');
  const counts: Record<string, number> = {};
  for (const t of TABLE_ORDER) {
    const rows = parsed.tables[t] ?? [];
    if (rows.length) await delegate(t, client).createMany({ data: rows });
    counts[t] = rows.length;
  }
  return counts;
}
