// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD ↔ CHAIN COORDINATE CODEC — the world must extend in all directions, which requires signed
// coordinates. The chain stores block coords as UNSIGNED u32 in `[0, bounds)` (world.move
// `assert_in_bounds`), so an origin at (0,0) can only ever grow one way. To let the world extend in ALL
// directions — north/south/east/west of a real centre — the CLIENT works in SIGNED world space centred on
// the chain's mid-point, and this codec is the ONE translation seam at every game↔chain boundary.
//
//   world_x = chain_x − offset          chain_x = world_x + offset          offset = bounds / 2 (PER WORLD)
//
// The offset is NOT a global constant: it is `bounds_x/2` (resp. `bounds_z/2`) read off the live `World`
// doc (`@aresrpg/sdk/game` get_world → bounds_x / bounds_z). For the Testlands bounds (500 000) the offset
// is 250 000, so world space spans ±250 000 and every translated chain value stays inside `[0, 500 000)` —
// `assert_in_bounds` and the u32 zone grid keep holding, ZERO Move impact.
//
// TWO coordinate facts, kept apart on purpose:
//   • ZONE KEYS are CHAIN-space, always (`zx = floor(chain / zone_size)`, u32, mirrors zones.move). Every
//     on-chain interaction (search / gather / fight-claim / spawn reads) keys by these. `zone_of_world`
//     derives them from a world position by translating FIRST, then flooring the CHAIN value — never the
//     signed world value (a negative world coord floored directly gives a bogus negative "zone").
//   • DISPLAY is world-space signed (the compass coord chips, and a re-centred zone label). Never fed to a tx.
//
// No package ids, no chain awareness — plain numbers in, plain numbers out. Pure + deterministic.

// SPEC §17.18 default discovery-zone edge in blocks (mirrors zones.move); the live per-world value rides the
// `World` doc's `zone_size`. This default only applies before that doc has loaded.
export const DEFAULT_ZONE_SIZE = 512

// SPEC §4 / world.move DEFAULT_BOUND = 500 000 blocks → the default half-extent (offset) is 250 000. Used as
// the pre-doc-load fallback so a display never breaks and the single live world (Testlands, default bounds)
// translates correctly even across a transient world-doc read miss.
export const DEFAULT_WORLD_OFFSET = 250_000

/**
 * The per-axis world↔chain offsets (`bounds/2`) for a `World` doc. Falls back to {@link DEFAULT_WORLD_OFFSET}
 * per axis when the doc (or its bounds) is absent, so callers stay correct for the default-bounds world
 * through a transient read miss. Floored to an integer (chain coords are u32).
 * @param {{ bounds_x?: number, bounds_z?: number } | null | undefined} world_doc
 * @returns {{ x: number, z: number }}
 */
export function world_offsets(world_doc) {
  const bx = Number(world_doc?.bounds_x)
  const bz = Number(world_doc?.bounds_z)
  return {
    x: Number.isFinite(bx) && bx > 0 ? Math.floor(bx / 2) : DEFAULT_WORLD_OFFSET,
    z: Number.isFinite(bz) && bz > 0 ? Math.floor(bz / 2) : DEFAULT_WORLD_OFFSET,
  }
}

/** SIGNED world coord → UNSIGNED chain coord (the value a PTB sends as u32). `offset = bounds/2`. */
export function world_to_chain(world_v, offset) {
  return Number(world_v) + Number(offset)
}

/** UNSIGNED chain coord → SIGNED world coord (for render / display). `offset = bounds/2`. */
export function chain_to_world(chain_v, offset) {
  return Number(chain_v) - Number(offset)
}

/**
 * CHAIN block coords → zone grid cell, mirroring zones.move (`pos / zone_size`, u32 non-negative). The
 * primitive: floors CHAIN values. A coord below 0 (west/north of the world's low edge) or non-finite has no
 * valid zone → null (the honest "outside the u32 zone grid" signal the compass shows as OUT OF BOUNDS).
 * @param {number} chain_x @param {number} chain_z @param {number} [zone_size]
 * @returns {{ zx: number, zy: number } | null}
 */
export function zone_of(chain_x, chain_z, zone_size = DEFAULT_ZONE_SIZE) {
  if (!Number.isFinite(chain_x) || !Number.isFinite(chain_z) || chain_x < 0 || chain_z < 0) return null
  return { zx: Math.floor(chain_x / zone_size), zy: Math.floor(chain_z / zone_size) }
}

/**
 * SIGNED world block coords → CHAIN zone key `{zx, zy}` (u32 non-negative), the key every on-chain zone
 * interaction uses. Translates world→chain per axis FIRST, then floors the CHAIN value (never the signed
 * world value — that would round the wrong way for negatives). Null when the translated chain coord falls
 * below the world's low edge.
 * @param {number} world_x @param {number} world_z @param {number} zone_size
 * @param {number} offset_x @param {number} offset_z
 * @returns {{ zx: number, zy: number } | null}
 */
export function zone_of_world(world_x, world_z, zone_size = DEFAULT_ZONE_SIZE, offset_x = DEFAULT_WORLD_OFFSET, offset_z = DEFAULT_WORLD_OFFSET) {
  return zone_of(world_to_chain(world_x, offset_x), world_to_chain(world_z, offset_z), zone_size)
}
