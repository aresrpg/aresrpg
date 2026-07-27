// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/fight_hud_cast.test.jsx — THE SIM CASTS GATE (#916 + #922). Two structural gaps stood between the
// simulator's fight phase and full world parity, and this file is the red that held them both:
//
//   #916 — `SpellBar` was declared INSIDE `world/GameWorldHud.jsx` and never exported, so the sim's fight HUD
//          rendered movement and END TURN with no spell sockets at all. The bar is now its own module; the tests
//          below render it against a LIVE sim fight, pin its markup, and hold the one-module wiring down.
//   #922 — every commit the sim fired was refused. `fight_shim`'s `commit_turn` read the active seat off
//          `store.getState().view.active_entity_id`, but `active_entity_id` is a field of the PROJECTION
//          (`fight_view`, project.js:508) and has never existed on the raw `view` slice — so the seat was
//          `undefined` on every press, the turn never ended and the board only whispered `flush_finished
//          ok:false`. The cast test below drives the SAME door the board's flush calls.
//
// Nothing is mocked but the clock and the macrotask pump: the local chain is real (`@aresrpg/fight/sim_chain`),
// the fight core is the production store, and the draft handed to `commit_turn` is exactly the staged-row shape
// `DungeonBoard.flush_commit` composes.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore_browser_globals)

const { renderToStaticMarkup } = await import('react-dom/server')
const { I18nextProvider } = await import('react-i18next')
const { default: i18n } = await import('../i18n')
const { encode, decode } = await import('@aresrpg/fight/los')
const { create_sim_chain } = await import('@aresrpg/fight/sim_chain')
const { fight_store } = await import('@aresrpg/fight/store')
const { fight_view } = await import('@aresrpg/fight/project')
const { MOB_ATTACK_ID } = await import('@aresrpg/sim/spell_templates')
const { build_teams } = await import('./fight_setup.js')
const { build_seat } = await import('./content.js')
const { create_fight_shim } = await import('./fight_shim.js')
const { SpellBar } = await import('../game/screens/hud/SpellBar.jsx')
const { reset_walrus_assets_for_test } = await import('@aresrpg/sdk/jobs')

// The pinned markup now holds FILLED sockets (#949 — a fight's dealt hand reaches the bar), and a filled
// socket carries its spell-art URL. That URL is resolved off the process-wide asset manifest, which any
// earlier test file in the run may have configured — so the snapshot would say `/assets/…` alone and
// `https://cdn…/walrus/…` inside the suite. Reset to the unpublished default: one URL shape, either way.
reset_walrus_assets_for_test()

const SEED = 0xc81f3a92
const NOW = 1_700_000_000_000

const character = (id, name) => ({
  id,
  name,
  class_id: 'senshi',
  level: 30,
  stat_alloc: { vitality: 100, wisdom: 0, strength: 45, intelligence: 0, chance: 0, agility: 0 },
  spell_levels: {},
  loadout: {},
})

const mob_block = (name) => ({
  template_id: `0xmob_${name}`,
  name,
  element: 3,
  role: 'striker',
  level: 6,
  min_level: 4,
  max_level: 8,
  hp: 30,
  max_hp: 30,
  ap: 6,
  mp: 3,
  stats: {},
  combat_block_published: true,
})

/**
 * Open a real sim fight through the production shim. The board is the seed's own derivation (probed first, as
 * `fight_e2e.test.js` does), so the seats stand on cells the chain actually placed them on; `schedule` runs the
 * mob pump synchronously so a test never waits on a macrotask.
 */
