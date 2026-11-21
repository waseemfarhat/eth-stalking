# Security

## Controls implemented

| Area | Control |
|---|---|
| Passwords | argon2id (19 MiB, t=2, p=1). Minimum 10 characters, letters and digits. Unknown-email logins take the same time as wrong-password logins |
| Brute force | 20 auth attempts / 15 min per IP. Account locks for 15 min after 5 failures |
| Sessions | Random 256-bit token in an **HttpOnly, SameSite=Strict** cookie (Secure in production). Only its SHA-256 is stored. 12 h absolute and 60 min idle expiry. Revoked on logout, password change, suspension and role change |
| CSRF | Per-session token (double-submit cookie) required on every authenticated non-GET request, plus an Origin allow-list check |
| Headers | helmet with a strict CSP (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`). `Cache-Control: no-store` on the API |
| Input | Zod validation on every body and query. Hashes and addresses checked by regex/checksum. Amounts parsed exactly (no floats) |
| RBAC | `USER`, `ADMIN`, `SUPERADMIN`. Admin APIs need an admin role. Wallets, roles, settings, backups and exports need SUPERADMIN. Customer endpoints reject admins |
| Segregation of duties | Admin accounts hold no balances. No actor can approve, credit, reward or review their own account. An account with a balance can't be promoted to admin |
| Balances | Changed only through the ledger service. There is no API that writes a balance directly. Ordinary users have no balance-changing endpoints beyond requests that reserve their own funds |
| Deposits | Verification (automatic, on-chain) is separate from approval (human). Screenshots and claims are never evidence. Unique constraints plus DB triggers prevent double credit |
| Withdrawals | No key handling, no automated signing. Marked complete only after on-chain verification of the exact amount to the exact destination |
| Audit | Every financial and administrative action is written to a hash-chained, append-only audit log (DB triggers block edits and deletes). **Admin → Audit → Verify** recomputes the chain |
| Secrets | RPC URL and any provider key live only in `apps/server/.env` (git-ignored), never in the frontend. The schema has no column for keys or phrases, and a test asserts this |
| Real money | Compliance gate (see COMPLIANCE.md). There is no UI or API switch |

## Wallet secrets

Do not request, accept, store or transmit private keys, seed phrases or recovery phrases, ever. Wallet ownership is proven with an EIP-191 signed message. Signing costs no gas and authorises nothing.

## Known limitations and pre-production work

- **Single-process app on SQLite.** The in-process write queue is correct for one server process. For multiple instances, move to PostgreSQL with SERIALIZABLE transactions and row-level locks.
- **Shared receiving address.** Anyone watching the public address can see incoming transfers and might try to claim someone else's. Admin review, sender history and the one-credit-per-transfer rule mitigate this. The robust fix is per-user deposit addresses from an authorised custodian.
- **No 2FA yet.** Add TOTP/WebAuthn for every admin account before any real use.
- **No four-eyes approval yet.** Consider requiring two different admins for credits, rewards and payouts above a threshold.
- **Prisma 6 CLI advisories.** `npm audit` reports advisories in the Prisma CLI's config tooling (`effect`, `deepmerge-ts`). They affect local migration tooling only, not the runtime client. They are fixed in Prisma 7, which needs driver-adapter changes. Evaluate that upgrade before production.
- **Deployment.** Serve over HTTPS only and set `NODE_ENV=production` (Secure cookies). Put the RPC key in a secret manager. Back up off-machine.
- **Professional review.** Get an independent security assessment and penetration test before handling customer funds.
