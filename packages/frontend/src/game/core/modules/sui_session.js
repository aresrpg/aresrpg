// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Session + sui state reducer: the selected character and server-pushed sui data
// (characters/items/balance/...). Pure reducer, no I/O.
//
// M5 (audit row #3): the `action/sui_data` merge is NO LONGER a blind spread. Every async source
// dispatches a TYPED input and the merge law (XP floor, pending ledgers, receipt-over-snapshot) lives
// in one place — @aresrpg/inventory (reduce.js). #1488's loot edge publishes domain facts instead;
// this reducer door is the single home that derives their typed settled-loot input.

import { reduce_sui_data } from '@aresrpg/inventory/reduce'

import { observe_roster_bindings, session_gate_input } from '../../../world-shell/session_gate.js'
import { is_app_managed_follower } from '../../../world-shell/follow_gate.js'
import { INITIAL_SUI_STATE } from '../initial_sui_state.js'

/** @type {import('../game.js').Module} */
export default function sui_session() {
  return {
    /** @param {import('../game.js').Context} context */
    observe({ events, get_state }) {
      // ── THE ROSTER FEED → THE BINDING BOOK (#2007). The indexed roster is EVIDENCE about every character's
      // world, not a second home for it: ferry each delta through the binding door so the book — not each
      // consumer's own copy of the cards — answers "which world is character X in". The reference compare is
      // effect-edge dedupe (the reducer returns the same state for an unchanged feed anyway), never a fact.
      let last_characters = null
      events.on('STATE_UPDATED', (state) => {
        const characters = state.sui?.characters ?? null
        if (characters === last_characters) return
        last_characters = characters
        observe_roster_bindings(characters ?? [])
      })
      // #708 — the roster row's `world_id` is a CACHED snapshot; the book now floors it behind any
      // unconfirmed chain-truth write, so a redundant reselect can no longer clobber a fresher binding and
      // this observer needs no `last_published_id` closure of its own (that guard was a second memory of
      // "what is character X's world"). Healing an externally-drifted binding stays the poll's job.
      events.on('action/select_character', (character_id) => {
        // #509 — an app-managed auto-follower can never become the driven character. Refusing at this ONE door
        // keeps the session scene from re-keying to a follower (the world-join auto-select focus-steal); the
        // reduce half below refuses the selection state itself. The × unfollow clears the gate, restoring both.
        if (is_app_managed_follower(character_id)) return
        const character = get_state().sui.characters.find((row) => row.id === character_id)
        // An indexed roster row carries explicit membership (`string | null`). Ferry that selection through
        // the world shell's ONE typed-input door so its character-keyed scene remounts with the HUD. An
        // An optimistic row can still have `world_id === undefined`; creation publishes the atomic receipt's
        // settled binding directly, so never invent a confirmed-unbound binding from that transient row.
        if (character?.world_id !== undefined) {
          session_gate_input({
            type: 'character_selected',
            character_id: character.id,
            world_id: character.world_id,
          })
        }
      })
    },
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      switch (type) {
        // Full engine-session teardown — the SINGLE authority for it is game/wallet_session_reset.js, fired on a
        // wallet switch (disconnect A → connect B). Clears the SELECTED character + the roster so the next account
        // never inherits the prior one's identity, and resets `loaded`/`load_error` back to the pre-fetch state so
        // the new account's roster reads as LOADING (not confirmed-empty): embed.js's wait_for_character keys on
        // `sui.loaded` to decide "no characters yet" vs "still loading", so a stale `loaded:true` here would let it
        // resolve NULL (decorative world) before the new roster lands. load_roster flips both back on the B fetch.
        case 'action/sui_logout':
          return {
            ...state,
            selected_character_id: null,
            // Rebuild from the boot shape, never from account A's slice. This also drops reducer-owned ledger
            // extensions such as xp_floor/deleted_ids that are intentionally absent before the first input.
            sui: { ...INITIAL_SUI_STATE },
          }
        case 'action/select_character':
          // #509 — refuse embodying an app-managed auto-follower (by sidebar click OR programmatically). The ×
          // on the folded row unfollows FIRST (clearing the follow gate), so the restored ordinary row selects.
          if (is_app_managed_follower(payload)) return state
          return { ...state, selected_character_id: payload }
        // LIVE health stream: health is transient server/Redis state (regen tick + leave=death),
        // NOT the chain object. The server broadcasts packet/characterHealth on every change; fold it
        // onto the matching roster character so the vitals bar reads the live value. Only
        // rebuilds the array when the value actually changed (referential stability for selectors).
        case 'packet/characterHealth': {
          const characters = state.sui.characters
          const target = characters.find((c) => c.id === payload.id)
          if (!target || target.health === payload.health) return state
          return {
            ...state,
            sui: {
              ...state.sui,
              characters: characters.map((c) => (c.id === payload.id ? { ...c, health: payload.health } : c)),
            },
          }
        }
        // Typed-input sui-data merge (M5) — the merge law lives in @aresrpg/inventory; a no-op input returns the
        // SAME sui ref so a delta that changed nothing never churns React.
        case 'action/sui_data': {
          const sui = reduce_sui_data(state.sui, payload)
          return sui === state.sui ? state : { ...state, sui }
        }
        // Mint effects publish receipt-proven rows as a domain event; state derivation belongs here, never in
        // their async completion callbacks. The inventory reducer owns de-duplication and its receipt floor, so
        // a later stale snapshot cannot erase loot and replaying the same event cannot duplicate it.
        case 'action/inventory/loot': {
          const sui = reduce_sui_data(state.sui, {
            kind: 'receipt_patch',
            op: 'settled_loot',
            rows: payload?.rows ?? [],
          })
          return sui === state.sui ? state : { ...state, sui }
        }
        default:
          return state
      }
    },
  }
}
