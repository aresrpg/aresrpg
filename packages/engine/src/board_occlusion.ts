// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEE THROUGH THE FOREST TO THE ARENA. A fight board is mounted in the live world, so whatever
// stands BETWEEN the camera and it — canopy, trunks, terrain shoulders — has to melt away or the
// player cannot read the board. Never with a hard clip: the mask is feathered everywhere.
//
// THE MASK, in screen space, because that is the only frame where "does this fragment overlap the
// arena from where I am standing" is exact — a world-space cone misses a tree crowding the near
// corner. A fragment dissolves when it is BOTH inside the board's projected footprint (as an
// ELLIPTICAL vignette, so no rectangle edge is ever visible) and NEARER than the board along the
// view. The depth test is what keeps the arena itself, and the whole world behind it, solid.
//
// Two escapes from the screen mask are handled separately: tall décor at a grazing orbit angle
// (a world-XZ radius term, angle-independent) and anything poking up through the board's own
// footprint (a depth-INDEPENDENT world AABB above the tile line — the peephole's depth gate
// misses it precisely because it sits AT the board's depth).
//
// APPLICATION. Alpha classes (foliage, liquids) multiply the fade into their opacity. Opaque
// terrain cannot blend, so it dissolves as a SCREEN-DOOR dither: discard where the fade falls
// under a per-pixel hash. That discard costs early-Z, so it lives in a MATERIAL VARIANT that is
// swapped in only while a board is mounted — never in the material normal play uses.

import { Vector2 } from 'three'
import {
  Discard,
  If,
  float,
  interleavedGradientNoise,
  length,
  max,
  positionView,
  positionWorld,
  screenCoordinate,
  screenSize,
  smoothstep,
  sub,
  uniform,
  vec2,
} from 'three/tsl'

/** Normalized elliptical radius fully melted — past the footprint's corners, so no rectangle. */
const MELT_CORE_R = 1.45
/** Where the melt reaches zero: a wide radial feather, so no boundary shape is ever visible. */
const MELT_OUTER_R = 2.6
/** Skirt on the projected half-extent, so the window clears the board's curbs generously. */
const FOOTPRINT_SKIRT_NDC = 0.4
/** View-space metres over which the dissolve ramps in as geometry approaches the board. */
const DEPTH_FEATHER_M = 5
/** View-space metres of grace, so the board's own curbs and props are never dissolved. */
const DEPTH_BIAS_M = 1.5
/** Soft rim on the world footprint clear — a dissolve edge, never a cut line. */
const FOOTPRINT_FEATHER_M = 1.5
/** Clear only what pokes ABOVE the board's tile line; the ground it rests on stays solid. */
const FOOTPRINT_FLOOR_M = 0.37

export type BoardOcclusion = ReturnType<typeof create_board_occlusion>

/** One instance per engine, threaded into every terrain-class material build. Inert until a
 *  board arms it, and `active` folds the whole term away at zero cost when it is not. */
export const create_board_occlusion = () => {
  const active = uniform(0)
  const screen_center = uniform(new Vector2(0, 0))
  const screen_half = uniform(new Vector2(-1, -1))
  const view_dist = uniform(1)
  /** the board's floor: fragments at or below it never dissolve, so the ground under a grazing
   *  sightline never breaks into a bright dither band */
  const floor_y = uniform(-1e9)
  const center_xz = uniform(new Vector2(0, 0))
  const radius = uniform(-1)
  const clear_center = uniform(new Vector2(0, 0))
  const clear_half = uniform(new Vector2(-1, -1))

  return {
    uniforms: { active, screen_center, screen_half, view_dist, floor_y, center_xz, radius, clear_center, clear_half },
    armed: () => active.value === 1,
    set_active: (on: boolean): void => {
      active.value = on ? 1 : 0
      if (!on) {
        screen_half.value.set(-1, -1)
        clear_half.value.set(-1, -1)
        radius.value = -1
      }
    },
    /** Per-frame: where the board landed on screen, how far it is, and the world footprint it
     *  clears. Called by whoever owns the camera; nothing here reads three's camera itself. */
    set_frame: (frame: {
      center_ndc: readonly [number, number]
      half_ndc: readonly [number, number]
      view_dist: number
      floor_y: number
      center_xz: readonly [number, number]
      radius: number
      clear_half: readonly [number, number]
    }): void => {
      screen_center.value.set(frame.center_ndc[0], frame.center_ndc[1])
      screen_half.value.set(frame.half_ndc[0] + FOOTPRINT_SKIRT_NDC, frame.half_ndc[1] + FOOTPRINT_SKIRT_NDC)
      view_dist.value = frame.view_dist
      floor_y.value = frame.floor_y
      center_xz.value.set(frame.center_xz[0], frame.center_xz[1])
      radius.value = frame.radius
      clear_center.value.set(frame.center_xz[0], frame.center_xz[1])
      clear_half.value.set(frame.clear_half[0], frame.clear_half[1])
    },
  }
}

/** The fade: 1 fully visible, 0 fully dissolved. Pure over the fragment and the uniforms; its
 *  ramp is pinned against `occlusion_fade_value` so the shader and the host cannot drift. */
