// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Player experience / end-of-fight result — the SSOT for the post-fight reward modal. Ported from
// the AresRPG dapp's core/modules/player_experience.js (the per-character experience delta tracker
// that emitted LEVEL_UP + a "+N XP" toast) and the game-fight-result.vue / game-popup-levelup.vue
// structure, folded into ONE focused modal slice (single player vs mobs — not the legacy two-table
// roster). Truth is the chain: the wire `fightEnded` carries ONLY {fight_id, winner} (no xp/loot),
// so this module opens the modal in a `pending` state on a player WIN. RECEIPT-FIRST LAW (07-18):
// the SETTLEMENT RECEIPT is the ONE resolver — finish_result (dungeon_settlement.js) dispatches
// `action/fight_result/resolve` off its own ResultOpened event (xp_share/loot_units) AND
// `action/fight_result/loot` off the minted FightResult's own `rolled` declaration (mapped through
// `loot_from_rolled` below); the /v1 roster owes the modal nothing and never resolves it (the
// legacy delta-resolve home died — it raced the read layer; the legacy ITEMS-DIFF loot home died
// 2026-07-18 with it: a D245 bag transient emptied its baseline and the post-settle full-bag
// repaint rendered a player's pet as mob loot — an inventory diff is a reconstruction, not a receipt).
// The roster-delta observer below survives ONLY as projections: the "+N XP" toast and the level-up
// card (they also cover non-fight xp — quests/admin grants). React (FightResult.jsx) renders the
// slice; it never computes the reward — that is chain-authoritative, credited by the settle+open tx.

import { experience_to_level } from '@aresrpg/sdk/experience'

import { game_log } from '../../../core/log.js'
import { push_event_toast } from '../toast.js'

const refresh_fight_character = (target) =>
  import('../../../roster/load_roster.js').then(({ reconcile_fight_character }) =>
    reconcile_fight_character(target)
  )

/**
 * One looted item line surfaced in the result modal — mapped from the minted FightResult's own `rolled`
 * declaration (the settlement receipt) by `loot_from_rolled` (world-shell/fight_result_receipt.js, the
 * receipt-parse home), NEVER from an inventory diff (the v30 receipt law).
 * @typedef {object} FightLoot
 * @property {string} [template_id] exact ItemTemplate id when the FightResult object read has landed;
 *   event-floor rows lack one
 * @property {string} item_type   dropped item's on-chain class/legacy slug (exact identity is template_id)
 * @property {string} name        display name (from the item template row)
 * @property {number} amount      quantity the chain rolled this fight
 */

/**
 * The end-of-fight result modal slice. null when nothing is showing.
 * @typedef {object} FightResultSlice
 * @property {'pending' | 'resolved'} status   pending = reward tx in flight; resolved = chain delta landed
 * @property {number} xp                gained experience (0 until resolved)
 * @property {number} level             the character's level after the fight
 * @property {number} levels_gained     levels gained this fight (0 if no level-up)
 * @property {number} points_gained     characteristic points gained (= available_points delta)
 * @property {FightLoot[]} loot         items gained this fight (empty until the event floor or the items delta lands)
 * @property {number|null} loot_units   loot units the ResultOpened event rolled (null until settlement lands);
 *                                       the card renders THIS many skeleton tiles until `loot` hydrates.
 * @property {boolean} [loot_resolved]  internal reconciliation flag (leg②, never read by the card): true once
 *                                       `loot` rode the FightResult OBJECT READ's real `rolled` declaration —
 *                                       false/absent while it is still the event-floor placeholder
 *                                       (dungeon_settlement.js's floor_loot). Gates the fold below so a stale/
 *                                       duplicate floor dispatch can never regress an already-resolved list.
 */

/**
 * The transient level-up congrats card slice. null when nothing is showing.
 * @typedef {object} LevelUpSlice
 * @property {number} level           the character's level after the gain
 * @property {number} levels_gained   levels crossed in this gain (>= 1)
 * @property {number} stat_points      characteristic points earned (= 5 * levels_gained)
 * @property {number} spell_points      spell points earned (= 1 * levels_gained)
 */

// Legacy reference-corpus grant per level: 5 characteristic points + 1 spell point.
const STAT_POINTS_PER_LEVEL = 5
const SPELL_POINTS_PER_LEVEL = 1

