// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PRESENCE ADAPTER (D770a W3) — the frontend edge of @aresrpg/world's presence core: THE one store
// instance, the dispatch helper, the React binding, and the chain-identity EFFECT executor (the core
// requests a resolve on first sighting; this edge reads the Character object chain-direct and answers
// through the door — the exact read the old presence module performed inline).

import { useStore } from 'zustand'
import { create_presence_store, subscribe_identity_requests } from '@aresrpg/world/presence'

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

/** Server-observed identity joined to the latest courier pose and chain-resolved display record. */
export function presence_character(character_id) {
  const state = presence_store.getState()
  const peer = state.peers.get(character_id)
  const online = state.online.get(character_id)
  if (!peer && !online) return null
  return {
    ...(peer ?? {}),
    ...(online ?? {}),
    id: character_id,
    address: online?.address || peer?.address || '',
    name: peer?.chain?.name ?? peer?.name ?? online?.name ?? null,
    classe: peer?.chain?.classe ?? peer?.classe ?? null,
    male: peer?.chain?.male ?? peer?.male ?? null,
    color_1: peer?.chain?.color_1 ?? peer?.color_1 ?? 0,
  }
}

/** The first server-observed character belonging to a wallet address. */
export function presence_character_by_address(address) {
  if (!address) return null
  const state = presence_store.getState()
  for (const row of state.online.values()) if (row.address === address) return presence_character(row.id)
  for (const peer of state.peers.values()) if (peer.address === address) return presence_character(peer.id)
  return null
}

/** Every courier-positioned character currently observed for a wallet address. */
export function presence_characters_by_address(address) {
  if (!address) return []
  const state = presence_store.getState()
  const ids = new Set()
  for (const row of state.online.values()) if (row.address === address) ids.add(row.id)
  for (const peer of state.peers.values()) if (peer.address === address) ids.add(peer.id)
  return [...ids].map(presence_character).filter(Boolean)
}

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
