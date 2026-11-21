# Local real-money test mode

Test the complete flow with **real USDT on Ethereum mainnet** on your own computer. The flow is: deposit to the client's receiving address, on-chain verification, admin approval, then the user's balance updates.

```powershell
npm run local-real
```

Then open **http://localhost:4000**.

## Safety limits (built in)

- Works **only on this computer**. The server listens on `127.0.0.1`, and every request that isn't from this machine is refused: other hostnames, tunnels, proxies, your Wi-Fi address.
- **Refuses to run with `NODE_ENV=production`**, so it can't be turned on for the Render site or any public deployment.
- **Limits:** 100 USDT per deposit and 500 USDT in total by default. To change them, set `LOCAL_REAL_TEST_MAX_DEPOSIT` / `LOCAL_REAL_TEST_MAX_TOTAL` before running.
- Uses a **separate database**, `data/local-real.db`, so practice data never mixes with real money.
- Seeded passwords are printed **the first time only**. Save them.

## One-time setup: verify the receiving wallet

Deposits stay closed until the receiving address is proven correct, so no real money is sent to a wrong address.

1. Sign in as **superadmin** and go to **Wallets & compliance**.
2. Click **Verify ownership** next to `0xC9cb644CF3a0BeD41109b04deD765FD58E3bcA94` and copy the message.
3. The **wallet owner** opens Bitget Wallet, signs the message ("Sign message" / personal_sign), and sends you the signature (`0x…`, 132 characters). **They never share a private key or recovery phrase.**
4. Paste the signature and click **Verify signature**, then **Activate**.

The deposit page now shows the real address.

## Testing a deposit

1. Sign in as **alice** (in a private window) and go to **Deposit**. Send a small amount, e.g. 1–5 USDT (ERC-20), from your own wallet to the address shown.
2. Paste the transaction hash. After 12 confirmations (~3 min) it shows **Under review**.
3. As **admin**, go to **Deposits → Review → Approve & credit**. Alice's balance increases.

## Going live for the public

This mode is not for that. Real deposits from the public require the compliance gate ([COMPLIANCE.md](COMPLIANCE.md)): a licence, KYC/AML and a signed attestation.