/**
 * Fold one `action/level_up/*` into the slice.
 * @param {LevelUpSlice | null} slice
 * @param {string} type
 * @param {any} payload
 * @returns {LevelUpSlice | null}
 */
const fold_level_up = (slice, type, payload) => {
  switch (type) {
    case 'action/level_up/open':
      return {
        level: payload.level,
        levels_gained: payload.levels_gained,
        stat_points: payload.levels_gained * STAT_POINTS_PER_LEVEL,
        spell_points: payload.levels_gained * SPELL_POINTS_PER_LEVEL,
      }
    case 'action/level_up/close':
      return null
    default:
      return slice
  }
}

/**
 * Fold one `action/fight_result/*` into the slice.
 * @param {FightResultSlice | null} result
 * @param {string} type
 * @param {any} payload
 * @returns {FightResultSlice | null}
 */
const fold = (result, type, payload) => {
  switch (type) {
    case 'action/fight_result/open':
      // open (or re-open) in the pending state — the reward tx is being signed/submitted. xp/level render a
      // SKELETON (not a literal 0/loot) until the chain delta resolves — avoids flashing "0xp" before
      // the correct xp lands; show a loading skeleton instead of 0. loot_units is unknown until settlement lands.
      return {
        status: 'pending',
        xp: 0,
        level: payload.level,
        levels_gained: 0,
        points_gained: 0,
        loot: [],
        loot_units: null,
      }
    case 'action/fight_result/resolve':
      // the settlement receipt landed (finish_result's ResultOpened dispatch — the ONE resolver, 07-18 law) —
      // fill in xp / level-up. Tolerate a resolve with no open modal (e.g. a receipt landing outside the
      // post-fight window) by ignoring it. Loot is folded separately (its items-delta refetch is independent
      // of the characters refetch), so preserve any loot already landed. loot_units rides the receipt resolve;
      // the object-read FALLBACK resolve (a receipt-parse miss) may omit it, so `?? result.loot_units`
      // preserves whichever resolve carried the real count (order-independent).
      if (!result) return result
      return {
        ...result,
        status: 'resolved',
        xp: payload.xp,
        level: payload.level,
        levels_gained: payload.levels_gained,
        points_gained: payload.points_gained,
        loot_units: payload.loot_units ?? result.loot_units,
      }
    case 'action/fight_result/loot':
      // the settlement receipt's loot landed (finish_result's FightResult `rolled` dispatch — the ONE loot
      // producer, per the receipt-first law). Independent of resolve (xp), so it may arrive before or after it;
      // merge onto whatever the slice currently holds. Ignore if closed.
      // RECONCILE INSIDE THE REDUCE (recap-truth lane leg②, CLIENT-INDEPENDENCE LAW §3): dungeon_settlement.js
      // may dispatch this TWICE per fight — an event-floor placeholder first (resolved:false, the instant
      // loot_units is known), the object read's real list second (resolved:true), or only the first if the
      // read never lands. SAME-VERSION DISCARD: once `loot_resolved` is true, a later resolved:false dispatch
      // (a stale/duplicate floor) is a no-op — richer data never regresses. RICHER ADOPT: anything else
      // (first-ever arrival, or a resolved:true dispatch) always adopts.
      if (!result) return result
      if (result.loot_resolved && !payload.resolved) return result
      return { ...result, loot: payload.loot, loot_resolved: !!payload.resolved }
    case 'action/fight_result/close':
      return null
    default:
      return result
  }
}

