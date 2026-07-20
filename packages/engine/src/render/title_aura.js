// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TR-5 — the VETERAN TITLE aura: soft LIGHT-BLUE flame/heat wisps licking up around the ROAM avatar.
//
// Technique (the classic scrolled-noise flame, ref frame-driven): 3-5 camera-facing billboard quads
// ringing the body, each running ONE shared node material whose fragment remaps a vertically-scrolled +
// domain-warped procedural value-noise field (two octaves, ported from mana_barrier's wall_noise — zero
// textures, cheapest path) through a licking-tongue envelope into a bright blue-white CORE → translucent
// CYAN falloff with ZERO hard edges (smoothstep both ends). Per-quad `aSeed` decorrelates the wisps so
// the ring reads as a volume, not a repeated card; the whole group yaw-billboards to the camera each
// frame (flames stay vertical) and the quads fan out (±yaw + z-depth jitter) for parallax.
//
// BLENDING (house law): the engine tone-maps through an AgX post stack that CRUSHES additive brights to
// invisibility (see board_vfx.js) — so, exactly like its sibling mana_barrier.js (a translucent glowing
// energy field), this uses NORMAL blending + `toneMapped = false` + bright emissive colour carried in
// ALPHA. That reads "additive-ish" (bright glow over the world) without vanishing under AgX.
//
// PHANTOM-EFFECT LAW: no bare `.discard()` — the whole fragment rides the material's colorNode output
// (Fn → vec4), and the `?auralens=1` debug lens is a BUILD-TIME branch that simply RETURNS a different,
// fully-consumed node (a flat grayscale mask) so the noise field can be eyeballed scrolling.

import { DoubleSide, Mesh, PlaneGeometry, BufferAttribute, Group } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { Fn, abs, attribute, clamp, float, floor, hash, mix, mod, smoothstep, time, uv, vec3, vec4 } from 'three/tsl'

import { CHARACTER_HEIGHT } from '../config/world_config.js'

/** Number of flame wisps ringing the avatar (ref: several licking tongues). Cheap: one shared material. */
const QUAD_COUNT = 5
/** Horizontal spread of the wisps across the body silhouette (world m, ±). ~shoulder width. */
const SPREAD_X = 0.5
/** Depth jitter (world m, ±) so, once yaw-billboarded, the wisps sit at different distances → parallax. */
const JITTER_Z = 0.22
/** Per-quad yaw fan (rad, ±) so the ring isn't a single flat card. */
const FAN_YAW = 0.32
/** Wisp width range (world m). */
const WISP_W_MIN = 0.55
const WISP_W_SPAN = 0.4
/** Wisp height as a multiple of CHARACTER_HEIGHT (ref: ~1.2-1.6× the avatar). */
const WISP_H_MIN = 1.2
const WISP_H_SPAN = 0.45

// ── shader tuning ────────────────────────────────────────────────────────────────────────────────────
const FREQ_X = 3.2 // horizontal noise cells across a wisp
const FREQ_Y = 5.5 // vertical noise cells up a wisp (the flame detail)
const SCROLL = 1.35 // upward scroll speed (noise slides DOWN in uv so the flame appears to rise)
const SWAY_AMP = 0.16 // horizontal lick amplitude at the tip
const SWAY_RATE = 1.3 // lick frequency
const LICK_LO = 0.16 // soft-edge remap floor (below = transparent)
const LICK_HI = 0.62 // soft-edge remap ceiling (above = full core)
const MAX_ALPHA = 0.85 // never fully opaque — it's a translucent flame

/** Light-blue fire palette: cool blue-white core → cyan falloff. */
const COL_FALLOFF = /** @type {[number, number, number]} */ ([0.2, 0.55, 1.0]) // translucent cyan-blue edge
const COL_MID = /** @type {[number, number, number]} */ ([0.45, 0.8, 1.0]) // mid body
const COL_CORE = /** @type {[number, number, number]} */ ([0.85, 0.96, 1.0]) // hot blue-white core

/** Deterministic per-quad pseudo-random in [0,1) — a plain fract(sin) hash (unit-testable, no RNG). */
function quad_rand(/** @type {number} */ i, /** @type {number} */ k) {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453
  return s - Math.floor(s)
}

