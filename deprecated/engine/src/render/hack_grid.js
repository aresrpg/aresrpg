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
  floor,
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

import { HACK_LATTICE, HACK_PALETTE } from './hack_palette.js'

/** [§1.3] The FEET plane: solid iff floor(y) < HACK_GROUND_Y, so the top ground block is 137 and every
 *  entity's feet rest at 138 — exactly WORLD_SPAWN's y, so a fresh boot stands ON the plane and no
 *  rescue/snap path can fire. Also the world-space y the grid quad is drawn at (a block's top face is
 *  at its index + 1, per the collision convention in player/collision.js). */
export const HACK_GROUND_Y = 138

/** The solid id the oracle answers below the plane. Any solid works — consumers read the SOLIDITY class,
 *  never the id; stone is the neutral subsurface pick (the same choice engine.js's analytic floor makes). */
const GROUND_BLOCK_ID = /** @type {number} */ (get_block_by_name('stone')?.id ?? 1)

/** THE INTERACTION GRID (one home: hack_palette.js — the HUD minimap draws the SAME lattice). Minor
 *  lines sit on the 1 m block lattice — the same lattice zone_derive positions, gather cells and
 *  movement snap to ("one line = one block"). Major lines every 8 blocks give distance legibility.
 *  The quad's centre snaps to MAJOR_M so both lattices stay world-locked. */
const MINOR_M = HACK_LATTICE.minor_m
const MAJOR_M = HACK_LATTICE.major_m
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

/** [§2.1] The palette (authored as sRGB hex in hack_palette.js — the ONE home the minimap shares);
 *  three converts to the linear working space on setHex. */
const HACK_BG_ZENITH = hex_rgb(HACK_PALETTE.bg_zenith)
const HACK_BG_MID = hex_rgb(HACK_PALETTE.bg_mid)
const HACK_BG_DRIFT = hex_rgb(HACK_PALETTE.bg_drift)
const HACK_HORIZON_GLOW = hex_rgb(HACK_PALETTE.horizon_glow)
const HACK_GROUND = hex_rgb(HACK_PALETTE.ground)
const HACK_GRID_MINOR = hex_rgb(HACK_PALETTE.grid_minor)
const HACK_GRID_MAJOR = hex_rgb(HACK_PALETTE.grid_major)
const HACK_SUN_TOP = hex_rgb(HACK_PALETTE.sun_top)
const HACK_SUN_BOTTOM = hex_rgb(HACK_PALETTE.sun_bottom)
const HACK_RIDGE_FILL = hex_rgb(HACK_PALETTE.ridge_fill)
const HACK_RIDGE_RIM = hex_rgb(HACK_PALETTE.ridge_rim)
/** Neon punch: AgX rolls saturated highlights off hard (there is no post grade in hack mode — the
 *  atmosphere stack is never constructed), so the emissive terms are authored above 1. */
const MINOR_GAIN = 0.55
const MAJOR_GAIN = 2.2
const HORIZON_GAIN = 1.4

// ── THE NEON-WAVE MOOD ────────────────────────────────────────────────────────────────────────────
// Every animated term below is a phase MULTIPLIED BY `u_motion` (1 normally, 0 under
// prefers-reduced-motion, matching board_entities.js's idiom). At 0 each oscillator freezes at its
// own phase 0 — the still frame is the same picture, so reduced motion loses the drift, never the look.
// All of it is fragment math on two surfaces that were already being shaded (the background node and the
// one grid quad): no new pass, no new draw call, no texture — which is why the mode stays 120fps-class.

