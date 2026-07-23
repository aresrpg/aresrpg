// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP KERNEL unit rows (RED-FIRST law) — the pure decision legs the coop_fight gold spec routes through:
// turn routing, visibility, runtime-derived effect evidence, the EXACT Move xp_share twin, split verdict, and
// disconnect-crank budget. Every function is pure data-in → data-out (house FP constitution).
import { describe, expect, it } from 'bun:test'

import {
  actor_for_turn,
  effect_evidence_fold,
  effect_evidence_observed,
  effect_evidence_verdict,
  effect_requirements_by_class,
  observable_effect_family,
  split_verdict,
  stall_budget_ms,
  visibility_complete,
  visibility_fold,
  xp_share_kernel,
} from './coop_kernel.mjs'

const seats = [
  { actor: 'A', entity: '0xa1' },
  { actor: 'B', entity: '0xb2' },
  { actor: 'D', entity: '0xd3' },
]

describe('actor_for_turn — the coop conductor routing', () => {
  it('routes the active player entity to its actor', () => {
    expect(actor_for_turn({ active: '0xb2', presenting: false }, seats)).toBe('B')
  })
  it('routes nobody while a wave presents (input stays disarmed)', () => {
    expect(actor_for_turn({ active: '0xa1', presenting: true }, seats)).toBeNull()
  })
  it('routes nobody on a mob turn or empty active', () => {
    expect(actor_for_turn({ active: 'mob-0', presenting: false }, seats)).toBeNull()
    expect(actor_for_turn({ active: null, presenting: false }, seats)).toBeNull()
  })
})

describe('visibility ledger — each observer must see the OTHER seats cast', () => {
  const entity_by_actor = { A: '0xa1', B: '0xb2', D: '0xd3' }
  it('folds only OTHER seats cast beats, deduped, immutably', () => {
    const beats = [
      { kind: 'cast', id: '0xb2' },
      { kind: 'cast', id: '0xb2' }, // duplicate — deduped
      { kind: 'move', id: '0xd3' }, // move is not a cast-visibility row
      { kind: 'cast', id: '0xa1' }, // my own cast — never cross-visibility
    ]
    const ledger = visibility_fold({}, 'A', beats, entity_by_actor)
    expect(ledger).toEqual({ A: ['B'] })
    const again = visibility_fold(ledger, 'A', [{ kind: 'cast', id: '0xd3' }], entity_by_actor)
    expect(again).toEqual({ A: ['B', 'D'] })
    expect(ledger).toEqual({ A: ['B'] }) // the input ledger was not mutated
  })
  it('verdicts required observer→caster pairs', () => {
    const ledger = { A: ['B', 'D'], B: ['A'] }
    const required = [
      ['A', 'B'],
      ['B', 'A'],
      ['A', 'D'],
    ]
    expect(visibility_complete(ledger, required)).toEqual({ ok: true, missing: [] })
    expect(visibility_complete({ A: ['B'] }, required)).toEqual({
      ok: false,
      missing: ['B→A', 'A→D'],
    })
  })
})

