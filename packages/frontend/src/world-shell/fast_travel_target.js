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

/** Address-only fallback: prefer a wallet character currently in a world, else the first. */
const primary_of = (chars) => (chars ?? []).find((c) => c && c.world) ?? (chars ?? [])[0] ?? null

/**
 * THE READ PLAN — every /v1 document a travel click needs, folded through the pure `resolve_route`. It lives in
 * ONE home because the plan IS the latency (#2158): the shape of these reads is what the player waits on, so it
 * has to be readable — and drivable — in one place. Effects (the reads, the presence lookup) are injected.
 * @param {{ target:{character_id?:string|null, address?:string|null, live?:boolean, x?:number, z?:number},
 *   traveler_id:string|null, deps:{
 *     read_characters:(q:{id?:string,owner?:string})=>Promise<any[]>,
 *     read_worlds:()=>Promise<{id:string,required_level?:number}[]>,
 *     peer_pos_of?:(id:string)=>({x:number,z:number}|null) } }} args
 * @returns {Promise<{ ok:true, cid:string|null, facts:any } | { ok:false, cid:string|null, reason:string }>}
 */
export async function read_route_facts({ target, traveler_id, deps }) {
  const { read_characters, read_worlds, peer_pos_of } = deps
  // A friend begin carries the exact live character id, never an owner guess. Its p2p cell refines position only;
  // world + cross-world anchor still come together from this /v1 document (the routing law).
  const target_doc = target.character_id
    ? ((await read_characters({ id: target.character_id }))[0] ?? null)
    : target.address
      ? primary_of(await read_characters({ owner: target.address }))
      : null
  const my_doc = traveler_id ? ((await read_characters({ id: traveler_id }))[0] ?? null) : null
  // Both world facts come from ONE live home (world_catalog.js): the census a route is checked against and the
  // gate it is refused on. Reading the census off the build-time receipt while the gate came from /v1 is exactly
  // the split #1510 filed — a throw here reaches the caller's catch, never a silent refusal.
  const worlds = await read_worlds()
  const cid = target_doc?.id ?? target.character_id ?? null
  const out = resolve_route({
    target_doc,
    my_doc,
    required_level_by_world: new Map(worlds.map((w) => [w.id, w.required_level])),
    catalog_ids: new Set(worlds.map((w) => w.id)),
    live_pos:
      target.live && Number.isFinite(target.x) && Number.isFinite(target.z)
        ? { x: Number(target.x), z: Number(target.z) }
        : cid
          ? (peer_pos_of?.(cid) ?? null)
          : null,
  })
  return { ...out, cid }
}
