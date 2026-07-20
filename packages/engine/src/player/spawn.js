// ENG-24 / D160 (2026-07-05) — the spawn column scan, PROMOTED verbatim from demo/walk_mode.js into
// the public player surface: the ONE home for "never spawn in a tree canopy, never in a lake" (the
// dapp's D156v2.1 app-side duplicate swaps to this per the agreed one-home plan). Pure functions over
// a block-id oracle — work against the streamed ring, the fixed world, a cave room's sampler, or the
// WebGL floor's heightmap alike.

import { CHARACTER_HEIGHT, WORLD_HEIGHT } from '../config/world_config.js'

/** Vertical headroom (blocks of air above the surface) a spawn column needs so the player isn't
 *  embedded in a tree canopy / overhang — ceil(CHARACTER_HEIGHT) + 1 for comfort. */
export const SPAWN_HEADROOM = Math.ceil(CHARACTER_HEIGHT) + 1

/** Walkable GROUND block ids — grass/dirt/sand/stone/snow + the D141 cave floors cave_stone(18)/
 *  mossy_stone(19) (block_registry). Spawns land only on these, never on a tree's log(6)/leaves(7)
 *  canopy (a top-down scan otherwise lands on the treetop) nor a mushroom cap, and never on fluids
 *  (water/lava are not in the set — a fluid-topped column simply never matches). */
export const GROUND_IDS = new Set([1, 2, 3, 4, 8, 18, 19])

/**
 * Finds an open GROUND spawn: spirals columns outward from (cx,cz), and for each scans top-down for
 * the first WALKABLE-GROUND cell (grass/dirt/sand/stone/snow — NOT a tree canopy) that has
 * SPAWN_HEADROOM air cells above it. Returns the feet position (top face of that ground), or null if
 * the area isn't resident / no open ground found in range. Pure — reads only the block-id oracle.
 * @param {(x: number, y: number, z: number) => number} block_id_at world-space voxel block id.
 * @param {number} cx @param {number} cz @param {number} [max_r] spiral radius in blocks
 * @returns {[number, number, number] | null}
 */
export function find_open_spawn(block_id_at, cx, cz, max_r = 40) {
  for (let r = 0; r <= max_r; r += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      for (let dz = -r; dz <= r; dz += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue // ring shell only (spiral outward)
        const x = cx + dx
        const z = cz + dz
        const surf = ground_surface_y(block_id_at, x, z)
        if (surf === null) continue
        // FLATNESS: reject peaks / cliff edges — the 4-neighbour ground must sit within ±1 block of
        // this column's, so the player spawns on walkable flat-ish terrain (not a mountain summit that
        // they walk off on the first step). This is what keeps a spawn a clean stand, not a fall.
        const n = [
          ground_surface_y(block_id_at, x + 1, z),
          ground_surface_y(block_id_at, x - 1, z),
          ground_surface_y(block_id_at, x, z + 1),
          ground_surface_y(block_id_at, x, z - 1),
        ]
        if (n.some((ny) => ny === null || Math.abs(ny - surf) > 1)) continue
        return [x + 0.5, surf + 1, z + 0.5] // feet centred on the ground's top face
      }
    }
  }
  return null
}

/**
 * Top walkable-ground surface y of a column: scans top-down for the first GROUND-material cell (grass/
 * dirt/sand/stone/snow) that has SPAWN_HEADROOM air above it — skipping tree canopies/trunks. Returns
 * the y of that ground block (the feet rest at y+1), or null if none / column unstreamed.
 * @param {(x: number, y: number, z: number) => number} block_id_at
 * @param {number} x @param {number} z @returns {number | null}
 */
