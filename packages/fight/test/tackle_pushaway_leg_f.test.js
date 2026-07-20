// LEG F — TACKLE FROM A PUSHED-AWAY MOB — a bug where pushing a mob away still let it tackle, because the
// fight thought it was still adjacent. The client's move-tackle preview (project.next_move_tackle / move_wash)
// must read the POST-push predicted cells: a mob a drafted push has already displaced out of adjacency locks
// nothing. tackle_lockers reads the PRESENTED fold (post-push) under cast_first — this pins that contract.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { next_move_tackle, move_wash } from '../src/project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB_ADJ = enc(6, 5) // orthogonally adjacent to ME — locks my move
const MOB_AWAY = enc(9, 5) // 4 cells off — no longer adjacent

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  world_seed: 12345,
  spawn_id: 7,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 9,
      mp: 4,
      base_ap: 9,
      base_mp: 4,
      hp: 50,
      max_hp: 50,
      cell: ME,
      stats: { agility: 10 },
    },
  ],
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: MOB_ADJ, ap: 4, mp: 3, level: 1, stats: { agility: 300 } }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const push_mob = (store) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'push1',
      actions: [
        { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB_ADJ, ap_cost: 3 },
        { kind: 'Displaced', target_is_mob: true, target_idx: 0, to_cell: MOB_AWAY },
      ],
      beats: [
        { kind: 'cast', at: 0, duration: 100, payload: {} },
        { kind: 'displacement', at: 100, duration: 200, payload: {} },
      ],
    },
    1_100
  )

describe('LEG F — a pushed-away mob no longer tackles my move', () => {
  test('baseline: an adjacent mob DOES lock my move (the tackle preview is live)', () => {
    const store = boot()
    expect(next_move_tackle(store.getState()), 'the adjacent high-agility mob tackles').not.toBeNull()
    expect(move_wash(store.getState(), {}).tackled, 'the wash paints the tackle band').toBe(true)
  })

  test('after a drafted push moves the mob out of adjacency, no tackle is predicted', () => {
    const store = boot()
    push_mob(store)
    expect(next_move_tackle(store.getState()), 'the pushed-away mob locks nothing').toBeNull()
    expect(move_wash(store.getState(), {}).tackled, 'the wash shows a free move (no red band)').toBe(false)
  })
})