const open_fight = () => {
  const roster = [character('sim_c1', 'KAELIS'), character('sim_c2', 'VORREN')]
  const mobs = [mob_block('aetherwing'), mob_block('gronk')]
  const probe = create_sim_chain({ seed: SEED, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const ally = probe.board.start_cells_a.map((cell) => decode(Number(cell)))
  const enemy = probe.board.start_cells_b.map((cell) => decode(Number(cell)))
  const { team0, team1 } = build_teams({
    placements: roster.map((row, index) => ({
      cell: ally[index],
      character: row,
      seat: build_seat(row, []),
      spell_ids: [MOB_ATTACK_ID],
    })),
    picks: mobs.map((mob, index) => ({ cell: enemy[index], mob })),
    class_templates: new Map(),
  })
  const shim = create_fight_shim({ schedule: (fn) => fn(), now: () => NOW })
  const opened = shim.start({
    seed: SEED,
    fight_id: `sim:${SEED}:1`,
    team0,
    team1: team1.map((entity) => ({ ...entity, spell_levels: { [MOB_ATTACK_ID]: 1 } })),
    templates_raw: [],
    roster,
    mobs,
    focus_id: 'sim_c1',
  })
  return { shim, opened, roster }
}

const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
const entity_of = (chain, id) => [...chain.sim_state.team0, ...chain.sim_state.team1].find((row) => row.id === id)

/**
 * The staged row `DungeonBoard.flush_commit` composes for a cast: `{kind:1}` with the ENCODED target cell and
 * the SpellTemplate id — byte-for-byte the shape the board hands `commit_turn`.
 *
 * Only the CAST is drafted, never a move: the seed's board has real walls, and pathing a seat across them is
 * the movement lane's problem, not this gate's. The mobs close on their own (their planner paths properly), so
 * the roster passes its turns until one is in `mob_attack` reach (range [1,1]) and then hits it — which
 * exercises the door in BOTH of its shapes, the bare pass and the loaded draft.
 */
const cast_draft = (chain, entity_id) => {
  const me = entity_of(chain, entity_id)
  const living = chain.sim_state.team1.filter((mob) => mob.health > 0)
  if (!me || living.length === 0) return { rows: [], target: null }
  const target = living.reduce((best, mob) =>
    chebyshev(me.cell, mob.cell) < chebyshev(me.cell, best.cell) ? mob : best
  )
  if (chebyshev(me.cell, target.cell) > 1) return { rows: [], target }
  return {
    rows: [
      {
        kind: 1,
        target: encode(target.cell.x, target.cell.y),
        spell_template_id: MOB_ATTACK_ID,
        spell_key: MOB_ATTACK_ID,
      },
    ],
    target,
  }
}

/**
 * Play the roster's turns through the shim's injected door until one of them lands a CAST. Every commit along
 * the way must be ACCEPTED — that is the #922 regression stated as a loop invariant, and before the fix not one
 * of them was.
 */
const play_until_cast = async (shim, max_turns = 40) => {
  for (let turn = 0; turn < max_turns; turn += 1) {
    const seat = fight_view(fight_store.getState())?.active_entity_id
    if (!seat || shim.chain().sim_state.winner !== -1) return null
    const { rows, target } = cast_draft(shim.chain(), seat)
    if (!target) return null
    const casting = rows.length > 0
    const before = target.health
    const accepted = await shim.commit_turn(rows)
    if (!accepted) return { refused: true, turn }
    if (casting) return { target_id: target.id, before, after: entity_of(shim.chain(), target.id).health }
  }
  return null
}

describe('#916 · the spell bar renders off a LIVE sim fight', () => {
  test('the extracted bar draws the optE box, the gem vitals and the full socket row', () => {
    const { opened } = open_fight()
    expect(opened.ok).toBe(true)
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <SpellBar />
      </I18nextProvider>
    )
    // the bar, its two halves, and the FIXED socket row (weapon + 9 slots — SPELL_SLOTS holds the width open
    // whether or not a spell is learned, so this count is the bar's structural contract, not a content assertion)
    expect(html).toContain('hud-spellbar--optE')
    expect(html).toContain('hud-spellbar2__top')
    expect(html).toContain('hud-vbox')
    expect(html).toContain('hud-socketgrid')
    expect(html.match(/hud-socket\b/g)?.length ?? 0).toBeGreaterThanOrEqual(10)
  })

  // ZERO-DRIFT PIN (#914): the bar moved out of GameWorldHud VERBATIM — the only textual delta in the whole
  // moved block is the `export` keyword. This snapshot is what keeps the WORLD composition byte-identical from
  // here on: the world and the sim render THIS markup or neither does, because it is one module.
  test('its markup is pinned — a change here changes the world fight too', () => {
    open_fight()
    expect(
      renderToStaticMarkup(
        <I18nextProvider i18n={i18n}>
          <SpellBar />
        </I18nextProvider>
      )
    ).toMatchSnapshot()
  })

  // THE MOUNT is asserted at the source, and deliberately so: `use_fight_phase` reads `use_dungeon`, and zustand
  // v5 pins a bound store's SERVER snapshot to `getInitialState` (the override lands on the hook function, never
  // on the api object `useStore` closes over), so `react-dom/server` renders the phase-gated layer as null no
  // matter what the fight is doing. The real mount gate is the driven browser capture on the PR; this holds the
  // wiring down between captures — one module, imported by both compositions.
  test('BOTH compositions mount the ONE module (no sim copy of the bar exists)', async () => {
    const read = async (path) => await Bun.file(new URL(path, import.meta.url)).text()
    const sim = await read('./FightHud.jsx')
    const world = await read('../game/screens/hud/world/GameWorldHud.jsx')
    expect(sim).toContain("from '../game/screens/hud/SpellBar.jsx'")
    expect(sim).toContain('<SpellBar />')
    expect(world).toContain("from '../SpellBar.jsx'")
    expect(world).toContain('<SpellBar />')
    // the bar is DECLARED in exactly one place — a second `function SpellBar` anywhere is the drift this forbids
    expect(world).not.toContain('function SpellBar')
  })
})

describe('#922 · a sim commit reaches the local chain instead of being silently refused', () => {
  test('a ZERO-draft END TURN passes the turn — the bare pass the button sends with nothing staged', async () => {
    const { shim } = open_fight()
    const seat = fight_view(fight_store.getState())?.active_entity_id
    expect(seat).toBeTruthy() // the projection is the ONLY home of the active seat (the #922 misread)
    const version_before = shim.chain().version

    const accepted = await shim.commit_turn([])

    expect(accepted).toBe(true)
    expect(shim.chain().version).toBeGreaterThan(version_before)
    // the turn genuinely MOVED ON — the pointer left my seat ("the turn never ends", inverted)
    expect(fight_view(fight_store.getState())?.active_entity_id).not.toBe(seat)
  })

  test('a drafted move+cast folds: every commit is accepted and the mob loses health', async () => {
    const { shim } = open_fight()

    const landed = await play_until_cast(shim)

    expect(landed).not.toBeNull()
    expect(landed.refused).toBeUndefined() // not one refusal along the way — the #922 loop, inverted
    expect(landed.after).toBeLessThan(landed.before)
  })
})
