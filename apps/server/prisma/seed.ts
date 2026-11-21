/**
 * Seed script — creates administrator accounts, demo customers, wallet configuration and
 * sample staking plans. Generated passwords are printed ONCE; store them in a password manager.
 *
 * Safe to re-run: existing records are left untouched.
 */
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth/auth.js';
import { audit } from '../src/audit/audit.js';
import { MAINNET_USDT, SAMPLE_CHAIN_ID, SAMPLE_TOKEN } from '../src/config/env.js';
import { prisma, withTx } from '../src/lib/prisma.js';

const genPassword = () => randomBytes(9).toString('base64url') + '7a';

// Client-provided receiving wallet (Bitget Wallet, USDT ERC-20). Seeded UNVERIFIED and INACTIVE:
// it can only be activated after its owner proves control by signing a challenge message.
const CLIENT_WALLET = '0xC9cb644CF3a0BeD41109b04deD765FD58E3bcA94';
// Sample-mode receiving address: belongs to the simulated chain only. NEVER send real funds to it.
const SAMPLE_WALLET = '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a0001';

async function main() {
  const created: { email: string; role: string; password: string }[] = [];
  const accounts = [
    { email: 'superadmin@ethstalking.local', name: 'Super Administrator', role: 'SUPERADMIN' },
    { email: 'admin@ethstalking.local', name: 'Operations Admin', role: 'ADMIN' },
    { email: 'alice@example.test', name: 'Alice Demo', role: 'USER' },
    { email: 'bob@example.test', name: 'Bob Demo', role: 'USER' },
  ];
  let superId = '';
  for (const a of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: a.email } });
    if (existing) {
      if (a.role === 'SUPERADMIN') superId = existing.id;
      continue;
    }
    const password = process.env.SEED_PASSWORD || genPassword();
    const u = await prisma.user.create({ data: { email: a.email, name: a.name, role: a.role, passwordHash: await hashPassword(password) } });
    if (a.role === 'SUPERADMIN') superId = u.id;
    created.push({ email: a.email, role: a.role, password });
  }

  await withTx(async (tx) => {
    const client = await tx.wallet.findFirst({ where: { chainId: 1, address: CLIENT_WALLET.toLowerCase() } });
    if (!client) {
      const w = await tx.wallet.create({
        data: {
          label: 'Client receiving wallet',
          provider: 'Bitget Wallet',
          currency: 'USDT',
          network: 'ETHEREUM_ERC20',
          chainId: 1,
          address: CLIENT_WALLET.toLowerCase(),
          tokenContract: MAINNET_USDT,
          status: 'UNVERIFIED',
          isActive: false,
          notes: 'Client-provided address. Must be verified by its owner via signed message before activation. Real deposits additionally require the compliance gate.',
          createdById: superId,
        },
      });
      await audit(tx, { actorId: superId, actorRole: 'SYSTEM', action: 'WALLET_SEEDED', entityType: 'Wallet', entityId: w.id, details: { address: w.address, status: 'UNVERIFIED' } });
    }
    const sample = await tx.wallet.findFirst({ where: { chainId: SAMPLE_CHAIN_ID } });
    if (!sample) {
      const w = await tx.wallet.create({
        data: {
          label: 'SAMPLE receiving wallet (simulated chain)',
          provider: 'Sample chain',
          currency: 'USDT',
          network: 'ETHEREUM_ERC20',
          chainId: SAMPLE_CHAIN_ID,
          address: SAMPLE_WALLET.toLowerCase(),
          tokenContract: SAMPLE_TOKEN,
          status: 'VERIFIED',
          isActive: true,
          isSample: true,
          ownershipVerifiedAt: new Date(),
          notes: 'Simulated address for local development. Not a real Ethereum wallet — never send funds to it.',
          createdById: superId,
        },
      });
      await audit(tx, { actorId: superId, actorRole: 'SYSTEM', action: 'WALLET_SEEDED', entityType: 'Wallet', entityId: w.id, details: { address: w.address, sample: true } });
    }

    if ((await tx.stakingPlan.count()) === 0) {
      const plans = [
        { name: 'Flexible 30', description: 'Internal 30-day staking record. Funds are held as an internal platform balance.', durationDays: 30, minAmount: 50_000000n, maxAmount: 10_000_000000n, indicativeRewardBps: 300, rewardRule: 'Administrator may allocate a discretionary reward at or after the end of the term. The indicative rate is not a promise or guarantee.' },
        { name: 'Term 90', description: 'Internal 90-day staking record. Funds are held as an internal platform balance.', durationDays: 90, minAmount: 100_000000n, maxAmount: 50_000_000000n, indicativeRewardBps: 500, rewardRule: 'Administrator may allocate a discretionary reward at or after the end of the term. The indicative rate is not a promise or guarantee.' },
      ];
      for (const p of plans) {
        const plan = await tx.stakingPlan.create({ data: { ...p, createdById: superId } });
        await audit(tx, { actorId: superId, actorRole: 'SYSTEM', action: 'STAKING_PLAN_SEEDED', entityType: 'StakingPlan', entityId: plan.id });
      }
    }
  });

  if (created.length) {
    console.log('\n  Seeded accounts (passwords shown once — save them now):\n');
    for (const c of created) console.log(`   ${c.role.padEnd(10)}  ${c.email.padEnd(32)}  ${c.password}`);
    console.log('');
  } else {
    console.log('  Seed: accounts already exist, nothing to create.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
