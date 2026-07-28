// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// File-backed audio registry. Asset identity, path construction, HTMLAudioElement construction, and the
// actual media play call live here; feature modules keep only their timing, mute, and mix policy.

import { asset_url } from '@aresrpg/sdk/jobs'

import { ASSETS_URL } from '../../../env'

const FIXED_SFX_ASSETS = Object.freeze({
  button: '/sfx/menu_button.aac',
  carousel: '/sfx/menu_carousel.aac',
  sword_plant: '/sfx/sword_plant_impact.ogg',
  turn_start: '/sfx/turn_clock.ogg',
  turn_start_legacy: '/sfx/turn_start.ogg',
  crit: '/sfx/crit_spell.ogg',
  death: '/sfx/death_sting.ogg',
  knockback: '/sfx/knockback_impact.ogg',
  player_death: '/sfx/player_death.ogg',
  fight_hit_medium: '/sfx/fight/being-hit-medium.ogg',
  fight_hit_heavy: '/sfx/fight/being-hit-heavy.ogg',
  // The struck CHARACTER's own voice, layered over the generic being-hit thwack above (authored one-shots,
  // shipped as delivered — aac plays natively, same as the menu cues).
  fight_hurt_male: '/sfx/fight/hurt-male.aac',
  fight_hurt_female: '/sfx/fight/hurt-female.aac',
  fight_cast_charge_air: '/sfx/fight/cast-charge-air.ogg',
  fight_cast_charge_earth: '/sfx/fight/cast-charge-earth.ogg',
  fight_cast_charge_fire: '/sfx/fight/cast-charge-fire.ogg',
  fight_cast_charge_water: '/sfx/fight/cast-charge-water.ogg',
  fight_cast_resolve: '/sfx/fight/cast-resolve.ogg',
  fight_absorb_1: '/sfx/fight/absorb-1.ogg',
  fight_absorb_2: '/sfx/fight/absorb-2.ogg',
  fight_absorb_3: '/sfx/fight/absorb-3.ogg',
})

/** Every shipped elemental family/layer and its number of corpus variants. */
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
})

/** @param {string} family @param {string} layer @param {number} [variant] */
export const element_audio_key = (family, layer, variant = 1) => `element_${layer}_${family}_${variant}`

const element_audio_assets = Object.fromEntries(
  Object.entries(ELEMENT_AUDIO_VARIANTS).flatMap(([family_layer, count]) => {
    const [family, layer] = family_layer.split(':')
    return Array.from({ length: count }, (_, index) => {
      const variant = index + 1
      const suffix = variant > 1 ? `_${variant}` : ''
      return [element_audio_key(family, layer, variant), `/sfx/${layer}_${family}${suffix}.ogg`]
    })
  })
)

/** The owned roam/battle pairs on the music quilt. */
export const MUSIC_TRACK_NAMES = Object.freeze([
  'arctic',
  'desert',
  'glacier',
  'grassland',
  'scorched',
  'swamp',
  'taiga',
  'temperate',
  'tropical',
])

/** @param {string} name @param {'roam' | 'battle'} bed */
export const music_audio_key = (name, bed) => `music_${name}_${bed}`
export const MUSIC_MANIFEST_PROBE_KEY = music_audio_key(MUSIC_TRACK_NAMES[0], 'roam')

const music_audio_assets = Object.fromEntries(
  MUSIC_TRACK_NAMES.flatMap((name) => [
    [music_audio_key(name, 'roam'), `${ASSETS_URL}/music/${name}.mp3`],
    [music_audio_key(name, 'battle'), `${ASSETS_URL}/music/${name}_battle.mp3`],
  ])
)

/** One key → fallback asset path home for every file-backed sound shipped or streamed by the frontend. */
export const AUDIO_ASSETS = Object.freeze({
  ...FIXED_SFX_ASSETS,
  ...element_audio_assets,
  ...music_audio_assets,
})

const is_music_key = (key) => key.startsWith('music_')
const filename_of = (src) => src.split('/').pop() ?? ''

/** Resolve a registered key. Music checks the boot manifest lazily so a late asset-host manifest can still win.
 * @param {string} key @returns {string | null} */
export function audio_asset_src(key) {
  const fallback = AUDIO_ASSETS[key]
  if (!fallback) return null
  if (!is_music_key(key)) return fallback
  return asset_url('music', filename_of(fallback)) ?? fallback
}

/** @param {string} family @param {string} layer @param {number} [variant] @returns {string | null} */
export const element_audio_src = (family, layer, variant = 1) =>
  audio_asset_src(element_audio_key(family, layer, variant))

/** @param {string} name @param {'roam' | 'battle'} bed @returns {string | null} */
export const music_audio_src = (name, bed) => audio_asset_src(music_audio_key(name, bed))

/** Whether a registered music asset currently resolves through the asset-host manifest. */
export function is_music_asset_resolved(key) {
  const fallback = AUDIO_ASSETS[key]
  return !!fallback && is_music_key(key) && asset_url('music', filename_of(fallback)) != null
}

/**
 * The house music level, 0..1 — subtle by default, never harsh. ONE home: the ambient beds and the hack
 * radio both play at it, so switching stream owner is never a level jump.
 */
export const MUSIC_VOLUME = 0.35

/**
 * Construct a media player from an already registry-resolved source. Headless environments stay inert.
 * @param {string} src
 * @param {{ loop?: boolean, preload?: string, volume?: number, on_error?: EventListener }} [options]
 * @returns {HTMLAudioElement | null}
 */
export function create_audio(src, options = {}) {
  if (!src || typeof Audio === 'undefined') return null
  const player = new Audio(src)
  if (options.loop != null) player.loop = options.loop
  if (options.preload != null) player.preload = options.preload
  if (options.volume != null) player.volume = options.volume
  if (options.on_error) player.addEventListener('error', options.on_error)
  return player
}

/**
 * The single HTML-media play door. A string is a registry key for a fresh one-shot; an existing player is used
 * by looping music. Rejections remain visible so music recovery can distinguish autoplay and load failures.
 * @param {string | HTMLAudioElement} target
 * @param {{ loop?: boolean, preload?: string, volume?: number, on_error?: EventListener }} [options]
 * @returns {Promise<unknown | null>}
 */
export function play_audio(target, options = {}) {
  const player = typeof target === 'string' ? create_audio(audio_asset_src(target) ?? '', options) : target
  if (!player) return Promise.resolve(null)
  try {
    return Promise.resolve(player.play())
  } catch (error) {
    return Promise.reject(error)
  }
}
