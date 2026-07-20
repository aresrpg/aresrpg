import { afterAll, afterEach, describe, expect, it, spyOn } from 'bun:test'

import * as sfx from '../audio/sfx.js'

// Headless wiring test for the fight-SFX caster layer (default `bun test`, no browser). Mocks the sfx module
// so we can OBSERVE which element+layer fired, feeds fake `packet/fightCastResult` events through a stub bus,
// and asserts: the CASTER whoosh voices the instant the packet arrives with the spell's element, the impact
// layer is NEVER fired here (the adapter owns it on the orb's land), mobs are skipped, and a duplicate
// same-caster dispatch is throttled. The real element_of_spell resolves the element (dungeon_strike → fire).

// bun's mock.module persists for the WHOLE test process (no un-mock API): every test file loaded after this
// one that touches sfx.js (directly or transitively) resolves it to THIS object. The mock must therefore mirror
// sfx.js's FULL export surface — a missing export is a hard module-load error in whichever file imports it next
// (proven: this mock exporting play_element_sfx ALONE made the full-suite count flicker 513/0 ↔ 505/2 depending
// on file-enumeration order, bisected 2026-07-10). Keep this object's keys in lockstep with sfx.js's exports.
const play = spyOn(sfx, 'play_element_sfx').mockImplementation(() => {})
const play_one = spyOn(sfx, 'play_sfx').mockImplementation(() => {})

const { default: fight_sfx } = await import('./fight-sfx.js')
const { fight_store } = await import('@aresrpg/fight')

/** Boot the REAL fight core to the given identity facts (S2 mirror kill: the module reads fight_view(), the
 *  synchronous core projection — there is no injectable `state.fight` copy anymore). `null` ⇒ no live fight. */
const seed_core = (fight) => {
  const { input } = fight_store.getState()
  if (!fight) {
    input({ type: 'init', fight_id: null })
    return
  }
  input({ type: 'init', fight_id: fight.fight_id, my_key: 'p0', ctx: { my_entity_id: fight.my_entity_id } })
  input({
    type: 'snapshot',
    version: 1,
    fight: {
      id: fight.fight_id,
      status: 1,
      width: 20,
      height: 19,
      participants: [
        {
          owner: '0xaaa',
          character: fight.my_entity_id,
          team: 0,
          ap: 6,
          mp: 3,
          base_ap: 6,
          base_mp: 3,
          hp: 50,
          max_hp: 50,
          cell: 100,
        },
      ],
      mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 }],
      queue: [
        { is_mob: false, idx: 0 },
        { is_mob: true, idx: 0 },
      ],
      turn_ptr: 0,
      turn_deadline_ms: 90_000,
    },
  })
}

/** Wire one module instance to a stub bus; returns dispatch(packet) for `packet/fightCastResult`. */
const mount = (fight = { fight_id: 'f1', my_entity_id: '0xme' }) => {
  seed_core(fight)
  /** @type {Record<string, Function>} */
  const handlers = {}
  const events = {
    on: (name, fn) => {
      handlers[name] = fn
    },
  }
  fight_sfx().observe({ events })
  return (packet) => handlers['packet/fightCastResult'](packet)
}

const cast_packet = (entity_id = 'me', spell_id = 'dungeon_strike') => ({
  fight_id: 'f1',
  entity_id,
  spell_id,
  target: { x: 1, y: 1 },
  effects: [{ target_id: 'mob-0', damage: 12, killed: false }],
})

afterEach(() => {
  play.mockClear()
  play_one.mockClear()
})

afterAll(() => {
  play.mockRestore()
  play_one.mockRestore()
  seed_core(null) // the core is a process-wide singleton — leave no live fight for later test files
})

describe('fight-sfx — caster-layer wiring (F1)', () => {
  it('voices the element caster whoosh the instant the packet arrives (dungeon_strike → fire)', () => {
    mount()(cast_packet())
    expect(play).toHaveBeenCalledWith('fire', 'cast')
  })

  it('resolves the element from the spell_id — a non-fire id falls back to neutral', () => {
    mount()(cast_packet('me', 'mob_attack_dungeon'))
    expect(play).toHaveBeenCalledWith('neutral', 'cast')
  })

  it('NEVER fires the impact layer — the adapter voices it on the orb land (one home, both paths)', () => {
    mount()(cast_packet())
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.calls.every(([, layer]) => layer === 'cast')).toBe(true)
  })

  it('throttles a duplicate same-caster dispatch (one caster whoosh never double-voices)', () => {
    const dispatch = mount()
    dispatch(cast_packet('me'))
    dispatch(cast_packet('me'))
    expect(play.mock.calls.length).toBe(1)
  })

  it('voices a distinct PLAYER caster even within the throttle window', () => {
    const dispatch = mount()
    dispatch(cast_packet('me'))
    dispatch(cast_packet('0xpeer')) // a co-op peer's cast — distinct player, voices too
    expect(play.mock.calls.length).toBe(2)
  })

  it('SKIPS mob casters entirely — the adapter voices mobs inside their paced replay slot (beat-sync law)', () => {
    mount()(cast_packet('mob-0'))
    expect(play).not.toHaveBeenCalled()
  })

  it('ignores a packet with no caster id', () => {
    mount()({ spell_id: 'dungeon_strike' })
    expect(play).not.toHaveBeenCalled()
  })

  it('a physical weapon swing has no caster-layer sound — no magic windup on a melee attack', () => {
    mount()(cast_packet('me', '__weapon_attack'))
    expect(play).not.toHaveBeenCalled()
  })
})

describe('fight-sfx — player death sting (a distinct death sound for players, separate from the generic kill sting)', () => {
  const death_packet = (target_id = '0xme', caster = 'mob-0') => ({
    fight_id: 'f1',
    entity_id: caster,
    spell_id: 'mob_attack',
    effects: [{ target_id, damage: 40, killed: true }],
  })

  it('voices the player-death sting when a killing effect names MY fighter', () => {
    mount()(death_packet('0xme'))
    expect(play_one).toHaveBeenCalledWith('player_death')
  })

  it('does NOT fire when the kill is someone else (a mob dies, not me)', () => {
    mount()(death_packet('mob-1'))
    expect(play_one).not.toHaveBeenCalledWith('player_death')
  })

  it('fires ONCE per fight — a re-arrived killing packet (optimistic + reconcile) never double-voices', () => {
    const dispatch = mount()
    dispatch(death_packet('0xme'))
    dispatch(death_packet('0xme'))
    expect(play_one.mock.calls.filter(([name]) => name === 'player_death').length).toBe(1)
  })

  it('is inert when there is no fight slice yet (get_state → no fight)', () => {
    mount(/** @type {any} */ (null))(death_packet('0xme'))
    expect(play_one).not.toHaveBeenCalledWith('player_death')
  })
})
