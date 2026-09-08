// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SuiGrpcClient } from '@mysten/sui/grpc'

import logger from './logger.ts'

const log = logger(import.meta)
export type ResolveName = (address: string) => Promise<string | null>
type NameClient = Pick<SuiGrpcClient, 'defaultNameServiceName' | 'resolveNameServiceAddress'>

const verified_name = async (client: NameClient, address: string): Promise<string | null> => {
  const signal = AbortSignal.timeout(2_000)
  const {
    data: { name },
  } = await client.defaultNameServiceName({ address, signal })
  if (!name) return null
  const target = await client.resolveNameServiceAddress({ name, signal })
  return target.address === address ? name : null
}

/** One network-bound resolver per server process. Names are disposable display enrichment. */
export const create_suins_resolver = ({
  client,
  now = Date.now,
  capacity = 2_000,
  concurrency = 8,
}: Readonly<{ client: NameClient; now?: () => number; capacity?: number; concurrency?: number }>): ResolveName => {
  const cache = new Map<string, Readonly<{ name: string | null; expires: number }>>()
  const pending = new Map<string, Promise<string | null>>()
  const waiting = new Set<() => void>()
  let active = 0

  const remember = (address: string, name: string | null, ttl_ms: number): void => {
    cache.delete(address)
    cache.set(address, { name, expires: now() + ttl_ms })
    if (cache.size > capacity) cache.delete(cache.keys().next().value!)
  }

  const lookup = async (address: string): Promise<string | null> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.add(resolve))
    else active++
    try {
      const verified = await verified_name(client, address)
      remember(address, verified, verified ? 300_000 : 60_000)
      return verified
    } catch (error) {
      log.warn({ address, error: error instanceof Error ? error.message : String(error) }, 'SuiNS lookup failed')
      remember(address, null, 10_000)
      return null
    } finally {
      const next = waiting.values().next().value
      if (next) {
        waiting.delete(next)
        next()
      } else active--
    }
  }

  return (address) => {
    const key = address.toLowerCase()
    const cached = cache.get(key)
    if (cached && cached.expires > now()) {
      cache.delete(key)
      cache.set(key, cached)
      return Promise.resolve(cached.name)
    }
    cache.delete(key)
    const existing = pending.get(key)
    if (existing) return existing
    const request = lookup(key).finally(() => pending.delete(key))
    pending.set(key, request)
    return request
  }
}
