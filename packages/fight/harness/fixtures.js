// @aresrpg/fight harness — shared HEADLESS fixtures + drivers for the acceptance pack (test/**).
// Plain chain-shaped objects driven through the ONE door `input(msg, now)`: no DOM, no chain, explicit
// clocks. Anything that speaks this protocol can play the game — the CLI playthrough test is the proof.

import { create_fight_store } from '../src/store.js'

export const FIGHT = '0xf1647'
export const ME = '0xchar_a'
export const PEER = '0xchar_b'
export const T0 = 1_000_000

/** A chain event exactly as a receipt carries it ({ type, parsedJson }). */
export const ev = (kind, json) => ({ type: `0xpkg::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

/** A decoded-Fight participant row (the board_state_from_fight input contract). */
export const participant = (character, cell, over = {}) => ({
  owner: '0xa11ce',
  character,
  class: 'warrior',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready: true,
  casts_this_turn: 0,
  weapon: null,
  ...over,
})

export const mob = (cell, over = {}) => ({
  template: '0xmob_t',
  level: 3,
  hp: 20,
  max_hp: 20,
  cell,
  ap: 6,
  mp: 3,
  ...over,
})

/** A decoded-Fight-shaped PLAIN object (status 1 = ACTIVE). */
export const fight_object = ({
  status = 1,
  participants = [participant(ME, 21)],
  mobs = [mob(45)],
  deadline = 0,
} = {}) => ({
  id: FIGHT,
  status,
  width: 20,
  height: 19,
  participants,
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs,
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: deadline,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

/** init → adopt `fight` at v1 → open MY playable turn at v2 (chain deadline `deadline`). turn_started_at
 *  stamps at now+100 (the playable rising edge — the min-turn floor's anchor). */
export const active_store = ({ fight = fight_object(), deadline = T0 + 30_000, now = T0 } = {}) => {
  const store = create_fight_store()
  store
    .getState()
    .input(
      { type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, address: '0xa11ce', beat_ctx: { grid_width: 20 } } },
      now
    )
  store.getState().input({ type: 'snapshot', fight, version: 1 }, now + 10)
  store.getState().input(
    {
      type: 'receipt',
      receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: deadline })] },
      version: 2,
    },
    now + 100
  )
  return store
}
