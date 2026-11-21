# Architecture

```
apps/web  (React 19 · Vite · TS · Tailwind 4 · Recharts · Lucide · React Router)
   │  REST, same-origin, HttpOnly session cookie + CSRF header
   ▼
apps/server  (Node · Express 5 · TS · Zod · Prisma 6)
   ├─ auth/          argon2id passwords, DB sessions, RBAC, CSRF
   ├─ middleware/    helmet/CSP, Origin check, rate limits, validation, errors
   ├─ ledger/        double-entry ledger, the ONLY code that changes balances
   ├─ modules/       deposits, staking, rewards, withdrawals, admin, user, public routes
   ├─ chain/         provider interface · RPC provider · sample provider · pure verifier · ownership proofs
   ├─ config/        env validation, chain safety checks, compliance gate, settings
   ├─ audit/         append-only, SHA-256 hash-chained audit log
   └─ jobs/          confirmation tracking + receiving-wallet scanner
   ▼
SQLite (data/app.db) via Prisma, PostgreSQL-ready
```

## Folder structure

```
apps/server/
  prisma/schema.prisma          data model
  prisma/migrations/            SQL migrations (incl. immutability triggers)
  prisma/seed.ts                accounts, wallets, plans
  scripts/                      backup / restore / export / import / reset
  src/…                         see above
  tests/                        vitest + supertest (sample chain, isolated DB)
  tests/live/                   read-only mainnet tests
apps/web/src/
  api/ lib/ components/ layouts/
  pages/public | pages/user | pages/admin
docs/  data/  backups/  exports/  compliance/
```

## Money and the ledger

- Every amount is stored as a **BigInt in USDT base units** (6 decimals). Integer arithmetic is exact on both SQLite and PostgreSQL. Prisma's `Decimal` type on SQLite can silently lose precision. The API sends amounts as exact decimal strings, and the UI never adds them up with floating point.
- **Double entry.** Each movement is one `Transaction` (a journal entry with a unique `reference`, which is the idempotency key) with two or more `LedgerEntry` legs that sum to zero.
- **User accounts** (`AVAILABLE`, `LOCKED`, `PENDING` = reserved for requests, `STAKED`) can never go negative. This is enforced with an atomic guarded decrement.
- **Platform counterpart accounts** show where money came from:

| Platform account | Meaning (sign) |
|---|---|
| `DEPOSIT_CLEARING` | − total verified deposits credited |
| `REWARD_FUNDING` | − total discretionary rewards allocated |
| `ADJUSTMENTS` | ± manual admin credits/debits |
| `WITHDRAWAL_PAYOUTS` | + total paid out on-chain |

  This makes *"liabilities created without on-chain funds"* visible: rewards plus credits. The admin overview compares the receiving wallet's real on-chain USDT balance against total user liabilities (the **reserve check**).
- `LedgerAccount.balance` is a cache. It is updated only inside the same DB transaction as the ledger entries, and **Admin → System → Integrity check** recomputes it.
- `LedgerEntry`, `Transaction` and `AuditLog` are **append-only**: SQLite triggers abort any UPDATE or DELETE. A credited `Deposit`'s credit fields are also frozen by a trigger.
- All money-moving work runs in `withTx()`. That is an interactive Prisma transaction, serialised in-process, so read-check-write sequences can't race on SQLite's single writer. On PostgreSQL, use SERIALIZABLE transactions plus row locks.

### Movements

| Action | Legs |
|---|---|
| Deposit approved | DEPOSIT_CLEARING −x → user AVAILABLE +x |
| Admin credit / debit | ADJUSTMENTS ↔ user AVAILABLE |
| Admin lock / unlock | AVAILABLE ↔ LOCKED |
| Staking request → approve → end | AVAILABLE→PENDING → STAKED → AVAILABLE (reject/cancel: PENDING→AVAILABLE) |
| Reward / reversal | REWARD_FUNDING ↔ user AVAILABLE |
| Withdrawal request → paid | AVAILABLE→PENDING → WITHDRAWAL_PAYOUTS (reject/cancel: PENDING→AVAILABLE) |

## Database models

`User`, `Session`, `Wallet`, `BlockchainTransaction`, `Deposit`, `Withdrawal`, `StakingPlan`, `StakingRecord`, `Reward`, `Transaction` (journal), `LedgerEntry`, `LedgerAccount`, `Notification`, `AuditLog`, `PlatformSetting`.

Key uniqueness guarantees:

- `BlockchainTransaction (chainId, txHash, logIndex)`: one row per on-chain transfer log.
- `Deposit.blockchainTxId`: one deposit per transfer.
- `Deposit.creditRef` = `chainId:txHash:logIndex`, and `Transaction.reference` = `DEPOSIT_CREDIT:<creditRef>`. A transfer can be credited **once**, to **one** account.
- `Withdrawal.payoutTxHash`: a payout tx settles exactly one withdrawal, and it cannot reuse a deposit hash.

## Blockchain integration

`ChainProvider` interface (`getChainId`, `getBlockNumber`, `lookupTransaction`, `findTransfersTo`, `getTokenBalance`):

- **RpcChainProvider** (ethers v6 JSON-RPC) for `sepolia` and `mainnet`. On every check it asks the node for its `eth_chainId` and refuses to verify if it doesn't match the configured chain.
- **SampleChainProvider**: a simulated chain (id 31337, its own token address) persisted to `data/sample-chain.json`. Blocks advance every 12 s and can be mined on demand. Sample transactions can never pass mainnet verification.

`verifyTransfer()` is a **pure function** (fully unit-tested). Its outcomes are:

- **Waiting, not terminal:** `NOT_FOUND`, `PENDING`, `INSUFFICIENT_CONFIRMATIONS`.
- **Terminal failures:** `WRONG_CHAIN`, `FAILED` (reverted), `NO_TRANSFER`, `INVALID_TOKEN` (not the configured contract), `WRONG_DESTINATION`, `AMOUNT_MISMATCH` (payouts).
- **Success:** `CONFIRMED`.

Each check stores a snapshot of the result in `BlockchainTransaction.verification`. **Approval re-verifies on-chain right before crediting.**

**Mainnet safety:** `CHAIN_MODE=mainnet` requires `CHAIN_ID=1`. It only accepts the official Tether contract `0xdAC17F958D2ee523a2206206994597C13D831ec7` with 6 decimals, and it won't start if the RPC reports another chain.

### Deposit attribution (shared receiving address)

The status flow is `SUBMITTED → AWAITING_VERIFICATION / AWAITING_CONFIRMATIONS → VERIFIED → UNDER_REVIEW → APPROVED | REJECTED`. The history of every step is stored and shown to the user.

- **User-submitted hash:** verified independently, then held *Under review* for an admin to approve.
- **Scanner:** detects incoming transfers nobody has claimed. They are listed as **Unmatched** for an admin to attribute. A user can also claim one by submitting its hash, but it still needs approval.
- **Re-attribution:** admins can re-attribute a confirmed but uncredited deposit, including one rejected for wrong attribution.
- **Sender history:** the admin review shows earlier approved deposits from the same sender address, as a hint.
- **Future:** per-user deposit addresses through an authorised custody provider fit behind the same `Wallet` + `BlockchainTransaction` model. Add a `DepositAddress` table (userId ↔ address) and attribute automatically by destination. Approval and the ledger are unchanged.
