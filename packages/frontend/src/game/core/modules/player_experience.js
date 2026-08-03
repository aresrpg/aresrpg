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
import { points_for_level_range } from '@aresrpg/sdk/progression'
import { commit_fact, commit_loot, empty_result } from '@aresrpg/fight/result_record'

import { game_log } from '../../../core/log.js'
import { reconcile_fight_character } from '../../../roster/fight_character_refresh.js'
import { push_event_toast } from '../toast.js'

/**
 * One looted item line surfaced in the result modal — mapped from the minted FightResult's own `rolled`
 * declaration (the settlement receipt) by `loot_from_rolled` (world-shell/fight_result_receipt.js, the
 * receipt-parse home), NEVER from an inventory diff (the v30 receipt law).
 * @typedef {object} FightLoot
 * @property {string} [item_id] exact owned Item id once the ItemMinted receipt has landed
 * @property {string} [template_id] exact ItemTemplate id when the FightResult object read has landed;
 *   event-floor rows lack one
 * @property {string} item_type   dropped item's on-chain class/legacy slug (exact identity is template_id)
 * @property {string} [icon_slug] authored render slug snapshotted from the session's live template map
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
 * @property {FightLoot[]} loot         items gained this fight — the MONOTONIC record's rows (@aresrpg/fight/
 *                                       result_record): they only ever add or gain fields, never shrink
 * @property {number|null} loot_units   loot units the ResultOpened event rolled (null until settlement lands);
 *                                       the card renders THIS many skeleton tiles until `loot` hydrates. A
 *                                       SEPARATE fact from `loot` on purpose — a loading count is not a drop.
 * @property {any[]} conflicts          transports that contradicted a committed fact, retained as DATA
 * @property {Record<string,string>} provenance which home first answered each committed fact
 * @property {string} [result_id] exact FightResult object currently bound to this card
 */

/**
 * The transient level-up congrats card slice. null when nothing is showing.
 * @typedef {object} LevelUpSlice
 * @property {number} level           the character's level after the gain
 * @property {number} levels_gained   levels crossed in this gain (>= 1)
 * @property {number} stat_points      characteristic points earned (= 5 * levels_gained)
 * @property {number} spell_points      spell points earned (= 1 * levels_gained)
 */

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
      // the grant is the CHAIN's own `points_for_level_range` (@aresrpg/sdk/progression) — the same door the
      // spellbook, the build drawer and the simulator read, never a per-surface 5/1 literal.
      return {
        level: payload.level,
        levels_gained: payload.levels_gained,
        ...points_for_level_range(0, payload.levels_gained),
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
      // A FRESH record every open: monotonicity is scoped to ONE fight's lifetime, so the card's own open is
      // where the ratchet resets. Nothing else may reset it.
      return {
        ...empty_result(),
        status: 'pending',
        xp: 0,
        level: payload.level,
        levels_gained: 0,
        points_gained: 0,
      }
    case 'action/fight_result/bind':
      if (!result || !payload.result_id || (result.result_id && result.result_id !== payload.result_id)) return result
      if (result.result_id === payload.result_id) return result
      return { ...result, result_id: payload.result_id }
    case 'action/fight_result/resolve':
      // the settlement receipt landed (finish_result's ResultOpened dispatch — the ONE resolver, 07-18 law) —
      // fill in xp / level-up. Tolerate a resolve with no open modal (e.g. a receipt landing outside the
      // post-fight window) by ignoring it. Loot is folded separately (its items-delta refetch is independent
      // of the characters refetch), so preserve any loot already landed. loot_units rides the receipt resolve;
      // the object-read FALLBACK resolve (a receipt-parse miss) may omit it, so `?? result.loot_units`
      // preserves whichever resolve carried the real count (order-independent).
      if (!result) return result
      if (payload.result_id && payload.result_id !== result.result_id) return result
      // xp/level/levels_gained/points_gained are written straight: `resolve_reward` fires ONCE per settlement
      // (the object-read fallback is gated on the receipt having carried no event), and the roster's own XP
      // floor in @aresrpg/inventory already refuses a lagging /v1 read. `loot_units` is the fact two different
      // resolves CAN both carry, so it goes through the record's guard — order-independent, and a disagreeing
      // count is recorded rather than picked.
      return commit_fact(
        {
          ...result,
          result_id: payload.result_id ?? result.result_id,
          status: 'resolved',
          xp: payload.xp,
          level: payload.level,
          levels_gained: payload.levels_gained,
          points_gained: payload.points_gained,
        },
        'loot_units',
        payload.loot_units,
        'receipt'
      )
    case 'action/fight_result/loot_units':
      // The rolled COUNT, on its own door — the skeleton the card renders while the drops hydrate. Its own fact,
      // never a row in `loot` (finding row 68), and monotonic like everything else: a second, disagreeing count
      // never repaints the card, it lands on `conflicts`.
      if (!result) return result
      if (payload.result_id && payload.result_id !== result.result_id) return result
      return commit_fact(result, 'loot_units', payload.loot_units, 'receipt')
    case 'action/fight_result/loot':
      // THE MONOTONIC LOOT COMMIT (#1993 WP4). settlement fans this dispatch out over transports that finish in
      // no fixed order — the aggregate FightResult declaration and the exact ItemMinted rows — and each one is
      // evidence about the rows it NAMES, never about the rest. `commit_loot` (@aresrpg/fight/result_record) is
      // the one home of that law: rows add, rows gain fields, exact enumeration retires its own aggregate, and a
      // contradiction lands on `conflicts` instead of repainting the card. It replaced three hand-rolled
      // precedence flags here (`loot_resolved`, `loot_instances_resolved`, and the adopt-don't-blank empty
      // check) — the same rule, stated once, per row rather than per dispatch. #1867 is the bug that made all
      // three necessary and none of them sufficient: a re-read carrying FEWER rows still un-looted the player.
      if (!result) return result
      if (payload.result_id && payload.result_id !== result.result_id) return result
      return commit_loot(result, payload.loot, payload.instances ? 'minted' : 'object_read')
    case 'action/fight_result/close':
      return null
    default:
      return result
  }
}

/** @type {import('../game.js').Module} */
export default function player_experience({ refresh_character = reconcile_fight_character } = {}) {
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
      // DECLINED MIGRATION (#1993 WP4). The canonical proposal is to open this card off the result projection
      // rather than off a winner number on an event. It cannot be done from here: the projection lives in the
      // fight store, and this card must outlive that store's teardown — reading it at open would bind a slice
      // whose source is about to be destroyed to the very thing that destroys it. `claim` already reads the
      // canonical record and emits THIS event from it (dungeon_run_store.js), so the event IS the record's
      // verdict crossing the lifetime boundary — one hop, in one direction, which is the shape the two-store
      // notification cycle (#1740) is banned for lacking.
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
        void refresh_character(
          {
            character_id: payload.character_id,
            expected_experience,
          },
          { get_state, dispatch }
        ).catch((error) => game_log('load_roster', 'post-fight Character reconcile failed', error))
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
