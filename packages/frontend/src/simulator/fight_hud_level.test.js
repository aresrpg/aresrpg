// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_hud_level.test.js — RED-FIRST for #949: the roster row the shim seeds must speak the SAME
// shape the production HUD reads its unlock level from.
//
// THE BUG, mechanically. `FightHud.jsx` mounts the production `<DungeonBoard />`, and that surface derives the
// character level it gates the spell bar with from the XP CURVE — `xp_progress(my_character?.experience ?? 0)`
// (DungeonBoard.jsx:196-198) — because on chain a character carries `experience`, never a `level` field. The
// shim seeded `sui.characters` rows carrying `level` and NO `experience`, so `experience ?? 0` fell to 0, the
// bar resolved its unlocks at LEVEL 1, and every class' three unlock-1 starters were the whole hand — while the
// SEAT was built by `build_seat` off the real roster level and carried level-200 HP. That is the exact captured
// symptom: level-200 pools, three armed spells.
//
// The oracle is the SHIPPED data sheet (spell_corpus_l2.fixture.json — all 240 published rows, captured
// verbatim from assets.aresrpg.world), not a hand-written approximation: a senshi authors 20 spells, of which
// exactly 3 unlock at level 1. Reading the fixture is what makes "3 vs 20" a real measurement.

import { describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

import fixture from './spell_corpus_l2.fixture.json'

// The shim is an effect edge over the page's real stores, so its import graph reaches the browser-only auth
// seam — the same reason `fight_hud_cast.test.jsx` installs the surface before its dynamic imports.
install_browser_globals({ with_document: true, with_element: true })

const { xp_progress } = await import('@aresrpg/sdk/experience')
const { resolve_class_spells } = await import('../game/screens/hud/fight-spells.js')
const { set_spell_corpus_for_test } = await import('../game/data/spell_corpus.js')
const { board_of } = await import('./board')
const { build_start_args } = await import('./fight_start.js')
const { create_fight_shim } = await import('./fight_shim.js')
const { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE, normalize_character } = await import('./reducer')

const CORPUS = fixture.rows
const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)
const ROSTER_LEVEL = 200

const MOB = {
  id: '0xmob_gronk',
  name: 'Gronk',
  element: 'earth',
  role: 'trash',
  minLevel: 10,
  maxLevel: 20,
  base_hp: 340,
  ap: 6,
  mp: 3,
}
const MOB_SPELL = { ap: 3, rmin: 1, rmax: 2, effects: [{ kind: 0, base: 9, element: 2 }] }

/** The page state a level-200 senshi seats from — through the reducer's own normalizer, never a raw literal. */
const state_of = () => {
  const character = normalize_character({
    id: 'sim_c1',
    name: 'KAELIS',
    class_id: 'senshi',
    male: true,
    level: ROSTER_LEVEL,
    stat_alloc: { ...EMPTY_STAT_ALLOC },
    spell_levels: {},
    loadout: {},
  })
  return {
    ...INITIAL_SIMULATOR_STATE,
    seed: SEED,
    roster: [character],
    focus_id: 'sim_c1',
    placements: { [BOARD.start_cells_a[0]]: 'sim_c1' },
    mob_picks: { [BOARD.start_cells_b[0]]: { template_id: MOB.id, level: 12 } },
  }
}

/** Start a real fight through the shim, capturing the roster rows it seeds into the engine's `sui` slice. */
const seeded_characters = () => {
  set_spell_corpus_for_test(CORPUS)
  const built = build_start_args({
    state: state_of(),
    board: BOARD,
    item_by_id: new Map(),
    mob_by_id: new Map([[MOB.id, MOB]]),
    mob_spells_of: () => [MOB_SPELL],
  })
  expect(built.ok).toBe(true)

  const dispatched = []
  const engine_context = {
    // an EMPTY sui slice is the honest page state: the simulator is its own session, so the seed always runs
    get_state: () => ({ sui: { characters: [] } }),
    dispatch: (action, payload) => dispatched.push({ action, payload }),
  }
  const shim = create_fight_shim({ engine_context, save: async () => {}, schedule: () => {} })
  const started = shim.start({ ...built.args, fight_id: 'sim:949:1' })
  expect(started.ok ?? true).not.toBe(false)
  shim.stop?.()

  const seed = dispatched.find(({ action }) => action === 'action/sui_data')
  expect(seed).toBeDefined()
  return { characters: seed.payload.characters, seat: built.args.team0[0] }
}

describe('#949 — the simulator roster row carries the level in the shape the HUD reads', () => {
  const { characters, seat } = seeded_characters()
  const [row] = characters

  test('the seat itself was always right — level-200 pools off the real curve', () => {
    // The half of the capture that was never broken: `build_seat` reads `character.level` directly.
    expect(seat.level).toBe(ROSTER_LEVEL)
    expect(seat.health_max).toBeGreaterThan(1000)
  })

  test('the seeded row carries an EXPERIENCE the xp curve reads back as the roster level', () => {
    // DungeonBoard.jsx:196-198 — the bar's unlock gate. `experience ?? 0` on a row without the field is
    // level 1, which is the whole bug; a row that speaks `experience` cannot regress to it.
    expect(xp_progress(row.experience ?? 0).level).toBe(ROSTER_LEVEL)
  })

  test('so the bar arms the full class book, not the three unlock-1 starters', () => {
    const armed = resolve_class_spells(row.classe, xp_progress(row.experience ?? 0).level)
    // the shipped sheet: 20 senshi spells, of which exactly 3 unlock at level 1 — the captured symptom
    expect(CORPUS.filter((sp) => sp.classType === 'senshi').length).toBe(20)
    expect(CORPUS.filter((sp) => sp.classType === 'senshi' && sp.unlock === 1).length).toBe(3)
    expect(armed.length).toBe(20)
  })
})
