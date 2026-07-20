// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL TARGET RESOLUTION (plan §3.2) — the edge that turns a target character id into the `resolved`
// facts the reducer folds. PURE core (`resolve_route`, unit-tested) + a thin async wrapper that does the /v1
// reads (the SAME get_characters + encyclopedia the friends/world-switcher surfaces read) and the presence live
// lookup, then calls the pure core.
//
// THE ROUTING LAW (invariant 2): world_id comes ONLY from the target's /v1 character doc — NEVER from p2p. A
// live p2p position (`live_pos`) only refines the FLY coordinate once same-world is proven; it never decides the
// world. The reducer applies the level + catalog gates; this module only surfaces the raw facts.

const REALM_UNREACHABLE = 'fast_travel.realm_unreachable'

/**
 * Pure route resolution. @param {{
 *   target_doc: { world?: string|null, position?: { x:number, z:number }|null }|null,
 *   my_doc: { world?: string|null, level?: number|null }|null,
 *   required_level_by_world: Map<string,number>|Record<string,number>|null,
 *   catalog_ids: Set<string>|null,
 *   live_pos: { x:number, z:number }|null,
 * }} args
 * @returns {{ ok:true, facts:any } | { ok:false, reason:string }}
 */
export function resolve_route({ target_doc, my_doc, required_level_by_world, catalog_ids, live_pos }) {
  if (!target_doc || !target_doc.world) return { ok: false, reason: REALM_UNREACHABLE } // no world = nowhere to go
  const world_id = target_doc.world
  const my_world_id = my_doc?.world ?? null
  const same_world = !!my_world_id && world_id === my_world_id
  // Coordinate: a same-world live peer pos wins (retarget-fresh); else the /v1 anchor (honest, possibly lagged).
  // Cross-world, the live coord is DISCARDED — p2p is world-blind, so a foreign-world pos proves nothing (§2-①).
  const anchor = target_doc.position && Number.isFinite(target_doc.position.x) ? target_doc.position : null
  const use_live = same_world && !!live_pos && Number.isFinite(live_pos.x)
  const coord = use_live ? live_pos : anchor
  if (!coord) return { ok: false, reason: REALM_UNREACHABLE } // no known position at all (never seen, no anchor)
  return {
    ok: true,
    facts: {
      world_id, // FROM THE /v1 DOC ONLY — never p2p (the routing law)
      x: Number(coord.x),
      z: Number(coord.z),
      live: use_live,
      my_world_id,
      my_level: my_doc?.level ?? null,
      required_level: required_level_lookup(required_level_by_world, world_id),
      catalog_has_world: catalog_ids?.has?.(world_id) ?? false,
    },
  }
}

const required_level_lookup = (map, world_id) => {
  if (!map) return null
  if (typeof map.get === 'function') return map.get(world_id) ?? null
  return map[world_id] ?? null
}

/**
 * The async resolution edge — reads the two /v1 docs + the worlds gate + the live peer pos, then folds through
 * `resolve_route`. Effects (the reads, the presence lookup) are injected so this stays testable and single-homed.
 * @param {{ target_character_id:string, my_character_id:string|null, deps:{
 *   read_character:(id:string)=>Promise<any>, read_worlds:()=>Promise<{world_id:string,required_level?:number}[]>,
 *   catalog_ids:Set<string>, peer_pos_of?:(id:string)=>({x:number,z:number}|null) } }} args
 */
export async function resolve_fast_travel_target({ target_character_id, my_character_id, deps }) {
  const { read_character, read_worlds, catalog_ids, peer_pos_of } = deps
  const [target_doc, my_doc, worlds] = await Promise.all([
    read_character(target_character_id),
    my_character_id ? read_character(my_character_id) : Promise.resolve(null),
    read_worlds(),
  ])
  const required_level_by_world = new Map((worlds ?? []).map((w) => [w.world_id, Number(w.required_level ?? 1)]))
  const live_pos = peer_pos_of?.(target_character_id) ?? null
  return resolve_route({ target_doc, my_doc, required_level_by_world, catalog_ids, live_pos })
}
