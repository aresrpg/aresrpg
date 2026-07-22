// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, it } from 'bun:test'

import { create_fight_audio_observer, fight_audio_sfx_key, fight_damage_audio_beat } from './fight_audio.js'

describe('fight_audio_sfx_key', () => {
  it('maps every fight presentation beat to its character-feel sound', () => {
    const cases = [
      [{ kind: 'hit', heavy: false }, 'fight_hit_medium'],
      [{ kind: 'hit', heavy: true }, 'fight_hit_heavy'],
      [{ kind: 'cast_charge', element: 'air' }, 'fight_cast_charge_air'],
      [{ kind: 'cast_charge', element: 'earth' }, 'fight_cast_charge_earth'],
      [{ kind: 'cast_charge', element: 'fire' }, 'fight_cast_charge_fire'],
      [{ kind: 'cast_charge', element: 'water' }, 'fight_cast_charge_water'],
      [{ kind: 'cast_resolve' }, 'fight_cast_resolve'],
      [{ id: '0', kind: 'absorb' }, 'fight_absorb_1'],
      [{ id: '1', kind: 'absorb' }, 'fight_absorb_2'],
      [{ id: '2', kind: 'absorb' }, 'fight_absorb_3'],
    ]

    for (const [beat, key] of cases) expect(fight_audio_sfx_key(beat)).toBe(key)
    expect(fight_audio_sfx_key({ id: 'charge-neutral', kind: 'cast_charge', element: 'neutral' })).toBeNull()
    expect(fight_audio_sfx_key({ id: 'unknown', kind: 'unknown' })).toBeNull()
  })
})

describe('fight_damage_audio_beat', () => {
  it('routes zero damage to absorb and positive damage through the shared impact-weight threshold', () => {
    expect(fight_damage_audio_beat({ fight_audio_id: 'zero', damage: 0 }, 100)).toEqual({
      id: 'zero',
      kind: 'absorb',
    })
    expect(fight_damage_audio_beat({ fight_audio_id: 'medium', damage: 10 }, 100)).toEqual({
      id: 'medium',
      kind: 'hit',
      heavy: false,
    })
    expect(fight_damage_audio_beat({ fight_audio_id: 'heavy', damage: 40 }, 100)).toEqual({
      id: 'heavy',
      kind: 'hit',
      heavy: true,
    })
  })

  it('treats critical and lethal hits as heavy, while heal rows emit no hit sound', () => {
    expect(fight_damage_audio_beat({ fight_audio_id: 'critical', damage: 1, is_critical: true }, 100)).toEqual({
      id: 'critical',
      kind: 'hit',
      heavy: true,
    })
    expect(fight_damage_audio_beat({ fight_audio_id: 'lethal', damage: 1, killed: true }, 100)).toEqual({
      id: 'lethal',
      kind: 'hit',
      heavy: true,
    })
    expect(fight_damage_audio_beat({ fight_audio_id: 'heal' }, 100)).toBeNull()
  })
})

describe('create_fight_audio_observer', () => {
  it('emits once for a replayed slice and re-emits for a real beat delta', () => {
    const emitted = []
    const observe = create_fight_audio_observer((key) => emitted.push(key))
    const first = { id: '7:fight:4:2', kind: 'hit', heavy: false }

    observe(first)
    observe({ ...first })
    observe({ ...first, id: '7:fight:4:3' })

    expect(emitted).toEqual(['fight_hit_medium', 'fight_hit_medium'])
  })

  it('treats charge and resolve as distinct projected phases of one cast', () => {
    const emitted = []
    const observe = create_fight_audio_observer((key) => emitted.push(key))

    observe({ id: '7:fight:5:0', kind: 'cast_charge', element: 'fire' })
    observe({ id: '7:fight:5:0', kind: 'cast_resolve' })

    expect(emitted).toEqual(['fight_cast_charge_fire', 'fight_cast_resolve'])
  })
})
