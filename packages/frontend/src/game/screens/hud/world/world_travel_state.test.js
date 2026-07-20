// Unit coverage for the world-travel pure derivations. The panel derivation is the
// REGRESSION seam for the "HERE bound to the wrong character" bug: a doc from another character (the exact
// state use_rpc_view's keep-last-good serves across a selection switch) must never bind the location line.

import { describe, expect, test } from 'bun:test'

import { derive_world_panel, derive_world_cards, filter_world_cards } from './world_travel_state.js'

describe('derive_world_panel (selected-character binding)', () => {
  test('no selected character → no_character', () => {
    expect(derive_world_panel({ selected_character_id: null, doc: null })).toEqual({
      status: 'no_character',
      world_id: null,
      level: null,
    })
  })

  test('selected character with a world → that world + ITS level (and only from ITS doc)', () => {
    expect(
      derive_world_panel({ selected_character_id: '0xb', doc: { id: '0xb', world: '0xw2', level: 7 } })
    ).toEqual({
      status: 'in_world',
      world_id: '0xw2',
      level: 7,
    })
  })

  test('selected character in NO world → honest not_in_world (never a lying HERE)', () => {
    // A proven doc without a level field reads as the create-default 1 (mirrors the old panel's `?? 1`).
    expect(derive_world_panel({ selected_character_id: '0xb', doc: { id: '0xb', world: null } })).toEqual({
      status: 'not_in_world',
      world_id: null,
      level: 1,
    })
  })

  test("REGRESSION 07-17: a DIFFERENT character's doc is discarded, not rendered", () => {
    // The first roster character's doc (First Shore) still in hand while the selection moved to 0xb.
    // Its LEVEL is discarded too — a foreign level must never drive the modal's locks.
    expect(
      derive_world_panel({ selected_character_id: '0xb', doc: { id: '0xa', world: '0xfirst_shore', level: 42 } })
    ).toEqual({ status: 'unknown', world_id: null, level: null })
  })

  test('no doc yet (unindexed / first poll in flight) → unknown, never fabricated', () => {
    expect(derive_world_panel({ selected_character_id: '0xb', doc: null })).toEqual({
      status: 'unknown',
      world_id: null,
      level: null,
    })
  })
})

const corpus = new Map([
  [
    '0xw1',
    {
      biome: 'archipelago',
      band: [1, 12],
      mobs: [
        { role: 'trash' },
        { role: 'boss' },
        { role: 'dungeon_boss' },
      ],
      resources: [{}, {}],
    },
  ],
  ['0xw3', { biome: 'ash_steppe', band: [10, 24], mobs: [{ role: 'trash' }], resources: [{}] }],
])

const cards = (over = {}) =>
  derive_world_cards({
    worlds: [
      { id: '0xw3', label: 'Emberfall Steppe' },
      { id: '0xw1', label: 'First Shore' },
      { id: '0xw9', label: 'Uncharted' }, // live world with no corpus row → honest gaps
    ],
    required_level_by_world: new Map([
      ['0xw1', 1],
      ['0xw3', 10],
    ]),
    corpus_of: (id) => corpus.get(id),
    my_level: 4,
    current_world_id: '0xw1',
    ...over,
  })

describe('derive_world_cards (modal join)', () => {
  test('joins the LIVE gate + authored knowledge and sorts by the real required_level', () => {
    const [first, ember, uncharted] = cards()
    expect(first).toEqual({
      id: '0xw1',
      label: 'First Shore',
      biome: 'archipelago',
      band: [1, 12],
      required_level: 1,
      here: true,
      locked: false,
      mob_count: 3,
      boss_count: 2,
      resource_count: 2,
    })
    expect({ id: ember.id, locked: ember.locked, required_level: ember.required_level }).toEqual({
      id: '0xw3',
      locked: true, // level 4 < gate 10 — mirrors zones::join_world's assert
      required_level: 10,
    })
    // No corpus row + no /v1 gate → every unknown stays null (rendered as a gap, never fabricated), and
    // the sort sends the unknown to the end.
    expect(uncharted).toEqual({
      id: '0xw9',
      label: 'Uncharted',
      biome: null,
      band: null,
      required_level: null,
      here: false,
      locked: false,
      mob_count: null,
      boss_count: null,
      resource_count: null,
    })
  })

  test('an UNKNOWN character level never pre-locks (no fabricated lock while the doc loads)', () => {
    const ember = cards({ my_level: null }).find((c) => c.id === '0xw3')
    expect(ember?.locked).toBe(false)
  })

  test('HERE is never locked, whatever the gate (you are already inside)', () => {
    const here = cards({ my_level: null, current_world_id: '0xw3' }).find((c) => c.id === '0xw3')
    expect({ here: here?.here, locked: here?.locked }).toEqual({ here: true, locked: false })
  })
})

describe('filter_world_cards', () => {
  test('accessible_only hides locked worlds and keeps the rest', () => {
    const all = cards()
    const accessible = filter_world_cards(all, { accessible_only: true })
    expect(all.some((c) => c.locked)).toBe(true)
    expect(accessible.map((c) => c.id)).toEqual(['0xw1', '0xw9'])
    expect(filter_world_cards(all, { accessible_only: false })).toEqual(all)
  })
})