describe('runtime-derived effect oracle — catalog kinds choose requirements, exports prove application', () => {
  const level = (...kinds) => ({ effects: kinds.map((kind) => ({ kind })) })
  const spells = [
    { class: 'senshi', unlock_level: 1, name_key: 'oathblade', levels: [level('DAMAGE', 'ALTER_STAT')] },
    { class: 'senshi', unlock_level: 1, name_key: 'vault', levels: [level('TELEPORT')] },
    { class: 'senshi', unlock_level: 3, name_key: 'warcleave', levels: [level('DAMAGE')] },
    { class: 'senshi', unlock_level: 101, name_key: 'late_shield', levels: [level('REDUCE_DAMAGE')] },
    { class: 'yajin', unlock_level: 1, name_key: 'snare', levels: [level('PLACE_TRAP', 'DAMAGE')] },
    { class: 'yajin', unlock_level: 3, name_key: 'gift', levels: [level('GIVE_POINTS', 'REVEAL')] },
    { class: 'tomoda', unlock_level: 1, name_key: 'beast_ward', levels: [level('ALTER_RESIST')] },
    { class: 'tomoda', unlock_level: 60, name_key: 'toad_slam', levels: [level('REDUCE_DAMAGE')] },
  ]

  it('maps kind vocabulary without turning a hardcoded family checklist into requirements', () => {
    expect(observable_effect_family('alter-stat')).toBe('buff')
    expect(observable_effect_family('PULL')).toBe('displacement')
    expect(observable_effect_family('REVEAL')).toBeNull()
    expect(effect_requirements_by_class(spells, ['senshi', 'yajin', 'tomoda', 'shugo'])).toEqual({
      senshi: [
        { family: 'buff', spell_ids: ['oathblade'], effect_kinds: ['ALTER_STAT'] },
        { family: 'damage', spell_ids: ['oathblade', 'warcleave'], effect_kinds: ['DAMAGE'] },
        { family: 'displacement', spell_ids: ['vault'], effect_kinds: ['TELEPORT'] },
      ],
      yajin: [
        { family: 'buff', spell_ids: ['gift'], effect_kinds: ['GIVE_POINTS'] },
        { family: 'damage', spell_ids: ['snare'], effect_kinds: ['DAMAGE'] },
        { family: 'trap', spell_ids: ['snare'], effect_kinds: ['PLACE_TRAP'] },
      ],
      tomoda: [
        { family: 'buff', spell_ids: ['beast_ward'], effect_kinds: ['ALTER_RESIST'] },
        { family: 'shield', spell_ids: ['toad_slam'], effect_kinds: ['REDUCE_DAMAGE'] },
      ],
      shugo: [],
    })
  })

  const fighter = (id, hp, cell, effects = []) => ({ id, hp, cell, effects })
  const board = (target) => [target, fighter('other', 40, { x: 9, y: 9 })]
  const base = {
    class_id: 'senshi',
    spell_id: 'oathblade',
    target_id: 'mob',
    before: board(fighter('mob', 100, { x: 2, y: 2 })),
  }

  it('recognizes hp, status-stat, cell, shield-hit, and trap-cell evidence from export snapshots', () => {
    expect(
      effect_evidence_observed({
        ...base,
        family: 'damage',
        after: board(fighter('mob', 88, { x: 2, y: 2 })),
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        family: 'buff',
        after: board(fighter('mob', 100, { x: 2, y: 2 }, [{ kind: 9, stat: 1, value: 12 }])),
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        family: 'buff',
        after: board(fighter('mob', 100, { x: 2, y: 2 }, [{ kind: 9, stat: 1, value: 0 }])),
      })
    ).toBe(false)
    expect(
      effect_evidence_observed({
        ...base,
        family: 'displacement',
        after: board(fighter('mob', 100, { x: 3, y: 2 })),
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        family: 'shield',
        after: board(fighter('mob', 100, { x: 2, y: 2 }, [{ kind: 24, stat: null, value: 8 }])),
        followup: board(fighter('mob', 98, { x: 2, y: 2 }, [{ kind: 24, stat: null, value: 8 }])),
        incoming_damage: 10,
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        family: 'trap',
        after: board(fighter('mob', 90, { x: 4, y: 2 })),
        trap_cell: { x: 3, y: 2 },
        trigger_cell: { x: 3, y: 2 },
      })
    ).toBe(true)
  })

  it('refuses cosmetic/no-op observations and accepts any candidate for each family', () => {
    const no_damage = { ...base, family: 'damage', after: base.before }
    expect(effect_evidence_observed(no_damage)).toBe(false)
    expect(
      effect_evidence_observed({
        ...base,
        family: 'trap',
        after: board(fighter('mob', 90, { x: 4, y: 2 })),
        trap_cell: { x: 3, y: 2 },
        trigger_cell: { x: 4, y: 2 },
      })
    ).toBe(false)

    const requirements = effect_requirements_by_class(spells, ['senshi'])
    const unchanged = {}
    expect(effect_evidence_fold(unchanged, no_damage)).toBe(unchanged)
    const ledger = effect_evidence_fold(
      {},
      {
        ...base,
        spell_id: 'warcleave',
        family: 'damage',
        after: board(fighter('mob', 88, { x: 2, y: 2 })),
      }
    )
    expect(ledger).toEqual({ senshi: { damage: ['warcleave'] } })
    expect(effect_evidence_verdict(requirements, ledger)).toEqual({
      ok: false,
      missing: ['senshi/buff:[oathblade]', 'senshi/displacement:[vault]'],
    })
  })
})

