// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const BALANCE_TTL_MS = 5_000

type BalanceEntry = Readonly<{
  at_ms: number
  value: bigint
}>

type BalanceRequest = Readonly<{
  token: object
  promise: Promise<bigint>
}>

export const create_balance_cache = ({
  get_balance,
  now = Date.now,
}: Readonly<{
  get_balance: (address: string) => Promise<bigint>
  now?: () => number
}>) => {
  const entries = new Map<string, BalanceEntry>()
  const in_flight = new Map<string, BalanceRequest>()
  const key_of = (address: string): string => address.trim().toLowerCase()

  const read = (address: string): Promise<bigint> => {
    const key = key_of(address)
    const entry = entries.get(key)
    if (entry && now() - entry.at_ms < BALANCE_TTL_MS) return Promise.resolve(entry.value)
    const pending = in_flight.get(key)
    if (pending) return pending.promise
    const token = Object.freeze({})
    const request = get_balance(key)
      .then((value) => {
        if (in_flight.get(key)?.token === token) entries.set(key, Object.freeze({ at_ms: now(), value }))
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
    invalidate: (address: string): void => {
      const key = key_of(address)
      entries.delete(key)
      in_flight.delete(key)
    },
  })
}

export type BalanceCache = ReturnType<typeof create_balance_cache>
