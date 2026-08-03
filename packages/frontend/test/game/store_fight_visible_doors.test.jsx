// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 — THE DOORS OF `fight_visible_view`. The view owns six fight-visible records and, until this train,
// only `entities` had a React binding: every other fact had to be fetched through a legacy hook (`useFightView`
// / `useFight` / `useGameState`) or through the dungeon mirror beside the fight core. This file is the doors'
// acceptance assert — one hook per record, each a PURE reader of the memoized view.
//
// WHAT IS DRIVEN, and why it is driven this way: the doors are `useSyncExternalStore(subscribe, snapshot,
// snapshot)` with the SERVER snapshot deliberately equal to the client one. This repo has no jsdom, so a React
// render in a test is `react-dom/server` — the exact path on which zustand v5's own hook would pin a static
// render to `getInitialState` and report every seeded fight EMPTY (the trap game/store.js documents on
// useFightView). The probe below therefore renders the REAL doors over the REAL seeded singleton store and
// asserts live values come back: a door that regressed to a store hook would render the empty session instead.
//
// NOTHING IS MOCKED HERE. `mock.module` is process-global in bun and several suites replace game/store.js with
// a PARTIAL surface — this file must never join them, because game/store.js is the subject.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'

// game/store.js reaches src/auth/index.ts through the engine context, which registers the Enoki wallets at
// module scope (reads window.location, dispatches an app-ready event). Never restored: the graph captures these.
install_browser_globals({ with_document: true })

const { fight_store } = await import('@aresrpg/fight/store')
const { fight_visible_view, my_action_slot } = await import('@aresrpg/fight/project')
const {
  useFightVisibleControls,
  useFightVisibleEntities,
  useFightVisibleMount,
  useFightVisibleResult,
  useFightVisibleSync,
  useFightVisibleTurn,
} = await import('../../src/game/store.js')
const { world_fight_session, world_fight_view } = await import('../../src/world-shell/fight_session_scope.js')

const GRID_W = 20
const FIGHT = '0xdoors_fight'
const ME = '0xdoors_char'
const OWNER = '0xdoors_owner'
const T0 = 1_000_000

const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

/** A decoded-Fight-shaped plain object — the board_state_from_fight input contract. */
const fight_object = (id = FIGHT) => ({
  id,
  status: 1, // ACTIVE
  width: GRID_W,
  height: 19,
  participants: [
    {
      owner: OWNER,
      character: ME,
      class: 'warrior',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 12,
      mp: 3,
      base_ap: 12,
      base_mp: 3,
      cell: 21,
      ready: true,
      casts_this_turn: 0,
      weapon: null,
    },
  ],
  group_template: '0xdoors_mob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [{ template: '0xdoors_mob_t', level: 3, hp: 40, max_hp: 40, cell: 45, ap: 6, mp: 3 }],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: T0 + 90_000,
  turn_entropy: T0 + 90_000,
  turn_ordinal: 1,
  placement_deadline_ms: 0,
  world_seed: 7,
  spawn_id: 3,
  last_action_ms: 0,
})

/** Seed the SINGLETON the doors subscribe to — a live fight at my turn, one cast folded. */
const seed_live_fight = (fight_id = FIGHT) => {
  const { input } = fight_store.getState()
  input({ type: 'init', fight_id, ctx: { my_entity_id: ME, address: OWNER, beat_ctx: { grid_width: GRID_W } } }, T0)
  fight_store.getState().input({ type: 'snapshot', fight: fight_object(fight_id), version: 1 }, T0 + 100)
  fight_store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 })] },
      version: 2,
    },
    T0 + 2_000
  )
  return fight_store.getState()
}

/** Close the session so the next scenario opens clean. */
const clear_fight = () => fight_store.getState().input({ type: 'init', fight_id: null, ctx: {} }, T0)

/** THE PREDICATE THIS TRAIN REPLACED (FightSyncBadge.fight_actor_unresolved, verbatim) — kept here as the
 *  parity REFERENCE so `sync.actor_unresolved` is measured against the exact expression it retired. */
const legacy_actor_unresolved = (fight) => {
  const actor_id = fight?.active_entity_id
  return actor_id == null || !fight?.fighters?.has?.(actor_id)
}

