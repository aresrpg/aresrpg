// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { BotConfig } from './model.ts'

/** Source-owned operational defaults; explicit deployment overrides remain validated. */
export const DEPLOYMENT_DEFAULTS: Readonly<Record<string, number>> = Object.freeze({
  BOT_PORT: 3000,
  BOT_OBSERVATION_FRESHNESS_MS: 15000,
  BOT_REQUEST_TTL_MS: 600000,
  BOT_CHALLENGE_TTL_MS: 300000,
  BOT_CODE_TTL_MS: 60000,
  BOT_ACCESS_TTL_MS: 900000,
  BOT_REFRESH_TTL_MS: 7776000000,
  BOT_MAX_BODY_BYTES: 65536,
  BOT_MAX_REDIRECT_URIS: 5,
  BOT_LEASE_MS: 30000,
  BOT_HEARTBEAT_MS: 10000,
  BOT_TICK_MS: 1000,
  BOT_EVENT_LIMIT: 256,
  BOT_SCAN_LIMIT: 100,
})

export const deployment_value = (env: Readonly<Record<string, string | undefined>>, name: string) => {
  const value = env[name]
  if (!value) throw new Error(`Missing required deployment setting: ${name}`)
  return value
}
export const deployment_integer = (env: Readonly<Record<string, string | undefined>>, name: string) => {
  const value = Number(
    env[name] === undefined && Object.hasOwn(DEPLOYMENT_DEFAULTS, name)
      ? DEPLOYMENT_DEFAULTS[name]
      : deployment_value(env, name)
  )
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Invalid positive integer deployment setting: ${name}`)
  return value
}
const https_origin = (value: string) => {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.origin !== value) throw new Error('Deployment requires canonical HTTPS origin')
  return value
}
export const read_config = (env: Readonly<Record<string, string | undefined>>): BotConfig => {
  const issuer = https_origin(deployment_value(env, 'BOT_ISSUER'))
  const recovery = deployment_value(env, 'BOT_RECOVERY_MODE')
  if (!['true', 'false'].includes(recovery)) throw new Error('BOT_RECOVERY_MODE must be explicit')
  return {
    issuer,
    resource: `${issuer}/mcp`,
    web_origin: https_origin(deployment_value(env, 'BOT_WEB_ORIGIN')),
    network: 'mainnet',
    authority_generation: deployment_value(env, 'BOT_AUTHORITY_GENERATION'),
    recovery_mode: recovery === 'true',
    observation_freshness_ms: deployment_integer(env, 'BOT_OBSERVATION_FRESHNESS_MS'),
    request_ttl_ms: deployment_integer(env, 'BOT_REQUEST_TTL_MS'),
    challenge_ttl_ms: deployment_integer(env, 'BOT_CHALLENGE_TTL_MS'),
    code_ttl_ms: deployment_integer(env, 'BOT_CODE_TTL_MS'),
    access_ttl_ms: deployment_integer(env, 'BOT_ACCESS_TTL_MS'),
    refresh_ttl_ms: deployment_integer(env, 'BOT_REFRESH_TTL_MS'),
    max_body_bytes: deployment_integer(env, 'BOT_MAX_BODY_BYTES'),
    max_redirect_uris: deployment_integer(env, 'BOT_MAX_REDIRECT_URIS'),
    scopes: ['bot:observe', 'bot:play', 'bot:pause'],
  }
}
