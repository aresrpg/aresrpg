// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEAM 5 — COMPASS / ZONE FEED (SPEC §5 wayfinding, the "information-parity law").
//
// "bots read spawn positions straight off the chain, so the client MUST surface the same public facts
// comfortably or humans play handicapped — the UI is the human's bot." This is the PURE math that turns
// pushed chain data (discovered zones + their live spawns) + the player's (x,z) into exactly what the HUD
// renders: the current zone id/bounds, compass pips (direction + distance to each live spawn in the
// current zone), and the zone-grid states for the world-map overlay. No rendering, no chain awareness —
// pure transforms over plain data, ready for the frontend MapDrawer (S-18) to layer.
//
// Zones tile the world on a fixed grid: zone (gx, gz) = the [gx·S, (gx+1)·S) × [gz·S, (gz+1)·S) square,
// S = zone size in blocks (SPEC §5 default 512 = 16 of the engine's 32-block chunks). A zone's id is its
// grid coord `${gx}:${gz}` — stable, derivable by any client, matching the chain's zone key.

import { CHUNK_SIZE } from '../config/world_config.js'

/** SPEC §5: discovery zones default 512×512 blocks = 16 engine chunks a side. */
export const DEFAULT_ZONE_SIZE_BLOCKS = 16 * CHUNK_SIZE
/** SPEC §4: worlds default 500,000×500,000 blocks — the overlay extent (centred on the origin). */
export const DEFAULT_WORLD_SIZE_BLOCKS = 500000

/** @typedef {{ id?: string, kind?: string, template_id?: string|number, x: number, z: number }} Spawn */
/** @typedef {{ gx: number, gz: number, state?: string, spawns?: Spawn[] }} ZoneData */
/** @typedef {{ zone_size?: number, world_bounds?: { min_x:number, min_z:number, max_x:number, max_z:number }, zones?: ZoneData[] }} ZonesData */

/** The world-space rect of grid zone (gx, gz). @param {number} gx @param {number} gz @param {number} s */
function zone_bounds(gx, gz, s) {
  return { min_x: gx * s, min_z: gz * s, max_x: (gx + 1) * s, max_z: (gz + 1) * s }
}

/**
 * The wayfinding view for the HUD, derived purely from the player position + pushed zone data.
 * @param {import('../config/world_gen_config.js').WorldGenConfig | null | undefined} world_config the
 *   world recipe — may carry `zones.{ size_blocks, world_bounds }` overrides (else SPEC defaults).
 * @param {[number, number]} player_xz the player's world [x, z]
 * @param {ZonesData | null | undefined} zones_data pushed chain data: discovered zones + their spawns
 * @returns {{
 *   zone_size: number,
 *   current: { id: string, gx: number, gz: number, bounds: ReturnType<typeof zone_bounds>, state: string },
 *   pips: { id: string|undefined, kind: string|undefined, template_id: string|number|undefined,
 *     x: number, z: number, dx: number, dz: number, distance: number, bearing: number, dir: [number, number] }[],
 *   zones: { id: string, gx: number, gz: number, bounds: ReturnType<typeof zone_bounds>, state: string,
 *     spawn_count: number, current: boolean }[],
 *   world_bounds: { min_x:number, min_z:number, max_x:number, max_z:number },
 * }}
 */
export function zone_state_view(world_config, player_xz, zones_data) {
  const zcfg = /** @type {any} */ (world_config)?.zones
  const size = zcfg?.size_blocks ?? zones_data?.zone_size ?? DEFAULT_ZONE_SIZE_BLOCKS
  const half = DEFAULT_WORLD_SIZE_BLOCKS / 2
  const world_bounds = zcfg?.world_bounds ??
    zones_data?.world_bounds ?? { min_x: -half, min_z: -half, max_x: half, max_z: half }

  const [px, pz] = Array.isArray(player_xz) ? player_xz : [0, 0]
  const gx = Math.floor(px / size)
  const gz = Math.floor(pz / size)
  const current_id = `${gx}:${gz}`

  const zone_list = Array.isArray(zones_data?.zones) ? zones_data.zones : []
  const current_data = zone_list.find((z) => z.gx === gx && z.gz === gz)

  // Compass pips: every live spawn in the CURRENT zone, with direction (bearing from +Z / north,
  // clockwise) + distance from the player. The HUD strip lays them out by bearing, fades by distance.
  const pips = (current_data?.spawns ?? []).map((sp) => {
    const dx = sp.x - px
    const dz = sp.z - pz
    const distance = Math.hypot(dx, dz)
    const inv = distance > 1e-6 ? 1 / distance : 0
    return {
      id: sp.id,
      kind: sp.kind,
      template_id: sp.template_id,
      x: sp.x,
      z: sp.z,
      dx,
      dz,
      distance,
      bearing: Math.atan2(dx, dz), // 0 = north(+z), +π/2 = east(+x)
      dir: /** @type {[number, number]} */ ([dx * inv, dz * inv]),
    }
  })

  // Map overlay: every pushed (discovered) zone as a grid cell + its state; guarantee the current zone
  // is present (undiscovered zones cost nothing on chain — SPEC §4 — so an unpushed current zone reads
  // 'undiscovered').
  const zones = zone_list.map((z) => ({
    id: `${z.gx}:${z.gz}`,
    gx: z.gx,
    gz: z.gz,
    bounds: zone_bounds(z.gx, z.gz, size),
    state: z.state ?? 'undiscovered',
    spawn_count: Array.isArray(z.spawns) ? z.spawns.length : 0,
    current: z.gx === gx && z.gz === gz,
  }))
  if (!current_data) {
    zones.push({
      id: current_id,
      gx,
      gz,
      bounds: zone_bounds(gx, gz, size),
      state: 'undiscovered',
      spawn_count: 0,
      current: true,
    })
  }

  return {
    zone_size: size,
    current: {
      id: current_id,
      gx,
      gz,
      bounds: zone_bounds(gx, gz, size),
      state: current_data?.state ?? 'undiscovered',
    },
    pips,
    zones,
    world_bounds,
  }
}
