// FLOATER BEAT TIMING — the damage floater lands ≥1s AFTER the hit VFX on a paced
// mob turn. ROOT: pace_segment's rescale STRETCHED every beat proportionally to fill the ~3s slot — a
// cast+damage turn (raw 1400+350ms) became cast≈2400ms, so the 'damage' queue slot (the floater) fired at
// t≈2400 while play_cast's swing→travel→impact chain runs at NATURAL speed (impact ≈1.4s): a dead ≥1s gap
// between the seen hit and its number. THE LAW (intra-segment ordering — the tuned wave length is
// untouched): every beat keeps its NATURAL duration and the LAST beat absorbs the slot's slack, so the
// floater rides the impact and the turn still occupies exactly mob_turn_ms. An over-long turn (raw > slot)
// keeps the proportional compress (long walks must fit the tuned slot).
//
// RED (2026-07-17, pre-fix, raw): `the damage beat must start at the cast's NATURAL end — the floater rides
// the impact: expected 1400, received 2400` (+ slack assert 1750 vs 3000).

import { describe, expect, test } from 'bun:test'

import { pace_segment, MOB_TURN_MS } from './present.js'

const FIGHT = '0xf1'
const ev = (suffix, fields) => ({
  type: `0x0::fight_events::${suffix}`,
  parsedJson: { fight: FIGHT, ...fields },
})

const CTX = {
  fight_id: FIGHT,
  grid_width: 20,
  resolve_fighter_id: ({ is_mob, idx, character }) =>
    character != null ? String(character) : is_mob ? `mob-${Number(idx)}` : `player-${Number(idx)}`,
  fighter_cells: () => ({ x: 5, y: 5 }),
  resolve_cast: () => ({ spell_id: 'mob_attack_dungeon' }),
}

/** One mob turn: cast (natural 1400ms) + one non-lethal hit (natural 350ms) — raw total 1750 < the 3s slot. */
const MOB_TURN_EVENTS = [
  ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 111_000 }),
  ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 100 }),
  ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 8, remaining_hp: 42 }),
  ev('TurnEnded', { is_mob: true, idx: 0 }),
]

describe('pace_segment — natural intra-turn beat spacing (the floater rides the impact)', () => {
  test('a short mob turn keeps NATURAL beat starts; the tail beat absorbs the slot slack', () => {
    const { turns } = pace_segment(MOB_TURN_EVENTS, CTX, { is_local: () => false })
    expect(turns.length).toBe(1)
    const [turn] = turns
    expect(turn.is_local).toBe(false)
    expect(turn.duration, 'the tuned wave length is untouched').toBe(MOB_TURN_MS)
    const cast = turn.beats.find((b) => b.kind === 'cast')
    const damage = turn.beats.find((b) => b.kind === 'damage')
    expect(cast).toBeDefined()
    expect(damage).toBeDefined()
    expect(cast.at).toBe(0)
    // THE FLOATER BEAT: it must start at the cast's NATURAL end (1400ms — impact pace), never pushed
    // to a proportionally stretched offset deep in the slot.
    expect(damage.at, "the damage beat must start at the cast's NATURAL end — the floater rides the impact").toBe(1400)
    // the slot still spans the full tuned wave length: the LAST beat's duration absorbs the slack.
    const last = turn.beats[turn.beats.length - 1]
    expect(last.at + last.duration, 'the last beat absorbs the slack — the slot spans the tuned length').toBe(
      MOB_TURN_MS
    )
  })

  test('an over-long turn still compresses proportionally into the tuned slot (long walks fit)', () => {
    const walk = Array.from({ length: 8 }, (_, i) => ({ x: 5 + i, y: 5 }))
    const events = [
      ev('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 111_000 }),
      ev('MobMoved', { idx: 0, to_cell: 5 + 7 + 5 * 20 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: 100 }),
      ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 8, remaining_hp: 42 }),
      ev('TurnEnded', { is_mob: true, idx: 0 }),
    ]
    const { turns } = pace_segment(events, { ...CTX, move_path: () => walk }, { is_local: () => false })
    const [turn] = turns
    const total = turn.beats.reduce((sum, b) => Math.max(sum, b.at + b.duration), 0)
    expect(turn.duration).toBe(MOB_TURN_MS)
    expect(total, 'an over-long raw turn compresses to the tuned slot').toBe(MOB_TURN_MS)
  })

  test('a LOCAL turn stays untouched at 0 pacing (prediction plays at natural clip pace)', () => {
    const { turns } = pace_segment(MOB_TURN_EVENTS, CTX, { is_local: () => true })
    expect(turns[0].duration).toBe(0)
  })
})
