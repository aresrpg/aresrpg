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
import { WEAPON_ATTACK_ID } from '@aresrpg/fight'
import { fight_view } from '@aresrpg/fight'

// One caster whoosh per caster inside this window — a duplicate dispatch of the same cast is dropped.
const CAST_THROTTLE_MS = 300

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
