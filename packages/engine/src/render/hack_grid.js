// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE — the retrowave flat-grid world presentation (docs/design/hack_mode_spec.md).
//
// Chain truth is x,z; terrain height is client decoration. This module IS the alternative decoration:
// a neon grid plane + a retrowave sky, plus the constant-plane ORACLE the engine swaps its three
// height/residency api methods onto (§1.3). Nothing else in the tree branches on the mode — every
// consumer (character controller, physics gate, boot veil, entity grounding, board seating, the
// rescue nets) keeps reading engine.sample_block / is_column_resident and inherits the plane.
//
// The mesh is ONE unlit quad that follows the camera, snapped to the MAJOR lattice, with every line
// derived in-shader from its LOCAL xz — so the world lattice is exact (the snap is a multiple of the
// spacing) and the fragment math never touches the huge world coordinates a ±250 km fence allows.
// No textures, no streaming, resolution-independent, antialiased. The far distance is the SAME quad
// fading to the sky's mid violet — the "skirt" is a colour ramp, not a second mesh.

import { Color, Mesh, PlaneGeometry } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  clamp,
  float,
  fract,
  fwidth,
  length,
  max,
  mix,
  positionLocal,
  positionWorldDirection,
  pow,
  sin,
  smoothstep,
  uniform,
  varying,
  vec3,
  vec4,
} from 'three/tsl'

import { get_block_by_name } from '../config/block_registry.js'

/** [§1.3] The FEET plane: solid iff floor(y) < HACK_GROUND_Y, so the top ground block is 137 and every
 *  entity's feet rest at 138 — exactly WORLD_SPAWN's y, so a fresh boot stands ON the plane and no
 *  rescue/snap path can fire. Also the world-space y the grid quad is drawn at (a block's top face is
 *  at its index + 1, per the collision convention in player/collision.js). */
export const HACK_GROUND_Y = 138

/** The solid id the oracle answers below the plane. Any solid works — consumers read the SOLIDITY class,
 *  never the id; stone is the neutral subsurface pick (the same choice engine.js's analytic floor makes). */
const GROUND_BLOCK_ID = /** @type {number} */ (get_block_by_name('stone')?.id ?? 1)

/** THE INTERACTION GRID: minor lines sit on the 1 m block lattice — the same lattice zone_derive
 *  positions, gather cells and movement snap to ("one line = one block"). Major lines every 8 blocks
 *  give distance legibility. The quad's centre snaps to MAJOR_M so both lattices stay world-locked. */
const MINOR_M = 1
const MAJOR_M = 8
/** Line half-widths in meters (world-space, so lines thin out with distance instead of pixel-crawling). */
const MINOR_HALF_W = 0.02
const MAJOR_HALF_W = 0.05
/** Lines start dissolving here and are gone by LINE_FADE_END_M; past SKIRT_FADE_END_M the plane IS the
 *  sky's mid violet, so the quad's far edge is invisible without a second mesh or any scene fog. */
const LINE_FADE_START_M = 140
const LINE_FADE_END_M = 400
const SKIRT_FADE_END_M = 2_600
/** Quad edge (m). Far beyond the camera's far plane at every framing ⇒ its rim never enters view. */
const PLANE_M = 32_000

/** [§2.2] The sun is a standing navigation LANDMARK, never animated: fixed azimuth north (+Z), ~6° up. */
const SUN_ELEVATION_RAD = (6 * Math.PI) / 180
/** Readability-oversized disc (the retrowave sun is a horizon anchor, not an astronomical body). */
const SUN_ANGULAR_RADIUS_RAD = (11 * Math.PI) / 180

/** [§2.1] The palette, authored as sRGB hex; three converts to the linear working space on setHex. */
const HACK_BG_ZENITH = hex_rgb(0x05010d)
const HACK_BG_MID = hex_rgb(0x2b0a4a)
const HACK_HORIZON_GLOW = hex_rgb(0xff6ec7)
const HACK_GROUND = hex_rgb(0x0a0118)
const HACK_GRID_MINOR = hex_rgb(0x00e5ff)
const HACK_GRID_MAJOR = hex_rgb(0xff2d95)
const HACK_SUN_TOP = hex_rgb(0xffd319)
const HACK_SUN_BOTTOM = hex_rgb(0xff2975)
/** Neon punch: AgX rolls saturated highlights off hard (there is no post grade in hack mode — the
 *  atmosphere stack is never constructed), so the emissive terms are authored above 1. */
const MINOR_GAIN = 0.55
const MAJOR_GAIN = 2.2
const HORIZON_GAIN = 1.4

/**
 * A colour literal as a constant vec3 node, converted sRGB→linear by three's colour management (so the
 * spec's hexes land as authored after the output transform).
 * @param {number} hex @returns {*} vec3 node
 */
