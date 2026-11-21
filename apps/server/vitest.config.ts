import { defineConfig } from 'vitest/config';

export const testEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./test.db',
  CHAIN_MODE: 'sample',
  CHAIN_ID: '31337',
  MIN_CONFIRMATIONS: '3',
  SCANNER_ENABLED: 'true',
  REAL_DEPOSITS_ENABLED: 'false',
  COMPLIANCE_ATTESTATION_PATH: './tests/.tmp/attestation.json',
  APP_ORIGIN: 'http://localhost:5173',
};

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/live/**', 'node_modules/**'],
    globalSetup: './tests/globalSetup.ts',
    env: testEnv,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
