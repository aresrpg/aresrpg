// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Session + sui state reducer: the zkLogin wallet/account/address, the selected character, and
// server-pushed sui data (characters/items/balance/...). Pure reducer, no I/O — the React
// onboarding dispatches action/sui_login after Enoki connect, then connect().
//
// M5 (audit row #3): the `action/sui_data` merge is NO LONGER a blind spread. Every async source
// dispatches a TYPED input and the merge law (XP floor, pending ledgers, receipt-over-snapshot) lives
// in one place — @aresrpg/inventory (reduce.js). See its header for the input kinds.

import { reduce_sui_data } from '@aresrpg/inventory/reduce'

/** @type {import('../game.js').Module} */
export default function sui_session() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      switch (type) {
        case 'action/sui_login':
          return {
            ...state,
            sui: {
              ...state.sui,
              wallet: payload.wallet,
              account: payload.account,
              selected_address: payload.address,
            },
          }
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
            sui: {
              ...state.sui,
              wallet: null,
              account: null,
              selected_address: null,
              characters: [],
              items: [],
              settled_item_floor: {},
              loaded: false,
              load_error: null,
              // Drop the receipt-proven XP floors — the next account's roster starts unbound.
              xp_floor: {},
              // Drop the delete tombstones too (BACKLOG 18) — same receipt-ledger class as the XP floor.
              deleted_ids: {},
            },
          }
        case 'action/select_character':
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
        default:
          return state
      }
    },
  }
}
