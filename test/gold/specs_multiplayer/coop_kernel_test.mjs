// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP KERNEL unit rows (RED-FIRST law) — the pure decision legs the coop_fight gold spec routes through:
// turn routing, visibility, runtime-derived effect evidence, the EXACT Move xp_share twin, split verdict, and
// disconnect-crank budget. Every function is pure data-in → data-out (house FP constitution).
import { describe, expect, it } from 'bun:test'

import {
  actor_for_turn,
  effect_catalog_verdict,
  effect_evidence_fold,
  effect_evidence_observed,
  effect_evidence_verdict,
  effect_oracle_for_kind,
  effect_requirements_by_class,
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

describe('runtime-derived effect oracle — every raw catalog kind owns its proof', () => {
  const fx = (kind, kind_id, stat = undefined) => ({ kind, kind_id, ...(stat == null ? {} : { stat }) })
  const level = (...effects) => ({ effects })
  const spells = [
    {
      class: 'senshi',
      unlock_level: 1,
      name_key: 'oathblade',
      levels: [level(fx('DAMAGE', 0), fx('ALTER_STAT', 9))],
    },
    { class: 'senshi', unlock_level: 13, name_key: 'executioner', levels: [level(fx('LIFE_STEAL', 2))] },
    { class: 'senshi', unlock_level: 21, name_key: 'ram', levels: [level(fx('PULL', 13))] },
    { class: 'senshi', unlock_level: 101, name_key: 'late', levels: [level(fx('MYSTERY', 42))] },
    {
      class: 'yajin',
      unlock_level: 1,
      name_key: 'vanish',
      levels: [level(fx('INVISIBILITY', 27), fx('GIVE_POINTS', 6, 1))],
    },
    {
      class: 'yajin',
      unlock_level: 3,
      name_key: 'prowlers_eye',
      levels: [level(fx('ALTER_STAT', 9, 6))],
    },
    {
      class: 'tomoda',
      unlock_level: 6,
      name_key: 'goad',
      levels: [level(fx('GIVE_POINTS', 6, 0), fx('GIVE_POINTS', 6, 0))],
    },
    { class: 'shugo', unlock_level: 100, name_key: 'mirror', levels: [level(fx('RETURN_SPELL', 29))] },
  ]

  it('retains raw kinds, splits AP/MP, dedupes candidates, and names honest gaps', () => {
    expect(effect_oracle_for_kind('life-steal')).toBe('life_steal')
    expect(effect_oracle_for_kind('PULL')).toBeNull()
    expect(effect_oracle_for_kind('ALTER_STAT')).toBe('stat_delta')
    const requirements = effect_requirements_by_class(spells, ['senshi', 'yajin', 'tomoda', 'shugo'])
    expect(requirements.senshi.map((row) => row.key)).toEqual(['ALTER_STAT:UNEXPORTED', 'DAMAGE', 'LIFE_STEAL', 'PULL'])
    expect(requirements.yajin.map((row) => row.key)).toEqual(['ALTER_STAT:RANGE', 'GIVE_POINTS:MP', 'INVISIBILITY'])
    expect(requirements.tomoda[0].spell_ids).toEqual(['goad'])
    expect(effect_catalog_verdict(requirements)).toMatchObject({
      ok: true,
      kinds: ['ALTER_STAT', 'DAMAGE', 'GIVE_POINTS', 'INVISIBILITY', 'LIFE_STEAL', 'PULL', 'RETURN_SPELL'],
      asserted_kinds: ['ALTER_STAT', 'DAMAGE', 'GIVE_POINTS', 'INVISIBILITY', 'LIFE_STEAL'],
      unassertable_kinds: ['PULL', 'RETURN_SPELL'],
      uncovered: [],
    })
    const unknown = effect_requirements_by_class(
      [...spells, { class: 'shugo', unlock_level: 99, name_key: 'future', levels: [level(fx('MYSTERY', 42))] }],
      ['shugo']
    )
    expect(effect_catalog_verdict(unknown)).toMatchObject({ ok: false, uncovered: ['shugo/MYSTERY'] })
  })

  it('partitions the current four-kit kind vocabulary into real oracles and explicit honesty gaps', () => {
    const current_kinds = [
      fx('DAMAGE', 0),
      fx('LIFE_STEAL', 2),
      fx('CASTER_DAMAGE', 3),
      fx('HEAL', 5),
      fx('GIVE_POINTS', 6, 0),
      fx('GIVE_POINTS', 6, 1),
      fx('REMOVE_POINTS', 7, 1),
      fx('ALTER_STAT', 9, 6),
      fx('STEAL_STAT', 10),
      fx('ALTER_RESIST', 11),
      fx('PUSH', 12),
      fx('PULL', 13),
      fx('TELEPORT', 14),
      fx('PLACE_TRAP', 19),
      fx('PLACE_GLYPH', 20),
      fx('APPLY_DOT', 21),
      fx('REDUCE_DAMAGE', 24),
      fx('INVISIBILITY', 27),
      fx('REVEAL', 28),
      fx('RETURN_SPELL', 29),
    ]
    const requirements = effect_requirements_by_class(
      [{ class: 'yajin', unlock_level: 1, name_key: 'inventory', levels: [level(...current_kinds)] }],
      ['yajin']
    )
    expect(effect_catalog_verdict(requirements)).toMatchObject({
      ok: true,
      kinds: [
        'ALTER_RESIST',
        'ALTER_STAT',
        'APPLY_DOT',
        'CASTER_DAMAGE',
        'DAMAGE',
        'GIVE_POINTS',
        'HEAL',
        'INVISIBILITY',
        'LIFE_STEAL',
        'PLACE_GLYPH',
        'PLACE_TRAP',
        'PULL',
        'PUSH',
        'REDUCE_DAMAGE',
        'REMOVE_POINTS',
        'RETURN_SPELL',
        'REVEAL',
        'STEAL_STAT',
        'TELEPORT',
      ],
      asserted_kinds: [
        'ALTER_STAT',
        'APPLY_DOT',
        'CASTER_DAMAGE',
        'DAMAGE',
        'GIVE_POINTS',
        'HEAL',
        'INVISIBILITY',
        'LIFE_STEAL',
        'PLACE_TRAP',
        'PUSH',
        'REMOVE_POINTS',
        'TELEPORT',
      ],
      unassertable_kinds: [
        'ALTER_RESIST',
        'PLACE_GLYPH',
        'PULL',
        'REDUCE_DAMAGE',
        'RETURN_SPELL',
        'REVEAL',
        'STEAL_STAT',
      ],
      uncovered: [],
    })
  })

  const fighter = (id, hp, cell, over = {}) => ({
    id,
    hp,
    cell,
    ap: 6,
    mp: 3,
    accepted_ap: 6,
    accepted_mp: 3,
    turn_number: 1,
    invisible: false,
    effective_range: 0,
    effects: [],
    ...over,
  })
  const board = (target, caster = fighter('caster', 80, { x: 0, y: 0 })) => [target, caster]
  const base = {
    class_id: 'senshi',
    spell_id: 'oathblade',
    target_id: 'mob',
    caster_id: 'caster',
    before: board(fighter('mob', 100, { x: 2, y: 2 })),
  }

  it('does not let generic damage satisfy life-steal or caster-damage', () => {
    const damage_after = board(fighter('mob', 88, { x: 2, y: 2 }))
    expect(effect_evidence_observed({ ...base, kind: 'DAMAGE', after: damage_after })).toBe(true)
    expect(effect_evidence_observed({ ...base, kind: 'LIFE_STEAL', after: damage_after })).toBe(false)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'LIFE_STEAL',
        after: board(fighter('mob', 88, { x: 2, y: 2 }), fighter('caster', 86, { x: 0, y: 0 })),
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'CASTER_DAMAGE',
        target_id: 'caster',
        after: board(fighter('mob', 100, { x: 2, y: 2 }), fighter('caster', 74, { x: 0, y: 0 })),
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'CASTER_DAMAGE',
        target_id: 'caster',
        after: board(fighter('mob', 88, { x: 2, y: 2 }), fighter('caster', 74, { x: 0, y: 0 })),
      })
    ).toBe(false)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'CASTER_DAMAGE',
        target_id: 'ally',
        before: [...base.before, fighter('ally', 80, { x: 1, y: 0 })],
        after: [...base.before, fighter('ally', 74, { x: 1, y: 0 })],
      })
    ).toBe(false)
  })

  it('proves heal, resource drain, stat delta, displacement, and a fresh trap-trigger beat', () => {
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'HEAL',
        before: board(fighter('mob', 70, { x: 2, y: 2 })),
        after: board(fighter('mob', 78, { x: 2, y: 2 })),
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'TELEPORT',
        target_id: 'caster',
        cast_target: { x: 1, y: 0 },
        after: board(fighter('mob', 100, { x: 2, y: 2 }), fighter('caster', 80, { x: 1, y: 0 })),
      })
    ).toBe(true)
    const removed = board(
      fighter('mob', 100, { x: 2, y: 2 }, { mp: 0, effects: [{ kind: 7, stat: 1, value: 4, flags: 1 }] })
    )
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'REMOVE_POINTS',
        kind_id: 7,
        stat: 1,
        resource: 'mp',
        cast_target: { x: 2, y: 2 },
        before: board(fighter('mob', 100, { x: 2, y: 2 }, { mp: 1 })),
        after: removed,
        drain_exports: Array.from({ length: 5 }, () => ({
          caster: 'caster',
          target: 'mob',
          resource: 'mp',
          removed: 1,
          requested: 4,
          cast_count: 1,
          cast_target: { x: 2, y: 2 },
        })),
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'REMOVE_POINTS',
        resource: 'mp',
        cast_target: { x: 2, y: 2 },
        before: board(fighter('mob', 100, { x: 2, y: 2 }, { mp: 1 })),
        after: removed,
        drain_exports: [],
      })
    ).toBe(false)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'REMOVE_POINTS',
        target_id: 'caster',
        caster_id: 'caster',
        resource: 'ap',
        before: board(fighter('mob', 100, { x: 2, y: 2 }), fighter('caster', 80, { x: 0, y: 0 }, { ap: 6 })),
        after: board(fighter('mob', 100, { x: 2, y: 2 }), fighter('caster', 80, { x: 0, y: 0 }, { ap: 2 })),
      })
    ).toBe(false)
    const returned = board(fighter('mob', 100, { x: 2, y: 2 }, { effects: [{ kind: 29, remaining_turns: 1 }] }))
    expect(effect_evidence_observed({ ...base, kind: 'RETURN_SPELL', kind_id: 29, after: returned })).toBe(false)
    const ranged = board(
      fighter('mob', 100, { x: 2, y: 2 }, { effective_range: 1, effects: [{ kind: 9, stat: 6, value: 1 }] })
    )
    expect(effect_evidence_observed({ ...base, kind: 'ALTER_STAT', kind_id: 9, stat: 6, after: ranged })).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'ALTER_STAT',
        kind_id: 9,
        stat: 6,
        after: board(fighter('mob', 100, { x: 2, y: 2 }, { effects: [{ kind: 9, stat: 6, value: 1 }] })),
      })
    ).toBe(false)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'PLACE_TRAP',
        after: board(fighter('mob', 100, { x: 4, y: 2 })),
        trap_cell: { x: 3, y: 2 },
        trigger_after_t: 100,
        trigger_beat: { t: 101, kind: 'trap_trigger', id: 'mob' },
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'PLACE_TRAP',
        after: board(fighter('mob', 90, { x: 4, y: 2 })),
        trap_cell: { x: 3, y: 2 },
        trigger_after_t: 100,
        trigger_beat: { t: 100, kind: 'trap_trigger', id: 'mob' },
      })
    ).toBe(false)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'PLACE_TRAP',
        after: board(fighter('mob', 90, { x: 4, y: 2 })),
        trap_cell: { x: 3, y: 2 },
        trigger_after_t: 100,
      })
    ).toBe(false)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'PLACE_TRAP',
        after: board(fighter('mob', 90, { x: 4, y: 2 })),
        trap_cell: { x: 3, y: 2 },
        trigger_after_t: null,
        trigger_beat: { t: 101, kind: 'trap_trigger', id: 'mob' },
      })
    ).toBe(false)
    const dot_tick = board(fighter('mob', 98, { x: 2, y: 2 }))
    const dot_observers = Array.from({ length: 5 }, () => structuredClone(dot_tick))
    dot_observers[0][0].effects = [{ kind: 21, remaining_turns: 2 }]
    const dot = {
      ...base,
      kind: 'APPLY_DOT',
      kind_id: 21,
      after: dot_tick,
      observer_exports: dot_observers,
      dot_exports: Array.from({ length: 5 }, () => ({
        caster: 'caster',
        target: 'mob',
        cast_count: 1,
        cast_target: { x: 2, y: 2 },
        amount: 2,
        remaining_hp: 98,
      })),
    }
    expect(effect_evidence_observed(dot)).toBe(true)
    expect(effect_evidence_observed({ ...dot, dot_exports: [] })).toBe(false)
  })

  it('requires five identical visibility and journal-budget exports for the mandatory kinds', () => {
    const invisible_after = board(
      fighter('mob', 100, { x: 2, y: 2 }, { invisible: true, effects: [{ kind: 27, value: 1, flags: 0 }] })
    )
    const visible_export = {
      target: 'mob',
      status_kind: null,
      invisible: false,
      remaining_turns: 0,
    }
    const invisible_export = {
      target: 'mob',
      status_kind: 27,
      invisible: true,
      remaining_turns: 2,
    }
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'INVISIBILITY',
        kind_id: 27,
        after: invisible_after,
        before_exports: Array.from({ length: 5 }, () => structuredClone(visible_export)),
        observer_exports: Array.from({ length: 5 }, () => structuredClone(invisible_export)),
      })
    ).toBe(true)
    expect(
      effect_evidence_observed({
        ...base,
        kind: 'INVISIBILITY',
        kind_id: 27,
        after: invisible_after,
        before_exports: Array.from({ length: 5 }, () => structuredClone(visible_export)),
        observer_exports: [...Array.from({ length: 4 }, () => structuredClone(invisible_export)), visible_export],
      })
    ).toBe(false)

    const resource_before = board(
      fighter('mob', 100, { x: 2, y: 2 }),
      fighter('caster', 80, { x: 0, y: 0 }, { mp: 3, accepted_mp: 3 })
    )
    const resource_after = board(
      fighter('mob', 100, { x: 2, y: 2 }),
      fighter('caster', 80, { x: 4, y: 0 }, { mp: 3, accepted_mp: 3 })
    )
    const turn_proof = {
      entity: 'caster',
      resource: 'mp',
      start: 3,
      minimum_grant: 1,
      spent: 4,
      minimum_remaining: 0,
      action_count: 1,
      grant_target: { x: 0, y: 0 },
      destination: { x: 4, y: 0 },
    }
    const resource_observers = Array.from({ length: 5 }, () => structuredClone(resource_after))
    resource_observers[0][1].effects = [{ kind: 27, remaining_turns: 2 }]
    const resource = {
      ...base,
      kind: 'GIVE_POINTS',
      target_id: 'caster',
      resource: 'mp',
      grant: 1,
      minimum_grant: 1,
      spent: 4,
      remaining: 0,
      committed_casts: 1,
      grant_target: { x: 0, y: 0 },
      before: resource_before,
      after: resource_after,
      before_exports: Array.from({ length: 5 }, () => structuredClone(resource_before)),
      observer_exports: resource_observers,
      turn_exports: Array.from({ length: 5 }, () => structuredClone(turn_proof)),
    }
    expect(effect_evidence_observed(resource)).toBe(true)
    expect(effect_evidence_observed({ ...resource, spent: 3 })).toBe(false)
    expect(effect_evidence_observed({ ...resource, grant: 2, remaining: 1 })).toBe(false)
  })

  it('folds by derived requirement key and verdicts each distinct observable kind globally', () => {
    const requirements = effect_requirements_by_class(spells, ['senshi'])
    const no_damage = { ...base, kind: 'DAMAGE', requirement_key: 'DAMAGE', after: base.before }
    expect(effect_evidence_fold({}, no_damage)).toEqual({})
    const ledger = effect_evidence_fold({}, { ...no_damage, after: board(fighter('mob', 88, { x: 2, y: 2 })) })
    expect(ledger).toEqual({ senshi: { DAMAGE: ['oathblade'] } })
    expect(
      effect_evidence_fold(
        {},
        { ...no_damage, requirement_key: 'RETURN_SPELL', after: board(fighter('mob', 88, { x: 2, y: 2 })) }
      )
    ).toEqual({})
    expect(effect_evidence_verdict(requirements, {})).toEqual({
      ok: false,
      missing: ['DAMAGE:[senshi/oathblade]', 'LIFE_STEAL:[senshi/executioner]'],
    })
    expect(effect_evidence_verdict(requirements, ledger)).toEqual({
      ok: false,
      missing: ['LIFE_STEAL:[senshi/executioner]'],
    })
    expect(
      effect_evidence_verdict(requirements, {
        senshi: { DAMAGE: ['oathblade'], LIFE_STEAL: ['executioner'] },
      })
    ).toEqual({ ok: true, missing: [] })
    expect(effect_evidence_verdict({ senshi: [] }, {})).toEqual({ ok: true, missing: [] })
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
