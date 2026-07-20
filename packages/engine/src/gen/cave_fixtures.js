// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D-WORLD AMBIENCE-PROP ANCHORS for the cave room — a PURE (integer-only, no three) placement pass split out of
// gen/cave_room.js (the ≤600-LoC law). Produces deterministic bonfire-brazier + candle-torch anchors in the room's
// PERIMETER band (between the flat board region and the walls), so a fixture never sits under a fight. The whole
// room shares ONE biome tint (seed-derived) → a void dungeon burns violet, an ice cave pale, etc., showcasing the
// 6 FlameFX colour variants across dungeons. Render-agnostic DATA only: the scene wrapper (scene/cave_scene.js)
// maps each anchor's `tint` to a FlameFX preset and mounts the LOOP VFX. Self-contained (its own splitmix hash +
// flat-region test) so it never couples back into cave_room's internals.

/**
 * @typedef {object} CaveFixture  A world/ambience light-prop anchor (render-agnostic — the scene maps `tint` to a
 *   FlameFX preset). Placed on the floor OUTSIDE the flat board region so a fixture never sits under a fight.
 * @property {'bonfire'|'candle'} kind bonfire = big brazier; candle = small wall torch.
 * @property {[number,number,number]} pos world feet position (floor top).
 * @property {number} tint flame-colour index 0..5 (basic/cold/green/light/purple/void — the room's biome theme).
 * @property {1|2} variant candle scene variant (01/02); ignored for bonfires.
 */

const U32 = 0xffffffff
/** 3-D splitmix-lineage integer hash → uint32, seed-folded (same family as cave_room.hash3; NO transcendentals —
 *  the room's determinism law). @param {number} x @param {number} y @param {number} z @param {number} salt
 *  @param {number} seed @returns {number} */
function hash3(x, y, z, salt, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) & U32
  h = (h + Math.imul(z | 0, 2147483647)) & U32
  h = (h ^ (salt | 0) ^ Math.imul(seed | 0, 1013904223)) & U32
  h = Math.imul(h ^ (h >>> 13), 1274126177) & U32
  return (h ^ (h >>> 16)) >>> 0
}
/** @param {{min_x:number,min_z:number,max_x:number,max_z:number}} f @param {number} wx @param {number} wz */
function in_flat(f, wx, wz) {
  return wx >= f.min_x && wx < f.max_x && wz >= f.min_z && wz < f.max_z
}

/**
 * Deterministic ambience-prop anchors for a cave room. Pure integer-hash placement: all fixtures sit on the floor
 * in the perimeter band, none under the flat board region. @param {{ size_x:number, size_z:number, floor_y:number,
 *   seed:number }} c the resolved cave config @param {{min_x:number,min_z:number,max_x:number,max_z:number}} flat
 *   the board's flat region rectangle @returns {CaveFixture[]}
 */
export function place_fixtures(c, flat) {
  const tint = hash3(0, 0, 0, 0xf1a, c.seed) % 6 // the room's biome flame colour (0..5)
  const y = c.floor_y
  /** @type {CaveFixture[]} */
  const out = []
  // BONFIRE braziers: candidate anchors at the mid of each perimeter band (open floor between board + wall);
  // keep 2–3 via hash so rooms vary. Each is clamped a safe margin off the wall.
  const mid_x = Math.round(c.size_x / 2)
  const mid_z = Math.round(c.size_z / 2)
  const west = Math.max(3, Math.round(flat.min_x / 2))
  const east = Math.min(c.size_x - 3, Math.round((flat.max_x + c.size_x) / 2))
  const north = Math.max(3, Math.round(flat.min_z / 2))
  const south = Math.min(c.size_z - 3, Math.round((flat.max_z + c.size_z) / 2))
  const brazier_spots = /** @type {[number,number][]} */ ([
    [west, mid_z],
    [east, mid_z],
    [mid_x, north],
    [mid_x, south],
  ])
  for (let i = 0; i < brazier_spots.length; i += 1) {
    if (hash3(brazier_spots[i][0], 1, brazier_spots[i][1], 0xf1b, c.seed) % 3 === 0) continue // drop ~1/3 for variety
    out.push({ kind: 'bonfire', pos: [brazier_spots[i][0], y, brazier_spots[i][1]], tint, variant: 1 })
  }
  if (out.length === 0) out.push({ kind: 'bonfire', pos: [west, y, mid_z], tint, variant: 1 }) // never a lightless room

  // CANDLE torches: two per wall, inset from the wall, along its length — lining the room like floor torches.
  const inset = 3
  const along = /** @param {number} lo @param {number} hi @param {number} t */ (lo, hi, t) =>
    Math.round(lo + (hi - lo) * t)
  /** @type {[number,number][]} */
  const candle_spots = [
    [inset, along(inset, c.size_z - inset, 0.32)],
    [inset, along(inset, c.size_z - inset, 0.68)],
    [c.size_x - inset, along(inset, c.size_z - inset, 0.32)],
    [c.size_x - inset, along(inset, c.size_z - inset, 0.68)],
    [along(inset, c.size_x - inset, 0.32), inset],
    [along(inset, c.size_x - inset, 0.68), c.size_z - inset],
  ]
  for (const [wx, wz] of candle_spots) {
    if (in_flat(flat, wx, wz)) continue // never under the board (the perimeter inset already clears it)
    const variant = /** @type {1|2} */ ((hash3(wx, 2, wz, 0xf1c, c.seed) % 2) + 1)
    out.push({ kind: 'candle', pos: [wx, y, wz], tint, variant })
  }
  return out
}
