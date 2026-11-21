# Legal & compliance gate

Real customer deposits are **disabled by default** and stay disabled until **all four** server-side checks pass:

1. `REAL_DEPOSITS_ENABLED=true` in `apps/server/.env`.
2. `CHAIN_MODE=mainnet` and `CHAIN_ID=1`. Only the official USDT contract is accepted.
3. A complete, unexpired **compliance attestation** file at `COMPLIANCE_ATTESTATION_PATH` (default `compliance/attestation.json`).
4. An **active receiving wallet whose ownership has been proven** by a signed message.

No admin UI setting can enable real deposits. The **Wallets & compliance** page is read-only. While the gate is closed on mainnet:

- the deposit page hides the receiving address and shows "Real deposits are not enabled — do not send funds";
- deposit submissions are refused;
- the background scanner does not run;
- deposit approvals are refused.

## The attestation

Copy `compliance/attestation.example.json` to `compliance/attestation.json` (git-ignored) and complete it. Every field is required. The file must be **completed and signed off by the business's authorised officer and legal counsel**. It records that the business has, at minimum:

- the regulatory **authorisations/licences** required in each jurisdiction where it operates or has customers (for example VASP/CASP registration or licensing, money-transmission or e-money permissions, as applicable);
- **customer due diligence** (KYC/KYB, enhanced due diligence for higher-risk customers) with a named provider and procedure;
- an **AML/CFT** programme with a named compliance officer/MLRO and a written policy;
- **transaction monitoring** and **sanctions screening**, including wallet screening of deposit sources and withdrawal destinations;
- published **customer terms and risk disclosures** that accurately describe internal balances, internal staking records, discretionary rewards and manual withdrawals;
- **safeguarding** of customer assets (segregation and reconciliation) and a plan for shortfalls;
- **record retention** that meets the applicable legal minimums.

The software checks only that the attestation is complete and unexpired. **It cannot determine legal compliance.** That remains the operator's responsibility.

> Note on product terms: offering "staking" or "rewards" on customer deposits may be regulated, for example as a collective investment scheme, a deposit-taking activity, or a security, depending on the jurisdiction. Get legal advice on how these features may be described and offered before launch.

## Enabling (operator checklist)

1. Obtain the authorisations above and complete the attestation.
2. Verify the receiving wallet. The **owner** signs the challenge in Bitget Wallet (Admin → Wallets & compliance → Verify ownership), then a super-admin activates it.
3. Configure a reliable mainnet RPC in `ETH_RPC_URL` and set `CHAIN_MODE=mainnet`, `CHAIN_ID=1`, `REAL_DEPOSITS_ENABLED=true`.
4. Run `npm run test:live` against your RPC and confirm it passes.
5. Restart the server. The startup log prints each gate check.
6. Do a small controlled deposit and full withdrawal round-trip before opening to customers.

Before any public launch, also move to PostgreSQL ([POSTGRES.md](POSTGRES.md)), add admin 2FA, and commission a security review ([SECURITY.md](SECURITY.md)).
