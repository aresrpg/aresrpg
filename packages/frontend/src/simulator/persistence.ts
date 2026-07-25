// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/persistence.ts — the simulator's IndexedDB EDGE (spec §6), the promise-wrapper shape
// game/core/draft.js proved, on its OWN database.
//
// Persistence is an edge, never a source of truth: the boot read re-enters the page reducer as ONE
// `hydrated` input (no async callback ever writes the store — the deep-tier one-reducer law), and every
// stored row is re-normalized by the reducer, so a hand-edited database cannot inject an out-of-budget
// build. Nothing here touches the chain: the simulator is local by constitution, and a fight's truth is
// NEVER persisted (a reload lands back in setup with the roster intact, by design).
//
// Schema `aresrpg_simulator` v1 (spec §6): `roster` keyed by character id · `setup` under 'current' ·
// `traces` (the last exports ring the L4 trace lane fills — declared at v1 so landing it needs no
// version bump).

import {
  type SimulatorInput,
  type SimulatorState,
  type SimCharacter,
  type SimMobPick,
  type SimMobPicks,
  type SimPlacements,
} from './reducer'

const DB_NAME = 'aresrpg_simulator'
const DB_VERSION = 1
const ROSTER_STORE = 'roster'
const SETUP_STORE = 'setup'
const TRACES_STORE = 'traces'
const SETUP_KEY = 'current'

/** The setup row. The BOARD is not stored — it is derived from `seed` + `anchor_nonce` (simulator/board.ts),
 *  so a reload can never hand back a layout that disagrees with its own seed. */
export type PersistedSetup = {
  seed: number
  focus_id: string | null
  anchor_nonce?: number
  mob_picks?: Record<string, SimMobPick>
  placements?: Record<string, string>
}
export type PersistedSimulator = { roster: readonly SimCharacter[]; setup: PersistedSetup | null }

/** Cell-keyed rows → the string-keyed shape IndexedDB stores (structured clone keeps numeric keys as strings). */
const cell_rows = <T>(rows: Readonly<Record<number, T>>): Record<string, T> =>
  Object.fromEntries(Object.entries(rows ?? {}))

/** The page state as stored rows — the roster keyed by id, everything else under the single setup row. */
export const to_persisted = (state: Readonly<SimulatorState>): PersistedSimulator => ({
  roster: state.roster,
  setup: {
    seed: state.seed,
    focus_id: state.focus_id,
    anchor_nonce: state.anchor_nonce,
    mob_picks: cell_rows(state.mob_picks as Record<number, SimMobPick>),
    placements: cell_rows(state.placements as Record<number, string>),
  },
})

/**
 * Stored rows → the ONE `hydrated` input. Junk (a non-object row, a row with no id) is dropped here, at
 * the seam; budgets and value ranges are the reducer's own normalization, decoded once.
 */
export const hydrated_input = (persisted: Readonly<PersistedSimulator> | null): SimulatorInput => {
  const rows = (persisted?.roster ?? []).filter(
    (row): row is SimCharacter => typeof row === 'object' && row !== null && typeof row.id === 'string'
  )
  return {
    type: 'hydrated',
    roster: rows,
    seed: Number(persisted?.setup?.seed ?? 0),
    focus_id: typeof persisted?.setup?.focus_id === 'string' ? persisted.setup.focus_id : null,
    anchor_nonce: Number(persisted?.setup?.anchor_nonce ?? 0),
    // Cell legality is the reducer's own re-fit (it owns the board oracle) — decoded once, here, into shape.
    mob_picks: (persisted?.setup?.mob_picks ?? {}) as SimMobPicks,
    placements: (persisted?.setup?.placements ?? {}) as SimPlacements,
  }
}

/* eslint-disable functional/immutable-data, no-param-reassign, functional/prefer-immutable-types --
   the IndexedDB API IS handler assignment: `request.onsuccess = …` is the platform's only completion
   channel, exactly as game/core/draft.js wires it. Everything above this line stays pure. */
const open_db = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of [ROSTER_STORE, SETUP_STORE, TRACES_STORE])
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/** Run `work` inside one transaction over `stores`, resolving when the transaction itself completes. */
const transact = async (
  stores: readonly string[],
  mode: IDBTransactionMode,
  work: (get_store: (name: string) => IDBObjectStore) => void
): Promise<void> => {
  const db = await open_db()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores as string[], mode)
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error)
    }
    work((name) => tx.objectStore(name))
  })
}

const request_value = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

/**
 * Read the persisted page state. A missing/failed database DEGRADES LOUDLY to null (one console.error) —
 * the page opens on an empty roster rather than a lie, and the next save re-creates the store.
 */
export const load_simulator_state = async (): Promise<PersistedSimulator | null> => {
  try {
    const db = await open_db()
    const tx = db.transaction([ROSTER_STORE, SETUP_STORE], 'readonly')
    const [roster, setup] = await Promise.all([
      request_value(tx.objectStore(ROSTER_STORE).getAll() as IDBRequest<SimCharacter[]>),
      request_value(tx.objectStore(SETUP_STORE).get(SETUP_KEY) as IDBRequest<PersistedSetup>),
    ])
    db.close()
    return { roster: roster ?? [], setup: setup ?? null }
  } catch (error) {
    console.error('[simulator] IndexedDB read failed — starting from an empty roster', error)
    return null
  }
}

/** Write the whole page state (the roster store is rewritten, so a deleted character stays deleted). */
export const save_simulator_state = async (state: Readonly<SimulatorState>): Promise<void> => {
  const { roster, setup } = to_persisted(state)
  try {
    await transact([ROSTER_STORE, SETUP_STORE], 'readwrite', (get_store) => {
      const store = get_store(ROSTER_STORE)
      store.clear()
      for (const character of roster) store.put(character, character.id)
      get_store(SETUP_STORE).put(setup, SETUP_KEY)
    })
  } catch (error) {
    console.error('[simulator] IndexedDB write failed — this build will not survive a reload', error)
  }
}

/**
 * Subscribe the persistence edge to a store: every change schedules ONE debounced flush, and the returned
 * disposer flushes anything still pending before detaching (a fast edit → navigate never loses the build).
 */
export const install_simulator_persistence = (
  subscribe: (listener: () => void) => () => void,
  read_state: () => SimulatorState,
  delay_ms = 400
): (() => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    timer = null
    void save_simulator_state(read_state())
  }
  const unsubscribe = subscribe(() => {
    if (timer === null) timer = setTimeout(flush, delay_ms)
  })
  return () => {
    if (timer !== null) {
      clearTimeout(timer)
      flush()
    }
    unsubscribe()
  }
}
