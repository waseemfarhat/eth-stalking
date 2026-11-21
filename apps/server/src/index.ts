import { createApp } from './app.js';
import { chainConfig, env } from './config/env.js';
import { complianceStatus, localRealTestActive, localRealTestLimits } from './config/compliance.js';
import { startChainJobs, stopChainJobs } from './jobs/chainJobs.js';
import { prisma } from './lib/prisma.js';
import { getChainProvider } from './chain/service.js';

async function main() {
  const cfg = chainConfig(); // throws on unsafe chain configuration
  await prisma.$connect();

  if (cfg.mode !== 'sample') {
    const p = getChainProvider();
    const id = await p.getChainId();
    if (id !== cfg.chainId) throw new Error(`ETH_RPC_URL is on chain ${id} but CHAIN_ID is ${cfg.chainId}. Refusing to start.`);
  }

  if (env.LOCAL_REAL_TEST && env.NODE_ENV === 'production') {
    throw new Error('LOCAL_REAL_TEST cannot be used with NODE_ENV=production. Local real-money test mode is for your own computer only.');
  }
  const localTest = localRealTestActive();
  // Local real-money test mode never listens on a network interface.
  const host = localTest ? '127.0.0.1' : env.HOST;

  const gate = await complianceStatus();
  const app = createApp();
  const server = app.listen(env.PORT, host, () => {
    console.log(`\n  ETH STALKING API  →  http://localhost:${env.PORT}`);
    console.log(`  Chain mode: ${cfg.mode.toUpperCase()} (chain id ${cfg.chainId})`);
    if (localTest) {
      const lim = localRealTestLimits();
      console.log('  LOCAL REAL-MONEY TEST MODE — real USDT on Ethereum mainnet, this computer only (127.0.0.1)');
      console.log(`  Limits: ${Number(lim.maxDeposit) / 1e6} USDT per deposit, ${Number(lim.maxTotal) / 1e6} USDT total`);
    } else {
      console.log(`  Real deposits: ${gate.realDepositsEnabled ? 'ENABLED' : 'DISABLED'}`);
      for (const c of gate.checks) console.log(`    [${c.ok ? 'x' : ' '}] ${c.label} — ${c.detail}`);
    }
    console.log('');
  });

  startChainJobs();

  const shutdown = async () => {
    stopChainJobs();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