/**
 * Pure ring layout — the placement of each wisp quad around the avatar's feet. Deterministic (seeded by
 * quad index) so a headless test can assert count, anchoring and value ranges without a GPU. Origin is
 * the FEET (y=0); each quad's geometry is built bottom-anchored so the flame rises from the ground.
 * @param {number} count how many wisps @param {number} height CHARACTER_HEIGHT
 * @returns {{ x: number, z: number, yaw: number, w: number, h: number, seed: number }[]}
 */
export function aura_quad_layout(count = QUAD_COUNT, height = CHARACTER_HEIGHT) {
  const out = []
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? (i + 0.5) / count : 0.5 // spread evenly across the silhouette
    out.push({
      x: (t - 0.5) * 2 * SPREAD_X,
      z: (quad_rand(i, 3) - 0.5) * 2 * JITTER_Z,
      yaw: (quad_rand(i, 4) - 0.5) * 2 * FAN_YAW,
      w: WISP_W_MIN + quad_rand(i, 2) * WISP_W_SPAN,
      h: height * (WISP_H_MIN + quad_rand(i, 1) * WISP_H_SPAN),
      seed: quad_rand(i, 5),
    })
  }
  return out
}

/** [mana_barrier port] 2-D value noise in [0,1) over an integer lattice (PCG hash per corner + smoothstep
 *  bilinear). Pure TSL, zero textures. @param {*} px @param {*} py @param {number} salt */
function value_noise(px, py, salt) {
  const x0 = floor(px)
  const y0 = floor(py)
  const ux = smoothstep(float(0), float(1), px.sub(x0))
  const uy = smoothstep(float(0), float(1), py.sub(y0))
  const hs = /** @param {*} x @param {*} y */ (x, y) =>
    hash(
      mod(float(x), float(289))
        .mul(float(3746.1393))
        .add(mod(float(y), float(289)).mul(float(6682.65263)))
        .add(float(salt * 1013.904223 + 71))
    )
  return mix(mix(hs(x0, y0), hs(x0.add(1), y0), ux), mix(hs(x0, y0.add(1)), hs(x0.add(1), y0.add(1)), ux), uy)
}

/** Build the ONE shared flame material. @param {boolean} lens `?auralens=1` — flat grayscale mask. */
function make_flame_material(lens) {
  const mat = new MeshBasicNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false // a translucent glow never occludes; terrain still occludes it (depthTest on)
  mat.side = DoubleSide
  mat.toneMapped = false // keep the light-blue neon from being crushed by the AgX post stack (mana_barrier law)

  const suv = /** @type {any} */ (uv()) // plane UV: x across (0..1), y up (0..1)
  const seed = /** @type {any} */ (attribute('aSeed', 'float'))

  const frag = Fn(() => {
    // tip lick: horizontal sway that grows with height (base steady, tip whips) — seed-phased per wisp.
    const sway = suv.y
      .mul(suv.y)
      .mul(time.mul(SWAY_RATE).add(seed.mul(6.2831)).sin())
      .mul(SWAY_AMP)
    const cx = suv.x.sub(0.5).sub(sway) // centred, swayed horizontal coordinate

    // DOMAIN WARP (a slow field bends the churn coords so the flame BOILS, not laminar lanes).
    const warp = value_noise(
      suv.x
        .mul(float(3))
        .add(seed.mul(float(10)))
        .add(time.mul(float(0.3))),
      suv.y.mul(float(2)).sub(time.mul(float(0.5))),
      2
    )
    const wx = suv.x
      .mul(float(FREQ_X))
      .add(warp.sub(0.5).mul(float(1.5)))
      .add(seed.mul(float(7)))
    const wy = suv.y
      .mul(float(FREQ_Y))
      .sub(time.mul(float(SCROLL)))
      .add(warp.sub(0.5).mul(float(1.2)))
      .add(seed.mul(float(3)))
    // two octaves of scrolling value noise = the flame churn.
    const n1 = value_noise(wx, wy, 0)
    const n2 = value_noise(
      wx.mul(float(2.1)).add(seed.mul(float(3))),
      wy.mul(float(1.9)).sub(time.mul(float(SCROLL * 1.4))),
      1
    )
    const noise = n1.mul(float(0.6)).add(n2.mul(float(0.4)))

    // licking-tongue envelope: horizontal body narrows to a point up top; vertical rises fast then dies
    // to zero at the crest (no top edge). Soft everywhere.
    const half_w = mix(float(0.42), float(0.05), suv.y) // narrows with height → a tongue tip
    const body = float(1).sub(smoothstep(float(0), half_w, cx.abs()))
    const rise = smoothstep(float(0), float(0.07), suv.y) // soft ground junction
    const fall = float(1).sub(smoothstep(float(0.5), float(1), suv.y)) // dissolve before the top edge
    const vert = rise.mul(fall)

    // remap the shaped noise into a soft flame intensity (smoothstep both ends = ZERO hard edges).
    const raw = noise.mul(vert).mul(body)
    const intensity = smoothstep(float(LICK_LO), float(LICK_HI), raw)

    if (lens) return vec4(vec3(intensity, intensity, intensity), float(1)) // ?auralens=1 — flat mask to eyeball the scroll

    // colour: translucent cyan-blue edge → mid body → hot blue-white core.
    let col = /** @type {any} */ (
      mix(vec3(...COL_FALLOFF), vec3(...COL_MID), smoothstep(float(0), float(0.5), intensity))
    )
    col = mix(col, vec3(...COL_CORE), smoothstep(float(0.55), float(0.95), intensity))
    return vec4(col, clamp(intensity.mul(float(MAX_ALPHA)), float(0), float(MAX_ALPHA)))
  })

  mat.colorNode = frag()
  return mat
}

