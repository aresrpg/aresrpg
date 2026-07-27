// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import { deriveDynamicFieldID } from '@mysten/sui/utils'

import { get_object_json } from './_object.js'

// THE ONE HOME for reading a wrapped `World`'s state (#1289). The shell is `World { id: UID, inner: Versioned }`
// and holds NO world facts — its UID carries only the zone dynamic fields. Everything a consumer wants (seed,
// dials, spawn tables, the inline mob levels + boss mask, the dungeon rooms/key) lives in the `WorldInner` that
// `Versioned` stores as a `Field<u64, WorldInner>` on its OWN UID, keyed by the payload version.
//
// Every consumer of world state goes through here, because reading the shell as if it were the payload does not
// FAIL — it succeeds with every field absent, i.e. a fully zeroed world with no spawn tables, which the client
// then caches. One home, and it fails SHUT.

/** The payload version this package speaks — world.move `WORLD_VERSION` (its `EWrongInnerVersion` twin). */
export const WORLD_VERSION = 1

/**
 * The address of the `Field<u64, WorldInner>` a `Versioned` holds its payload in: a dynamic field on the
 * Versioned's own UID, keyed by the u64 version (`sui::versioned::create` → `df::add(&mut self.id, version, v)`).
 */
export const world_inner_field_id = (versioned_id, version) =>
  deriveDynamicFieldID(
    versioned_id,
    'u64',
    bcs.u64().serialize(version).toBytes(),
  )

/**
 * A wrapped `World`'s payload as flat json (`id` = the WORLD's id, not the field's), or null when the world is
 * absent, the payload is unreadable, or the chain speaks a version this package does not. TWO reads, no walk:
 * the shell names its Versioned, and the payload's address is DERIVED from it.
 *
 * NULL IS THE POINT on every failure: a world we cannot decode must never surface as an empty-but-present world
 * (issue #1315 review finding 2 — a zeroed world gets cached and the overworld quietly loses its spawns).
 * @param {any} grpc_client the SDK's SuiGrpcClient (has `.core.getObject`)
 * @param {string} world_id
 */
export async function read_world_inner(grpc_client, world_id) {
  const shell = await get_object_json(grpc_client, world_id)
  if (!shell) return null
  // `Versioned` nests as `{ id: "0x…", version: "1" }` — a nested UID renders as a bare hex string.
  const versioned_id = shell.inner?.id
  const version = Number(shell.inner?.version)
  if (!versioned_id || version !== WORLD_VERSION) return null
  const field = await get_object_json(
    grpc_client,
    world_inner_field_id(versioned_id, version),
  )
  if (!field?.value) return null
  return { ...field.value, id: shell.id ?? world_id }
}
