// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2029 — the auto-search settings were lost on every reload, and the loop could only hunt MOBS. Two halves,
// one settings group: the group persists through the house pref idiom (pure localStorage, quality_pref /
// engine_flags_pref shape — no new mechanism), and a TARGETS axis says what the loop is looking for.
//
// The spend gate is the reason this is a settings-only group: `armed` / `fee_pending` are NEVER persisted —
// a scouter that came back armed after a reload would start paying for zone searches with nobody watching.
// bun:test has no DOM localStorage; the same in-memory shim hp_display_pref.test.js uses stands in.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'

const store = new Map()
const real = globalThis.localStorage
globalThis.localStorage = /** @type {any} */ ({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
})
afterAll(() => {
  if (real === undefined) delete globalThis.localStorage
  else globalThis.localStorage = real
})

const { AUTO_SEARCH_STORAGE_KEY, read_auto_search_settings, save_auto_search_settings } =
  await import('../../../src/game/dev/auto_search_pref.js')
const {
  DEFAULT_RANGE_FROM_M,
  DEFAULT_RANGE_TO_M,
  DEFAULT_TARGETS,
  blank_auto_search,
  reduce_auto_search,
  settings_of,
} = await import('../../../src/game/dev/auto_search.js')

describe('#2029 auto-search settings survive a reload', () => {
  beforeEach(() => store.clear())

  test('nothing saved ⇒ the shipped defaults, and the loop hunts mobs as it always did', () => {
    expect(read_auto_search_settings()).toEqual({
      from_m: DEFAULT_RANGE_FROM_M,
      to_m: DEFAULT_RANGE_TO_M,
      wanted: [],
      wanted_resources: [],
      targets: DEFAULT_TARGETS,
    })
    expect(DEFAULT_TARGETS).toBe('mobs')
  })

  test('the whole group round-trips — a fresh read (≡ a fresh page) hydrates what was configured', () => {
    save_auto_search_settings({
      from_m: 250,
      to_m: 4000,
      wanted: ['boar'],
      wanted_resources: ['wheat'],
      targets: 'both',
    })
    expect(read_auto_search_settings()).toEqual({
      from_m: 250,
      to_m: 4000,
      wanted: ['boar'],
      wanted_resources: ['wheat'],
      targets: 'both',
    })
  })

  // The spend gate can never be restored from disk: an armed scouter pays real SUI per zone search.
  test('the run state is NEVER persisted — only the settings group is written', () => {
    const armed = { ...blank_auto_search(), armed: true, fee_pending: true, config_open: true, phase: 'travel' }
    save_auto_search_settings(settings_of(armed))
    const written = JSON.parse(/** @type {string} */ (store.get(AUTO_SEARCH_STORAGE_KEY)))
    expect(Object.keys(written).sort()).toEqual(['from_m', 'targets', 'to_m', 'wanted', 'wanted_resources'])
    expect(read_auto_search_settings()).not.toHaveProperty('armed')
  })

  test('a corrupt or foreign payload falls back to the defaults instead of throwing', () => {
    store.set(AUTO_SEARCH_STORAGE_KEY, '{ not json')
    expect(read_auto_search_settings().targets).toBe(DEFAULT_TARGETS)
    store.set(AUTO_SEARCH_STORAGE_KEY, JSON.stringify({ targets: 'everything', from_m: 'soon', wanted: 'boar' }))
    const settings = read_auto_search_settings()
    expect(settings.targets).toBe(DEFAULT_TARGETS)
    expect(settings.from_m).toBe(DEFAULT_RANGE_FROM_M)
    expect(settings.wanted).toEqual([])
  })
})

// The second half of the row: the TARGETS axis filters the population the fold will approach. A gatherable
// marker carries (job, tier) — its roster id is the same items.json slug the jobs panel lists.
describe('#2029 the targets axis filters the searched population', () => {
  const world = (markers) => ({
    type: 'world',
    player: { x: 0, z: 0 },
    zone_size: 100,
    offset_x: 0,
    offset_z: 0,
    fresh_keys: [],
    search_armed: false,
    markers,
  })
  const boar = { kind: 'mob', template_id: 'boar', name: 'Boar', x: 4, z: 0, zx: 0, zy: 0 }
  // farmer (job 0) tier 1 = `wheat` in the sdk's gathering roster.
  const wheat = { kind: 'resource', job: 0, tier: 1, x: 4, z: 0, zx: 0, zy: 0 }

  const armed_with = (settings) => ({
    ...blank_auto_search(),
    ...settings,
    armed: true,
    phase: 'idle',
  })

  test('MOBS (the shipped default) never approaches a gatherable node', () => {
    const state = reduce_auto_search(armed_with({ wanted: ['boar'], wanted_resources: ['wheat'] }), world([wheat]), 0)
    expect(state.command?.kind).not.toBe('approach')
  })

  test('GATHERABLES approaches a wanted resource node and ignores the mob', () => {
    const state = reduce_auto_search(
      armed_with({ targets: 'gatherables', wanted: ['boar'], wanted_resources: ['wheat'] }),
      world([boar, wheat]),
      0
    )
    expect(state.command).toMatchObject({ kind: 'approach', template_id: 'wheat' })
  })

  test('GATHERABLES ignores a node the player did not select', () => {
    const state = reduce_auto_search(
      armed_with({ targets: 'gatherables', wanted_resources: ['diamond'] }),
      world([wheat]),
      0
    )
    expect(state.command?.kind).not.toBe('approach')
  })

  test('BOTH takes whichever is nearest', () => {
    const state = reduce_auto_search(
      armed_with({ targets: 'both', wanted: ['boar'], wanted_resources: ['wheat'] }),
      world([{ ...boar, x: 40 }, wheat]),
      0
    )
    expect(state.command).toMatchObject({ kind: 'approach', template_id: 'wheat' })
  })

  // The world's mob table prunes unfindable MOBS; it must never touch the gatherable selection.
  test('a world-table prune never eats the gatherable selection', () => {
    const state = reduce_auto_search(
      armed_with({ wanted: ['boar'], wanted_resources: ['wheat'], targets: 'both' }),
      { type: 'world_mobs', template_ids: ['wolf'] },
      0
    )
    expect(state.wanted).toEqual([])
    expect(state.wanted_resources).toEqual(['wheat'])
  })
})
