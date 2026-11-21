# ETH STALKING

USDT (Ethereum ERC-20) deposit verification with an administrator-managed internal ledger: balances, internal staking records, discretionary rewards and manual withdrawals. Everything is auditable.

> **Real deposits are disabled by default.** The app runs locally on a simulated **sample chain** (or the Sepolia testnet) until the legal and compliance gate in [docs/COMPLIANCE.md](docs/COMPLIANCE.md) is satisfied. Never send real funds while you are developing.

## Quick start (Windows / macOS / Linux)

Requires Node.js 20+.

```bash
npm run setup      # install, migrate the SQLite DB, seed accounts (passwords are printed once)
npm run dev        # API on http://localhost:4000 + web on http://localhost:5173
```

On Windows you can also run `start.ps1`. On macOS/Linux, run `./start.sh`.

Production-style local run, a single origin with no Vite dev server: `npm start`, then open http://localhost:4000.

### Seeded accounts

| Role | Email |
|---|---|
| SUPERADMIN | superadmin@ethstalking.local |
| ADMIN | admin@ethstalking.local |
| USER | alice@example.test |
| USER | bob@example.test |

Passwords are random and printed by the seed script. To reseed: `npm run db:reset` (development only; it backs up first). Set `SEED_PASSWORD=...` to choose one password for all accounts.

### Try the full flow in sample mode

1. Sign in as **superadmin** and go to **System → Sample chain**. Create a sample transfer of 100 USDT and copy its hash.
2. Sign in as **alice** (in another browser profile) and go to **Deposit**. Paste the hash. It shows *awaiting confirmations*.
3. As admin, click **Mine 12 blocks** and then **Run scanner & confirmations**. The deposit moves to *Under review*.
4. Go to **Admin → Deposits → Review**. Click **Approve & credit**. Alice's internal balance is now 100.
5. Try staking, rewards and withdrawals. To complete a withdrawal payout, create a sample transfer *to the withdrawal destination* for the exact amount. Record its hash, mine blocks, then click **Verify on-chain**.

### Test with real USDT (read-only)

**Admin → Real network check** connects to real Ethereum mainnet. It shows the receiving wallet's real USDT balance, scans for real incoming transfers, and verifies any real transaction hash using the same verifier as deposits. It never credits an account and does not open customer deposits. Send 1–2 USDT (ERC-20) from another wallet you own, paste the hash, and wait for 12 confirmations.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | API (watch mode) and web dev server |
| `npm start` | Build the web app and serve everything from the API on :4000 |
| `npm test` | Full backend test suite (74 tests, isolated test DB, sample chain) |
| `npm run test:live` | **Read-only** checks against real Ethereum mainnet data (no funds, no keys) |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Seed accounts, wallets and plans (idempotent) |
| `npm run db:backup` | Consistent SQLite snapshot into `backups/` (safe while running) |
| `npm run db:restore -- <file>` | Restore a backup. **Stop the server first.** The current DB is saved as `pre-restore-*.db` |
| `npm run db:export` | Portable JSON export of every table into `exports/` |
| `npm run db:import -- <file>` | Import a JSON export into an **empty** migrated database (e.g. PostgreSQL) |
| `npm run db:reset` | Development only: back up, recreate and reseed |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture, folder structure, data model, ledger and blockchain design
- [docs/SECURITY.md](docs/SECURITY.md): security controls and threat notes
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md): the real-deposit gate and how it is enabled
- [docs/OPERATIONS.md](docs/OPERATIONS.md): admin runbook (deposits, attribution, withdrawals, wallet verification, backups)
- [docs/POSTGRES.md](docs/POSTGRES.md): moving from SQLite to PostgreSQL

## What is and isn't verified

- The deposit/payout verifier and the RPC provider were tested against **real mainnet USDT transfers** with `npm run test:live`. This is a read-only check that picks a recent real transfer and verifies chain ID, status, official contract, destination, amount and confirmations.
- **The client's receiving wallet has not been verified or activated.** It is seeded as `UNVERIFIED` and inactive. Its owner must sign a challenge message (see OPERATIONS.md).
- Continuous mainnet monitoring of the receiving wallet (the scanner) uses the same code path, but by design it stays idle until the compliance gate is open. It has not been run against the live receiving address.
