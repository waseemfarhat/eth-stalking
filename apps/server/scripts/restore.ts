// npm run db:restore -- <backup-file>   (STOP THE SERVER FIRST)
// Replaces the live database with a backup. The current database is saved as a pre-restore copy first.
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { BACKUP_DIR, dbFilePath, isSqliteFile } from '../src/lib/backup.js';

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run db:restore -- <backup file name or path>');
  process.exit(1);
}
const src = fs.existsSync(arg) ? path.resolve(arg) : path.join(BACKUP_DIR, arg);
if (!fs.existsSync(src)) throw new Error(`Backup not found: ${src}`);
if (!isSqliteFile(src)) throw new Error('File is not a SQLite database');

const target = dbFilePath();
if (fs.existsSync(target)) {
  const safety = path.join(BACKUP_DIR, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.copyFileSync(target, safety);
  console.log(`Current database saved to ${safety}`);
}
for (const ext of ['-wal', '-shm', '-journal']) if (fs.existsSync(target + ext)) fs.rmSync(target + ext);
fs.copyFileSync(src, target);

const prisma = new PrismaClient();
const res = (await prisma.$queryRawUnsafe('PRAGMA integrity_check')) as { integrity_check: string }[];
const users = await prisma.user.count();
await prisma.$disconnect();
if (res[0]?.integrity_check !== 'ok') throw new Error(`Integrity check failed: ${JSON.stringify(res)}`);
console.log(`Restored ${path.basename(src)} → ${target}  (integrity ok, ${users} users)`);
console.log('Run "npm run db:migrate" if the backup predates the current schema.');