/** Slowest cycle in the mode — the sky's violet hue drift (≈90 s round trip). "Slow atmospheric motion". */
const SKY_DRIFT_HZ = 0.011
/** Psychedelic banding: concentric colour ripples up the dome, drifting down over ~25 s. */
const SKY_BAND_COUNT = 16
const SKY_BAND_HZ = 0.04
const SKY_BAND_AMP = 0.085
/** The sun's glow breathes ±12% over ~10 s; the stripes crawl up the disc over ~2 min. */
const SUN_BREATH_HZ = 0.1
const SUN_STRIPE_DRIFT_HZ = 0.008
/** The two analytic glow lobes around the disc — a TIGHT warm core bleed and a WIDE magenta corona.
 *  This is the "glowy sun" the mood pass asks for, and it is deliberately NOT the post-stack bloom:
 *  hack mode constructs no post stack at all (renderer.js `atmosphere:false`), and a threshold bloom
 *  would re-admit the whole PassNode chain for one highlight. A stylised sun's glow is an AUTHORED
 *  gradient, so it is drawn where the disc is drawn — same node, zero extra cost. */
const SUN_GLOW_CORE_POW = 210
const SUN_GLOW_CORE_GAIN = 0.5
const SUN_GLOW_WIDE_POW = 22
const SUN_GLOW_WIDE_GAIN = 0.22

/** FAKE RETROWAVE MOUNTAINS — a silhouette derived from the VIEW DIRECTION, not geometry. The sky node
 *  is already a direction→colour function, so the ridge is one more term in it: no mesh, no draw call,
 *  no culling, no camera-follow, and background-only/collision-free BY CONSTRUCTION (there is nothing
 *  to collide with). Three sine octaves over the horizontal direction give a continuous, world-locked
 *  profile — the same peaks always sit on the same azimuth — and quantising it to RIDGE_STEPS facets
 *  produces the flat-shaded low-poly read of the synthwave reference. STATIC by design: the ridge
 *  carries no time term, so the mountains never swim while the drift/glow around them animate. */
const RIDGE_STEPS = 26
/** Peak elevation of the ridge in `up` units (≈9°). The profile is raised to RIDGE_SHARPNESS so most of
 *  the skyline sits LOW and only a few summits reach the ceiling — a ridge line with silhouette, not the
 *  even wall a linear profile draws. */
const RIDGE_HEIGHT = 0.155
const RIDGE_SHARPNESS = 2.1
/** Floor under the whole ridge so the skyline never fully clears the horizon (there is always distant land). */
const RIDGE_FLOOR = 0.012
/** The sun sits in a VALLEY: the profile is pressed down toward the sun's azimuth so the disc stays the
 *  standing navigation landmark (§2.2) instead of being swallowed by whatever peak happens to sit north. */
const RIDGE_SUN_VALLEY = 0.34
/** Neon rim thickness on the silhouette edge, in `up` units. */
const RIDGE_RIM_W = 0.0035

/** Grid: the whole lattice breathes ±12% over ~4 s; a pulse RING travels outward from the camera. */
const GRID_BREATH_HZ = 0.25
const GRID_PULSE_HZ = 0.13
const GRID_PULSE_WAVELENGTH_M = 110

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
 * The accessibility opt-out, read ONCE at construction (the same matchMedia idiom board_entities.js
 * uses). True ⇒ every oscillator in the mode freezes at its phase-0 value.
 * @returns {boolean}
 */
