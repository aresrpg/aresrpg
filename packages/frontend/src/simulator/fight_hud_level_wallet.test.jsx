// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_hud_level_wallet.test.jsx — RED-FIRST for #1001: NO WALLET STATE MAY STARVE THE DECK.
//
// #949/#1000 taught the SEEDED roster row to speak `experience`, the shape the HUD's xp gate decodes. But the
// seeding door is GUARDED — `seed_stores` only dispatches when `sui.characters` is empty, so a real session's
// roster is never clobbered by a sandbox seat. Every consequence of that guard was missed: a connected wallet
// that owns chain characters (or a player who touched the world first, the issue's original door) closes the
// guard, the seed never fires, `sim_c1` is in NO roster the HUD reads, `experience ?? 0` falls to 0, and the
// board arms LEVEL 1 — the three unlock-1 starters beside a seat carrying level-200 pools. #1000's fix is a
// no-op for every real player.
//
// The state driven below is the PRODUCTION shape from the served-build capsule: two real chain rows already
// loaded (they carry `experience` and no `level` — the chain's shape) plus a level-200 sim seat that exists
// only in the fight. The fight always knows that seat: `fighters` is projected from `ctx.roster`, which the
// shim hands the core at init regardless of wallet state. So the assertions are on the CONSUMPTION seam — the
// level the production surfaces resolve — never on whether some seeding door happened to run.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

import fixture from './spell_corpus_l2.fixture.json'

const restore_browser_globals = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore_browser_globals)

const { renderToStaticMarkup } = await import('react-dom/server')
const { I18nextProvider } = await import('react-i18next')
const { default: i18n } = await import('../i18n')
const { xp_progress, level_to_experience } = await import('@aresrpg/sdk/experience')
const { fight_view } = await import('@aresrpg/fight/project')
const { resolve_class_spells } = await import('../game/screens/hud/fight-spells.js')
const { set_spell_corpus_for_test } = await import('../game/data/spell_corpus.js')
const { SpellBar } = await import('../game/screens/hud/SpellBar.jsx')
const { seat_character } = await import('../world-shell/seat_character.js')
const { context } = await import('../game/store.js')
const { board_of } = await import('./board')
const { build_start_args } = await import('./fight_start.js')
const { create_fight_shim } = await import('./fight_shim.js')
const { EMPTY_STAT_ALLOC, INITIAL_SIMULATOR_STATE, normalize_character } = await import('./reducer')

const CORPUS = fixture.rows
const SEED = 0xc81f3a92
const BOARD = board_of(SEED, 0)
const ROSTER_LEVEL = 200
const WORLD_LEVEL = 12

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

/** A row exactly as the wallet's roster carries it: `experience` is the on-chain field, there is no `level`. */
const chain_row = (id, name, level) => ({
  id,
  name,
  classe: 'senshi',
  experience: level_to_experience(level),
  in_dungeon: false,
})

/** The page state a level-200 senshi seats from — through the reducer's own normalizer, never a raw literal. */
const state_of = () => ({
  ...INITIAL_SIMULATOR_STATE,
  seed: SEED,
  roster: [
    normalize_character({
      id: 'sim_c1',
      name: 'KAELIS',
      class_id: 'senshi',
      male: true,
      level: ROSTER_LEVEL,
      stat_alloc: { ...EMPTY_STAT_ALLOC },
      spell_levels: {},
      loadout: {},
    }),
  ],
  focus_id: 'sim_c1',
  placements: { [BOARD.start_cells_a[0]]: 'sim_c1' },
  mob_picks: { [BOARD.start_cells_b[0]]: { template_id: MOB.id, level: 12 } },
})

/** The engine's action door is a STREAM — every dispatch lands a tick later, exactly as `load_roster` does. */
const settle = async (done) => {
  for (let tick = 0; tick < 200 && !done(); tick += 1) await new Promise((resolve) => setTimeout(resolve, 1))
  return done()
}

/** The board's spell-unlock gate, read exactly as `DungeonBoard.jsx` composes it (my_character → my_level).
 *  The structural pin below holds the board to that composition. */
const board_gate = () => {
  const view = fight_view()
  const { my_entity_id: id = null } = view ?? {}
  const row = seat_character(context.get_state().sui.characters, view?.fighters, id)
  const { level } = xp_progress(row?.experience ?? 0)
  const class_id = row?.classe ?? row?.class_id ?? view?.fighters.get(id)?.class_id ?? null
  return { level, spells: resolve_class_spells(class_id, level) }
}

/**
 * Drive a real sim fight through the production shim against the REAL engine context, with the wallet's roster
 * ALREADY loaded — the state that closes the seed door. `selected` embodies one of those characters first,
 * which is what a world-first navigation leaves behind (and what the bar falls back to with no fight).
 */
