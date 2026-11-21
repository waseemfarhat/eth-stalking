// npm run db:backup  — consistent snapshot of the SQLite database into <repo>/backups (safe while running)
import { createBackup } from '../src/lib/backup.js';
import { prisma } from '../src/lib/prisma.js';

const b = await createBackup(process.argv[2] ?? 'cli');
console.log(`Backup written: ${b.file} (${(b.size / 1024).toFixed(1)} KiB)`);
await prisma.$disconnect();
