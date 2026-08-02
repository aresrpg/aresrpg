// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { get_object_json, option_value, to_bigint } from './_object.js'
import { read_world_inner } from './world_inner.js'

// GAME READS for `aresrpg_game` — the live `World` config a consumer needs to gate join/search/gather (required level,
// bounds, zone size/TTL, spawn zone, density, the optional dungeon key). Mirrors the `world` getters. Per-zone spawn
// contents (resource nodes / mob groups) are read through the fine-grained on-chain getters, not snapshotted here.

/**
 * A `World` snapshot: seed/biome + the gates & dials a client mirrors to compute zones and pre-flight the world flows.
 * `dungeon_key_template` is the `Option<ID>` (null = no dungeon). Null when the world is ABSENT; a FAILED
 * read throws (#2054) rather than arriving as a world that simply is not there.
 * @param {import("../../../types.js").Context} context
 */
/**
 * A `MobTemplate` snapshot — the display facts a mob group's world card needs (the on-chain roster NAME +
 * level band) plus its `element` discriminant (mob_template.move `element: u8` — 0=fire 1=water 2=earth
 * 3=air, 255=none). The zone-spawn rows carry only the template `ID`; this resolves it to a human name. The
 * element is what a mob's basic-attack cast VFX/SFX resolve on (vfx_map.resolve_cast_element) so every mob no
 * longer casts the neutral fallback; absent field (legacy) reads 255 → neutral. Null when the template is
 * ABSENT; a FAILED read throws (#2054).
 * @param {import("../../../types.js").Context} context
 */
export function get_mob_template(context) {
  const { grpc_client } = context
  return async template_id => {
    const json = await get_object_json(grpc_client, template_id)
    if (!json) return null // ABSENT template
    return {
      id: json.id,
      name: json.name ?? '',
      min_level: Number(json.min_level ?? 0),
      max_level: Number(json.max_level ?? 0),
      element: Number(json.element ?? 255),
    }
  }
}

export function get_world(context) {
  const { grpc_client } = context
  return async world_id => {
    // The world's state lives in its version-wrapped payload, never on the shell (#1289) — and reading the shell
    // as the payload does not fail, it returns a ZEROED world. One home for that resolution: world_inner.js.
    const json = await read_world_inner(grpc_client, world_id)
    if (!json) return null
    const mobs = (json.mobs ?? []).map((/** @type {any} */ mob) => ({
      template_id: mob.template_id,
      rate_bp: Number(mob.rate_bp ?? 0),
      min_group: Number(mob.min_group ?? 1),
      max_group: Number(mob.max_group ?? 1),
    }))
    // #1290 — levels are a vector PARALLEL to the mob table and the mask a plain vector, both INLINE in the
    // payload now (they were `MobLevelKey`/`BossMaskKey` dynamic fields while the layout was frozen).
    const levels = (json.mob_levels ?? []).map(Number)
    return {
      // #1110 — the boss fence's predicate. `derive_zone` zeroes these rows out of the MEMBER pick table; a
      // client reading the table without the mask draws packs with bosses riding along that never seat.
      boss_mask: (json.boss_mask ?? []).map(Number),
      id: json.id,
      seed: to_bigint(json.seed),
      biome: json.biome,
      required_level: Number(json.required_level ?? 0),
      bounds_x: Number(json.bounds_x ?? 0),
      bounds_z: Number(json.bounds_z ?? 0),
      zone_size: Number(json.zone_size ?? 0),
      zone_ttl_ms: to_bigint(json.zone_ttl_ms),
      speed_budget: to_bigint(json.speed_budget),
      spawn_zone_x: Number(json.spawn_zone_x ?? 0),
      spawn_zone_z: Number(json.spawn_zone_z ?? 0),
      protector_bp: to_bigint(json.protector_bp),
      min_groups: Number(json.min_groups ?? 0),
      max_groups: Number(json.max_groups ?? 0),
      min_nodes: Number(json.min_nodes ?? 0),
      max_nodes: Number(json.max_nodes ?? 0),
      dungeon_key_template: option_value(json.dungeon_key_template),
      // The SPAWN TABLES (search-cost rework): the zone derivation's inputs — `@aresrpg/sim` `derive_zone`
      // joins these with a zone's stored seed to derive the exact spawn rows the chain would materialise.
      // `level` is the per-template MobLevelKey DF consumed by the chain's distance eligibility filter. Reading
      // the exact same values keeps the client-derived spawn rows claimable; a batch transport failure fails shut.
      mobs: mobs.map((mob, index) => ({
        ...mob,
        level: levels[index] ?? 0,
      })),
      resources: (json.resources ?? []).map((/** @type {any} */ r) => ({
        template_id: r.template_id,
        rate_bp: Number(r.rate_bp ?? 0),
        min_qty: Number(r.min_qty ?? 1),
        max_qty: Number(r.max_qty ?? 1),
        job: Number(r.job ?? 0),
        tier: Number(r.tier ?? 1),
      })),
    }
  }
}
