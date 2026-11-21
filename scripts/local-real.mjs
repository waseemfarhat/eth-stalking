// npm run local-real — LOCAL REAL-MONEY TEST MODE (your own computer only).
//
// - Real Ethereum mainnet + official USDT; deposits to the verified receiving wallet are
//   verified on-chain and credited after admin approval.
// - Separate database (data/local-real.db) so practice data never mixes with real money.
// - Server listens on 127.0.0.1 only and rejects any request not from this computer.
// - Capped: LOCAL_REAL_TEST_MAX_DEPOSIT per deposit, LOCAL_REAL_TEST_MAX_TOTAL in total.
// - Refuses to run with NODE_ENV=production.
import { spawn, spawnSync } from 'node:child_process';

const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: process.env.PORT || '4000',
  HOST: '127.0.0.1',
  APP_ORIGIN: `http://localhost:${process.env.PORT || '4000'}`,
  DATABASE_URL: 'file:../../../data/local-real.db',
  CHAIN_MODE: 'mainnet',
  CHAIN_ID: '1',
  TOKEN_CONTRACT: '',
  ETH_RPC_URL: process.env.LOCAL_REAL_RPC_URL || 'https://ethereum-rpc.publicnode.com',
  MIN_CONFIRMATIONS: process.env.MIN_CONFIRMATIONS || '12',
  LOCAL_REAL_TEST: 'true',
  LOCAL_REAL_TEST_MAX_DEPOSIT: process.env.LOCAL_REAL_TEST_MAX_DEPOSIT || '100',
  LOCAL_REAL_TEST_MAX_TOTAL: process.env.LOCAL_REAL_TEST_MAX_TOTAL || '500',
  SCANNER_BLOCK_CHUNK: '500',
};

const run = (args, label) => {
  console.log(`\n▶ ${label}`);
  const r = spawnSync(npm, args, { stdio: 'inherit', shell: win, env });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run(['run', 'build', '-w', 'apps/web'], 'Building web app');
run(['exec', '-w', 'apps/server', '--', 'prisma', 'migrate', 'deploy'], 'Preparing local real-money database (data/local-real.db)');
run(['run', 'db:seed', '-w', 'apps/server'], 'Seeding accounts (passwords are printed only the first time)');

console.log('\n▶ Starting server on http://localhost:' + env.PORT + '  (this computer only)\n');
const server = spawn(npm, ['run', 'start', '-w', 'apps/server'], { stdio: 'inherit', shell: win, env });
server.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => server.kill());
