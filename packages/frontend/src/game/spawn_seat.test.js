// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPAWN SEAT — regression proof: a mob group whose chain anchor sat over WATER
// showed a compass pip at 1m but rendered NO rig anywhere. Root: `find_open_spawn`/`ground_surface_y` reject
// fluid columns (water is a real voxel, id 5 — column_gen.js block_at: `world_y < water_level ? WATER : AIR`),
// so over a lake the whole radius-6 neighbourhood scanned null and place() SILENTLY returned false. The whole
// zone being a lake ⇒ every nearby group skipped ⇒ "no rigs render anywhere". The fix: `resolve_group_seat`
// never silently skips — it FLOATS the group on the first surface (water OR topmost solid) when no clean column
// exists, returning null ONLY for a genuinely unstreamed column (which self-corrects on the next scan).
//
// SECOND regression — gatherable resources must never render on top of water, they belong at the bottom:
// a resource anchored over water was FLOATING at the water surface (the FLOAT fallback
// above treats water as a valid top-down surface). Fix: the resource branch now reads `seat_surface_y` (the same
// fluid/canopy-skipping ground reader `world_board_seat.js` uses to seat a fight board under tree canopy) instead
// of `ground_surface_y`, so it tunnels PAST water/lava to the real lakebed/riverbed floor — a node over deep
// water seats fully submerged at the bottom, never at the surface. The mob (nudge) path is untouched: mobs are
// still nudged to a nearby dry column and only float-on-water as the last-resort fallback below.
//
// Pure over a synthetic block oracle (id at x,y,z) — same headless technique as ambient_grounding.test.js.

import { describe, expect, it } from 'bun:test'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// MISSING-ARTIFACT (#117): spawn_rigs.js imports @aresrpg/engine3/player, whose character_controller.js
// unconditionally re-exports create_character_avatar — a static import of the absent-by-design
// senshi_male.glb — see test_helpers/glb_fixture.js.
const { resolve_group_seat } = SENSHI_MALE_GLB_AVAILABLE ? await import('./spawn_rigs.js') : {}

// GROUND_IDS (engine spawn.js) = {1,2,3,4,8,18,19}; grass = 3, dirt = 2, water = 5 (fluid, NOT walkable ground).
const GRASS = 3
const DIRT = 2
const WATER = 5

