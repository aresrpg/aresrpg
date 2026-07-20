import { parseTransactionEffectsBcs } from '@mysten/sui/client'
import { fromBase64 } from '@mysten/sui/utils'

export const GAS_SPEND_WINDOW_MS = 24 * 60 * 60 * 1000

const STORAGE_PREFIX = 'aresrpg:gas-spend-24h:'
const REFRESH_MS = 60_000

export type GasSpendEntry = { ts: number; mist: string }
export type GasUsed = {
  computationCost?: string | number | bigint
  storageCost?: string | number | bigint
  storageRebate?: string | number | bigint
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type GasReceipt = {
  digest?: string
  effects?: string | { gasUsed?: GasUsed }
  effects_result?: any
  gasUsed?: GasUsed
}

const listeners = new Set<() => void>()

function browser_storage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function gas_spend_storage_key(address: string): string {
  return `${STORAGE_PREFIX}${address.trim().toLowerCase()}`
}

export function prune_gas_spend_entries(entries: unknown, now_ms: number): GasSpendEntry[] {
  if (!Array.isArray(entries) || !Number.isFinite(now_ms)) return []
  const cutoff = now_ms - GAS_SPEND_WINDOW_MS
  const kept: GasSpendEntry[] = []
  for (const candidate of entries) {
    const entry = candidate as { ts?: unknown; mist?: unknown }
    if (!Number.isFinite(entry?.ts) || !Number.isInteger(entry.ts)) continue
    if ((entry.ts as number) < cutoff) continue
    try {
      const mist = BigInt(entry.mist as string | number | bigint).toString()
      kept.push({ ts: entry.ts as number, mist })
    } catch {
      // localStorage is untrusted; malformed rows are pruned with the expired ones.
    }
  }
  return kept
}

function write_entries(storage: StorageLike, key: string, entries: GasSpendEntry[]): void {
  try {
    if (entries.length) storage.setItem(key, JSON.stringify(entries))
    else storage.removeItem(key)
  } catch {
    // A disabled/full localStorage must never interfere with transaction completion.
  }
}

function read_entries(address: string, now_ms: number, storage: StorageLike | null): GasSpendEntry[] {
  if (!address || !storage) return []
  const key = gas_spend_storage_key(address)
  let raw: string | null = null
  try {
    raw = storage.getItem(key)
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: unknown = []
  try {
    parsed = JSON.parse(raw)
  } catch {
    write_entries(storage, key, [])
    return []
  }
  const entries = prune_gas_spend_entries(parsed, now_ms)
  if (JSON.stringify(parsed) !== JSON.stringify(entries)) write_entries(storage, key, entries)
  return entries
}

export function gas_mist_from_used(gas_used: GasUsed | null | undefined): bigint | null {
  if (!gas_used) return null
  try {
    return (
      BigInt(gas_used.computationCost ?? 0) + BigInt(gas_used.storageCost ?? 0) - BigInt(gas_used.storageRebate ?? 0)
    )
  } catch {
    return null
  }
}

export function gas_used_from_receipt(receipt: GasReceipt): GasUsed | null {
  const executed = receipt.effects_result?.Transaction ?? receipt.effects_result?.FailedTransaction
  if (executed?.effects?.gasUsed) return executed.effects.gasUsed
  if (receipt.gasUsed) return receipt.gasUsed
  if (typeof receipt.effects === 'object' && receipt.effects?.gasUsed) return receipt.effects.gasUsed
  if (typeof receipt.effects !== 'string') return null
  try {
    return parseTransactionEffectsBcs(fromBase64(receipt.effects)).gasUsed
  } catch {
    return null
  }
}

function notify_listeners(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Observers run after execution; one broken UI listener must never reject an already-landed tx.
    }
  }
}

export function record_gas_spend(
  address: string,
  mist: bigint,
  now_ms = Date.now(),
  storage: StorageLike | null = browser_storage()
): void {
  if (!address || !storage || !Number.isFinite(now_ms)) return
  const entries = read_entries(address, now_ms, storage)
  entries.push({ ts: now_ms, mist: mist.toString() })
  write_entries(storage, gas_spend_storage_key(address), entries)
  notify_listeners()
}

/** Record an executed SELF-PAY receipt and return that same receipt for the tx choke's return path. */
export function record_self_paid_receipt<T extends GasReceipt>(
  address: string,
  receipt: T,
  now_ms = Date.now(),
  storage: StorageLike | null = browser_storage()
): T {
  if (!receipt.digest) return receipt
  const mist = gas_mist_from_used(gas_used_from_receipt(receipt))
  if (mist != null) record_gas_spend(address, mist, now_ms, storage)
  return receipt
}

export function rolling_gas_spend_mist(
  address: string | null,
  now_ms = Date.now(),
  storage: StorageLike | null = browser_storage()
): bigint {
  if (!address) return 0n
  return read_entries(address, now_ms, storage).reduce((total, entry) => total + BigInt(entry.mist), 0n)
}

export function format_gas_spend_sui(mist: bigint): string {
  const sign = mist < 0n ? '-' : ''
  const absolute = mist < 0n ? -mist : mist
  // Design ruling 2026-07-15: 2 decimals on the card. Non-zero spend never reads as zero — below a cent it says "<0.01".
  if (absolute > 0n && absolute < 10_000_000n) return `${sign}<0.01`
  const whole = absolute / 1_000_000_000n
  const fraction = ((absolute % 1_000_000_000n) / 10_000_000n).toString().padStart(2, '0')
  return `${sign}${whole}.${fraction}`
}

export function subscribe_gas_spend(listener: () => void): () => void {
  listeners.add(listener)
  if (typeof window === 'undefined') return () => listeners.delete(listener)
  const on_storage = (event: StorageEvent) => {
    if (event.key?.startsWith(STORAGE_PREFIX)) listener()
  }
  const timer = window.setInterval(listener, REFRESH_MS)
  window.addEventListener('storage', on_storage)
  return () => {
    listeners.delete(listener)
    window.clearInterval(timer)
    window.removeEventListener('storage', on_storage)
  }
}
