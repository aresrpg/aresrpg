// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { aresrpg_id } from '../../deployment/aresrpg.js'

import { get_object_json } from './_object.js'

// CRUSH RUNE REGISTRY read — the on-chain `forgemagie::CrushBoard.runes` table (`Table<ID, RuneRef>`: rune
// ItemTemplate id → { stat, tier }), enumerated chain-direct via gRPC dynamic fields (the get_creation_classes
// pattern). READ-PATH CHOICE (declared): the registry is STATIC post-seed ("runes never change" — hardcoded
// content law, DECISIONS 2143-2145), so a cached chain-direct read at composer level (tx pre-flight class,
// CLAUDE.md sanctioned) beats an indexer projection — the /v1 read-API deliberately does NOT project
// `RuneRegistered` (snapshot.rs: "the rune registry is served chain-direct").
//
// Consumers: the crush action passes EVERY registered template id into `crush_ptb`'s fixed slots (each owed
// rune needs its mint slot), maps preview rows to display names, and REFUSES pre-flight when a reachable
// (stat, tier) has no registered template (the chain would abort EMissingTemplate — honest, but the client
// catches it for free before any gas).

/** @typedef {{ template_id: string, stat: number, tier: number }} RuneRegistryEntry */
/** @typedef {{ entries: RuneRegistryEntry[], by_key: Map<string, string>, by_template: Map<string, { stat: number, tier: number }> }} CrushRegistry */

/** `stat:tier` — the by_key map key of one registered rune. */
export const rune_key = (stat, tier) => `${stat}:${tier}`

/** One cached load per (network, board) — the registry is static post-seed; a failed load is NOT cached. */
const registry_cache = new Map()

/**
 * Read (and cache) the crush rune registry off the shared CrushBoard. Throws loudly when CRUSH_BOARD is
 * unstamped for the network (refuse, never guess — the board is a post-publish seed object).
 * @param {import("../../../types.js").Context | { grpc_client: any, network: string, ids?: any }} context
 * @returns {() => Promise<CrushRegistry>}
 */
export function get_crush_registry(context) {
  const { grpc_client, network } = context
  return async () => {
    const board_id =
      context.ids?.aresrpg?.CRUSH_BOARD ?? aresrpg_id(/** @type {any} */ (network), 'CRUSH_BOARD')
    if (!board_id)
      throw new Error(
        `[crush] CRUSH_BOARD is unstamped for "${network}" — seed the board (board_bootstrap.mjs) and run the release writer before any crush.`,
      )
    const key = `${network}:${board_id}`
    if (!registry_cache.has(key)) {
      const load = load_registry(grpc_client, board_id).catch(error => {
        registry_cache.delete(key) // never cache a failure — the next call re-reads
        throw error
      })
      registry_cache.set(key, load)
    }
    return registry_cache.get(key)
  }
}

/** @returns {Promise<CrushRegistry>} */
async function load_registry(grpc_client, board_id) {
  // Board json (flattened): { runes: { id: <table uid> }, taux: …, pressure: … } — the get_world_explorers pattern.
  // Through the ONE read seam (#2054): a FAILED read throws with its cause, absence returns null, and the two
  // are told apart in the message instead of collapsing into one vague "unreadable".
  const json = await get_object_json(grpc_client, board_id)
  const table_id = json?.runes?.id
  if (!table_id)
    throw new Error(
      json == null
        ? `[crush] CrushBoard ${board_id} does not exist.`
        : `[crush] CrushBoard ${board_id} carries no runes table id in its json.`,
    )

  /** @type {RuneRegistryEntry[]} */
  const entries = []
  let cursor = null
  do {
    const { dynamicFields, hasNextPage, cursor: next } = await grpc_client.core.listDynamicFields({
      parentId: table_id,
      cursor,
    })
    if (dynamicFields?.length) {
      // Each Field<ID, RuneRef> flattens to { name: <rune template id>, value: { stat, tier } }.
      const { objects } = await grpc_client.core.getObjects({
        objectIds: dynamicFields.map(({ fieldId }) => fieldId),
        include: { json: true },
      })
      for (const entry of objects) {
        if (entry instanceof Error) continue
        const json = /** @type {any} */ (entry)?.json
        if (json?.name != null && json?.value != null)
          entries.push({
            template_id: String(json.name),
            stat: Number(json.value.stat),
            tier: Number(json.value.tier),
          })
      }
    }
    cursor = hasNextPage ? next : null
  } while (cursor)

  return {
    entries,
    by_key: new Map(entries.map(e => [rune_key(e.stat, e.tier), e.template_id])),
    by_template: new Map(entries.map(e => [e.template_id, { stat: e.stat, tier: e.tier }])),
  }
}