/** Every door, rendered through the real React binding, printed as one data attribute per record. */
function DoorProbe() {
  const turn = useFightVisibleTurn()
  const entities = useFightVisibleEntities()
  const result = useFightVisibleResult()
  const sync = useFightVisibleSync()
  const mount = useFightVisibleMount()
  const controls = useFightVisibleControls()
  return (
    <div
      data-turn-active={String(turn.active_entity_id)}
      data-entities={Object.keys(entities).sort().join(',')}
      data-result-over={String(result.is_over)}
      data-sync-adopted={String(sync.board_adopted)}
      data-mount-scope={String(mount.scope)}
      data-controls-slot={String(controls.action_slot)}
    />
  )
}

test('each door returns its own record of the memoized view, identity-stable per state', () => {
  const state = seed_live_fight()
  const view = fight_visible_view(state)
  // A door is a pure reader: the SAME frozen record object the view published, not a copy and not a re-derivation.
  const html = renderToStaticMarkup(<DoorProbe />)
  expect(html).toContain(`data-turn-active="${view.turn.active_entity_id}"`)
  expect(html).toContain(`data-entities="${Object.keys(view.entities).sort().join(',')}"`)
  expect(html).toContain('data-sync-adopted="true"')
  expect(html).toContain('data-mount-scope="world"')
  expect(html).toContain('data-result-over="false"')
  // The live actor is real: a door pinned to an empty initial state (the zustand/SSR trap) would print "null".
  expect(view.turn.active_entity_id).toBe(ME)
  expect(html).not.toContain('data-turn-active="null"')
  // Referential stability — useSyncExternalStore's hard requirement. Same state in, same record OUT.
  expect(fight_visible_view(fight_store.getState()).turn).toBe(view.turn)
  expect(fight_visible_view(fight_store.getState()).controls).toBe(view.controls)
  clear_fight()
})

test('the CONTROLS record carries the next action slot — the one home every seeded preview prices on', () => {
  const state = seed_live_fight()
  // #1224's one derivation, now reachable through the view's door instead of a raw-core selector.
  expect(fight_visible_view(state).controls.action_slot).toBe(my_action_slot(state))
  expect(fight_visible_view(state).controls.action_slot).toBe(0)
  clear_fight()
})

test('mount + sync answer session scope and the actor verdict exactly as the retired reads did', () => {
  // ① pre-adoption: no board, no scope, no actor.
  clear_fight()
  const fresh = fight_store.getState()
  const fresh_view = fight_visible_view(fresh)
  expect(fresh_view.mount.world_active).toBe(world_fight_view(fresh) != null)
  expect(fresh_view.mount.scope === 'world').toBe(world_fight_session(fresh))
  expect(fresh_view.sync.actor_unresolved).toBe(legacy_actor_unresolved(world_fight_view(fresh)))

  // ② a live WORLD fight with a resolved actor.
  const live = seed_live_fight()
  const live_view = fight_visible_view(live)
  expect(live_view.mount.world_active).toBe(world_fight_view(live) != null)
  expect(live_view.mount.world_active).toBe(true)
  expect(live_view.mount.scope === 'world').toBe(world_fight_session(live))
  expect(live_view.sync.actor_unresolved).toBe(legacy_actor_unresolved(world_fight_view(live)))
  expect(live_view.sync.actor_unresolved).toBe(false)

  // ③ a SIMULATOR session must never light the world shell's chip — the scope partition, both ways.
  clear_fight()
  const sim = seed_live_fight('sim:doors')
  const sim_view = fight_visible_view(sim)
  expect(sim_view.mount.scope).toBe('sim')
  expect(sim_view.mount.world_active).toBe(false)
  expect(sim_view.mount.world_active).toBe(world_fight_view(sim) != null)
  expect(sim_view.mount.scope === 'world').toBe(world_fight_session(sim))
  clear_fight()
})

test('a re-keyed session moves BOTH session-id homes, so the scope door cannot outlive the rekey', () => {
  // #1609 — the presentation gate's `fight_id` and the core's own are two writes of one transition. The mount
  // record reads the CORE's; `world_fight_session` reads the gate's. A rekey that moved only one would show up
  // here as a scope disagreement — which is exactly the class this door has to be immune to.
  clear_fight()
  const opened = seed_live_fight('sim:pending-doors')
  expect(fight_visible_view(opened).mount.scope).toBe('sim')
  fight_store.getState().input({ type: 'rekey', from: 'sim:pending-doors', to: FIGHT }, T0 + 3_000)
  const rekeyed = fight_store.getState()
  expect(fight_visible_view(rekeyed).mount.scope).toBe('world')
  expect(fight_visible_view(rekeyed).mount.scope === 'world').toBe(world_fight_session(rekeyed))
  expect(fight_visible_view(rekeyed).mount.world_active).toBe(world_fight_view(rekeyed) != null)
  clear_fight()
})
