# Operations runbook

## Deposits

- **Under review:** the transfer is confirmed on-chain. Before approving, check that the attributed user is the plausible sender. Use the sender address, the sender history, the support ticket and the amount. **Approve & credit** re-verifies on-chain and credits exactly once.
- **Unmatched:** the scanner found a transfer to the receiving address that no one claimed. Attribute it to the right customer with a note recording your evidence, then approve.
- **Wrong attribution:** reject it with a reason. You can then re-attribute the confirmed transfer to the correct customer.
- **Already credited by mistake:** approvals can't be undone. Correct with **Users → Balance management → Debit**, giving a reason.
- **Rejected automatically** (wrong token, wrong destination, reverted, wrong chain): the user sees the reason. Nothing can be credited.

## Withdrawals

1. **Approve.** The request stays reserved. It is **not** paid.
2. Send exactly the requested USDT amount on Ethereum to the destination, from your own treasury wallet, outside this platform.
3. **Record the payout hash.**
4. **Verify on-chain & complete.** This succeeds only when there is a confirmed transfer of the exact amount, with the official token, to that destination.
5. To reject, give a reason (the user sees it). The reserved funds return to the user.

## Staking and rewards

- Plans show an *indicative* rate only. Approving a request moves the funds to *staked*. **End** returns the principal.
- **Allocate reward** shows a suggestion (amount × rate × days / 365), but the amount is your decision. Every reward records the user, amount, currency, date, administrator, description and ledger reference.
- Fix mistakes with **Reverse**. This adds a corrective entry, and the original stays in the history.

## Verifying the client receiving wallet (Bitget Wallet)

1. Super-admin: **Wallets & compliance → Verify ownership** on `0xC9cb644CF3a0BeD41109b04deD765FD58E3bcA94`.
2. Send the generated message to the **wallet owner**. In Bitget Wallet, they use the message-signing feature (personal_sign) with that address.
3. Paste the 132-character `0x…` signature. The server recovers the signer and marks the wallet VERIFIED only if it matches.
4. Activate it. (Real deposits additionally need the compliance gate.)

Never ask for, or accept, a private key or recovery phrase.

## Integrity and backups

- **System → Integrity check:** ledger reconciliation and audit-chain verification. Run it daily.
- **Backups:** **System → Create backup now**, or `npm run db:backup`. Schedule this and copy the backups off-machine.
- **Restore:** stop the server, run `npm run db:restore -- <file>`, then start the server.
- **Export:** `npm run db:export`, or System → Download JSON export.
