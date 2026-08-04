// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mock } from 'bun:test'

// bun's module registry is process-global. Keep the two cosmetic suites on one
// complete, immutable env surface so neither can replace the other's factory.
export const ENV_MOCK = Object.freeze({
  ASSETS_URL: 'https://cdn.test',
  RPC_URL: 'http://localhost:3000',
  SPONSOR_URL: '/api/sponsor',
  RELAY_URL: 'ws://relay.test/mqtt',
  STUN_URL: 'stun:stun.test:3478',
  STUN_FALLBACK_URL: '',
  TURN_URL: '',
  TURN_USER: '',
  TURN_CRED: '',
  SENTRY_DSN: '',
  NETWORK: 'testnet',
  DEPLOY_ENV: '', // a test build has no deploy target — the same state as a local build

  UNSAFE_DEV_GAS_MIST: null,
})

mock.module('../env', () => ENV_MOCK)
