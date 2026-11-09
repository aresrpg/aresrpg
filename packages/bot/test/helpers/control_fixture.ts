// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import type { Bot, BotConfig } from '../../src/model.ts'
import { has_pending_work, type ControlStore } from '../../src/store.ts'

/** Disposable test store with rollback and serialization, never a production fallback. */
export const memory_store = (): ControlStore => {
  let records = new Map<string, unknown>()
  let pending: Promise<unknown> = Promise.resolve()
  return {
    read: async <T>(key: string) => structuredClone(records.get(key) as T | undefined) ?? null,
    scan_pending: async (limit, after = '') =>
      [...records.entries()]
        .filter(([key, value]) => key > after && has_pending_work(key, value))
        .map(([key]) => key)
        .sort()
        .slice(0, limit),
    scan_keys: async (prefix, limit, after = '') =>
      [...records.keys()]
        .filter((key) => key.startsWith(prefix) && key > after)
        .sort()
        .slice(0, limit),
    transaction: (keys, operation) => {
      const result = pending.then(async () => {
        const next = structuredClone(records)
        const check = (key: string) => {
          if (!keys.includes(key)) throw new Error('unlocked fixture key')
        }
        const value = await operation({
          get: async <T>(key: string) => {
            check(key)
            return structuredClone(next.get(key) as T | undefined) ?? null
          },
          put: async (key, item) => {
            check(key)
            next.set(key, structuredClone(item))
          },
        })
        records = next
        return value
      })
      pending = result.then(
        () => undefined,
        () => undefined
      )
      return result
    },
  }
}
export const fixture_google = toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false })
export const fixture_config: BotConfig = {
  issuer: 'https://bot.example.test',
  resource: 'https://bot.example.test/mcp',
  web_origin: 'https://game.example.test',
  network: 'mainnet',
  authority_generation: 'fixture-generation',
  recovery_mode: false,
  observation_freshness_ms: 60000,
  request_ttl_ms: 300000,
  challenge_ttl_ms: 60000,
  code_ttl_ms: 30000,
  access_ttl_ms: 10000,
  refresh_ttl_ms: 300000,
  max_body_bytes: 8192,
  max_redirect_uris: 3,
  scopes: ['bot:observe', 'bot:play', 'bot:pause'],
}
export const fixture_bot: Bot = {
  id: 'fixture-bot',
  owner: fixture_google.toSuiAddress(),
  zklogin_public_identifier: fixture_google.toBase64(),
  network: 'mainnet',
  address: `0x${'a'.repeat(64)}`,
  multisig_public_key: 'fixture-public-descriptor',
  key_id: 'fixture-never-funded',
  generation: 1,
  status: 'ready',
  policy: { revision: 1, scopes: fixture_config.scopes },
}
export const put = (store: ControlStore, key: string, value: unknown) =>
  store.transaction([key], (tx) => tx.put(key, value))
