// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals({ with_document: true, with_element: true })

afterAll(restore_browser_globals)

const { createStore } = await import('zustand/vanilla')
const { committed_truth, create_fight_store } = await import('@aresrpg/fight/store')
const { engine_view_of } = await import('@aresrpg/fight/project')
const { decode, encode } = await import('@aresrpg/fight/los')
const { create_sim_chain, submit_staged } = await import('@aresrpg/fight/sim_chain')
const { INVISIBILITY_STATUS_KIND: K_INVISIBILITY } = await import('@aresrpg/fight/fight_status_snapshot')
const { MOB_ATTACK_ID } = await import('@aresrpg/sim/spell_templates')
const { build_teams } = await import('./fight_setup.js')
const { build_seat } = await import('./content.js')
const { create_fight_shim } = await import('./fight_shim.js')

const SEED = 0xc81f3a92
const NOW = 1_700_000_000_000
const SEAT = 'sim_c1'
const VANISH = 'yajin_shadowfold'

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

const character = () => ({
  id: SEAT,
  name: 'KAELIS',
  class_id: 'senshi',
  level: 30,
  stat_alloc: { vitality: 100, wisdom: 0, strength: 45, intelligence: 0, chance: 0, agility: 0 },
  spell_levels: {},
  loadout: {}, // no equipped weapon: the fixture is the player's bare-hands seat
})

