// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SEEDED-WORLD CATALOG — one home for "which worlds are live, and what gate does each one hold".
//
// Every field here is CHAIN truth read from `/v1/encyclopedia?kind=worlds`: `required_level` is the exact
// value `zones::join_world` asserts, `biome` is the World object's own field. The seed receipt contributes
// exactly one thing — the display LABEL, which the chain does not carry (issue #1510: "T62_WORLDS keeps what
// it legitimately owns: the seeded id enumeration and the display label").
//
// It exists because that gate had TWO homes: the travel modal locked cards off the build-time receipt while
// fast travel and the level-up card read the live view. Raise a gate on chain without redeploying the client
// and the modal offered a world fast travel refused — the player read a MoveAbort instead of an honest lock.
// The receipt is frozen into the deployed bundle, so a chain-enforced VALUE may never be read from it.
//
// The read is a scoped one: 2.9 KB against the live testnet corpus, versus the 3.0 MB all-kinds envelope
// (get_encyclopedia honours `kind` since #1510) — small enough for the always-mounted world HUD, which is
// what "the boot path cannot afford this" was arguing about.
//
// It THROWS on a read failure. Degradation is each consumer's own call (the level-up card omits its world
// row, the engine falls back to its default recipe, the travel modal renders its loading state) and none of
// them may be handed an empty catalog that reads like "no worlds exist". Nothing is memoized until a
// non-empty answer lands: neither a failure nor an empty response poisons the session.

import { get_encyclopedia } from '../rpc/client'
import { T62_WORLDS } from '../chain/deployment'

/** @typedef {{ id: string, label: string, biome: string | null, required_level: number }} SeededWorld */

/** @type {Promise<SeededWorld[]> | null} — the session cache (world config is static). */
let cache = null

/**
 * Every live world with its join gate and biome, labelled from the seed receipt.
 * @param {AbortSignal} [signal]
 * @returns {Promise<SeededWorld[]>}
 */
export function load_world_catalog(signal) {
  if (cache) return cache
  const label_by_id = new Map(T62_WORLDS.map(({ id, label }) => [String(id), label]))
  const pending = get_encyclopedia('worlds', signal).then(({ worlds }) => {
    const rows = (worlds ?? []).map((world) => ({
      id: String(world.world_id),
      // An unlabelled world is honestly its own id — never a prettified guess at a name the chain lacks.
      label: label_by_id.get(String(world.world_id)) ?? String(world.world_id),
      biome: world.biome || null,
      required_level: Number(world.required_level ?? 1),
    }))
    // An empty answer is a transport STATE, not a world census — never cache it (#1467 cache law).
    if (!rows.length) cache = null
    return rows
  })
  cache = pending
  void pending.catch(() => {
    if (cache === pending) cache = null
  })
  return pending
}

/** Test-only reset of the session cache. */
export function _reset_for_test() {
  cache = null
}