/** @type {import('../game.js').Module} */
export default function player_experience({ refresh_character = refresh_fight_character } = {}) {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      if (type.startsWith('action/fight_result/'))
        return {
          ...state,
          fight_result: fold(state.fight_result, type, payload),
        }
      if (type.startsWith('action/level_up/'))
        return {
          ...state,
          level_up: fold_level_up(state.level_up, type, payload),
        }
      return state
    },
    /** @param {import('../game.js').Context} context */
    observe({ events, dispatch, get_state }) {
      // Per-character last-seen on-chain experience, so we can surface DELTAS (toast/level-up projections)
      // when the read-model refetch (suiEvent → sui_data) repaints after xp lands.
      // NOTE (v30 receipt law): the sibling LOOT-delta tracker that lived here (last_items baseline +
      // awaiting_loot gate diffing state.sui.items) is DEAD — an inventory diff manufactured loot out of any
      // bag repaint that outgrew its baseline (D245 transients emptied it → the full-bag repaint rendered the
      // player's own pet as mob loot). Loot now rides finish_result's FightResult `rolled` dispatch only.
      /** @type {Map<string, { experience: number }>} */
      const last = new Map()

      const active_character = () => {
        const { sui, selected_character_id } = get_state()
        return sui.characters.find((c) => c.id === selected_character_id) ?? null
      }

      // A player WIN (our team) opens the modal immediately in the pending state — the settle+open tx is
      // being signed/submitted; the xp/level resolve from ITS receipt (finish_result's ResultOpened dispatch).
      // winner is the local team number (0 = player team) resolved in fight.js.
      events.on('action/fight/ended', ({ winner }) => {
        if (winner !== 0) return
        const character = active_character()
        const experience = character?.experience ?? 0
        dispatch('action/fight_result/open', {
          // curve floor is level 1 — experience_to_level(0) === 1, so a fresh 0-XP character is level 1, never 0.
          // (the old `experience ? … : 0` rendered "Lv 0" on the victory card for a first-fight character.)
          level: experience_to_level(experience),
        })
      })

      // The literal fight-ended event above is PRE-settlement, so fetching there can only return the old XP.
      // `action/fight_result/resolve` is the existing post-settle bus signal: ResultOpened has supplied both the
      // paid delta and an absolute XP floor. Drive one bounded, cache-bypassed `/v1` reconcile from that signal;
      // the full load_roster tail still refreshes loot/HP independently.
      events.on('action/fight_result/resolve', (payload) => {
        const expected_experience = Number(payload?.expected_experience ?? NaN)
        if (!payload?.character_id || !Number.isFinite(expected_experience)) return
        void refresh_character({
          character_id: payload.character_id,
          expected_experience,
        }).catch((error) => game_log('load_roster', 'post-fight Character reconcile failed', error))
      })

      // Track every character's experience/available_points and surface deltas as PROJECTIONS ONLY —
      // a "+N XP" event toast on any experience gain and the level-up card. Mirrors the legacy tracker
      // minus its modal-resolve: the settlement receipt is the modal's one resolver (07-18 law), so a
      // roster delta NEVER dispatches `action/fight_result/resolve`. Subscribed to STATE_UPDATED
      // (observe-only; the chain read-model is the source, this never mutates it).
      let last_characters = null
      events.on('STATE_UPDATED', (state) => {
        const characters = state.sui?.characters
        if (characters === last_characters) return
        last_characters = characters
        // D245 — the roster transiently empties/undefined during a fight (the fighting char is ESCROWED in the
        // dungeon → invisible to a kiosk scan → a mid-fight load_roster/refresh drops it for a tick). Guard the
        // iterate: `state.sui.characters` can be undefined on that transient → 'object is not iterable' (qa).
        for (const character of characters ?? []) {
          const experience = character.experience ?? 0
          const previous = last.get(character.id)
          if (!previous) {
            last.set(character.id, { experience })
            continue
          }
          const xp_delta = experience - previous.experience
          if (xp_delta === 0) continue

          const level_before = experience_to_level(previous.experience)
          const level_after = experience_to_level(experience)
          last.set(character.id, { experience })

          // fire-and-forget "+N XP" toast (faithful to the legacy tracker), only on a gain
          if (xp_delta > 0)
            push_event_toast({
              state: 'success',
              title: `+${xp_delta} XP`,
              message: character.name ?? '',
            })

          // level-up congrats card — fire on the ACTIVE character crossing one+ levels (regardless of
          // whether a fight modal is open: xp can also land from quests/admin grants). The chain has
          // already credited the +5 characteristic + 1 spell points per level; this is the momentary
          // celebration. Faithful to game-popup-levelup.vue (levels_taken * 5 stat / levels_taken spell).
          if (character.id === state.selected_character_id && level_after > level_before) {
            dispatch('action/level_up/open', {
              level: level_after,
              levels_gained: level_after - level_before,
            })
          }
        }
      })
    },
  }
}
