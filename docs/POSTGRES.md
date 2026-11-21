# Moving to PostgreSQL

The schema avoids SQLite-only features: string status columns, BigInt amounts, and no SQLite JSON functions. That makes the move mechanical.

1. In `apps/server/prisma/schema.prisma`, set `provider = "postgresql"`, and point `DATABASE_URL` at your PostgreSQL instance.
2. Create a fresh migration baseline: move `prisma/migrations` aside, then run `npx prisma migrate dev --name init`.
3. Re-create the immutability rules in that migration. In PostgreSQL that means triggers that `RAISE EXCEPTION` on UPDATE/DELETE of `"LedgerEntry"`, `"Transaction"`, `"AuditLog"`, and on credited `"Deposit"` rows. Even better, revoke UPDATE/DELETE on those tables from the application role.
4. Export from SQLite: `npm run db:export`.
5. Import into the empty PostgreSQL database: `npm run db:import -- exports/<file>.json`. After importing, reset the `AuditLog.seq` sequence with `SELECT setval(pg_get_serial_sequence('"AuditLog"','seq'), MAX(seq)) FROM "AuditLog";`.
6. Run **Admin → System → Integrity check**. The ledger must reconcile and the audit chain must verify.
7. Replace the in-process write queue in `src/lib/prisma.ts` with SERIALIZABLE transactions (and retry on serialization failure) or `SELECT … FOR UPDATE` on ledger accounts. This lets you run several server instances.

Also plan for managed backups (point-in-time recovery), connection pooling, encrypted storage, and least-privilege database roles.
