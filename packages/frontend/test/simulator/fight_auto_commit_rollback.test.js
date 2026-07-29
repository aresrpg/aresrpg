// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SIMULATOR'S AUTO-PASS ROLLBACK (owner live report): "I had moved to a cell, auto turn pass put me back on
// the starting one" — with the mob then casting its VFX on the cell he had MOVED TO, and the damage landing.
// The same session also reported "my buffs are always gone when I end my turn".
//
// MECHANISM (one root, both symptoms). The deadline auto-commit is a zustand SUBSCRIBER: `subscribe_commit_due`
// (fight/txs.js) observes the reducer's `commit_due` projection and fires `submit()` synchronously from inside the
// notification of the very `input({type:'tick'})` that raised the flag. On chain that is harmless — the submit
// crosses the network, so its receipt re-enters the ONE door from a LATER task. The simulator's local chain is
// PURE and SYNCHRONOUS, so the whole submit → fold → `input({type:'receipt'})` ran INSIDE that notification, and
// `with_core_fold` (fight/store.js) folds the core BEFORE calling the door and writes it back AFTER:
//
//     const core = ingest(get().core, envelope, now)      // folded off the PRE-tick core
//     const result = door(msg, now, core)                 // ← the nested receipt input happens in here
//     set((s) => (core === s.core ? s : { ...s, core }))  // ← overwrites the nested fold's core
//
// so every row of the player's own committed turn was admitted and then discarded on the outer call's way out.
// The SIM kept the move (the mob planned against the moved-to cell and hit it); the client's committed truth fell
// back to the adopted base snapshot — the fight's START cell — and the same turn's status rows went with it.
// The mob cascade was never affected: `pump_mobs` already defers through `schedule`, so its receipts land outside
// the notification. That is exactly the asymmetry the live report describes.
//
// THE FIX (fight_shim.js): the local chain's submit leaves the caller's synchronous stack before it folds, the
// same way a chain submit does. Nothing here is simulator-special pleading — it is the effect-edge contract the
// rest of the fight core is built on.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore_browser_globals)

const { fight_store } = await import('@aresrpg/fight/store')
const { fight_view } = await import('@aresrpg/fight/project')
const { decode, encode } = await import('@aresrpg/fight/los')
const { create_sim_chain } = await import('@aresrpg/fight/sim_chain')
const { subscribe_commit_due, staged_turn_paths } = await import('@aresrpg/fight/txs')
const { local_move_beats } = await import('@aresrpg/fight/present')
const { INVISIBILITY_STATUS_KIND: K_INVISIBILITY } = await import('@aresrpg/fight/fight_status_snapshot')
const { build_teams } = await import('../../src/simulator/fight_setup.js')
const { build_seat } = await import('../../src/simulator/content.js')
const { create_fight_shim } = await import('../../src/simulator/fight_shim.js')

const SEED = 0xc81f3a92
const START_MS = 1_700_000_000_000
const VANISH = 'yajin_shadowfold'

// The published corpus rows for a point self-cast granting invisibility for three turns (the same authored shape
// `fight_status_chip.test.jsx` pins — one home for what this spell is, restated here only as test input).
const VANISH_ROWS = [
  {
    id: VANISH,
    name: 'Vanish',
    classType: 'yajin',
    element: 'air',
    levels: [
      {
        min_char_level: 1,
        ap_cost: 2,
        range_min: 0,
        range_max: 0,
        line_of_sight: true,
        cooldown_turns: 11,
        crit_rate: 0,
        effects: [
          {
            kind: K_INVISIBILITY,
            element: 255,
            value: 1,
            area_shape: 0,
            area_size: 0,
            target_filter: 32,
            chance: 100,
            turns: 3,
            stat: 0,
            flags: 0,
            phase: 0,
          },
        ],
        crit_effects: [],
      },
    ],
  },
]

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

const SEAT = 'sim_c1'

/**
 * One seat + one mob on the seed's own board, opened through the production shim, with the REAL deadline
 * auto-commit edge installed exactly as `DungeonBoard` installs it (`subscribe_commit_due` → the live staged
 * draft → the store-injected `commit_turn`). The macrotask pump is drained by hand; the clock is a value.
 */
