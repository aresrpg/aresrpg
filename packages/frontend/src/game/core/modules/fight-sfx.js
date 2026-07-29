// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight voice verdicts. Playback is owned by the voxel adapter's presented beat pipeline, so sound follows the
// same paced edge as image and never depends on an event name with no producer.

import { play_sfx } from '../audio/sfx.js'

// Entity-id convention shared with the fight projection: mobs are `mob-<idx>`, characters carry their id.
const MOB_ID_PREFIX = 'mob-'

/**
 * The distinct player KO sting for one presented death edge. The adapter's `observe_death` is the once-per-life
 * gate; this verdict only selects the sound family and never invents a second death latch.
 * @param {{ is_player?: boolean } | null | undefined} victim
 * @param {string | null | undefined} victim_id
 * @param {string | null | undefined} my_entity_id
 * @returns {'player_death' | null}
 */
export const death_sfx_key = (victim, victim_id, my_entity_id) =>
  victim?.is_player && victim_id === my_entity_id ? 'player_death' : null

/**
 * The gendered hurt cry for ONE presented damage beat — the struck CHARACTER's own voice, layered over the
 * generic being-hit thwack (fight_audio's fight_hit_*). Silent unless a mob-sourced blow actually landed on a
 * player character: mob victims keep their own impact vocabulary, a peer's hit is not "hit by a mob", and a
 * zero-damage absorb or a heal is no blow at all. An unresolved gender stays silent rather than guessing one —
 * a misgendered cry is worse than the thwack alone, which already voices the beat.
 * Pure: the fighter row is the honest gender source (`male`, packages/fight/src/project.js).
 * @param {{ source_id?: string | null, target_id?: string | null, damage?: number | null } | null} event
 * @param {{ is_player?: boolean, male?: boolean } | null | undefined} victim the struck fighter's projected row
 * @returns {'fight_hurt_male' | 'fight_hurt_female' | null}
 */
export const hurt_sfx_key = (event, victim) => {
  if (!(Number(event?.damage) > 0)) return null
  if (!String(event?.source_id ?? '').startsWith(MOB_ID_PREFIX)) return null
  if (String(event?.target_id ?? '').startsWith(MOB_ID_PREFIX)) return null
  if (!victim?.is_player || typeof victim.male !== 'boolean') return null
  return victim.male ? 'fight_hurt_male' : 'fight_hurt_female'
}

/**
 * Effect edge for the cry above — voiced by the adapter AT the victim's flinch beat, so it lands inside the
 * paced replay slot with the hit rather than seconds early on the raw packet. Best-effort, mute-aware (play_sfx).
 * @param {{ source_id?: string | null, target_id?: string | null, damage?: number | null } | null} event
 * @param {{ is_player?: boolean, male?: boolean } | null | undefined} victim
 * @returns {void}
 */
export const play_hurt_sfx = (event, victim) => {
  const key = hurt_sfx_key(event, victim)
  if (key) play_sfx(key)
}