const drive = async ({ selected = null } = {}) => {
  set_spell_corpus_for_test(CORPUS)
  context.dispatch('action/sui_logout')
  await settle(() => context.get_state().sui.characters.length === 0)
  context.dispatch('action/sui_data', {
    characters: [chain_row('0xchain_a', 'MIRO', 1), chain_row('0xchain_b', 'SELV', WORLD_LEVEL)],
    loaded: true,
    load_error: null,
  })
  if (selected) context.dispatch('action/select_character', selected)
  await settle(() => context.get_state().sui.characters.length === 2)

  const built = build_start_args({
    state: state_of(),
    board: BOARD,
    item_by_id: new Map(),
    mob_by_id: new Map([[MOB.id, MOB]]),
    mob_spells_of: () => [MOB_SPELL],
  })
  if (!built.ok) throw new Error(`build_start_args refused: ${built.reason}`)
  const shim = create_fight_shim({ save: async () => {}, schedule: () => {} })
  const started = shim.start({ ...built.args, fight_id: 'sim:1001:1' })

  const captured = {
    started,
    my_entity_id: fight_view()?.my_entity_id ?? null,
    roster_ids: context.get_state().sui.characters.map(({ id }) => id),
    selected_character_id: context.get_state().selected_character_id,
    gate: board_gate(),
    html: renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <SpellBar />
      </I18nextProvider>
    ),
  }
  shim.stop()
  shim.dispose()
  captured.roster_ids_after = context.get_state().sui.characters.map(({ id }) => id)
  return captured
}

/** The bar's XP strip, as the served page paints it. */
const strip_level = (html) => html.match(/hud-xplvl hud-num">(\d+)</)?.[1] ?? null

// A connected wallet that owns chain characters — the generalized door, whatever route reached /simulator.
const connected = await drive()
// World-first navigation (#1001's original door): the world session loaded the roster AND embodied a character.
const world_first = await drive({ selected: '0xchain_b' })

describe('#1001 — no wallet state can starve the sim seat of its level', () => {
  test('the fight opens on the sim seat with the seed door CLOSED — the world roster is untouched', () => {
    for (const capture of [connected, world_first]) {
      expect(capture.started.ok).toBe(true)
      expect(capture.my_entity_id).toBe('sim_c1')
      // The guard's purpose still holds: no sim row leaked into what the world page reads for the rest of the
      // session, before OR after the fight. That is precisely why the derivation may not live behind it.
      expect(capture.roster_ids).toEqual(['0xchain_a', '0xchain_b'])
      expect(capture.roster_ids_after).toEqual(['0xchain_a', '0xchain_b'])
    }
  })

  test('the board resolves the SEAT level, 200, from the fight itself', () => {
    expect(connected.gate.level).toBe(ROSTER_LEVEL)
    expect(world_first.gate.level).toBe(ROSTER_LEVEL)
  })

  test('so the deck fills with the whole class book, not the three unlock-1 starters', () => {
    // the shipped sheet: 20 senshi spells, of which exactly 3 unlock at level 1 — the captured symptom
    expect(CORPUS.filter((sp) => sp.classType === 'senshi').length).toBe(20)
    expect(CORPUS.filter((sp) => sp.classType === 'senshi' && sp.unlock === 1).length).toBe(3)
    expect(connected.gate.spells.length).toBe(20)
    expect(world_first.gate.spells.length).toBe(20)
  })

  test("the bar's XP strip prints 200 — the production surface, rendered", () => {
    expect(strip_level(connected.html)).toBe(String(ROSTER_LEVEL))
    // and the embodied WORLD character's level never leaks into the sim seat's strip
    expect(world_first.selected_character_id).toBe('0xchain_b')
    expect(strip_level(world_first.html)).toBe(String(ROSTER_LEVEL))
    expect(strip_level(world_first.html)).not.toBe(String(WORLD_LEVEL))
  })

  test('a chain row the wallet DOES own still reads its own on-chain experience — chain truth wins', () => {
    const characters = [chain_row('0xchain_b', 'SELV', WORLD_LEVEL)]
    const fighters = new Map([['0xchain_b', { class_id: 'senshi', level: 1 }]])
    // the fighter beside it says level 1; the owned row's own experience is what answers, always
    expect(xp_progress(seat_character(characters, fighters, '0xchain_b').experience).level).toBe(WORLD_LEVEL)
    expect(seat_character([], fighters, '0xchain_b').experience).toBe(level_to_experience(1))
    expect(seat_character([], fighters, null)).toBeNull()
  })

  // The board itself cannot be server-rendered (its phase gate reads a zustand store whose SERVER snapshot is
  // pinned to getInitialState — the same reason fight_hud_cast.test.jsx asserts the bar's MOUNT at the source).
  // So the composition `board_gate` mirrors is pinned here: BOTH level-gated surfaces read the one door.
  test('both level-gated fight surfaces resolve their seat through the ONE door', async () => {
    const read = async (path) => await Bun.file(new URL(path, import.meta.url)).text()
    const board = await read('../game/screens/hud/world/DungeonBoardState.jsx')
    const bar = await read('../game/screens/hud/SpellBar.jsx')
    for (const source of [board, bar]) {
      expect(source).toContain('world-shell/seat_character.js')
      expect(source).toContain('seat_character(')
    }
    // and the board no longer re-derives its seat by hand off the wallet roster alone
    expect(board).not.toContain('characters.find((ch) => ch.id === controlled_character_id)')
  })
})
