// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRESENCE ADAPTER (D770a W3) — the frontend edge of @aresrpg/world's presence core: THE one store
// instance, the dispatch helper, the React binding, and the chain-identity EFFECT executor (the core
// requests a resolve on first sighting; this edge reads the Character object chain-direct and answers
// through the door — the exact read the old presence module performed inline).

import { useStore } from 'zustand'
import {
  create_presence_store,
  peer_state_by_address,
  peer_state_of,
  peer_states_by_address,
  subscribe_identity_requests,
} from '@aresrpg/world/presence'

/** THE one presence atom for the app (the package factory owns its shape + door). */
export const presence_store = create_presence_store()

/** Dispatch one typed presence input without exposing store plumbing at call sites. */
export function presence_input(input, now) {
  presence_store.getState().input(input, now)
}

/**
 * React binding + imperative statics (the M2 use_party idiom).
 * @type {(<T>(selector: (state: import('@aresrpg/world').PresenceState) => T) => T) & Pick<import('zustand/vanilla').StoreApi<import('@aresrpg/world').PresenceState>, 'getState' | 'subscribe'>}
 */
export const use_presence = Object.assign((selector) => useStore(presence_store, selector), {
  getState: () => presence_store.getState(),
  subscribe: (listener) => presence_store.subscribe(listener),
})

// ONE PROJECTION HOME (#1698): the world package's peer projections, bound to THIS app's store. `peers` is the
// presence fold's only roster — joining the p2p room IS the announcement, so there is no second registry to
// merge against and no way for the two to disagree. Identity prefers the chain record and falls back to the
// peer's self-declared row.

/** One live character, or null when nobody by that id is here. */
export const presence_character = (character_id) => peer_state_of(presence_store.getState(), character_id)

/** The first live character belonging to a wallet address (friend dots, chat-click → menu). */
export const presence_character_by_address = (address) => peer_state_by_address(presence_store.getState(), address)

/** Every live character of a wallet address, each with its accepted cell — fast travel picks the freshest. */
export const presence_characters_by_address = (address) => peer_states_by_address(presence_store.getState(), address)

// ── THE IDENTITY EXECUTOR — chain-direct enrichment (S-50, backend-off): on a first sighting the core
// requests a resolve; read the peer's Character object straight off chain via the SDK's gRPC client (the
// SAME `read_character(grpc_client, id)` read load_roster uses — src/chain, D770c). The WHOLE chain leg
// rides LAZY failure-path imports (the chain/ sanctioned lazy-edge pattern, sdk.ts report_error precedent):
// the read client loads only when an identity actually resolves — tests stub it through the chain-sdk
// module mock (test_helpers/expedition_sdk_mock.js) — and ANY failure (sdk init, module load, read) answers
// null through the door: the placeholder identity stands; an
// escrowed peer resolves null too (acceptable). A request is NEVER left unanswered.
subscribe_identity_requests(presence_store, ({ ids }) => {
  for (const id of ids)
    void (async () => {
      const [{ get_sdk }, { read_character }] = await Promise.all([
        import('../chain/sdk'),
        import('../chain/read_character.js'),
      ])
      const { grpc_client } = await get_sdk()
      return read_character(grpc_client, id)
    })()
      .catch(() => null)
      .then((record) =>
        presence_input({
          type: 'peer_identity',
          id,
          record: record
            ? { name: record.name, classe: record.classe, male: record.male, color_1: record.color_1 }
            : null,
        })
      )
})