const open_fight = (templates_raw = []) => {
  const clock = { now: START_MS }
  const roster = [character(SEAT, 'KAELIS')]
  const mobs = [mob_block('aetherwing')]
  const probe = create_sim_chain({ seed: SEED, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const ally = probe.board.start_cells_a.map((cell) => decode(Number(cell)))
  const enemy = probe.board.start_cells_b.map((cell) => decode(Number(cell)))
  const { team0, team1 } = build_teams({
    placements: roster.map((row, index) => ({
      cell: ally[index],
      character: row,
      seat: build_seat(row, []),
      spell_ids: [VANISH],
    })),
    picks: mobs.map((mob, index) => ({ cell: enemy[index], mob })),
    class_templates: new Map(),
  })
  const tasks = []
  const shim = create_fight_shim({
    schedule: (fn) => tasks.push(fn),
    now: () => clock.now,
    // The engine global is not this test's subject and its shape depends on whatever else the suite booted, so
    // the shim's own injection seam supplies a seated stub: the roster guard reads it and never dispatches.
    engine_context: { get_state: () => ({ sui: { characters: roster } }), dispatch: () => {} },
  })
  const opened = shim.start({
    seed: SEED,
    fight_id: `sim:${SEED}:auto`,
    team0: team0.map((entity) => ({ ...entity, deck: Array.from({ length: 24 }, () => VANISH) })),
    team1,
    templates_raw,
    roster,
    mobs,
    focus_id: SEAT,
  })
  expect(opened.ok).toBe(true)
  const drain = () => {
    let guard = 0
    while (tasks.length && guard < 200) {
      guard += 1
      tasks.shift()()
    }
  }
  drain()
  // The board's own auto-submit edge, verbatim: read the LIVE staged draft, commit it in the background.
  const stop_edge = subscribe_commit_due(fight_store, {
    submit: () => shim.commit_turn(staged_turn_paths(fight_store).draft_actions, { background: true }),
    on_error: () => {},
  })
  return { shim, clock, drain, stop_edge }
}

const me_of = () => fight_view(fight_store.getState())?.fighters?.get(SEAT)
const sim_row = (shim) => shim.chain().sim_state.team0.find((row) => row.id === SEAT)

/** Let the deadline lapse and tick the reducer — the ONE edge that fires the background pass. */
const auto_pass = async ({ shim, clock, drain }) => {
  clock.now += 44_000
  fight_store.getState().input({ type: 'tick' }, clock.now)
  await Promise.resolve()
  await Promise.resolve()
  fight_store.getState().input({ type: 'clear_staged' })
  drain()
  await Promise.resolve()
  return shim
}

describe('the simulator’s deadline auto-pass keeps the turn it committed', () => {
  test('a staged move survives the auto pass — the client stands where the sim put it, never back on the start cell', async () => {
    const { shim, clock, drain, stop_edge } = open_fight()
    const start_cell = { ...me_of().cell }
    const destination = { x: start_cell.x, y: start_cell.y + 1 }
    const encoded = encode(destination.x, destination.y)

    // The board's move draft: one staged step + its optimistic walk, then the walk's own wave acked (the rig
    // finished walking long before a 45s deadline lapses).
    fight_store.getState().input({ type: 'stage', intent: { kind: 0, target: encoded, landed: true } })
    fight_store.getState().input({
      type: 'intent',
      intent: { kind: 'move', character: SEAT, to_cell: encoded, mp_left: 2 },
      beats: local_move_beats({
        fight_id: shim.chain().fight_id,
        character: SEAT,
        to_cell: encoded,
        path: [destination],
      }),
    })
    for (const turn of fight_store.getState().wave ?? [])
      fight_store.getState().input({ type: 'presented', seq: turn.seq }, clock.now)
    expect(me_of().cell).toEqual(destination)

    await auto_pass({ shim, clock, drain })
    stop_edge()

    // THE AUTHORITY MOVED — the mob planned its whole turn against this cell, which is why the live report saw
    // the spell land on the cell it had been rolled back OFF of.
    expect(sim_row(shim).cell).toEqual(destination)
    // …AND SO MUST THE CLIENT. The reported symptom is exactly this pair disagreeing, with the client back on the
    // cell the fight STARTED on.
    expect(me_of().cell).not.toEqual(start_cell)
    expect(me_of().cell).toEqual(sim_row(shim).cell)
  })

  test('a staged self-buff survives the auto pass — the chip does not vanish with the turn that cast it', async () => {
    const { shim, clock, drain, stop_edge } = open_fight(VANISH_ROWS)
    const { cell } = me_of()
    expect((me_of().effects ?? []).length).toBe(0)

    fight_store.getState().input({
      type: 'stage',
      intent: { kind: 1, target: encode(cell.x, cell.y), spell_key: VANISH, spell_template_id: VANISH },
    })

    await auto_pass({ shim, clock, drain })
    stop_edge()

    // The sim granted it (3 turns, one burned by the caster's own turn end) — so the HUD must hold it too.
    expect(sim_row(shim).effects.length).toBeGreaterThan(0)
    expect((me_of().effects ?? []).map((effect) => Number(effect.kind))).toContain(K_INVISIBILITY)
  })
})
