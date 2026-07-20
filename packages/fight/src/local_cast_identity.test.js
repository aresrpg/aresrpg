import { describe, expect, test } from 'bun:test'

import { local_intent_beats, synthetic_cast_events } from './present.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'

describe('local cast presentation identity', () => {
  test('the optimistic cast uses my real entity id and drafted spell id', () => {
    const beats = local_intent_beats(
      synthetic_cast_events({
        fight_id: FIGHT,
        caster_idx: 0,
        target_cell: 105,
        victims: [{ is_mob: true, idx: 0, remaining_hp: 20 }],
      }),
      {
        fight_id: FIGHT,
        resolve_fighter_id: ({ is_mob, idx, character }) =>
          character != null ? String(character) : is_mob ? `mob-${Number(idx)}` : CHAR,
        resolve_cast: () => ({ spell_id: 'ember_strike' }),
      }
    )
    const cast = beats.find((beat) => beat.kind === 'cast')

    expect(cast.payload.entity_id).toBe(CHAR)
    expect(cast.payload.spell_id).toBe('ember_strike')
  })

  test('the optimistic cast damage beat carries the real per-hit amount (never a 0 floater)', () => {
    const beats = local_intent_beats(
      synthetic_cast_events({
        fight_id: FIGHT,
        caster_idx: 0,
        target_cell: 105,
        victims: [{ is_mob: true, idx: 0, amount: 6, remaining_hp: 20 }],
      }),
      {
        fight_id: FIGHT,
        resolve_fighter_id: ({ is_mob, idx, character }) =>
          character != null ? String(character) : is_mob ? `mob-${Number(idx)}` : CHAR,
        resolve_cast: () => ({ spell_id: 'ember_strike' }),
      }
    )
    const damage = beats.find((beat) => beat.kind === 'damage')

    // the floater prints exactly this fold (voxel_fight_adapter.play_damage_beat): a synthetic Hit
    // that drops `amount` folds to 0 while remaining_hp still moves the bar — the "0 damage floater".
    expect(Math.max(0, Number(damage.payload.damage ?? 0))).toBe(6)
    expect(damage.payload.damage).toBe(6)
    expect(damage.payload.new_health).toBe(20)
  })
})