function hex_rgb(hex) {
  const c = new Color().setHex(hex)
  return vec3(c.r, c.g, c.b)
}

/**
 * Antialiased coverage of one world lattice, in [0,1]. `dist` is the distance (m) to the nearest line
 * of that lattice; a line narrower than a pixel is DIMMED rather than drawn thin, which is what keeps
 * the receding grid from moiré-ing into noise.
 * @param {*} p vec2 node — local xz in meters @param {*} px vec2 node — one pixel in meters (fwidth)
 * @param {number} spacing lattice pitch (m) @param {number} half_w line half-width (m)
 * @returns {*} float node
 */
function lattice_coverage(p, px, spacing, half_w) {
  const cell = p.div(float(spacing))
  // distance to the nearest line, per axis, in meters: (0.5 − |fract − 0.5|) · spacing
  const dx = float(0.5)
    .sub(abs(fract(cell.x).sub(float(0.5))))
    .mul(float(spacing))
  const dz = float(0.5)
    .sub(abs(fract(cell.y).sub(float(0.5))))
    .mul(float(spacing))
  const aa_x = max(px.x, float(1e-5))
  const aa_z = max(px.y, float(1e-5))
  const cov_x = float(1)
    .sub(smoothstep(float(half_w), float(half_w).add(aa_x), dx))
    .mul(clamp(float(2 * half_w).div(aa_x), 0, 1))
  const cov_z = float(1)
    .sub(smoothstep(float(half_w), float(half_w).add(aa_z), dz))
    .mul(clamp(float(2 * half_w).div(aa_z), 0, 1))
  return max(cov_x, cov_z)
}

/**
 * @typedef {object} HackOracle
 * @property {(x: number, y: number, z: number) => number} sample_block the constant-plane oracle; the
 *   engine swaps BOTH sample_block and sample_block_analytic onto it (residency is meaningless here).
 * @property {(x: number, z: number) => boolean} is_column_resident always true — nothing streams, so
 *   nothing can be missing.
 * @property {(x: number, z: number) => number} ground_at the top solid block y (HACK_GROUND_Y − 1) —
 *   the mana barrier's terrain-following probe, flat by construction.
 */

/**
 * @typedef {object} HackDecoration
 * @property {*} sky_node vec3 node for `scene.backgroundNode` — the retrowave sky + its fixed sun.
 * @property {(dt: number, camera_position: { x: number, z: number }) => void} tick advances the shimmer
 *   clock and re-centres the quad on the camera (snapped to the major lattice).
 * @property {() => void} dispose unmounts the quad and frees its geometry/material.
 */

/** @typedef {HackOracle & HackDecoration} HackPresentation */

/**
 * The height/residency truth of hack mode, on its own — no scene, no GPU, no clock. The engine arms it
 * at CREATE time (the decoration below can only be built once the renderer exists), so the very first
 * `is_column_resident` a consumer asks — the boot veil's, before init has even resolved — already
 * answers true and no readiness path can ever wait on streaming.
 * @returns {HackOracle}
 */
export function create_hack_oracle() {
  return {
    sample_block(_x, y, _z) {
      const iy = Math.floor(y)
      // (HACK_GROUND_Y < WORLD_HEIGHT, so the world box's ceiling is already implied by the plane.)
      return iy >= 0 && iy < HACK_GROUND_Y ? GROUND_BLOCK_ID : 0
    },
    is_column_resident() {
      return true
    },
    ground_at() {
      return HACK_GROUND_Y - 1
    },
  }
}

/**
 * Builds the hack-mode presentation — the oracle above plus its decoration — and mounts the grid quad
 * into the scene. Pure construction: no GPU work, no streaming, no workers; the engine's hack branch
 * skips every terrain system and calls this instead.
 * @param {{ scene: import('three').Scene }} opts
 * @returns {HackPresentation}
 */
