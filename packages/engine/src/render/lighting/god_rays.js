// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PHYSICALLY-BASED GOD RAYS — shadow-map-gated volumetric in-scatter (Hillaire-style single-scatter
// raymarch), the CONTRAST-not-density cure for the froxel/addon whiteout that was parked default-OFF.
//
// WHY THE OLD ONE WASHED OUT (the "white-halo post-mortem"): three's addon GodraysNode accumulates an
// ISOTROPIC `1 − exp(−Σ lit·density·dist)` along the whole camera→depth ray. With no phase term and no
// height falloff, ANY lit view — an open clearing, a downward framing — integrates to a milky veil that
// fills the frame. The CPU `godray_gain.js` band-aids it by fading shafts at the framings that blow out.
//
// THIS MODULE fixes it at the source with the mechanism that was named (and the linked WebGPU thread
// demonstrates), so an open clearing adds ≈ZERO veil while cave mouths / canopy holes glow:
//   1. PER-SAMPLE SUN SHADOW-MAP GATING — each raymarch sample adds in-scatter ONLY where the sun's
//      shadow map says sunlight reaches that air (`lit∈{0,1}`). Shadowed air contributes nothing, so a
//      cave stays dark and a shaft through a hole glows. Samples outside the shadow frustum count as
//      UNLIT (bounds the effect to the shadow-mapped near field — far haze is the fog's job).
//   2. HENYEY-GREENSTEIN FORWARD PHASE (g≈0.7) — a per-RAY scalar `phase(rd·sun)`: rays bloom sharply
//      looking toward the sun and collapse ~40× looking off-sun. This is the "look away → gone" proof and
//      the reason an off-sun open view integrates to nothing regardless of how much air is lit.
//   3. LOW DENSITY with HEIGHT FALLOFF — `σ(y)=density·exp(−(y−ground)/H)`. Density lives near the ground
//      (caves/canopy) and thins with altitude, so an upward/open view leaves the dense layer within a few
//      metres and its veil integral collapses. Contrast (lit vs shadowed), not density, makes rays visible.
//   4. SUN COLOUR/INTENSITY INHERITED — `u_sun_color` is fed the transmittance-filtered Hillaire sun
//      (sky_light_coupling's coupled sun radiance), so dawn rays are warm and noon rays white: ONE sun,
//      never a second disagreeing light.
//
// SELF-CONTAINED: emits a bare `in_scatter` vec3 TSL node the post stack ADDS to its HDR colour (inside
// its existing half-res rtt), plus live-tunable uniforms + `update()`/`dispose()`. No render target of its
// own (nothing to leak — dispose is a safe no-op). Shadow access mirrors the proven three-good-godrays
// idiom (`lightShadowMatrix` + depthTexture `.compare`); world rays are rebuilt from the SCENE camera's
// own uniforms (never the post quad's ortho camera — the quad-camera trap). Perspective depth only.
//
// TSL/naga discipline: ONE flat march Loop (build-time step count = the quality knob), a single shallow
// `If` for the frustum gate, no unrolled chains (nowhere near the ~127 nesting cliff), no `discard` (the
// output mixes to zero via the phase/lit terms). The pure JS twins below (hg_phase / height_density /
// integrate_inscatter) are what the shader mirrors and god_rays.test.js pins against a brute-force RTE.

