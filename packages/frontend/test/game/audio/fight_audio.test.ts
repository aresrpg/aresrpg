// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import type { FightPresentationCue } from '@aresrpg/engine'
import { describe, expect, test } from 'bun:test'

import { create_fight_audio_observer, fight_audio_variant } from '../../../src/game/audio/fight_audio.ts'
import { FIGHT_AUDIO_ASSETS, fight_audio_keys_for_families } from '../../../src/game/audio/fight_audio_registry.ts'

const cast_cue = Object.freeze({
  id: 'fight:1:0',
  type: 'cast',
  caster_id: 'fight_character_0',
  spell: 'Inferno',
  cast_level: 1,
  target_cell: 12,
  element: 'fire',
  critical: true,
  weapon: false,
  amount: 42,
  target_max_hp: 100,
  affected_cells: Object.freeze([12, 13, 14]),
  killed: true,
} satisfies FightPresentationCue)

describe('fight audio', () => {
  test('registers every authored seed sound exactly once', () => {
    const authored = readdirSync(resolve(import.meta.dir, '../../../../../seed/sounds')).sort()
    const registered = Object.values(FIGHT_AUDIO_ASSETS)
      .map((source) => source.replace('/sound_effect/', ''))
      .sort()
    expect(registered).toEqual(authored)
  })

  test('keeps the exact cast, impact, critical, death, and area layers on cue phases', () => {
    const played: string[] = []
    const observe = create_fight_audio_observer(
      (key) => played.push(key),
      () => 0
    )
    observe(cast_cue, 'start', Object.freeze({}))
    observe(cast_cue, 'complete', Object.freeze({}))
    expect(played).toEqual([
      'cast_charge_fire',
      'cast_resolve',
      'element_impact_fire_1',
      'crit',
      'death',
      'element_aoe_fire_1',
    ])
  })

  test('never repeats a rotating family variant immediately', () => {
    const first = fight_audio_variant('fire', 'cast', undefined, () => 0)
    const second = fight_audio_variant('fire', 'cast', first.variant, () => 0)
    expect(first.key).toBe('element_cast_fire_1')
    expect(second.key).toBe('element_cast_fire_2')
  })

  test('preload selection keeps shared sounds and only requested effect families', () => {
    const keys = fight_audio_keys_for_families(['fire'])

    expect(keys).toContain('turn_start')
    expect(keys).toContain('cast_charge_fire')
    expect(keys).toContain('element_impact_fire_1')
    expect(keys).not.toContain('cast_charge_water')
    expect(keys).not.toContain('element_impact_water_1')
  })
})
