// npm run db:import -- <export.json>  — import into an EMPTY, freshly migrated database
import fs from 'node:fs';
import { importAll } from '../src/lib/backup.js';
import { prisma } from '../src/lib/prisma.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: npm run db:import -- <path to export .json>');
  process.exit(1);
}
const counts = await importAll(fs.readFileSync(file, 'utf8'));
console.log('Imported rows:', counts);
await prisma.$disconnect();