import { Vector3 } from 'three'
import {
  Fn,
  If,
  Loop,
  dot,
  exp,
  float,
  getViewPosition,
  length,
  lightShadowMatrix,
  max,
  min,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'

const FOUR_PI = 4 * Math.PI

/** Physically-grounded defaults — LOW density + forward phase so an open view integrates to ≈0. All are
 *  live uniforms (except `steps`, a build-time Loop bound = the adaptive quality knob). */
export const GODRAYS_DEFAULTS = Object.freeze({
  /** base extinction/scatter coefficient at ground level (1/m). Deliberately LOW so an open view's veil
   *  integral stays ≈0 (the non-washout law): the optical depth over a whole ray must NOT saturate
   *  — rays appear from shadow CONTRAST, not from thick air. */
  density: 0.008,
  /** Henyey-Greenstein asymmetry g∈(0,1): forward-peaked so shafts bloom toward the sun and an off-sun
   *  view scatters ~40× less — the veil in a clearing (never looking into the sun) is near-nil. Kept in the
   *  target 0.5–0.7 band. */
  g: 0.7,
  /** height falloff scale (m): σ decays e-fold every H metres above `ground_y` (near-ground haze only). */
  falloff_h: 16,
  /** altitude (world m) at/below which density is full — the ground plane the near-haze layer sits on. */
  ground_y: 0,
  /** overall in-scatter gain multiplied into the final radiance (taste; the cave-contrast brightness). */
  strength: 0.18,
  /** march cap (m): the ray integrates at most this far (the near field the shadow map covers). */
  max_dist: 130,
  /** raymarch step count (build-time Loop bound; 48 = cheap default, bump per quality tier). */
  steps: 48,
})

/**
 * Henyey-Greenstein phase function — the normalised angular scattering probability. Forward-peaked for
 * g>0 (`cos_theta`→1 bright), back-scatter tiny (`cos_theta`→−1). Integrates to 1 over the sphere.
 * The TSL shader mirrors this exactly (per-ray scalar of `dot(view_dir, sun_dir)`).
 * @param {number} cos_theta cosine between the VIEW ray and the direction TO the sun, [-1,1]
 * @param {number} g asymmetry parameter, (-1,1) — 0 isotropic, →1 sharply forward
 * @returns {number} phase value (1/sr)
 */
export function hg_phase(cos_theta, g) {
  const g2 = g * g
  const denom = Math.pow(Math.max(1e-6, 1 + g2 - 2 * g * cos_theta), 1.5)
  return (1 - g2) / (FOUR_PI * denom)
}

/**
 * Height-falloff extinction (1/m) at world altitude `y`: full `base` at/below `ground_y`, decaying e-fold
 * every `falloff_h` metres above it. The near-ground haze layer that makes cave/canopy shafts visible and
 * an open upward view fade to nothing. Monotonic non-increasing in `y`. Twin of the shader's `σ` term.
 * @param {number} y world-space altitude of the sample (m)
 * @param {number} [base] ground density (1/m)
 * @param {number} [ground_y] base altitude (m)
 * @param {number} [falloff_h] e-fold height (m)
 * @returns {number} extinction at `y` (1/m)
 */
export function height_density(
  y,
  base = GODRAYS_DEFAULTS.density,
  ground_y = GODRAYS_DEFAULTS.ground_y,
  falloff_h = GODRAYS_DEFAULTS.falloff_h
) {
  return base * Math.exp(-Math.max(0, y - ground_y) / Math.max(1e-6, falloff_h))
}

/**
 * Front-to-back single-scatter integral along a ray of homogeneous `dt` segments — the exact reducer the
 * shader's Loop performs. For each segment (nearest first) the in-scatter added is `σ·lit·T_mid·dt` (light
 * scattered toward the eye, attenuated by the transmittance to the segment MIDPOINT `T_mid = T·exp(−σ·dt/2)`),
 * then `T ·= exp(−σ·dt)`. The midpoint transmittance makes this a 2nd-order (midpoint-rule) quadrature, so
 * the cheap default step count is accurate to a fraction of a percent instead of a left-Riemann 5% bias.
 * `lit∈[0,1]` is the sun-shadow visibility of that air. The caller multiplies the returned `L` by the
 * (per-ray) phase, the sun colour and the strength — those factor out of the integral.
 * @param {{sigma:number, lit:number}[]} segments nearest-first samples (σ in 1/m, lit visibility)
 * @param {number} dt segment length (m)
 * @returns {{L:number, T:number}} L = geometric in-scatter (pre-phase/colour), T = surviving transmittance
 */
export function integrate_inscatter(segments, dt) {
  let T = 1
  let L = 0
  for (const s of segments) {
    const sigma = Math.max(0, s.sigma)
    const lit = s.lit < 0 ? 0 : s.lit > 1 ? 1 : s.lit
    const half = Math.exp(-sigma * dt * 0.5)
    L += sigma * lit * (T * half) * dt // in-scatter at the segment midpoint transmittance
    T *= half * half // = exp(−σ·dt) — full-segment extinction
  }
  return { L, T }
}

/**
 * @typedef {object} GodRaysOptions
 * @property {import('three').DirectionalLight} light the shadow-casting sun (its `shadow.map` MUST exist
 *   at build time — render one shadow frame first, exactly as post_stack defers its mount until then).
 * @property {import('three').Camera} camera the SCENE camera (never the post quad camera — world rays are
 *   rebuilt from this camera's own matrices to dodge the quad-camera trap).
 * @property {*} scene_depth a depth TextureNode (perspective NDC depth), e.g. `pass(scene,camera).getTextureNode('depth')`.
 * @property {number[]} [sun_direction] initial unit direction TO the sun [x,y,z] (share sky_node's).
 * @property {number[]} [sun_color] initial sun radiance (colour×intensity, linear) — the coupled Hillaire sun.
 * @property {number} [density] @property {number} [g] @property {number} [falloff_h] @property {number} [ground_y]
 * @property {number} [strength] @property {number} [max_dist] @property {number} [steps] see {@link GODRAYS_DEFAULTS}.
 */

/**
 * Build the physically-based god-rays in-scatter node for one directional sun. Returns a bare `in_scatter`
 * vec3 (add it to the HDR colour), the live uniforms, and `update()`/`dispose()`.
 * @param {GodRaysOptions} opts
 */
export function create_god_rays(opts) {
  const { light, camera, scene_depth } = opts
  if (!light?.shadow?.map?.depthTexture) {
    throw new Error(
      'create_god_rays: light.shadow.map.depthTexture missing — render one shadow frame before building (see post_stack deferred-mount).'
    )
  }
  const D = GODRAYS_DEFAULTS
  const steps = Math.max(1, Math.floor(opts.steps ?? D.steps))

  // ── live uniforms (taste + the coupled sun) ────────────────────────────────────────────────────────
  const u_density = uniform(float(opts.density ?? D.density))
  const u_g = uniform(float(opts.g ?? D.g))
  const u_falloff_h = uniform(float(opts.falloff_h ?? D.falloff_h))
  const u_ground_y = uniform(float(opts.ground_y ?? D.ground_y))
  const u_strength = uniform(float(opts.strength ?? D.strength))
  const u_max_dist = uniform(float(opts.max_dist ?? D.max_dist))
  const u_sun_direction = uniform(new Vector3(...(opts.sun_direction ?? [0.5, 0.9, 0.25])).normalize())
  const u_sun_color = uniform(new Vector3(...(opts.sun_color ?? [1, 0.95, 0.88])))

  // ── scene-camera uniforms (rebuild world rays from the REAL camera, not the post quad's ortho cam) ──
  // matrixWorld / projectionMatrixInverse are live three objects → the UniformNode reads their current
  // value every frame; only the world position is extracted explicitly in update() (mirrors the addon).
  const u_cam_world = uniform(camera.matrixWorld)
  const u_cam_proj_inv = uniform(camera.projectionMatrixInverse)
  const u_cam_pos = uniform(new Vector3().setFromMatrixPosition(camera.matrixWorld))

  const shadow_map = light.shadow.map.depthTexture

  /** HG phase as a TSL scalar — exact mirror of {@link hg_phase}. */
  const hg_phase_tsl = (/** @type {*} */ cos_theta, /** @type {*} */ g) => {
    const g2 = g.mul(g)
    const denom = max(float(1e-6), float(1).add(g2).sub(g.mul(cos_theta).mul(2))).pow(1.5)
    return float(1).sub(g2).div(denom.mul(FOUR_PI))
  }

  // ── the in-scatter node ────────────────────────────────────────────────────────────────────────────
  const in_scatter = Fn(() => {
    const uv_node = uv()
    const depth = scene_depth.sample(uv_node).r
    // reconstruct the world-space depth hit from the SCENE camera (vec4 wrap = dimension-safe for either
    // getViewPosition return shape). The march runs camera→hit, capped at max_dist (the shadow near field).
    const view_pos = getViewPosition(uv_node, depth, u_cam_proj_inv)
    const world_hit = u_cam_world.mul(vec4(view_pos.xyz, 1)).xyz

    const ro = u_cam_pos
    const to_hit = world_hit.sub(ro)
    const hit_dist = length(to_hit)
    const rd = to_hit.div(max(hit_dist, float(1e-3))) // normalised view ray (world)
    const march_len = min(hit_dist, u_max_dist)
    const dt = march_len.div(float(steps))

    // per-RAY forward-scatter phase (the "look away → gone" gate): dot(view ray, direction to the sun).
    const cos_theta = dot(rd, u_sun_direction.normalize())
    const phase = hg_phase_tsl(cos_theta, u_g)

    const T = float(1).toVar() // surviving transmittance camera→sample
    const L = float(0).toVar() // accumulated geometric in-scatter (pre-phase/colour)

    Loop(steps, ({ i }) => {
      const t = float(i).add(0.5).mul(dt) // segment midpoint
      const p = ro.add(rd.mul(t))
      // height-falloff extinction (mirror of height_density): full at/below ground, e-fold every H up.
      const rel_y = max(float(0), p.y.sub(u_ground_y))
      const sigma = u_density.mul(exp(rel_y.div(u_falloff_h).negate()))

      // per-sample SUN SHADOW-MAP gate — lit=1 where the sun reaches this air, 0 in shadow / out-of-frustum.
      // three's lightShadowMatrix bakes the world→[0,1] uv+depth bias, so `scc` is already in [0,1]; the
      // texture fetch wants y flipped (the proven three-good-godrays idiom).
      const sc = lightShadowMatrix(light).mul(vec4(p, 1))
      const scc = sc.xyz.div(sc.w)
      const s = vec3(scc.x, scc.y.oneMinus(), scc.z)
      const lit = float(0).toVar()
      const inside = s.x
        .greaterThanEqual(0)
        .and(s.x.lessThanEqual(1))
        .and(s.y.greaterThanEqual(0))
        .and(s.y.lessThanEqual(1))
        .and(s.z.greaterThanEqual(0))
        .and(s.z.lessThanEqual(1))
      If(inside, () => {
        // .compare(z) returns 1 when the fragment passes the depth test (LIT), 0 when occluded (SHADOW).
        lit.assign(texture(shadow_map, s.xy).compare(s.z).r)
      })

      // front-to-back accumulate (mirror of integrate_inscatter): add lit in-scatter at the segment
      // MIDPOINT transmittance (2nd-order — cheap steps stay accurate), then extinct the full segment.
      const half = exp(sigma.mul(dt).mul(-0.5))
      L.addAssign(sigma.mul(lit).mul(T.mul(half)).mul(dt))
      T.mulAssign(half.mul(half))
    })

    // radiance = geometric integral × forward phase × sun colour × strength (colour/phase factor out).
    return u_sun_color.mul(L).mul(phase).mul(u_strength)
  })()

  let disposed = false

  return {
    /** vec3 TSL node: the shadow-gated, HG-phased in-scatter radiance. ADD it to the HDR scene colour. */
    in_scatter,
    // live-tunable knobs (probe slider / window.__godrays / owner tuning)
    u_density,
    u_g,
    u_falloff_h,
    u_ground_y,
    u_strength,
    u_max_dist,
    u_sun_direction,
    u_sun_color,
    /** build-time march resolution (adaptive quality knob; rebuild to change). */
    steps,

    /**
     * Per-frame refresh: the coupled sun (direction + colour from sky_light_coupling) and the scene
     * camera world position (matrices auto-sync via their live uniform refs).
     * @param {{ sun_direction?: number[], sun_color?: number[] }} [frame]
     */
    update(frame = {}) {
      if (disposed) return
      if (frame.sun_direction)
        u_sun_direction.value.set(frame.sun_direction[0], frame.sun_direction[1], frame.sun_direction[2])
      if (frame.sun_color) u_sun_color.value.set(frame.sun_color[0], frame.sun_color[1], frame.sun_color[2])
      u_cam_pos.value.setFromMatrixPosition(camera.matrixWorld)
    },

    /** No render target is held (bare node), so this only latches the update() guard — safe to call twice. */
    dispose() {
      disposed = true
    },
  }
}
