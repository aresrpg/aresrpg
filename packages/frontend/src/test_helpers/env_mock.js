import { mock } from 'bun:test'

// bun's module registry is process-global. Keep the two cosmetic suites on one
// complete, immutable env surface so neither can replace the other's factory.
mock.module('../env', () => ({
  ASSETS_URL: 'https://cdn.test',
  RPC_URL: 'http://localhost:3000',
  SPONSOR_URL: '/api/sponsor',
  SENTRY_DSN: '',
  NETWORK: 'testnet',
  UNSAFE_DEV_GAS_MIST: null,
}))
