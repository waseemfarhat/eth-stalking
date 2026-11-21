import { defineConfig } from 'vitest/config';

// Read-only tests against REAL Ethereum mainnet data. No funds are moved; no keys are used.
// Uses LIVE_RPC_URL or a free public endpoint.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    env: { NODE_ENV: 'test', DATABASE_URL: 'file:./test-live.db', CHAIN_MODE: 'sample' },
    testTimeout: 60000,
  },
});
