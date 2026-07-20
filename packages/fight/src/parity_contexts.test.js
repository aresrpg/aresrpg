// GATE D — cross-context state-hash parity (FIGHT_REWRITE_DESIGN enforcement §2): the SAME
// scripted fight driven through all three contexts (world · dungeon · kolizeum) must produce IDENTICAL
// fight-core state-transition hashes — context cannot alter fight semantics BY CONSTRUCTION. The contexts
// differ ONLY in the ctx a shim supplies (run / rooms / wager routing); the canonical fight state (fighters,
// turn machine, winner) must be byte-identical at every step. The localnet gold twin is the multi-turn
// fight_lifecycle row; this unit row runs in `ares test fightcore` AND the default gate.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'
import { state_hash } from './inputs.js'

const FIGHT = '0xf1'
const ev = (suffix, parsedJson) => ({
  type: `0x0::fight_events::${suffix}`,
  parsedJson: { fight: FIGHT, ...parsedJson },
})

// One scripted fight: mob0 turn (move + cast + hit on p0) → my turn opens → my cast kills m0 → victory.
const SCRIPT = [
  {
    type: 'receipt',
    version: 5,
    events: [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 111_000 }),
      ev('MobMoved', { idx: 0, to_cell: 45 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0 }),
      ev('Hit', { victim_is_mob: false, victim_idx: 0, remaining_hp: 37 }),
      ev('TurnEnded', { is_mob: true, idx: 0 }),
      ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 222_000 }),
    ],
  },
  {
    type: 'receipt',
    version: 6,
    events: [
      ev('Cast', { caster_is_mob: false, caster_idx: 0 }),
      ev('Hit', { victim_is_mob: true, victim_idx: 0, remaining_hp: 0 }),
      ev('Victory', {}),
    ],
  },
]

// The three context shims differ ONLY in ctx payload — exactly what a shim is allowed to supply.
const CONTEXTS = {
  world: { address: '0xaaa', my_entity_id: '0xc1', creator: '0xaaa' },
  dungeon: {
    address: '0xaaa',
    my_entity_id: '0xc1',
    creator: '0xaaa',
    run: { id: '0xr1', room: 1, world: '0xw1' },
    rooms_total: 3,
    mob_names: { '0xt1': 'Frost Wolf' },
  },
  kolizeum: { address: '0xaaa', my_entity_id: '0xc1', creator: '0xaaa', wager_mist: 1_000_000 },
}

describe('gate d — cross-context fight-core parity', () => {
  test('identical scripted fight → identical hash sequence in all three contexts', () => {
    const sequences = Object.entries(CONTEXTS).map(([name, ctx]) => {
      const store = create_fight_store()
      store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx })
      const hashes = SCRIPT.map((msg) => {
        store.getState().input(msg, 1_000)
        return state_hash(store.getState())
      })
      return { name, hashes }
    })
    const [world, dungeon, kolizeum] = sequences
    expect(dungeon.hashes).toEqual(world.hashes)
    expect(kolizeum.hashes).toEqual(world.hashes)
    // And the script actually progressed: distinct hashes per step, terminal victory folded.
    expect(new Set(world.hashes).size).toBe(SCRIPT.length)
  })

  test('terminal state is context-invariant: p0 alive at 37hp, m0 dead, winner 0', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: CONTEXTS.dungeon })
    for (const msg of SCRIPT) store.getState().input(msg, 1_000)
    const s = store.getState()
    expect(s.fighters.p0).toMatchObject({ hp: 37, alive: true })
    expect(s.fighters.m0).toMatchObject({ hp: 0, alive: false })
    expect(s.winner).toBe(0)
  })
})
