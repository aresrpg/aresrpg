// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Fight cast SFX — the CASTER-LAYER voice for the PLAYER's own casts (F1 2-layer grammar).
// Subscribes to the SAME raw `packet/fightCastResult` event the optimistic own-turn cast and the chain
// reconcile dispatch, so a player's wind-up whoosh fires the instant they cast. This is HALF of the
// reference's 2-layer spell sound:
//   • cast (here) — the element wind-up whoosh, keyed to the spell's element, the instant the packet arrives.
//   • impact      — the target hit, fired by the voxel adapter's play_cast on the orb's LAND (the same frame
//                   the flipbook burst + damage float resolve), so it lands WITH the visual impact, not on a
//                   fixed timer. ONE home for the impact layer, both paths (player + mob).
//
// It also owns the VICTIM-side hurt cry policy (`hurt_sfx_key` / `play_hurt_sfx` below) — the struck
// character's own gendered voice. That one is a pure verdict called BY the adapter at the flinch beat, so the
// cry lands inside the paced slot with the hit; this module never subscribes it to a raw packet.
//
// This module OWNS only the player's caster whoosh. It never renders, never reads/writes fight state, never
// touches the board. MOB casts are voiced INSIDE their ≥3s-paced replay slot by the adapter (both layers),
// so this module skips them — the existing two-paths-one-voice law: a raw-packet caster whoosh for the
// player (instant), a paced whoosh for the mob (in-slot), never both.
//
// DEDUPE: the optimistic path and the chain reconcile can each dispatch a cast for the SAME caster (the
// store's #39 optimistic-replay suppression drops the reconcile while my own intent is live, but a late
// poll after the intent clears is not covered upstream). A per-caster throttle guarantees one caster whoosh
// never double-voices — a player cannot re-cast inside the on-chain action floor, so a genuinely distinct
// cast is never suppressed.

import { play_element_sfx, play_sfx } from '../audio/sfx.js'
import { element_of_spell } from '../../../world-shell/voxel_fight_folds.js'
import { WEAPON_ATTACK_ID } from '@aresrpg/fight/weapon'
import { fight_view } from '@aresrpg/fight/project'

// One caster whoosh per caster inside this window — a duplicate dispatch of the same cast is dropped.
const CAST_THROTTLE_MS = 300

// Entity-id convention shared with the fight projection: mobs are `mob-<idx>`, characters carry their id.
const MOB_ID_PREFIX = 'mob-'

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

/** @type {import('../game.js').Module} */
export default function fight_sfx() {
  // caster id → last ms a cast sound fired for it (the per-caster double-play throttle).
  /** @type {Map<string, number>} */
  const last_cast_at = new Map()
  // [2026-07-12, adds a missing death sound for players] the fight_id whose LOCAL-player death sting has
  // already fired — the killing packet can re-arrive (optimistic + chain reconcile), and a player dies once, so
  // this latch guarantees exactly one player-death sound per fight.
  let death_voiced_for = /** @type {string | null} */ (null)

  return {
    /** @param {import('../game.js').Context} context */
    observe(context) {
      const { events } = context
      events.on(
        'packet/fightCastResult',
        (/** @type {{ entity_id?: string, spell_id?: string, fight_id?: string, effects?: any[] }} */ packet) => {
          // ── PLAYER-DEATH sting ──────────────────────────────────────────────────────────────────
          // The LOCAL player's own KO. Keyed off the SAME packet the death beat/anim resolve from (NOT a new
          // trigger): whichever caster lands the effect whose `killed` names MY fighter, voice the corpus KO
          // sound once. It rides packet arrival (before the paced death anim); the sibling lane guarantees that
          // anim plays before the end card, so the sound is never cut by an instant results-card teardown.
          const fight = fight_view() // synchronous core view (S2 mirror kill)
          const me = fight?.my_entity_id
          if (me && fight?.fight_id !== death_voiced_for) {
            const killed_me = (packet?.effects ?? []).some(
              (/** @type {{ killed?: boolean, target_id?: string }} */ e) => e?.killed && e?.target_id === me
            )
            if (killed_me) {
              death_voiced_for = fight.fight_id ?? null
              play_sfx('player_death')
            }
          }

          // ── PLAYER CASTER whoosh (the wind-up, instant on the raw packet) ────────────────────────────────
          const caster = packet?.entity_id
          if (!caster) return
          // MOB casts are voiced by the adapter INSIDE their ≥3s-paced replay slot (both layers ride the same
          // paced beat clock as the anim). This module owns the RAW/player caster layer only.
          if (caster.startsWith('mob-')) return
          const now = Date.now()
          const prev = last_cast_at.get(caster)
          if (prev != null && now - prev < CAST_THROTTLE_MS) return // same cast — already voiced
          last_cast_at.set(caster, now)

          // the element wind-up whoosh — NOW, as the packet arrives (the caster half of the 2-layer pair;
          // the impact half fires from the adapter on the orb's land). [2026-07-11] a physical weapon swing
          // has no magic windup (mirrors voxel_fight_adapter's mob-side guard + sfx.js's 'weapon:impact'-only
          // coverage comment) — was silently playing a neutral magic-whoosh before every melee attack.
          if (packet.spell_id !== WEAPON_ATTACK_ID) play_element_sfx(element_of_spell(packet.spell_id), 'cast')
        }
      )
    },
  }
}
