// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { receipt_digest_or_null, type Receipt } from './cache.ts'

const WINDOW_MS = 24 * 60 * 60 * 1_000
const STORAGE_PREFIX = 'aresrpg:sdk:gas:24h'

type StorageLike = Readonly<Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>>
type Entry = Readonly<{ digest: string; at: number; mist: string; scopes: readonly string[] }>

const browser_storage = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch (error) {
    console.warn('Browser storage is unavailable; gas history will remain in memory only.', error)
    return null
  }
}

const gas_used_of = (receipt: Receipt) =>
  receipt.Transaction?.effects?.gasUsed ??
  receipt.FailedTransaction?.effects?.gasUsed ??
  receipt.effects?.gasUsed ??
  null

const gas_summary_from_receipt = (receipt: Receipt) => {
  const gas = gas_used_of(receipt)
  if (!gas) return null
  try {
    const computation = BigInt(gas.computationCost ?? 0)
    const storage = BigInt(gas.storageCost ?? 0)
    const rebate = BigInt(gas.storageRebate ?? 0)
    return Object.freeze({ computation, storage, rebate, net: computation + storage - rebate })
  } catch (error) {
    console.warn('A transaction receipt carried invalid gas values.', error)
    return null
  }
}

export const gas_mist_from_receipt = (receipt: Receipt): bigint | null => gas_summary_from_receipt(receipt)?.net ?? null

const sui_from_mist = (mist: bigint): string => {
  const negative = mist < 0n
  const absolute = negative ? -mist : mist
  const fraction = String(absolute % 1_000_000_000n)
    .padStart(9, '0')
    .replace(/0+$/, '')
  return `${negative ? '-' : ''}${absolute / 1_000_000_000n}${fraction ? `.${fraction}` : ''}`
}

export const log_transaction_receipt = (receipt: Receipt): void => {
  const digest = receipt_digest_or_null(receipt)
  const gas = gas_summary_from_receipt(receipt)
  if (!digest || !gas) return
  const failed =
    receipt.$kind === 'FailedTransaction' ||
    receipt.FailedTransaction !== undefined ||
    receipt.Transaction?.effects?.status?.success === false ||
    receipt.effects?.status?.success === false
  console.log('%c tx ', 'color:#ff5a8b;font-weight:700', digest, `${sui_from_mist(gas.net)} SUI`, {
    status: failed ? 'failed' : 'success',
    net_sui: sui_from_mist(gas.net),
    computation_sui: sui_from_mist(gas.computation),
    storage_sui: sui_from_mist(gas.storage),
    rebate_sui: sui_from_mist(gas.rebate),
  })
}

const valid_entries = (value: unknown, cutoff: number): readonly Entry[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): readonly Entry[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const { digest, at, mist, scopes } = candidate as Record<string, unknown>
    if (typeof digest !== 'string' || !Number.isInteger(at) || Number(at) < cutoff) return []
    if (typeof mist !== 'string' || !/^-?\d+$/.test(mist)) return []
    return [
      {
        digest,
        at: Number(at),
        mist: BigInt(mist).toString(),
        scopes: Object.freeze(
          Array.isArray(scopes) ? scopes.filter((scope): scope is string => typeof scope === 'string') : []
        ),
      },
    ]
  })
}

export const create_gas_ledger = ({
  address,
  network,
  storage = browser_storage(),
  now = Date.now,
}: Readonly<{
  address: string | null
  network: string
  storage?: StorageLike | null
  now?: () => number
}>) => {
  const key = `${STORAGE_PREFIX}:${network}:${address?.trim().toLowerCase() ?? ''}`
  let memory: readonly Entry[] = Object.freeze([])

  const read = (): readonly Entry[] => {
    if (!address) return []
    if (!storage) return memory.filter(({ at }) => at >= now() - WINDOW_MS)
    try {
      const raw = storage.getItem(key)
      if (!raw) return []
      const entries = valid_entries(JSON.parse(raw) as unknown, now() - WINDOW_MS)
      if (entries.length) storage.setItem(key, JSON.stringify(entries))
      else storage.removeItem(key)
      memory = Object.freeze(entries)
      return entries
    } catch (error) {
      console.warn('Stored gas history could not be read.', error)
      return memory.filter(({ at }) => at >= now() - WINDOW_MS)
    }
  }

  const write = (entries: readonly Entry[]): void => {
    if (!address) return
    memory = Object.freeze([...entries])
    if (!storage) return
    try {
      if (entries.length) storage.setItem(key, JSON.stringify(entries))
      else storage.removeItem(key)
    } catch (error) {
      // Gas history is display-only and must never affect an executed transaction.
      console.warn('Gas history could not be stored.', error)
    }
  }

  return Object.freeze({
    record: (receipt: Receipt): void => {
      const digest = receipt_digest_or_null(receipt)
      const mist = gas_mist_from_receipt(receipt)
      if (!digest || mist === null) return
      const entries = read()
      if (entries.some((entry) => entry.digest === digest)) return
      write(
        Object.freeze([
          ...entries,
          Object.freeze({ digest, at: now(), mist: mist.toString(), scopes: Object.freeze([]) }),
        ])
      )
    },
    tag: (receipt: Receipt, scope: string): void => {
      const digest = receipt_digest_or_null(receipt)
      const mist = gas_mist_from_receipt(receipt)
      if (!digest || mist === null) return
      const entries = read()
      const existing = entries.find((entry) => entry.digest === digest)
      if (existing?.scopes.includes(scope)) return
      const tagged = existing
        ? entries.map((entry) =>
            entry.digest === digest
              ? Object.freeze({ ...entry, scopes: Object.freeze([...entry.scopes, scope]) })
              : entry
          )
        : [...entries, Object.freeze({ digest, at: now(), mist: mist.toString(), scopes: Object.freeze([scope]) })]
      write(Object.freeze(tagged))
    },
    spent_24h: (scope?: string): bigint =>
      read()
        .filter((entry) => scope === undefined || entry.scopes.includes(scope))
        .reduce((total, entry) => total + BigInt(entry.mist), 0n),
  })
}

export type GasLedger = ReturnType<typeof create_gas_ledger>
