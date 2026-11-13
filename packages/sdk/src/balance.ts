// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const BALANCE_TTL_MS = 5_000

type BalanceEntry = Readonly<{
  sampled_at_ms: number
  at_ms: number
  value: bigint
}>

type BalanceRequest = Readonly<{
  token: object
  promise: Promise<bigint>
}>

export const create_balance_cache = ({
  get_balance,
  now = () => performance.now(),
}: Readonly<{
  get_balance: (address: string) => Promise<bigint>
  now?: () => number
}>) => {
  const entries = new Map<string, BalanceEntry>()
  const in_flight = new Map<string, BalanceRequest>()
  const key_of = (address: string): string => address.trim().toLowerCase()

  const read = (address: string): Promise<bigint> => {
    if (!address) throw new Error('[sdk] balance reads need an address')
    const key = key_of(address)
    const entry = entries.get(key)
    if (entry && now() - entry.at_ms < BALANCE_TTL_MS) return Promise.resolve(entry.value)
    const pending = in_flight.get(key)
    if (pending) return pending.promise
    const token = Object.freeze({})
    const sampled_at_ms = now()
    const request = get_balance(key)
      .then((value) => {
        if (in_flight.get(key)?.token === token) entries.set(key, Object.freeze({ sampled_at_ms, at_ms: now(), value }))
        return value
      })
      .finally(() => {
        if (in_flight.get(key)?.token === token) in_flight.delete(key)
      })
    in_flight.set(key, Object.freeze({ token, promise: request }))
    return request
  }

  return Object.freeze({
    read,
    read_snapshot: async (address: string) => {
      await read(address)
      const entry = entries.get(key_of(address))
      if (!entry) return null // Invalidated while the read was in flight.
      return {
        address: key_of(address),
        balance_mist: entry.value.toString(),
        sampled_at_ms: entry.sampled_at_ms,
        expires_at_ms: entry.sampled_at_ms + BALANCE_TTL_MS,
      }
    },
    invalidate: (address: string): void => {
      const key = key_of(address)
      entries.delete(key)
      in_flight.delete(key)
    },
  })
}

export type BalanceCache = ReturnType<typeof create_balance_cache>