export const occlusion_fade_node = (occlusion: BoardOcclusion) => {
  const u = occlusion.uniforms
  const frag_ndc = screenCoordinate.div(screenSize).mul(float(2)).sub(float(1))
  const nx = frag_ndc.x.sub(u.screen_center.x).div(u.screen_half.x)
  const ny = frag_ndc.y.sub(u.screen_center.y).div(u.screen_half.y)
  const inside = float(1).sub(smoothstep(float(MELT_CORE_R), float(MELT_OUTER_R), length(vec2(nx, ny))))
  const above_floor = smoothstep(u.floor_y.add(float(0.1)), u.floor_y.add(float(0.5)), positionWorld.y)
  const frag_xz = length(vec2(positionWorld.x, positionWorld.z).sub(u.center_xz))
  const within_radius = u.radius
    .lessThan(float(0))
    .select(float(0), float(1).sub(smoothstep(u.radius, u.radius.add(float(1.5)), frag_xz)))
  // positionView.z runs negative down the view axis; its magnitude is the distance
  const ahead = u.view_dist.sub(positionView.z.negate()).sub(float(DEPTH_BIAS_M))
  const in_front = smoothstep(float(0), float(DEPTH_FEATHER_M), ahead)
  const between = max(inside, within_radius).mul(in_front).mul(above_floor)

  const cdx = positionWorld.x.sub(u.clear_center.x).abs()
  const cdz = positionWorld.z.sub(u.clear_center.y).abs()
  const fx = float(1).sub(smoothstep(u.clear_half.x.sub(float(FOOTPRINT_FEATHER_M)), u.clear_half.x, cdx))
  const fz = float(1).sub(smoothstep(u.clear_half.y.sub(float(FOOTPRINT_FEATHER_M)), u.clear_half.y, cdz))
  const above_tile = smoothstep(u.floor_y, u.floor_y.add(float(FOOTPRINT_FLOOR_M)), positionWorld.y)
  const footprint_clear = fx.min(fz).mul(above_tile)

  return sub(float(1), max(between, footprint_clear).mul(u.active))
}

/** The opaque path. Emit as a STATEMENT inside the material's own colorNode Fn — a nested Fn's
 *  Discard never lands in the outer graph, and a bare build-scope discard is compiled away. */
export const occlusion_dither_discard = (occlusion: BoardOcclusion): void => {
  const fade = occlusion_fade_node(occlusion)
  If(fade.lessThan(interleavedGradientNoise(screenCoordinate)), () => {
    Discard()
  })
}

const smoothstep_host = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** The host mirror of the ramp — the only way to test this maths without a GPU. */
export const occlusion_fade_value = ({
  frag_ndc,
  frag_dist,
  frag_world,
  center_ndc,
  half_ndc,
  view_dist,
  floor_y = -1e9,
  clear_center = [0, 0],
  clear_half = [-1, -1],
  active = true,
}: {
  frag_ndc: readonly [number, number]
  frag_dist: number
  frag_world?: readonly [number, number, number]
  center_ndc: readonly [number, number]
  /** the SKIRTED half-extent, as the uniform carries it */
  half_ndc: readonly [number, number]
  view_dist: number
  floor_y?: number
  clear_center?: readonly [number, number]
  clear_half?: readonly [number, number]
  active?: boolean
}): number => {
  if (!active) return 1
  const nx = (frag_ndc[0] - center_ndc[0]) / half_ndc[0]
  const ny = (frag_ndc[1] - center_ndc[1]) / half_ndc[1]
  const inside = 1 - smoothstep_host(MELT_CORE_R, MELT_OUTER_R, Math.hypot(nx, ny))
  const in_front = smoothstep_host(0, DEPTH_FEATHER_M, view_dist - frag_dist - DEPTH_BIAS_M)
  const above_floor = frag_world ? smoothstep_host(floor_y + 0.1, floor_y + 0.5, frag_world[1]) : 1
  const between = inside * in_front * above_floor
  const footprint = frag_world
    ? Math.min(
        1 -
          smoothstep_host(
            clear_half[0] - FOOTPRINT_FEATHER_M,
            clear_half[0],
            Math.abs(frag_world[0] - clear_center[0])
          ),
        1 -
          smoothstep_host(clear_half[1] - FOOTPRINT_FEATHER_M, clear_half[1], Math.abs(frag_world[2] - clear_center[1]))
      ) * smoothstep_host(floor_y, floor_y + FOOTPRINT_FLOOR_M, frag_world[1])
    : 0
  return 1 - Math.max(between, footprint)
}

/** Project a board's world footprint to a screen AABB plus its view distance — the per-frame CPU
 *  half of the mask. Returns null when the board sits behind the eye. */
export const project_board_screen = (
  view_projection: { elements: readonly number[] },
  camera_matrix_world_inverse: { elements: readonly number[] },
  center: readonly [number, number, number],
  half_x: number,
  half_z: number,
  floor_y: number
): { center_ndc: [number, number]; half_ndc: [number, number]; view_dist: number } | null => {
  const project = (x: number, y: number, z: number, m: readonly number[]): [number, number, number, number] => [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]!,
  ]
  const corners = [-half_x, half_x].flatMap((dx) => [-half_z, half_z].map((dz) => [center[0] + dx, center[2] + dz]))
  // A corner BEHIND the eye has w <= 0: dividing by it mirrors the point to the far side and
  // inverts the whole box, which flashes the vignette across the screen. One such corner and the
  // footprint is not trustworthy at all, so the mask rests this frame instead of guessing.
  const projected_corners = corners.map(([x, z]) => project(x!, floor_y, z!, view_projection.elements))
  if (projected_corners.some(([, , , w]) => w <= 0)) return null
  const ndc = projected_corners.map(([cx, cy, , cw]) => [cx / cw, cy / cw] as const)
  const xs = ndc.map(([x]) => x)
  const ys = ndc.map(([, y]) => y)
  const [, , vz] = project(center[0], center[1], center[2], camera_matrix_world_inverse.elements)
  const view_dist = -vz
  if (view_dist <= 0) return null
  return {
    center_ndc: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2],
    half_ndc: [(Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2],
    view_dist,
  }
}
