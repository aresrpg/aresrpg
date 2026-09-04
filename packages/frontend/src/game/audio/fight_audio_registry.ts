// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Exact key -> seed-derived public path home for fight one-shots.

import { scale_audio_volume } from '../core/audio_volume.ts'

const FIXED_AUDIO = Object.freeze({
  absorb_1: '/sound_effect/absorb-1.ogg',
  absorb_2: '/sound_effect/absorb-2.ogg',
  absorb_3: '/sound_effect/absorb-3.ogg',
  crit: '/sound_effect/crit_spell.ogg',
  death: '/sound_effect/death_sting.ogg',
  hurt_female: '/sound_effect/hurt-female.aac',
  hurt_male: '/sound_effect/hurt-male.aac',
  hit_heavy: '/sound_effect/being-hit-heavy.ogg',
  hit_medium: '/sound_effect/being-hit-medium.ogg',
  cast_charge_air: '/sound_effect/cast-charge-air.ogg',
  cast_charge_earth: '/sound_effect/cast-charge-earth.ogg',
  cast_charge_fire: '/sound_effect/cast-charge-fire.ogg',
  cast_charge_water: '/sound_effect/cast-charge-water.ogg',
  cast_resolve: '/sound_effect/cast-resolve.ogg',
  knockback: '/sound_effect/knockback_impact.ogg',
  menu_button: '/sound_effect/menu_button.aac',
  menu_carousel: '/sound_effect/menu_carousel.aac',
  player_death: '/sound_effect/player_death.ogg',
  sword_plant: '/sound_effect/sword_plant_impact.ogg',
  turn_start: '/sound_effect/turn_clock.ogg',
  turn_start_legacy: '/sound_effect/turn_start.ogg',
})

export const ELEMENT_AUDIO_VARIANTS = Object.freeze({
  'air:aoe': 1,
  'earth:aoe': 1,
  'fire:aoe': 1,
  'neutral:aoe': 1,
  'water:aoe': 1,
  'air:cast': 3,
  'earth:cast': 2,
  'fire:cast': 3,
  'heal:cast': 1,
  'neutral:cast': 2,
  'water:cast': 3,
  'air:impact': 2,
  'earth:impact': 2,
  'fire:impact': 2,
  'neutral:impact': 3,
  'water:impact': 2,
  'weapon:impact': 2,
} as const)

export const element_audio_key = (family: string, layer: string, variant = 1): string =>
  `element_${layer}_${family}_${variant}`

const ELEMENT_AUDIO = Object.fromEntries(
  Object.entries(ELEMENT_AUDIO_VARIANTS).flatMap(([family_layer, count]) => {
    const [family, layer] = family_layer.split(':') as [string, string]
    return Array.from({ length: count }, (_, index) => {
      const variant = index + 1
      const suffix = variant > 1 ? `_${variant}` : ''
      return [element_audio_key(family, layer, variant), `/sound_effect/${layer}_${family}${suffix}.ogg`]
    })
  })
)

export const FIGHT_AUDIO_ASSETS: Readonly<Record<string, string>> = Object.freeze({
  ...FIXED_AUDIO,
  ...ELEMENT_AUDIO,
})

const SHARED_FIGHT_AUDIO = Object.freeze([
  'absorb_1',
  'absorb_2',
  'absorb_3',
  'crit',
  'death',
  'hurt_female',
  'hurt_male',
  'hit_heavy',
  'hit_medium',
  'cast_resolve',
  'knockback',
  'turn_start',
])
const audio_pool = new Map<string, HTMLAudioElement[]>()

export const fight_audio_keys_for_families = (families: readonly string[]): readonly string[] => {
  const wanted = new Set(SHARED_FIGHT_AUDIO)
  families.forEach((family) => {
    const charge = `cast_charge_${family}`
    if (FIGHT_AUDIO_ASSETS[charge]) wanted.add(charge)
    Object.keys(FIGHT_AUDIO_ASSETS).forEach((key) => {
      if (key.startsWith('element_') && key.includes(`_${family}_`)) wanted.add(key)
    })
  })
  return Object.freeze([...wanted].sort())
}

export const fight_audio_src = (key: string): string | null => FIGHT_AUDIO_ASSETS[key] ?? null

const create_audio_player = (key: string): HTMLAudioElement | null => {
  const source = fight_audio_src(key)
  if (!source || typeof Audio === 'undefined') return null
  const player = new Audio(source)
  // eslint-disable-next-line functional/immutable-data -- HTML media is a mutable browser effect boundary.
  player.preload = 'auto'
  audio_pool.set(key, [...(audio_pool.get(key) ?? []), player])
  return player
}

export const preload_fight_audio = (keys: readonly string[]): void => {
  keys.forEach((key) => {
    if (audio_pool.has(key)) return
    create_audio_player(key)?.load()
  })
}

export const play_fight_audio = (key: string, volume = 0.4): void => {
  const player = audio_pool.get(key)?.find(({ paused, ended }) => paused || ended) ?? create_audio_player(key)
  if (!player) return
  // eslint-disable-next-line functional/immutable-data -- HTML media is a mutable browser effect boundary.
  player.volume = scale_audio_volume(volume)
  // eslint-disable-next-line functional/immutable-data -- Reusing the preloaded player avoids first-cast network/decode work.
  player.currentTime = 0
  void player.play().catch((error: unknown) => console.warn(`Fight sound ${key} could not play.`, error))
}