function reduced_motion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
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
  // prefers-reduced-motion folds every oscillator to its phase-0 constant (same picture, no drift).
  const u_motion = uniform(reduced_motion() ? 0 : 1)
  /** One animated phase, in radians, already gated by u_motion. @param {number} hz @returns {*} */
  const phase = (hz) => u_time.mul(float(hz * Math.PI * 2)).mul(u_motion)

  // ── the sky (scene.backgroundNode) ────────────────────────────────────────────────────────────
  const view = positionWorldDirection.normalize()
  const up = view.y
  // PSYCHEDELIC DRIFT: the mid-sky violet cycles between two stops of the palette on the mode's slowest
  // clock. One mix on a constant pair — the whole dome's mood shifts without a second gradient.
  const bg_mid_live = mix(HACK_BG_MID, HACK_BG_DRIFT, sin(phase(SKY_DRIFT_HZ)).mul(float(0.5)).add(float(0.5)))
  // three stops: near-black zenith → deep violet at the horizon → the ground colour below it, so the
  // quad's far ramp and the sky meet on the same value and the horizon line is a glow, not a seam.
  const sky_gradient = mix(
    mix(HACK_GROUND, bg_mid_live, smoothstep(float(-0.3), float(0), up)),
    HACK_BG_ZENITH,
    smoothstep(float(0), float(0.55), up)
  )
  // BANDING: concentric ripples up the dome, crawling downward — the psychedelic tell. Amplitude fades
  // to nothing at the horizon so it never muddies the sun/ridge silhouette band.
  const bands = sin(up.mul(float(SKY_BAND_COUNT)).sub(phase(SKY_BAND_HZ)))
    .mul(float(SKY_BAND_AMP))
    .mul(smoothstep(float(0.02), float(0.5), up))
  const sky_banded = sky_gradient.add(HACK_RIDGE_RIM.mul(max(bands, float(0))))
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
  // here, so a linear ramp reads as an all-yellow ball); ×0.82 keeps it off AgX's desaturating shoulder.
  const sun_rgb = mix(HACK_SUN_BOTTOM, HACK_SUN_TOP, pow(disc_t, float(1.7))).mul(float(0.82))
  // 4 horizontal gap stripes carved into the lower half (the retrowave grammar), fading out by mid-disc.
  // SHIMMER: the stripe phase crawls slowly UP the disc, so the gaps drift instead of sitting frozen.
  const stripes = smoothstep(float(0.34), float(0.46), fract(disc_t.mul(float(7)).sub(phase(SUN_STRIPE_DRIFT_HZ))))
  const sun_mask = mix(float(1), stripes, smoothstep(float(0.55), float(0.1), disc_t))
  // THE GLOW: two boundary-free lobes (tight warm core + wide magenta corona) breathing together. The
  // wide lobe is what makes the disc read as a light SOURCE rather than a sticker on the gradient.
  const breath = sin(phase(SUN_BREATH_HZ)).mul(float(0.12)).add(float(1))
  const glow_core = pow(clamp(cos_sun, 0, 1), float(SUN_GLOW_CORE_POW)).mul(float(SUN_GLOW_CORE_GAIN))
  const glow_wide = pow(clamp(cos_sun, 0, 1), float(SUN_GLOW_WIDE_POW)).mul(float(SUN_GLOW_WIDE_GAIN))
  const sun_glow = mix(HACK_SUN_BOTTOM, HACK_SUN_TOP, float(0.35)).mul(glow_core).add(HACK_SUN_BOTTOM.mul(glow_wide))

  // FAKE MOUNTAINS: quantised sine octaves over the horizontal view direction → a static, world-locked,
  // faceted skyline. `aa` is the screen-space width of one `up` step, so the silhouette edge antialiases
  // at every field of view instead of crawling.
  const ridge_raw = sin(view.x.mul(float(11.7)).add(view.z.mul(float(4.3))))
    .mul(float(0.5))
    .add(sin(view.x.mul(float(23.3)).sub(view.z.mul(float(9.7)))).mul(float(0.3)))
    .add(sin(view.z.mul(float(41.9)).add(view.x.mul(float(6.1)))).mul(float(0.2)))
  const ridge_faceted = floor(ridge_raw.mul(float(0.5)).add(float(0.5)).mul(float(RIDGE_STEPS))).div(float(RIDGE_STEPS))
  // press the skyline down toward the sun's azimuth (+Z) so the disc keeps a clear valley to sink into.
  const sun_valley = mix(float(RIDGE_SUN_VALLEY), float(1), float(1).sub(smoothstep(float(0.86), float(1), view.z)))
  const ridge_h = pow(ridge_faceted, float(RIDGE_SHARPNESS))
    .mul(float(RIDGE_HEIGHT))
    .mul(sun_valley)
    .add(float(RIDGE_FLOOR))
  const aa = max(fwidth(up), float(1e-5))
  // solid below the profile, only ABOVE the horizon line (the grid plane owns everything below).
  const ridge_mask = float(1)
    .sub(smoothstep(ridge_h.sub(aa), ridge_h.add(aa), up))
    .mul(smoothstep(float(0), aa.add(float(1e-4)), up))
  // the neon rim riding the silhouette edge — the synthwave wireframe read, one smoothstep pair.
  const ridge_rim = smoothstep(ridge_h.sub(float(RIDGE_RIM_W)), ridge_h, up)
    .mul(float(1).sub(smoothstep(ridge_h, ridge_h.add(float(RIDGE_RIM_W)), up)))
    .mul(smoothstep(float(0), float(0.004), up))

  // The disc REPLACES the sky it covers instead of adding to it — the deep violet underneath was summing
  // into the gold and turning the whole ball pale cream (the "why is the sun beige" read). Mixing by
  // `disc · sun_mask` also gives the stripe gaps for free: mask 0 ⇒ the sky shows straight through the
  // slots, which is exactly what the retrowave grammar wants. The glow then rides OUTSIDE the disc.
  const sky_before_ridge = mix(sky_banded, sun_rgb, disc.mul(sun_mask)).add(
    sun_glow.mul(breath).mul(float(1).sub(disc))
  )
  // The ridge occludes the sun/sky behind it; the horizon glow is added AFTER so the haze bleeds over the
  // mountains' base exactly like the reference art (the ridge stands IN the glow, not in front of it).
  const sky_node = mix(sky_before_ridge, HACK_RIDGE_FILL, ridge_mask)
    .add(HACK_RIDGE_RIM.mul(ridge_rim.mul(float(0.42))))
    .add(HACK_HORIZON_GLOW.mul(horizon_band.mul(float(HORIZON_GAIN)).mul(breath)))

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
    // the far ramp meets the LIVE mid-sky, so the plane's horizon keeps matching the drifting dome.
    const base = mix(HACK_GROUND, bg_mid_live, smoothstep(float(LINE_FADE_END_M), float(SKIRT_FADE_END_M), d))
    // house DNA: slow atmospheric motion — a faint scanline crawling along Z over the major lines only.
    const shimmer = sin(p.y.mul(float(0.05)).sub(u_time.mul(float(1.1)).mul(u_motion)))
      .mul(float(0.12))
      .add(float(0.88))
    // THE BREATHING GRID: one global glow swell over ~4 s (both lattices), plus a PULSE RING travelling
    // outward from the camera — a raised crest that sweeps the major lines and fades between passes.
    const glow_breath = sin(phase(GRID_BREATH_HZ)).mul(float(0.12)).add(float(1))
    const pulse = sin(d.mul(float((Math.PI * 2) / GRID_PULSE_WAVELENGTH_M)).sub(phase(GRID_PULSE_HZ)))
    const pulse_gain = smoothstep(float(0.55), float(1), pulse).mul(float(0.45)).add(float(1))
    // colour cycling WITHIN the palette: the minor lattice drifts cyan→violet and the major magenta→gold,
    // in antiphase, so the two lattices never peak on the same hue.
    const cycle = sin(phase(SKY_DRIFT_HZ * 2.7))
      .mul(float(0.5))
      .add(float(0.5))
    const minor_rgb = mix(HACK_GRID_MINOR, HACK_RIDGE_RIM, cycle.mul(float(0.35)))
    const major_rgb = mix(HACK_GRID_MAJOR, HACK_SUN_TOP, float(1).sub(cycle).mul(float(0.22)))
    const minor = minor_rgb.mul(
      lattice_coverage(p, px, MINOR_M, MINOR_HALF_W)
        .mul(float(0.14 * MINOR_GAIN))
        .mul(glow_breath)
        .mul(line_fade)
    )
    const major = major_rgb.mul(
      lattice_coverage(p, px, MAJOR_M, MAJOR_HALF_W)
        .mul(float(0.55 * MAJOR_GAIN))
        .mul(shimmer)
        .mul(glow_breath)
        .mul(pulse_gain)
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
