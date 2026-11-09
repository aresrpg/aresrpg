// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { DEPLOYMENT_DEFAULTS, deployment_integer, read_config } from '../src/config.ts'

const env = {
  BOT_ISSUER: 'https://bot.example',
  BOT_WEB_ORIGIN: 'https://game.example',
  BOT_AUTHORITY_GENERATION: 'fixture',
  BOT_RECOVERY_MODE: 'false',
  BOT_REFRESH_TTL_MS: '86400000',
}

test('one service uses source-owned tuning defaults while keeping authority explicit', () => {
  expect(read_config(env)).toMatchObject({
    observation_freshness_ms: 15000,
    request_ttl_ms: 600000,
    challenge_ttl_ms: 300000,
    code_ttl_ms: 60000,
    access_ttl_ms: 900000,
    refresh_ttl_ms: 86400000,
    max_body_bytes: 65536,
    max_redirect_uris: 5,
    recovery_mode: false,
  })
  expect(DEPLOYMENT_DEFAULTS.BOT_HEARTBEAT_MS).toBeLessThan(DEPLOYMENT_DEFAULTS.BOT_LEASE_MS!)
  expect(deployment_integer({}, 'BOT_PORT')).toBe(3000)
  expect(read_config({ ...env, BOT_REFRESH_TTL_MS: undefined }).refresh_ttl_ms).toBe(90 * 24 * 60 * 60 * 1000)
  expect(() => read_config({ ...env, BOT_AUTHORITY_GENERATION: undefined })).toThrow('BOT_AUTHORITY_GENERATION')
  expect(() => read_config({ ...env, BOT_RECOVERY_MODE: undefined })).toThrow('BOT_RECOVERY_MODE')
})

test('operator overrides remain effective and malformed values do not silently fall back', () => {
  expect(read_config({ ...env, BOT_ACCESS_TTL_MS: '10000' }).access_ttl_ms).toBe(10000)
  for (const invalid of ['', '0', '-1', '1.5', 'NaN'])
    expect(() => deployment_integer({ BOT_PORT: invalid }, 'BOT_PORT')).toThrow()
  expect(() => read_config({ ...env, BOT_ISSUER: 'http://insecure.example' })).toThrow()
})