describe('xp_share_kernel — the EXACT settlement.move twin (u64 floor at every step, same order)', () => {
  it('flat split, no boosts', () => {
    expect(xp_share_kernel({ total_xp: 1000, party_size: 2, wisdom: 0, aged_bp: 0, xp_mult: 100 })).toBe(500n)
  })
  it('wisdom boost ×(600+w)/600', () => {
    expect(xp_share_kernel({ total_xp: 1000, party_size: 2, wisdom: 300, aged_bp: 0, xp_mult: 100 })).toBe(750n)
  })
  it('aging ×(10000+bp)/10000 and multiplier ×mult/100 compose in Move order', () => {
    expect(xp_share_kernel({ total_xp: 1000, party_size: 2, wisdom: 0, aged_bp: 2500, xp_mult: 400 })).toBe(2500n)
  })
  it('floors at the division steps exactly like u64 (never float math)', () => {
    // 7/2 floors to 3 FIRST, then boosts apply: naive 3.5-based math would return 4.
    expect(xp_share_kernel({ total_xp: 7, party_size: 2, wisdom: 0, aged_bp: 0, xp_mult: 100 })).toBe(3n)
    // 123/3 = 41 → ×400/100 = 164 (the gold rig: the multi_turn fixture mob pays 123 xp, 3 seats, mult 400).
    expect(xp_share_kernel({ total_xp: 123, party_size: 3, wisdom: 0, aged_bp: 0, xp_mult: 400 })).toBe(164n)
  })
  it('party 0 pays 0 (the Move guard)', () => {
    expect(xp_share_kernel({ total_xp: 1000, party_size: 0, wisdom: 0, aged_bp: 0, xp_mult: 100 })).toBe(0n)
  })
})

describe('split_verdict — every seat paid its own kernel share, equal loot treatment', () => {
  const fight = { total_xp: 123, aged_bp: 0, xp_mult: 400 }
  const wisdom_by_character = { '0xa1': 0, '0xb2': 0, '0xd3': 0 }
  const paid = (character, xp_share) => ({ character, outcome: 2, xp_share, loot_len: 0 })
  it('accepts three victory seats at the exact kernel share', () => {
    const verdict = split_verdict([paid('0xa1', 164), paid('0xb2', 164), paid('0xd3', 164)], {
      ...fight,
      wisdom_by_character,
    })
    expect(verdict.ok).toBe(true)
    expect(verdict.expected['0xa1']).toBe(164n)
  })
  it('rejects a mis-paid seat naming it', () => {
    const verdict = split_verdict([paid('0xa1', 164), paid('0xb2', 163), paid('0xd3', 164)], {
      ...fight,
      wisdom_by_character,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('0xb2')
  })
  it('rejects a non-victory outcome and unequal loot treatment', () => {
    expect(
      split_verdict([{ character: '0xa1', outcome: 3, xp_share: 164, loot_len: 0 }], {
        ...fight,
        wisdom_by_character,
      }).ok
    ).toBe(false)
    expect(
      split_verdict([paid('0xa1', 164), { character: '0xb2', outcome: 2, xp_share: 164, loot_len: 1 }], {
        ...fight,
        wisdom_by_character,
      }).ok
    ).toBe(false)
  })
})

describe('stall_budget_ms — the disconnect-crank wait bound', () => {
  it('is two turn deadlines plus slack (one stalled seat + the wave that follows)', () => {
    expect(stall_budget_ms(45_000)).toBe(120_000)
    expect(stall_budget_ms(45_000, 10_000)).toBe(100_000)
  })
})