export function ground_surface_y(block_id_at, x, z) {
  // [D192 root, corrected twice — the FIRST SOLID DECIDES THE COLUMN] Spawning landed on tree-top
  // snow (snow id 8 is in GROUND_IDS, but CANOPY snow rests on leaves) and a first fix that merely
  // skipped it TUNNELED past the surface into cave pockets (dirt at y≈128 under the forest floor).
  // The sky-reachable rule: scan down through air and pass-through flora (cross sprites, ids 10-17,
  // and 20-23 mushrooms — you stand IN those); the FIRST real solid decides: valid open ground with
  // headroom → this column's surface; a leaf/log/canopy-snow/fluid/anything-else → the column is
  // FOREST/WATER — return null and let the spiral try the next column. Never tunnels underground.
  let air_run = 0
  for (let y = WORLD_HEIGHT - 1; y >= 1; y -= 1) {
    const id = block_id_at(x, y, z)
    if (id === 0 || (id >= 10 && id <= 17) || (id >= 20 && id <= 23)) {
      air_run += 1
      continue
    }
    const is_canopy_snow = id === 8 && [7, 28, 29].includes(block_id_at(x, y - 1, z))
    if (!is_canopy_snow && GROUND_IDS.has(id) && air_run >= SPAWN_HEADROOM) return y
    return null // first solid is not open ground — forest canopy, trunk, fluid, or no headroom
  }
  return null
}

/**
 * The GROUND surface y for SEATING a world fight board — the topmost settled-ground block UNDER any tree canopy.
 * Unlike ground_surface_y (which REJECTS a forested column → null so a player never SPAWNS in a tree), a fight
 * board SEATS on the ground and the render-side footprint clear (board_occlusion) carves the trees/terrain above
 * it — so a canopy column must yield its GROUND height, never null. With procedural trees now the world DEFAULT
 * (GEN_VERSION 8), a whole footprint reads as "forest" to the spawn scan → every column null → the seat refused
 * on solid, resident, RENDERED ground and stranded the fight (P0 2026-07-12). This scan finds the ground the
 * tree grows on: it scans top-down and returns the FIRST GROUND_ID block (grass/dirt/sand/stone/snow), skipping
 * air, cross-flora, and tree canopy (leaves/logs/twigs are not GROUND_IDS ⇒ skipped). The "topmost GROUND_ID"
 * IS the surface — a cave pocket sits BELOW the surface ground, which returns first, so this never tunnels
 * underground (the D192 hazard ground_surface_y guards against comes free here: we stop at the first ground).
 * Canopy-snow (snow resting on a non-ground solid = a snow-capped tree) is skipped generically (robust to every
 * tree species, unlike the hardcoded ground_surface_y check) so the board never seats on a treetop. Returns
 * null ONLY when the column holds NO ground block at all — the honest "genuinely unstreamed / void" signal the
 * seat's void guard needs (a canopy column no longer masquerades as void). Pure over the block-id oracle.
 * @param {(x: number, y: number, z: number) => number} block_id_at
 * @param {number} x @param {number} z @returns {number | null}
 */
export function seat_surface_y(block_id_at, x, z) {
  for (let y = WORLD_HEIGHT - 1; y >= 1; y -= 1) {
    const id = block_id_at(x, y, z)
    if (!GROUND_IDS.has(id)) continue // air / cross-flora / leaves / logs / twigs / fluid — keep scanning down
    // Snow (8) on a non-ground solid is a snow-CAPPED TREE, not the ground — skip past it to the real surface.
    if (id === 8) {
      const below = block_id_at(x, y - 1, z)
      if (below !== 0 && !GROUND_IDS.has(below)) continue // snow on leaves/log ⇒ canopy, not the ground plane
    }
    return y // topmost settled-ground block = the surface (cave pockets sit below it, never reached)
  }
  return null // no ground anywhere in the column ⇒ genuinely unstreamed / void
}

/**
 * The id of the TOPMOST non-air block in a column, or null when the whole column is air (genuinely unstreamed /
 * void). The "is ANY terrain resident here" ground truth — the world-board seat compares it against
 * seat_surface_y at a refusal so the diagnostic is HONEST: resident solids present but no seatable ground = a
 * LOUD seat-scan regression; all-air = a genuine void (the old blind "void/ungenerated terrain" guess lied when
 * the real cause was a canopy-rejected forest). Pure over the block-id oracle.
 * @param {(x: number, y: number, z: number) => number} block_id_at
 * @param {number} x @param {number} z @returns {number | null}
 */
export function topmost_solid_id(block_id_at, x, z) {
  for (let y = WORLD_HEIGHT - 1; y >= 1; y -= 1) {
    const id = block_id_at(x, y, z)
    if (id !== 0) return id
  }
  return null
}
