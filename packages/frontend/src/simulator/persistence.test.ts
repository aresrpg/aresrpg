// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The IndexedDB edge, driven for real: save → reload → hydrate must return the SAME build (the L0
// acceptance criterion), a deleted character must stay deleted, and a broken database must degrade to an
// empty roster instead of a crash. bun:test has no DOM, so the suite runs the module against a minimal
// in-memory IndexedDB double (the real request/transaction callback protocol — the code under test is
// unchanged) and restores the global afterwards, keeping the order-independence gate honest.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

import {
  hydrated_input,
  install_simulator_persistence,
  load_simulator_state,
  save_simulator_state,
  to_persisted,
} from './persistence'
import { INITIAL_SIMULATOR_STATE, reduce_simulator, type SimulatorInput, type SimulatorState } from './reducer'

// ── the in-memory IndexedDB double ────────────────────────────────────────────
type Handlers = { onsuccess?: () => void; onerror?: () => void }
const settle = (request: Handlers & { result?: unknown }) => queueMicrotask(() => request.onsuccess?.())

const create_fake_idb = (fail = false) => {
  const data = new Map<string, Map<string, unknown>>()
  const store_of = (name: string) => {
    const rows = data.get(name) ?? new Map<string, unknown>()
    data.set(name, rows)
    return rows
  }
  const object_store = (name: string, pending: Handlers[]) => ({
    getAll: () => {
      const request: Handlers & { result?: unknown } = { result: [...store_of(name).values()] }
      pending.push(request)
      settle(request)
      return request
    },
    get: (key: string) => {
      const request: Handlers & { result?: unknown } = { result: store_of(name).get(key) }
      pending.push(request)
      settle(request)
      return request
    },
    put: (value: unknown, key: string) => {
      store_of(name).set(key, value)
      return {}
    },
    clear: () => {
      store_of(name).clear()
      return {}
    },
  })
  return {
    open: () => {
      const request: Handlers & { onupgradeneeded?: () => void; result?: unknown; error?: unknown } = {}
      queueMicrotask(() => {
        if (fail) {
          request.error = new Error('quota exceeded')
          request.onerror?.()
          return
        }
        request.result = {
          objectStoreNames: { contains: (name: string) => data.has(name) },
          createObjectStore: (name: string) => store_of(name),
          transaction: (_names: string[], _mode: string) => {
            const pending: Handlers[] = []
            const tx: { oncomplete?: () => void; onerror?: () => void; objectStore: (n: string) => unknown } = {
              objectStore: (name: string) => object_store(name, pending),
            }
            // real-ish semantics: the transaction completes after the microtasks its requests queued
            queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()))
            return tx
          },
          close: () => {},
        }
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
}

const real_indexeddb = (globalThis as { indexedDB?: unknown }).indexedDB
const use_fake_idb = (fail = false) => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = create_fake_idb(fail)
}
afterAll(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = real_indexeddb
})

// ── fixtures ──────────────────────────────────────────────────────────────────
const fold = (inputs: SimulatorInput[]): SimulatorState => inputs.reduce(reduce_simulator, INITIAL_SIMULATOR_STATE)

const two_character_build = (): SimulatorState =>
  fold([
    { type: 'seed_set', seed: 0xc81f3a92 },
    { type: 'character_added', class_id: 'senshi', name: 'Kaelis', male: true },
    { type: 'level_set', id: 'sim_c1', level: 120 },
    { type: 'stat_set', id: 'sim_c1', stat: 'strength', value: 400 },
    { type: 'spell_level_set', id: 'sim_c1', spell_id: 'ember_strike', level: 5, max_level: 6 },
    { type: 'character_added', class_id: 'iyashi', name: 'Nyx', male: false },
    { type: 'focus_set', id: 'sim_c1' },
  ])

describe('the pure mapping', () => {
  test('to_persisted keeps the roster and the setup row, and hydrated_input drops junk rows', () => {
    const built = two_character_build()
    expect(to_persisted(built)).toEqual({
      roster: built.roster,
      setup: { seed: built.seed, focus_id: 'sim_c1' },
    })

    const input = hydrated_input({
      roster: [null, { name: 'no id' }, built.roster[0]] as never,
      setup: { seed: 7, focus_id: 'sim_c1' },
    })
    expect(input).toEqual({ type: 'hydrated', roster: [built.roster[0]], seed: 7, focus_id: 'sim_c1' })
  })

  test('an absent database hydrates to the initial state, not to a crash', () => {
    expect(reduce_simulator(INITIAL_SIMULATOR_STATE, hydrated_input(null))).toEqual(INITIAL_SIMULATOR_STATE)
  })
})

describe('the IndexedDB round trip', () => {
  beforeEach(() => use_fake_idb())

  test('a saved build reloads identically — the reload-proof acceptance criterion', async () => {
    const built = two_character_build()
    await save_simulator_state(built)

    const reloaded = reduce_simulator(INITIAL_SIMULATOR_STATE, hydrated_input(await load_simulator_state()))
    expect(reloaded).toEqual(built)
    expect(reloaded.roster[0].spell_levels).toEqual({ ember_strike: 5 })
  })

  test('a deleted character does not come back — the roster store is rewritten, never merged', async () => {
    const built = two_character_build()
    await save_simulator_state(built)
    await save_simulator_state(reduce_simulator(built, { type: 'character_removed', id: 'sim_c2' }))

    const reloaded = reduce_simulator(INITIAL_SIMULATOR_STATE, hydrated_input(await load_simulator_state()))
    expect(reloaded.roster.map(({ id }) => id)).toEqual(['sim_c1'])
  })

  test('an empty database reads as an empty roster', async () => {
    expect(await load_simulator_state()).toEqual({ roster: [], setup: null })
  })

  test('a failing database degrades to null instead of throwing into the page', async () => {
    use_fake_idb(true)
    expect(await load_simulator_state()).toBeNull()
    await save_simulator_state(two_character_build())
  })
})

describe('the debounced subscriber', () => {
  beforeEach(() => use_fake_idb())

  test('many edits coalesce into one flush, and disposing flushes what is still pending', async () => {
    const listeners: (() => void)[] = []
    const built = two_character_build()
    const dispose = install_simulator_persistence(
      (listener) => {
        listeners.push(listener)
        return () => listeners.splice(listeners.indexOf(listener), 1)
      },
      () => built,
      50
    )
    listeners.forEach((listener) => {
      listener()
      listener()
      listener()
    })
    // nothing is written yet — the flush is still scheduled
    expect(await load_simulator_state()).toEqual({ roster: [], setup: null })

    dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const reloaded = reduce_simulator(INITIAL_SIMULATOR_STATE, hydrated_input(await load_simulator_state()))
    expect(reloaded).toEqual(built)
    expect(listeners).toHaveLength(0)
  })
})
