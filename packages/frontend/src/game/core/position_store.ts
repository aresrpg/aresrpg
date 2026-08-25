// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/prefer-immutable-types -- this browser storage boundary accepts the platform's mutable position shape. */
// Local resume position — the finer-grained "exactly where you stood" cache over the chain
// checkpoint (the only authoritative anchor). A saved pose is honored ONLY while it can
// explain itself against the chain: same character/world, captured under the SAME chain
// anchor, and young enough. The moment chain truth moves, the row is stale and the
// checkpoint wins. IndexedDB, never localStorage (positions are data, not preferences).

const DB_NAME = 'aresrpg_world_position'
const DB_VERSION = 1
const STORE = 'positions'
/** a row older than this resumes at the chain checkpoint instead */
const MAX_AGE_MS = 30 * 60 * 1000

export type ChainAnchor = Readonly<{ x: number; z: number; at_ms: number }>
export type SavedPosition = Readonly<{
  x: number
  y: number
  z: number
  saved_at: number
  anchor: ChainAnchor
}>

export type PositionStorage = Readonly<{
  load: (character_id: string, world: string) => Promise<SavedPosition | null>
  save: (character_id: string, world: string, row: SavedPosition) => Promise<void>
}>
export type PositionIdentity = Readonly<{ character_id: string; world: string }>

const row_key = (character_id: string, world: string): string => `${character_id}:${world}`

/* eslint-disable functional/immutable-data -- IndexedDB handler assignment is the platform completion channel. */
const open_database = (factory: IDBFactory): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
/* eslint-enable functional/immutable-data */

const in_transaction = async <T>(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T> | null
): Promise<T | null> => {
  const database = await open_database(factory)
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode)
    const request = act(transaction.objectStore(STORE))
    /* eslint-disable functional/immutable-data -- platform completion channel */
    transaction.oncomplete = () => {
      database.close()
      resolve((request?.result as T | undefined) ?? null)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error)
    }
    transaction.onabort = transaction.onerror
    /* eslint-enable functional/immutable-data */
  })
}

export const browser_position_storage = (factory: IDBFactory | null = globalThis.indexedDB ?? null): PositionStorage =>
  Object.freeze({
    load: async (character_id, world) => {
      if (!factory) return null
      const row = await in_transaction<unknown>(factory, 'readonly', (store) => store.get(row_key(character_id, world)))
      return is_saved_position(row) ? row : null
    },
    save: async (character_id, world, row) => {
      if (!factory) return
      await in_transaction(factory, 'readwrite', (store) => store.put(row, row_key(character_id, world)))
    },
  })

const is_saved_position = (value: unknown): value is SavedPosition => {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  const anchor = row.anchor as Record<string, unknown> | undefined
  return (
    [row.x, row.y, row.z, row.saved_at].every((field) => typeof field === 'number' && Number.isFinite(field)) &&
    typeof anchor === 'object' &&
    anchor !== null &&
    [anchor.x, anchor.z, anchor.at_ms].every((field) => typeof field === 'number' && Number.isFinite(field))
  )
}

const same_anchor = (a: ChainAnchor, b: ChainAnchor): boolean => a.x === b.x && a.z === b.z && a.at_ms === b.at_ms

export const chain_anchor_changed = (before: ChainAnchor | null, current: ChainAnchor | null): boolean =>
  before === null ? current !== null : current === null || !same_anchor(before, current)

/** The resume arbiter: the saved pose wins only while it explains itself against the current
 *  chain anchor; otherwise the caller falls back to the checkpoint. Pure — tested directly. */
export const resume_position = (
  saved: SavedPosition | null,
  chain_anchor: ChainAnchor | null,
  now: number = Date.now()
): Readonly<{ x: number; y: number; z: number }> | null => {
  if (!saved || !chain_anchor) return null
  if (!same_anchor(saved.anchor, chain_anchor)) return null
  if (now - saved.saved_at > MAX_AGE_MS) return null
  // A future checkpoint is a chain root (gathering/ambush): its movement budget is exactly
  // zero, so an offset cached pose cannot possibly explain itself even under the same anchor id.
  if (chain_anchor.at_ms > now && (saved.x !== chain_anchor.x || saved.z !== chain_anchor.z)) return null
  return Object.freeze({ x: saved.x, y: saved.y, z: saved.z })
}

/** Resolve the first real terrain focus before the render loop starts. The app previously
 * scheduled origin chunks while IndexedDB decided between the checkpoint and saved pose. */
export const resolve_world_boot_position = async ({
  checkpoint,
  chain_anchor,
  load,
}: Readonly<{
  checkpoint: Readonly<{ x: number; z: number }>
  chain_anchor: ChainAnchor | null
  load: () => Promise<SavedPosition | null>
}>): Promise<Readonly<{ x: number; z: number }>> => {
  const resumed = resume_position(await load(), chain_anchor)
  return resumed ? Object.freeze({ x: resumed.x, z: resumed.z }) : checkpoint
}

/** Debounced writer: at most one write per interval while moving, plus a trailing write when
 *  movement stops. `note` is called from the pose lane; `flush` on teardown. */
export const create_position_writer = ({
  save,
  interval_ms = 5_000,
  settle_ms = 750,
  now = () => Date.now(),
}: Readonly<{
  save: (identity: PositionIdentity, row: SavedPosition) => void
  interval_ms?: number
  settle_ms?: number
  now?: () => number
}>): Readonly<{
  note: (pose: Readonly<{ x: number; y: number; z: number }>, anchor: ChainAnchor, identity: PositionIdentity) => void
  flush: () => void
}> => {
  let last_write = 0
  let pending: Readonly<{ identity: PositionIdentity; row: SavedPosition }> | null = null
  let settle_timer: ReturnType<typeof setTimeout> | null = null
  const write = (): void => {
    if (!pending) return
    last_write = now()
    save(pending.identity, pending.row)
    pending = null
  }
  return Object.freeze({
    note: (pose, anchor, identity) => {
      pending = Object.freeze({
        identity,
        row: Object.freeze({ x: pose.x, y: pose.y, z: pose.z, saved_at: now(), anchor }),
      })
      if (settle_timer) clearTimeout(settle_timer)
      settle_timer = setTimeout(write, settle_ms)
      if (now() - last_write >= interval_ms) write()
    },
    flush: () => {
      if (settle_timer) clearTimeout(settle_timer)
      write()
    },
  })
}