/**
 * @typedef {object} TitleAura
 * @property {Group} object3d the aura root — add via engine.add_to_scene and place at the avatar's FEET
 *   each frame (its origin is the feet; flames rise from y=0).
 * @property {(camera: import('three').Camera | null | undefined) => void} update yaw-billboards the ring
 *   to face the camera (flames stay vertical). The scroll animates for free off the global `time` node.
 * @property {(active: boolean) => void} set_active show/hide the whole aura (the title-slot gate).
 * @property {() => void} dispose free the geometries + the shared material.
 */

/**
 * Create the veteran-title flame aura. Cheap: `count` bottom-anchored plane quads sharing ONE procedural
 * flame material, under a yaw-billboarded group. Starts HIDDEN (set_active(true) to show).
 * @param {object} [opts]
 * @param {number} [opts.height] avatar height the wisps scale to (default CHARACTER_HEIGHT).
 * @param {number} [opts.count] wisp count (default 5).
 * @param {boolean} [opts.lens] force the `?auralens=1` debug mask (tests/bench); otherwise read from the URL.
 * @returns {TitleAura}
 */
export function create_title_aura({ height = CHARACTER_HEIGHT, count = QUAD_COUNT, lens = undefined } = {}) {
  const use_lens =
    lens !== undefined
      ? lens
      : typeof location !== 'undefined' && new URLSearchParams(location.search).get('auralens') === '1'

  const root = new Group()
  root.name = 'title_aura'
  root.visible = false // gated on by set_active (the title-slot check)

  const material = make_flame_material(use_lens)
  /** @type {PlaneGeometry[]} */
  const geometries = []

  for (const q of aura_quad_layout(count, height)) {
    const geo = new PlaneGeometry(q.w, q.h)
    geo.translate(0, q.h / 2, 0) // bottom edge at y=0 → the wisp rises from the feet
    // constant per-quad seed on all 4 verts → decorrelates each wisp's noise (the material reads aSeed).
    geo.setAttribute('aSeed', new BufferAttribute(new Float32Array([q.seed, q.seed, q.seed, q.seed]), 1))
    const mesh = new Mesh(geo, material)
    mesh.position.set(q.x, 0, q.z)
    mesh.rotation.y = q.yaw
    mesh.frustumCulled = false // the group is re-posed every frame; its static bounds lie
    root.add(mesh)
    geometries.push(geo)
  }

  return {
    object3d: root,
    update(camera) {
      if (!root.visible || !camera) return
      // yaw-billboard: face the group's +Z (the planes' normal) at the camera on the horizontal plane so
      // the wisps stay vertical (a full sprite-billboard would tip the flames over).
      const dx = camera.position.x - root.position.x
      const dz = camera.position.z - root.position.z
      root.rotation.y = Math.atan2(dx, dz)
    },
    set_active(active) {
      root.visible = !!active
    },
    dispose() {
      for (const g of geometries) g.dispose()
      material.dispose()
    },
  }
}
