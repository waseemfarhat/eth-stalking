import { createApp } from './app.js';
import { chainConfig, env } from './config/env.js';
import { complianceStatus } from './config/compliance.js';
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

  const gate = await complianceStatus();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`\n  ETH STALKING API  →  http://localhost:${env.PORT}`);
    console.log(`  Chain mode: ${cfg.mode.toUpperCase()} (chain id ${cfg.chainId})`);
    console.log(`  Real deposits: ${gate.realDepositsEnabled ? 'ENABLED' : 'DISABLED'}`);
    for (const c of gate.checks) console.log(`    [${c.ok ? 'x' : ' '}] ${c.label} — ${c.detail}`);
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