// Flat grass to y=63, air above → ground block 63, feet (top face) at 64.
const flat = (/** @type {number} */ _x, /** @type {number} */ y) => (y <= 63 ? GRASS : 0)
// A LAKE: dirt seabed ≤60, WATER 61..64 (fluid — rejected by the clean scan), air above. The reported scene.
const lake = (/** @type {number} */ _x, /** @type {number} */ y) => (y <= 60 ? DIRT : y <= 64 ? WATER : 0)
// SHALLOW water: dirt seabed ≤62, just 2 blocks of water (63..64), air above.
const shallow_lake = (/** @type {number} */ _x, /** @type {number} */ y) => (y <= 62 ? DIRT : y <= 64 ? WATER : 0)
// DEEP water: dirt seabed ≤10, water all the way up to 250 (240 blocks deep), air above.
const deep_lake = (/** @type {number} */ _x, /** @type {number} */ y) => (y <= 10 ? DIRT : y <= 250 ? WATER : 0)
// BOTTOMLESS water: no ground ANYWHERE in the column (water floor-to-ceiling, air above 64) — the sane-depth cap.
const bottomless = (/** @type {number} */ _x, /** @type {number} */ y) => (y <= 64 ? WATER : 0)

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('resolve_group_seat — never a silent skip (the lake bug)', () => {
  it('CLEAN land, mob (nudge): seats on the ground top face', () => {
    const seat = resolve_group_seat({ sample: flat, x: 10, z: 10, scan_from_y: 70, nudge: true })
    expect(seat).not.toBeNull()
    expect(seat?.mode).toBe('clean')
    expect(seat?.y).toBe(64) // 63 ground + 1 → standing ON the top face, never inside it
  })

  it('CLEAN land, resource (no nudge): keeps its EXACT anchor point', () => {
    const seat = resolve_group_seat({ sample: flat, x: 10.3, z: 10.7, scan_from_y: 70, nudge: false })
    expect(seat).not.toBeNull()
    expect(seat?.mode).toBe('clean')
    expect(seat?.y).toBe(64)
    expect(seat?.x).toBe(10.3) // a crystal is not nudged off its discovered point
    expect(seat?.z).toBe(10.7)
  })

  it('LAKE, mob: FLOATS on the water surface instead of vanishing (the headline regression)', () => {
    const seat = resolve_group_seat({ sample: lake, x: 0, z: 0, scan_from_y: 64, nudge: true })
    // pre-fix this returned null → place() silently skipped → the group never rendered while its pip showed.
    expect(seat).not.toBeNull()
    expect(seat?.mode).toBe('float')
    expect(seat?.y).toBe(65) // water top (64) + 1 → the rig stands on the lake surface, visible
  })

  it('LAKE, resource: seats on the LAKEBED floor, not the water surface (nodes seat at the bottom)', () => {
    const seat = resolve_group_seat({ sample: lake, x: 0.3, z: 0.7, scan_from_y: 64, nudge: false })
    expect(seat).not.toBeNull()
    expect(seat?.mode).toBe('clean') // seat_surface_y tunnels past the fluid to the real dirt floor
    expect(seat?.y).toBe(61) // dirt top (60) + 1 — submerged under the water column, never at y=65 (the surface)
    expect(seat?.x).toBe(0.3) // still the crystal's exact anchor — only Y changed
    expect(seat?.z).toBe(0.7)
  })

  it('SHALLOW water, resource: still seats on the seabed, not the 2-block-deep surface', () => {
    const seat = resolve_group_seat({ sample: shallow_lake, x: 5, z: 5, scan_from_y: 64, nudge: false })
    expect(seat?.mode).toBe('clean')
    expect(seat?.y).toBe(63) // dirt top (62) + 1
  })

  it('DEEP water, resource: seats far below at the real floor, fully submerged under 240 blocks (no depth cap)', () => {
    const seat = resolve_group_seat({ sample: deep_lake, x: 5, z: 5, scan_from_y: 251, nudge: false })
    expect(seat?.mode).toBe('clean')
    expect(seat?.y).toBe(11) // dirt top (10) + 1 — gathering underwater is allowed, not ours to block
  })

  it('BOTTOMLESS water (no floor anywhere in the column), resource: the sane-depth cap — falls back to the ' +
    'existing FLOAT-on-surface behavior instead of erroring', () => {
    const seat = resolve_group_seat({ sample: bottomless, x: 0, z: 0, scan_from_y: 64, nudge: false })
    expect(seat).not.toBeNull()
    expect(seat?.mode).toBe('float') // seat_surface_y found no GROUND_ID anywhere → same fallback as before the fix
    expect(seat?.y).toBe(65) // water top (64) + 1
  })

  it('LAKE with floating flora: skips the sprite, floats on the WATER (not perched on a lily)', () => {
    // dirt ≤60, water 61..64, a floating cross-sprite (id 16, ART-ONLY) at 65 — the rig must ignore it.
    const lily = (/** @type {number} */ _x, /** @type {number} */ y) =>
      y <= 60 ? DIRT : y <= 64 ? WATER : y === 65 ? 16 : 0
    const seat = resolve_group_seat({ sample: lily, x: 0, z: 0, scan_from_y: 64, nudge: true })
    expect(seat?.mode).toBe('float')
    expect(seat?.y).toBe(65) // water top face — NOT 66 (would be perched on the lily sprite)
  })

  it('STEEP terrain (flatness rejects every column) still renders — floats on the topmost solid', () => {
    // checkerboard heights: adjacent columns alternate 63/66 (Δ=3 > 1) → find_open_spawn's flatness gate rejects
    // the whole spiral, yet solid ground exists → the group must seat, not skip.
    const jagged = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
      y <= (((x + z) & 1) === 0 ? 63 : 66) ? GRASS : 0
    const seat = resolve_group_seat({ sample: jagged, x: 0, z: 0, scan_from_y: 70, nudge: true })
    expect(seat).not.toBeNull()
    expect(seat?.mode).toBe('float')
    expect(seat?.y).toBe(64) // column (0,0) top 63 + 1
  })

  it('UNSTREAMED column (all air in the window): returns null so the caller RETRIES (not a permanent skip)', () => {
    const air = () => 0
    const seat = resolve_group_seat({ sample: air, x: 0, z: 0, scan_from_y: 64, nudge: true })
    expect(seat).toBeNull() // legit deferral — self-corrects when chunks stream in / the player nears
  })
})
