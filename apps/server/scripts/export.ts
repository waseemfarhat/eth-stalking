// npm run db:export — portable JSON export of every table (for migration to PostgreSQL or archiving)
import { writeExport } from '../src/lib/backup.js';
import { prisma } from '../src/lib/prisma.js';

console.log(`Export written: ${await writeExport()}`);
await prisma.$disconnect();
