// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { play_sfx } from '../game/core/audio/sfx.js'
import { IMPACT_BIG_AT, MAG_HP_FRACTION, magnitude_scale } from '../game/vfx_map.js'

/** @type {Readonly<Record<string, string>>} */
const CAST_CHARGE_SFX = Object.freeze({
  air: 'fight_cast_charge_air',
  earth: 'fight_cast_charge_earth',
  fire: 'fight_cast_charge_fire',
  water: 'fight_cast_charge_water',
})
const ABSORB_SFX = Object.freeze(['fight_absorb_1', 'fight_absorb_2', 'fight_absorb_3'])

const absorb_sfx = (id) => {
  const index = Array.from(String(id)).reduce((sum, character) => sum + character.charCodeAt(0), 0) % ABSORB_SFX.length
  return ABSORB_SFX[index]
}

/**
 * Map one renderer presentation beat to its file-backed SFX key.
 * @param {{ id?: string, kind?: string, element?: string, heavy?: boolean } | null} beat
 * @returns {string | null}
 */
export function fight_audio_sfx_key(beat) {
  if (!beat) return null
  if (beat.kind === 'hit') return beat.heavy ? 'fight_hit_heavy' : 'fight_hit_medium'
  if (beat.kind === 'cast_charge') return CAST_CHARGE_SFX[beat.element] ?? null
  if (beat.kind === 'cast_resolve') return 'fight_cast_resolve'
  if (beat.kind === 'absorb') return absorb_sfx(beat.id ?? '')
  return null
}

/**
 * Project a rendered damage row into the character-feel beat vocabulary. A zero-damage Hit is an absorb;
 * positive damage reuses the fight VFX magnitude threshold so sound and image agree about impact weight.
 * @param {{ fight_audio_id?: string, damage?: number, killed?: boolean, is_critical?: boolean } | null} event
 * @param {number | undefined} health_max
 * @returns {{ id: string, kind: 'hit', heavy: boolean } | { id: string, kind: 'absorb' } | null}
 */
export function fight_damage_audio_beat(event, health_max) {
  if (!event?.fight_audio_id || event.damage == null) return null
  const damage = Math.max(0, Number(event.damage) || 0)
  if (damage === 0) return { id: event.fight_audio_id, kind: 'absorb' }
  const mag_ref = health_max > 0 ? health_max * MAG_HP_FRACTION : undefined
  const heavy = !!event.killed || !!event.is_critical || magnitude_scale(damage, mag_ref) >= IMPACT_BIG_AT
  return { id: event.fight_audio_id, kind: 'hit', heavy }
}

/** Project only immutable beat facts; replaying the same presentation produces the same primitive slice. */
export function project_fight_audio_slice(beat) {
  const sfx_key = fight_audio_sfx_key(beat)
  if (!sfx_key) return null
  return `${beat.id}:${beat.kind}:${beat.element ?? ''}:${beat.heavy ? 'heavy' : 'normal'}:${sfx_key}`
}

/**
 * Pure reduce half of the reduce/observe boundary. Effects are values returned to the caller, never store writes.
 * @param {string | null} last_slice
 * @param {{ id?: string, kind?: string, element?: string, heavy?: boolean } | null} beat
 * @returns {{ slice: string | null, sfx_key: string | null }}
 */
export function reduce_fight_audio(last_slice, beat) {
  const slice = project_fight_audio_slice(beat)
  if (!slice || slice === last_slice) return { slice: last_slice, sfx_key: null }
  return { slice, sfx_key: fight_audio_sfx_key(beat) }
}

/** Imperative observe half: fold the projected slice, then perform only the emitted audio effect. */
export function create_fight_audio_observer(emit = play_sfx) {
  let last_slice = null
  return (beat) => {
    const next = reduce_fight_audio(last_slice, beat)
    last_slice = next.slice
    if (next.sfx_key) emit(next.sfx_key)
  }
}
