// npm run db:reset — DEVELOPMENT ONLY: back up, delete and recreate the database, then seed.
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { env } from '../src/config/env.js';
import { createBackup, dbFilePath } from '../src/lib/backup.js';
import { prisma } from '../src/lib/prisma.js';

if (env.NODE_ENV === 'production' || env.CHAIN_MODE === 'mainnet') {
  console.error('Refusing to reset a production / mainnet database.');
  process.exit(1);
}
const file = dbFilePath();
if (fs.existsSync(file)) {
  const b = await createBackup('pre-reset');
  console.log(`Backed up to ${b.file}`);
}
await prisma.$disconnect();
for (const ext of ['', '-wal', '-shm', '-journal']) if (fs.existsSync(file + ext)) fs.rmSync(file + ext);
execSync('npx prisma migrate deploy', { stdio: 'inherit' });
execSync('npx tsx prisma/seed.ts', { stdio: 'inherit' });
