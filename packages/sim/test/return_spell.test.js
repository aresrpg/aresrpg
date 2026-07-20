import { describe, expect, test } from 'bun:test'

import { find_entity } from '../src/fight_state.js'
import { process_spell_cast } from '../src/fight_spells.js'
import { K_RETURN_SPELL, TF_NOT_ENEMY } from '../src/spell_effect.js'
import {
  CAST_CTX,
  fresh_state,
  single_effect_spell,
} from './spell_effect_conformance_matrix.js'

// RED-FIRST regression for MATRIX_CONVICTIONS §kind 29 (K_RETURN_SPELL — 1 slot / shugo_mirror_covenant): a spell
// declares "return the incoming cast to its caster" and NOTHING lands in FightState (normalize_effect →
// UNSUPPORTED no-op → effects 0->0; matrix `status` class = "no status row applied"). The DECLARED chain
// semantics (spell_effect.move:61-64 "#55-E2 spell-reflect: RETURN the incoming cast to its caster
// (≠ K_REFLECT_DAMAGE's flat dmg reflect); turns"): a TIMED status row on the shielded fighter (target_filter 4 =
// NOT_ENEMY → self/ally), recorded via record_timed (cast.move:682). The DEPTH-1 return-redirect RESOLUTION (a
// returned cast can never be returned/reflected again — annex §1 / review F6) is enforced at the dungeon
// RESOLVER, NEVER in this pure-data layer (spell_effect.move:62-63) — so the sim lands the ROW honestly and the
// redirect arm rides the next train. Convicted slot (real corpus): shugo_mirror_covenant base0 (value 0, 1 turn,
// target_filter 4 → ally p1).

const cast_return = raw => {
  const state = fresh_state([])
  const ally_cell = find_entity(state, 'p1').cell
  const spell = single_effect_spell('return_spell', raw, 3, false)
  return {
    before: state,
    result: process_spell_cast(state, 'p0', spell, 1, ally_cell, CAST_CTX),
  }
}

describe('K_RETURN_SPELL — a spell-return status row lands on the shielded fighter (matrix kind 29 burn-down)', () => {
  test('shugo_mirror_covenant base0 (1 turn) writes the return-spell row on the ally', () => {
    const { before, result } = cast_return({
      kind: K_RETURN_SPELL,
      value: 0,
      turns: 1,
      target_filter: TF_NOT_ENEMY,
    })
    expect(result.success).toBe(true)
    const b = find_entity(before, 'p1')
    const a = find_entity(result.state, 'p1')
    const row = a.effects.find(e => e.type === 'RETURN_SPELL')
    expect(row, 'no status row applied — return-spell did not land').toBeDefined()
    expect(a.effects.length).toBeGreaterThan(b.effects.length)
    expect(row.turns_remaining).toBe(1)
  })
})
