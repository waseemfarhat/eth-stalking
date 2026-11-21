import { Link } from 'react-router-dom';
import { Logo, ModeBanner } from '../../layouts/AppShell';
import { KindTag } from '../../components/ui';

const sections: { kind: Parameters<typeof KindTag>[0]['kind']; title: string; body: string[] }[] = [
  {
    kind: 'onchain',
    title: 'Blockchain-verified deposits',
    body: [
      'Deposits are accepted only as USDT on Ethereum (ERC-20) to the receiving address shown on the deposit page. Sending any other token or using any other network may result in permanent loss.',
      'The receiving address is shared by all customers. After sending, you must submit your transaction hash so it can be attributed to your account.',
      'A deposit is credited only after (1) the transfer is independently verified on-chain with the required number of confirmations, and (2) an administrator approves the attribution to your account. Screenshots or claims are never accepted as proof.',
      'Each on-chain transfer can be credited to exactly one account.',
    ],
  },
  {
    kind: 'internal',
    title: 'Internal balances',
    body: [
      'Your balance is an internal record in the platform ledger. It is not a separate on-chain wallet held in your name, and you do not hold the private keys to platform funds.',
      'Every change to your balance is recorded as a ledger entry that you can view and export. Administrators may lock, unlock, credit or debit balances only with a recorded reason, which you can see.',
    ],
  },
  {
    kind: 'staking',
    title: 'Internal staking records',
    body: [
      'Staking on this platform is an internal record managed by administrators. It is NOT Ethereum proof-of-stake staking, nothing is staked on-chain, and no protocol rewards are earned.',
      'While a staking record is active, the amount is held in your internal "staked" balance and cannot be withdrawn until the record ends.',
      'Plans may show an indicative rate. This is not a promise, offer, or guarantee of any return.',
    ],
  },
  {
    kind: 'reward',
    title: 'Administrator-allocated rewards',
    body: [
      'Rewards are discretionary allocations made manually by administrators. They are not automatically generated, not profits from an investment, and not guaranteed in amount or timing.',
      'Incorrect allocations may be reversed with a visible corrective ledger entry.',
    ],
  },
  {
    kind: 'payout',
    title: 'Withdrawals',
    body: [
      'Withdrawal requests reserve the amount from your available balance and are reviewed manually. An approved request is NOT yet paid.',
      'A withdrawal is marked paid only after the payout transaction has been recorded and independently verified on-chain. Rejected requests show a reason and the reserved amount is returned to your available balance.',
    ],
  },
];

export function Terms() {
  return (
    <div className="min-h-full">
      <ModeBanner />
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link to="/" className="mb-8 inline-block">
          <Logo />
        </Link>
        <h1 className="text-3xl font-semibold text-white">Terms & risk disclosures</h1>
        <p className="mt-2 text-sm text-slate-400">Please read carefully. These explain what each figure on the platform represents.</p>
        <div className="mt-8 space-y-5">
          {sections.map((s) => (
            <section key={s.title} className="card p-6">
              <div className="mb-3 flex items-center gap-3">
                <KindTag kind={s.kind} />
                <h2 className="font-semibold text-white">{s.title}</h2>
              </div>
              <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-300">
                {s.body.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </section>
          ))}
          <section className="card border-rose-500/20 p-6">
            <h2 className="mb-3 font-semibold text-white">General risks</h2>
            <p className="text-sm leading-relaxed text-slate-300">
              Digital assets are volatile and carry a risk of total loss. Blockchain transactions are irreversible. The platform operator holds deposited funds; your claim is against the operator as recorded in the internal ledger. Real-money deposits are only enabled once the operator has documented the required regulatory authorisations and AML/CFT controls.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