const mob_block = () => ({
  template_id: '0xmob_aetherwing',
  name: 'Aetherwing',
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

let fight_seq = 0

const open_fight = () => {
  const roster = [character()]
  const mobs = [mob_block()]
  const probe = create_sim_chain({ seed: SEED, fight_id: 'probe', team0: [], team1: [], templates_raw: [] })
  const ally = probe.board.start_cells_a.map((cell) => decode(Number(cell)))
  const enemy = probe.board.start_cells_b.map((cell) => decode(Number(cell)))
  const { team0, team1 } = build_teams({
    placements: roster.map((row, index) => ({
      cell: ally[index],
      character: row,
      seat: build_seat(row, []),
      spell_ids: [MOB_ATTACK_ID, VANISH],
    })),
    picks: mobs.map((mob, index) => ({ cell: enemy[index], mob })),
    class_templates: new Map(),
  })
  const store = create_fight_store()
  const dungeon = createStore(() => ({ dungeon: {}, busy: false }))
  const tasks = []
  const shim = create_fight_shim({
    store,
    dungeon,
    schedule: (fn) => tasks.push(fn),
    now: () => NOW,
    engine_context: { get_state: () => ({ sui: { characters: roster } }), dispatch: () => {} },
  })
  fight_seq += 1
  const opened = shim.start({
    seed: SEED,
    fight_id: `sim:${SEED}:reentrancy:${fight_seq}`,
    team0,
    team1,
    templates_raw: VANISH_ROWS,
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
    expect(guard).toBeLessThan(200)
  }
  drain()
  const commit = async (actions) => {
    const accepted = await shim.commit_turn(actions)
    drain()
    return accepted
  }
  return { store, shim, commit }
}

const view_of = (rig) => engine_view_of(rig.store.getState())
const sim_me = (rig) => rig.shim.chain().sim_state.team0[0]
const sim_mob = (rig) => rig.shim.chain().sim_state.team1[0]
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))

const fold_receipt_during_notification = (rig, result) => {
  let reentered = false
  const unsubscribe = rig.store.subscribe(() => {
    if (reentered) return
    reentered = true
    rig.store.getState().input({
      type: 'receipt',
      fight_id: rig.shim.chain().fight_id,
      version: result.version,
      receipt: result.receipt,
    })
  })
  // `hand_update` changes the adapter but is a core no-op. Its notification is the exact hostile window: the
  // authoritative receipt above re-enters before the outer call installs its core fold.
  rig.store.getState().input({ type: 'hand_update', entity_id: SEAT, hand: ['reentrancy-probe'] }, NOW)
  unsubscribe()
  expect(reentered).toBe(true)
}

const open_neighbor = (chain, origin) => {
  const occupied = new Set(
    [...chain.sim_state.team0, ...chain.sim_state.team1]
      .filter((row) => row.health > 0)
      .map((row) => `${row.cell.x},${row.cell.y}`)
  )
  return [
    { x: origin.x + 1, y: origin.y },
    { x: origin.x - 1, y: origin.y },
    { x: origin.x, y: origin.y + 1 },
    { x: origin.x, y: origin.y - 1 },
  ].find(
    (cell) =>
      cell.x >= 0 &&
      cell.y >= 0 &&
      cell.x < chain.arena.width &&
      cell.y < chain.arena.height &&
      chain.arena.cells[cell.y * chain.arena.width + cell.x] === 0 &&
      !occupied.has(`${cell.x},${cell.y}`)
  )
}

describe('#1615 · the simulator keeps every committed row across later inputs', () => {
  test('the bare-hands seat’s attack leaves the target HP delta committed', async () => {
    const rig = open_fight()
    for (let turn = 0; turn < 40 && chebyshev(sim_me(rig).cell, sim_mob(rig).cell) > 1; turn += 1)
      expect(await rig.commit([])).toBe(true)

    const before = sim_mob(rig).health
    expect(chebyshev(sim_me(rig).cell, sim_mob(rig).cell)).toBeLessThanOrEqual(1)
    const result = submit_staged(
      rig.shim.chain(),
      [
        {
          kind: 1,
          target: encode(sim_mob(rig).cell.x, sim_mob(rig).cell.y),
          spell_template_id: MOB_ATTACK_ID,
          spell_key: MOB_ATTACK_ID,
        },
      ],
      SEAT,
      { now_ms: NOW }
    )
    fold_receipt_during_notification(rig, result)

    const landed = result.chain.sim_state.team1[0].health
    expect(landed).toBeLessThan(before)
    expect(view_of(rig).fighters.get('mob-0').committed_health).toBe(landed)
  })

  test('a self-buff followed by MOVE keeps the buff rows', async () => {
    const rig = open_fight()
    const from = { ...sim_me(rig).cell }
    const destination = open_neighbor(rig.shim.chain(), from)
    expect(destination).toBeDefined()

    const result = submit_staged(
      rig.shim.chain(),
      [
        { kind: 1, target: encode(from.x, from.y), spell_template_id: VANISH, spell_key: VANISH },
        { kind: 0, target: encode(destination.x, destination.y) },
      ],
      SEAT,
      { now_ms: NOW }
    )
    fold_receipt_during_notification(rig, result)

    expect(result.chain.sim_state.team0[0].cell).toEqual(destination)
    expect(
      (committed_truth(rig.store.getState()).fighters.p0.statuses ?? []).map((effect) => Number(effect.kind))
    ).toContain(K_INVISIBILITY)
    expect((view_of(rig).fighters.get(SEAT).effects ?? []).map((effect) => Number(effect.kind))).toContain(
      K_INVISIBILITY
    )
  })

  test('the same cast + MOVE sequence keeps the cooldown record', async () => {
    const rig = open_fight()
    const from = { ...sim_me(rig).cell }
    const destination = open_neighbor(rig.shim.chain(), from)
    expect(destination).toBeDefined()

    const result = submit_staged(
      rig.shim.chain(),
      [
        { kind: 1, target: encode(from.x, from.y), spell_template_id: VANISH, spell_key: VANISH },
        { kind: 0, target: encode(destination.x, destination.y) },
      ],
      SEAT,
      { now_ms: NOW }
    )
    fold_receipt_during_notification(rig, result)

    expect(result.chain.sim_state.cast_history[`${SEAT}:${VANISH}`]).toEqual({
      last_turn: 1,
      casts_this_turn: 1,
    })
    expect(Object.values(rig.store.getState().core.inbox.log).some((action) => action.kind === 'Cast')).toBe(true)
  })
})
