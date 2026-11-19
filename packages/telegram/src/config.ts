// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/** Strict readers for values that arrive from outside this process: environment JSON and hosted observations. */
export const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response')
  return value as Record<string, any>
}
export const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('invalid_response')
  return value
}
export const integer = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('invalid_response')
  return Number(value)
}

type Env = Readonly<Record<string, string | undefined>>
/** A required variable names itself when absent, so a refused start says which one to set. */
export const setting = (env: Env, name: string) => {
  const value = env[name]
  if (!value) throw new Error(`${name}_required`)
  return value
}
const whole = (value: string | undefined) => (/^\d+$/.test(value ?? '') ? Number(value) : 0)
export const configuration = (env: Env) => {
  const hostname = env.TELEGRAM_BIND_HOST ?? '127.0.0.1'
  if (!['127.0.0.1', '0.0.0.0'].includes(hostname)) throw new Error('invalid_bind_host')
  const port = whole(env.TELEGRAM_LOCAL_PORT)
  const maximum = whole(env.TELEGRAM_MAX_REQUEST_BYTES)
  if (![Boolean(port), port <= 65535, Boolean(maximum), Number.isSafeInteger(maximum)].every(Boolean))
    throw new Error('local_limits_required')
  return {
    hostname,
    port,
    maximum,
    secret: setting(env, 'TELEGRAM_LOCAL_SECRET'),
    redis_url: setting(env, 'TELEGRAM_REDIS_URL'),
  }
}
export const connected_configuration = (env: Env) => {
  const config = object(JSON.parse(setting(env, 'TELEGRAM_CONNECTED_CONFIG')))
  const issuer = text(config.issuer)
  const callback_url = text(config.callback_url)
  if (new URL(callback_url).pathname !== '/oauth/callback') throw new Error('invalid_callback_path')
  return {
    issuer,
    callback_url,
    limits: limits_of(config.limits),
    token: setting(env, 'TELEGRAM_BOT_TOKEN'),
    storage_key: setting(env, 'TELEGRAM_STORAGE_KEY'),
  }
}

type Limits = Readonly<{ proposal_ttl_ms: number; link_ttl_ms: number; request_ms: number }>
export const limits_of = (value: unknown): Limits => {
  const input = object(value)
  const keys = ['proposal_ttl_ms', 'link_ttl_ms', 'request_ms'] as const
  const pairs = keys.map((key) => {
    const value = integer(input[key])
    if (!value) throw new Error('limits_required')
    return [key, value]
  })
  if (Object.keys(input).some((key) => !keys.includes(key as (typeof keys)[number]))) throw new Error('unknown_limit')
  return Object.fromEntries(pairs) as Limits
}
