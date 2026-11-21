import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { testEnv } from '../vitest.config.js';

export default function setup() {
  const db = path.resolve('prisma', 'test.db');
  for (const f of [db, db + '-journal', db + '-wal', db + '-shm', path.resolve('prisma', 'test-roundtrip.db')]) if (fs.existsSync(f)) fs.rmSync(f);
  fs.rmSync(path.resolve('tests', '.tmp'), { recursive: true, force: true });
  fs.mkdirSync(path.resolve('tests', '.tmp'), { recursive: true });
  execSync('npx prisma migrate deploy', { env: { ...process.env, ...testEnv }, stdio: 'pipe' });
}
