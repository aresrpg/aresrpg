// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD ACCESS GATES — the seeded worlds + each world's on-chain `required_level`, for the character
// level-up card's "you now have access to X and Y worlds" row.
//
// #304 — REROUTED off the chain-direct `read_worlds.js` `get_worlds` batch fan-out (a `grpc_client.core.
// getObjects` fullnode call on EVERY level-up — the same DISPLAY-read-burst class the shop-sales storm was
// cured of). The required_level the card needs is ALREADY served by the keyless `/v1/encyclopedia?kind=worlds`
// view (`{ world_id, required_level, ... }`) — the exact read world_biome.js's `resolve_world_biome` uses for
// the SAME World object (`biome`). `read_worlds.js` is deleted (this was its only live caller — its sibling
// `onchain_templates.ts` consumer was already dead, see fullnode_object_reads.test.js). T62_WORLDS still
// supplies the id + display LABEL (worlds have no on-chain name; /v1 carries no label either).
// Cached once per session (world gates are static config); a read failure resolves to [] so the card simply
// omits the world row (never a fabricated unlock).
//
// DECLARED REALITY: the live testnet seed carries ONE world (Testlands, required_level 1), so no character
// level-up unlocks a NEW world today; this lights up the moment higher-gate biome worlds are seeded. The
// unlock MATH (worlds_unlocked_between, level_unlocks.js) is unit-proven independently of this reader.

import { get_encyclopedia } from '../../../rpc/client'
import { T62_WORLDS } from '../../../chain/deployment'
import { game_log } from '../../../core/log.js'

/** @typedef {{ id: string, label: string, required_level: number }} WorldGate */

/** @type {Promise<WorldGate[]> | null} — the session-cached read (worlds config is static). */
let cache = null

/**
 * Every seeded world + its join gate, off the /v1 encyclopedia worlds view, joined against T62_WORLDS for the
 * display label (chain carries no world name). Never throws: a failed/partial read degrades to the worlds it
 * could resolve (or []), so the card's world row degrades to absent rather than blocking the celebration. A
 * world seeded but not yet indexer-snapshotted is honestly omitted, same as a failed chain read was before.
 * @returns {Promise<WorldGate[]>}
 */
export function load_world_gates() {
  if (cache) return cache
  cache = (async () => {
    try {
      if (T62_WORLDS.length === 0) return []
      const { worlds } = await get_encyclopedia('worlds')
      const gate_by_id = new Map(worlds.map((w) => [String(w.world_id), w]))
      return T62_WORLDS.map(({ id, label }) => {
        const gate = gate_by_id.get(String(id))
        if (!gate) return null
        return { id: String(id), label: String(label ?? id), required_level: Number(gate.required_level ?? 1) }
      }).filter(/** @returns {w is WorldGate} */ (w) => w != null)
    } catch (error) {
      game_log('world-gates', 'world read failed — the level-up world row is omitted', error)
      cache = null // let a later card retry rather than caching the failure forever
      return []
    }
  })()
  return cache
}

/** Test-only reset of the session cache (mirrors world_biome.js's `_reset_for_test`). */
export function _reset_for_test() {
  cache = null
}