export function create_hack_presentation({ scene }) {
  const u_time = uniform(0)

  // ── the sky (scene.backgroundNode) ────────────────────────────────────────────────────────────
  const view = positionWorldDirection.normalize()
  const up = view.y
  // three stops: near-black zenith → deep violet at the horizon → the ground colour below it, so the
  // quad's far ramp and the sky meet on the same value and the horizon line is a glow, not a seam.
  const sky_gradient = mix(
    mix(HACK_GROUND, HACK_BG_MID, smoothstep(float(-0.3), float(0), up)),
    HACK_BG_ZENITH,
    smoothstep(float(0), float(0.55), up)
  )
  const horizon_band = float(1).sub(smoothstep(float(0), float(0.05), abs(up)))
  const sun_dir = vec3(0, Math.sin(SUN_ELEVATION_RAD), Math.cos(SUN_ELEVATION_RAD))
  const cos_sun = view.dot(sun_dir)
  const disc = smoothstep(float(Math.cos(SUN_ANGULAR_RADIUS_RAD)), float(Math.cos(SUN_ANGULAR_RADIUS_RAD * 0.985)), cos_sun) // prettier-ignore
  // Vertical parameter over the VISIBLE disc — 0 at the horizon, 1 at the disc top. The sun is half
  // sunk into the horizon (elevation < radius, the retrowave silhouette), so a bottom-of-disc origin
  // would hide the whole magenta half under the plane; anchoring at the horizon puts the spec's
  // #ff2975 → #ffd319 ramp exactly across what a player sees.
  const disc_t = clamp(up.div(float(Math.sin(SUN_ELEVATION_RAD) + Math.sin(SUN_ANGULAR_RADIUS_RAD))), 0, 1)
  // ^1.7 holds the magenta across the disc's lower third (the disc's widest band sits BELOW its centre
  // here, so a linear ramp reads as an all-yellow ball); ×0.8 keeps it off AgX's desaturating shoulder.
  const sun_rgb = mix(HACK_SUN_BOTTOM, HACK_SUN_TOP, pow(disc_t, float(1.7))).mul(float(0.8))
  // 4 horizontal gap stripes carved into the lower half (the retrowave grammar), fading out by mid-disc.
  const stripes = smoothstep(float(0.34), float(0.46), fract(disc_t.mul(float(7))))
  const sun_mask = mix(float(1), stripes, smoothstep(float(0.55), float(0.1), disc_t))
  const halo = pow(clamp(cos_sun, 0, 1), float(320)).mul(float(0.35))
  const sky_node = sky_gradient
    .add(HACK_HORIZON_GLOW.mul(horizon_band.mul(float(HORIZON_GAIN))))
    .add(sun_rgb.mul(disc.mul(sun_mask)))
    .add(HACK_SUN_BOTTOM.mul(halo))

  // ── the grid quad ─────────────────────────────────────────────────────────────────────────────
  const material = new MeshBasicNodeMaterial({
    // [§1.4] fog-immune BY MATERIAL: a hack-owned fog_scale would be clobbered on every dungeon exit
    // (D213-B drives that dial), so the plane opts out of the shared scene fog and fades in-shader.
    fog: false,
  })
  material.colorNode = (() => {
    const p = varying(positionLocal.xz) // local ≡ world − the snapped centre: exact fp32 near the camera
    const px = fwidth(p)
    const d = length(p)
    const line_fade = float(1).sub(smoothstep(float(LINE_FADE_START_M), float(LINE_FADE_END_M), d))
    const base = mix(HACK_GROUND, HACK_BG_MID, smoothstep(float(LINE_FADE_END_M), float(SKIRT_FADE_END_M), d))
    // house DNA: slow atmospheric motion — a faint scanline crawling along Z over the major lines only.
    const shimmer = sin(p.y.mul(float(0.05)).sub(u_time.mul(float(1.1))))
      .mul(float(0.12))
      .add(float(0.88))
    const minor = HACK_GRID_MINOR.mul(
      lattice_coverage(p, px, MINOR_M, MINOR_HALF_W)
        .mul(float(0.14 * MINOR_GAIN))
        .mul(line_fade)
    )
    const major = HACK_GRID_MAJOR.mul(
      lattice_coverage(p, px, MAJOR_M, MAJOR_HALF_W)
        .mul(float(0.55 * MAJOR_GAIN))
        .mul(shimmer)
        .mul(line_fade)
    )
    // (cast: mix() infers its node type from the interpolant in the TSL typings — the value is a vec3)
    return vec4(/** @type {*} */ (base.add(minor).add(major)), float(1))
  })()

  const geometry = new PlaneGeometry(PLANE_M, PLANE_M)
  geometry.rotateX(-Math.PI / 2) // XY plane → horizontal XZ
  const mesh = new Mesh(geometry, material)
  mesh.position.y = HACK_GROUND_Y
  mesh.frustumCulled = false // it is always under the camera; culling it would be a black screen
  mesh.renderOrder = -1 // the world floor draws before everything standing on it
  scene.add(mesh)

  return {
    ...create_hack_oracle(),
    sky_node,
    tick(dt, camera_position) {
      u_time.value += dt
      // Snap to the MAJOR pitch: the local lattice then coincides with the world lattice exactly, so
      // the lines are world-locked (they never swim under a walking player) at zero shader cost.
      mesh.position.x = Math.round(camera_position.x / MAJOR_M) * MAJOR_M
      mesh.position.z = Math.round(camera_position.z / MAJOR_M) * MAJOR_M
    },
    dispose() {
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
    },
  }
}
