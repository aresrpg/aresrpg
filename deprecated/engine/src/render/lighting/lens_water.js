// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Wet-lens GPU graph. The field/lifecycle math lives in lens_water_field.js. apply(source, false)
// is the exact dry identity; apply(source, true) preserves the established film/bead/trail graph.

import { Vector4 } from 'three'
import {
  Fn,
  Loop,
  cos,
  exp,
  float,
  length,
  rtt,
  screenUV,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import {
  LENS_WATER,
  build_droplets,
  build_trails,
  burst_shape,
  decay_intensity,
  droplet_alpha,
  droplet_life_fade,
  droplet_state_at,
  film_amp_at,
  film_front_y,
  meniscus_bump,
  rand01,
  region_cut,
  region_level,
  region_noise,
  sheet_envelope,
  trail_center_x,
  trail_edge_rag,
  trail_halfwidth,
  trail_life_fade,
  trail_state_at,
} from './lens_water_field.js'

// Re-export the pure field surface so importers (post_stack, the probe, tsl_smoke, the CPU-twin capture,
// and the test) keep a single `./lens_water.js` entry point across the round-7 module split.
export {
  LENS_WATER,
  rand01,
  decay_intensity,
  film_front_y,
  sheet_envelope,
  film_amp_at,
  region_noise,
  region_cut,
  region_level,
  droplet_life_fade,
  droplet_alpha,
  burst_shape,
  build_droplets,
  droplet_state_at,
  trail_life_fade,
  build_trails,
  trail_state_at,
  trail_center_x,
  trail_halfwidth,
  trail_edge_rag,
  meniscus_bump,
}

/**
 * @typedef {object} LensWaterPass
 * @property {(final_node: *, wet?: boolean) => *} apply wraps the finished display-space vec4 — call ONCE, last, in
 *   post_stack's build_output (after sharpen). Re-callable on a graph rebuild (godrays remount): disposes
 *   its previous rtt first, mirroring post_stack's own cloud_rtt rebuild idiom.
 * @property {() => void} update per-frame: advances the decay/film/bead/trail clock (self-clocked via
 *   performance.now()). No-op forever until the first `splash()`.
 * @property {() => void} splash reseeds the field (beads + trails) and spikes intensity to 1 — call on the
 *   underwater exit edge (`underwater.just_exited()`), never on entry.
 * @property {*} intensity `uniform(float)` — the live global envelope (0 = fully inactive/identity).
 * @property {() => void} dispose releases the wrapped rtt's render target.
 */

/**
 * Builds the lens-water pass (pure node-graph construction; nothing renders until the pipeline does).
 * Wire `apply()` into post_stack's build_output, `update()`+the underwater exit check into its per-frame
 * update(), and `dispose()` into its dispose() — the exact god-rays integration shape.
 * @param {object} [opts]
 * @param {import('../../core/quality/tiers.js').TierName} [opts.tier] quality tier — LOW trims the bead/
 *   splinter/trail counts (same math, cheaper loops); every other tier gets the full field.
 * @returns {LensWaterPass}
 */
export function create_lens_water({ tier = 'high' } = {}) {
  const low = tier === 'low'
  const primary = low ? LENS_WATER.count_low : LENS_WATER.count
  const splinter_count = low ? Math.round(LENS_WATER.splinter_slots / 2) : LENS_WATER.splinter_slots
  const trail_count = low ? Math.round(LENS_WATER.trail_slots / 2) : LENS_WATER.trail_slots
  const bead_count = primary + splinter_count // one flat loop over beads + their ejecta splinters

  let seed = 0
  let drops = build_droplets(seed, primary, splinter_count)
  let trails = build_trails(drops, seed, trail_count)
  let t_since_splash = /** @type {number | null} */ (null) // null = never triggered ⇒ fully inactive
  let last_frame_ms = 0
  let primed = false
  let disposed = false

  const u_intensity = uniform(0)
  const u_film_t = uniform(0) // the film clock (s since splash) — drives advection + the drain front
  // Packed per-bead GPU state: vec4(x, y, radius, alpha), refreshed every update() from droplet_state_at().
  const packed = Array.from({ length: bead_count }, () => new Vector4(0, 0, 0, 0))
  const u_droplets = uniformArray(packed, 'vec4')
  // Packed per-trail GPU state: vec4(x, y_top, length, alpha), refreshed from trail_state_at().
  const packed_trails = Array.from({ length: trail_count }, () => new Vector4(0, 0, 0, 0))
  const u_trails = uniformArray(packed_trails, 'vec4')

  /** @param {number} t */
  const sync_packed = (t) => {
    for (let i = 0; i < bead_count; i += 1) {
      const s = droplet_state_at(drops[i], t)
      packed[i].set(s.x, LENS_WATER.flip_y ? 1 - s.y : s.y, s.radius, s.alpha)
    }
    for (let i = 0; i < trail_count; i += 1) {
      const tr = trail_state_at(trails[i], t)
      packed_trails[i].set(tr.x, LENS_WATER.flip_y ? 1 - tr.y_top : tr.y_top, tr.length, tr.alpha)
    }
  }

  /** @type {*} */ let frame_rtt = null

  /** @type {LensWaterPass['apply']} */
  const apply = (final_node, wet = true) => {
    if (!wet) return final_node
    frame_rtt?.renderTarget?.dispose?.() // rebuild safety (godrays-remount reruns build_output — cloud_rtt idiom)
    frame_rtt = rtt(final_node)
    const frame = frame_rtt
    const glint_dir = vec2(LENS_WATER.glint_dir[0], LENS_WATER.glint_dir[1])
    const [f0, f1, f2] = LENS_WATER.film_freq
    const [k0, k1] = LENS_WATER.finger_freq
    return Fn(() => {
      const uvn = screenUV
      const t = u_film_t
      // ── FILM (round-9 — THE WET SHEET): the wide 2-axis noise field, ADVECTED DOWNWARD as always, but
      // its AMPLITUDE opens at sheet_amp (full-frame "looking through water") and recedes to the subtle
      // film_amp base via the sheet envelope, while COVERAGE fragments through the region field. Every
      // formula below mirrors its pure twin in lens_water_field.js term-for-term.
      const adv = uvn.y.sub(t.mul(LENS_WATER.film_flow_speed)) // pattern coordinate flowing down
      const n1 = sin(uvn.x.mul(f0).add(adv.mul(f1)).add(t.mul(0.9)))
        .mul(sin(adv.mul(f2).sub(uvn.x.mul(1.7))))
        .add(sin(uvn.x.mul(f2).add(adv.mul(2.6)).add(t.mul(1.3))).mul(0.5))
      const n2 = cos(uvn.x.mul(f1).sub(adv.mul(f0)).add(t.mul(1.1)))
        .mul(cos(adv.mul(f1).add(uvn.x.mul(2.3))))
        .add(cos(uvn.x.mul(f0).sub(adv.mul(3.1))).mul(0.5))
      const patch = float(1).sub(
        sin(uvn.x.mul(2.1).add(1.7))
          .mul(sin(adv.mul(1.6).add(0.6)))
          .mul(0.5)
          .add(0.5)
          .mul(LENS_WATER.patch_gain)
      )
      // top-first macro drain front (unchanged round-4/6 law), fingered edge
      const front = t.sub(float(LENS_WATER.drain_start)).mul(LENS_WATER.drain_speed)
      const fingers = sin(uvn.x.mul(k0).add(2.0))
        .add(sin(uvn.x.mul(k1)).mul(0.6))
        .mul(LENS_WATER.finger_amp)
      const band = float(LENS_WATER.drain_band)
      const front_main = front.sub(fingers)
      const wet_main = smoothstep(front_main.sub(band), front_main.add(band), uvn.y)
      // round-9 REGION field — mirror of region_noise/region_cut/region_level: coverage fragments into
      // irregular fluid patches as the cut climbs (the straight sin stream columns died here).
      const region_n = sin(uvn.x.mul(6.3).add(1.7))
        .mul(cos(uvn.y.mul(5.1).add(0.4)))
        .add(
          sin(uvn.x.mul(13.1).add(uvn.y.mul(3.7)).add(2.9))
            .mul(cos(uvn.y.mul(11.7).sub(uvn.x.mul(2.3)).add(1.1)))
            .mul(0.55)
        )
        .add(
          sin(uvn.x.mul(27.9).sub(uvn.y.mul(7.1)).add(4.2))
            .mul(cos(uvn.y.mul(23.3).add(uvn.x.mul(5.9))))
            .mul(0.3)
        )
        .div(2.6) // practical-range normalization + clamp — mirrors region_noise (see its twin note)
        .add(0.5)
        .max(float(0))
        .min(float(1))
      const region_p = t
        .sub(float(LENS_WATER.sheet_hold))
        .div(LENS_WATER.region_end - LENS_WATER.sheet_hold)
        .max(float(0))
        .min(float(1))
      const r_cut = region_p.mul(1 + 2 * LENS_WATER.region_band).sub(LENS_WATER.region_band)
      const region = smoothstep(r_cut, r_cut.add(LENS_WATER.region_band), region_n)
      const wet = wet_main.mul(region).mul(patch)
      const edge = smoothstep(float(0.25), float(0.55), length(uvn.sub(vec2(0.5, 0.5))))
        .mul(LENS_WATER.edge_gain)
        .add(1)
      const env = sqrt(u_intensity) // the field rides √intensity (linear buried it mid-window); √0 = 0
      // sheet envelope (mirror of sheet_envelope/film_amp_at): sheet_amp at t=0 → film_amp base by ~1.35s
      const sheet_env = smoothstep(
        float(LENS_WATER.sheet_hold),
        float(LENS_WATER.sheet_hold + LENS_WATER.sheet_fade),
        t
      ).oneMinus()
      const amp_t = float(LENS_WATER.film_amp).add(sheet_env.mul(LENS_WATER.sheet_amp - LENS_WATER.film_amp))
      const film_amp_now = amp_t.mul(env).mul(wet).mul(edge)
      const film_off = vec2(n1.mul(0.45), n2.mul(0.6).add(LENS_WATER.film_down_bias)).mul(film_amp_now)

      // Shared accumulators — the bead loop AND the trail loop add into these, then one shared sampling tail.
      const acc_offset = vec2(0, 0).toVar()
      const acc_darken = float(0).toVar()
      const acc_glint = float(0).toVar()
      // round-9 specular SHEEN: a soft glisten riding the film noise inside wet regions — strongest during
      // the sheet phase (0.35 floor keeps surviving patches faintly glistening through the breakup, so wet
      // regions READ as wet). Additive, but gated by wet × env ⇒ exactly 0 when inactive (identity holds).
      acc_glint.addAssign(
        smoothstep(float(0.55), float(1.4), n1)
          .mul(LENS_WATER.sheen_strength)
          .mul(wet)
          .mul(sheet_env.mul(0.65).add(0.35))
      )

      // ── BEAD LOOP (round-6 dome-lens over the round-7 dense/bursting field). FLAT, one shallow level —
      // the naga ~127-nesting law: a uniformArray read + straight-line ALU per bead. Bursts/splinters need
      // NO branch here — they're just a swelling-then-vanishing radius and a fading alpha in the packed data.
      Loop(bead_count, ({ i }) => {
        const d = /** @type {*} */ (u_droplets.element(i))
        const center = vec2(d.x, d.y)
        const R = d.z.max(float(1e-4))
        const alpha = d.w // this bead's own life/burst-fade
        const raw = center.sub(screenUV) // toward the centre = the dome-normal (∇height) direction
        const dist = length(raw)
        // round-8 AMORPHOUS silhouette — term-for-term mirror of meniscus_bump() (2 incommensurate
        // sin·cos octaves, ±26% of R): the outline is a lumpy fluid blob, never a clean circle.
        const ux = raw.x.div(R)
        const uy = raw.y.div(R)
        const bump = sin(ux.mul(LENS_WATER.meniscus_freq).add(d.x.mul(31)))
          .mul(cos(uy.mul(LENS_WATER.meniscus_freq).add(d.y.mul(27))))
          .add(
            sin(ux.mul(6.7).add(d.y.mul(53)))
              .mul(cos(uy.mul(5.3).add(d.x.mul(47))))
              .mul(0.65)
          )
        const r_eff = R.mul(float(1).add(bump.mul(LENS_WATER.meniscus_amp)))
        const local = dist.div(r_eff)
        const inside = smoothstep(float(LENS_WATER.mask_lo), float(LENS_WATER.mask_hi), local).oneMinus()
        const presence = inside.mul(alpha)
        const guard = r_eff.mul(float(LENS_WATER.edge_softness))
        const denom = sqrt(r_eff.mul(r_eff).sub(dist.mul(dist)).max(guard.mul(guard)))
        const dome = r_eff.div(denom)
        acc_offset.addAssign(raw.mul(float(LENS_WATER.refract_eta)).mul(dome).mul(presence))
        const rim = smoothstep(float(0.7), float(0.9), local).mul(
          smoothstep(float(0.9), float(LENS_WATER.mask_hi), local).oneMinus()
        )
        acc_darken.addAssign(rim.mul(alpha).mul(LENS_WATER.rim_darken))
        const gp = center.add(glint_dir.mul(r_eff.mul(float(LENS_WATER.glint_offset))))
        const gd = length(screenUV.sub(gp)).div(r_eff.mul(float(LENS_WATER.glint_width)))
        acc_glint.addAssign(exp(gd.mul(gd).negate()).mul(presence).mul(LENS_WATER.glint_strength))
      })

      // ── TRAIL LOOP (round-7; round-8 FLUID): each packed trail is a wandering wet PATCH STREAM running
      // DOWN from a burst — a CYLINDRICAL lens (same eta/edge_softness dome, bending across-x only) whose
      // centreline MEANDERS (mirror of trail_center_x), whose width PINCHES/BULGES (trail_halfwidth),
      // whose caps are RAGGED (trail_edge_rag), and whose crest is broken into flowing patches. At a frozen
      // frame nothing here is straight. Sibling flat loop, straight-line ALU (naga-shallow).
      Loop(trail_count, ({ i }) => {
        const tr = /** @type {*} */ (u_trails.element(i))
        const t_alpha = tr.w
        // meandering centreline — 3 incommensurate octaves, phases decorrelated per trail by its anchor x
        const p = tr.x.mul(43.75)
        const cx = tr.x.add(
          sin(screenUV.y.mul(9.1).add(p))
            .add(sin(screenUV.y.mul(23.3).add(p.mul(1.93))).mul(0.55))
            .add(sin(screenUV.y.mul(47.7).add(p.mul(3.1))).mul(0.3))
            .mul(LENS_WATER.trail_meander)
        )
        // pinch-and-bulge width along the path — never a constant-width capsule
        const q = tr.x.mul(61.3)
        const w = float(LENS_WATER.trail_width).mul(
          sin(screenUV.y.mul(13.7).add(q))
            .mul(0.6)
            .add(sin(screenUV.y.mul(31.9).add(q.mul(2.3))).mul(0.4))
            .mul(LENS_WATER.trail_width_var)
            .add(1)
        )
        const rx = cx.sub(screenUV.x) // toward the centreline (matches the bead's center-ward convention)
        const across_local = rx.abs().div(w)
        // ragged head/tail caps — the edges wobble across x (never straight horizontal cuts)
        const pr = tr.x.mul(87.7)
        const rag_head = sin(screenUV.x.mul(83).add(pr))
          .add(sin(screenUV.x.mul(197).add(pr.mul(2.7))).mul(0.5))
          .mul(LENS_WATER.trail_rag)
        const pr2 = tr.x.mul(142.95) // 87.7 × 1.63 — tail phases decorrelated from the head
        const rag_tail = sin(screenUV.x.mul(83).add(pr2))
          .add(sin(screenUV.x.mul(197).add(pr2.mul(2.7))).mul(0.5))
          .mul(LENS_WATER.trail_rag)
        const y_top = tr.y.add(rag_head)
        const y_bot = tr.y.add(tr.z).add(rag_tail)
        const cap = float(LENS_WATER.trail_cap)
        const along = smoothstep(y_top.sub(cap), y_top.add(cap), screenUV.y).mul(
          smoothstep(y_bot.add(cap), y_bot.sub(cap), screenUV.y)
        )
        const inside = smoothstep(float(1.0), float(0.75), across_local) // ~1 near centre → 0 at the edge
        const presence = along.mul(inside).mul(t_alpha)
        // CYLINDRICAL dome bend (x only) — the round-3 kernel restricted to the across-column axis
        const t_guard = w.mul(float(LENS_WATER.edge_softness))
        const denom = sqrt(w.mul(w).sub(rx.mul(rx)).max(t_guard.mul(t_guard)))
        const dome = w.div(denom)
        acc_offset.addAssign(
          vec2(
            rx.mul(float(LENS_WATER.refract_eta)).mul(dome).mul(presence),
            /** @type {any} */ (presence.mul(LENS_WATER.trail_drag).mul(w))
          )
        )
        // specular crest along the meandering centre, BROKEN into flowing patches (never a solid stroke)
        const cw = rx.div(w.mul(float(LENS_WATER.trail_crest_w)))
        const crest_mod = sin(screenUV.y.mul(17.3).add(p.mul(1.31)))
          .mul(0.45)
          .add(0.55)
        acc_glint.addAssign(exp(cw.mul(cw).negate()).mul(along).mul(t_alpha).mul(LENS_WATER.trail_crest).mul(crest_mod))
        // thin dark rim at the column edges (multiplicative), like the bead meniscus
        const rim = smoothstep(float(0.72), float(0.9), across_local).mul(
          smoothstep(float(0.9), float(1.0), across_local).oneMinus()
        )
        acc_darken.addAssign(rim.mul(t_alpha).mul(LENS_WATER.trail_rim))
      })

      // ── shared sampling tail — film + bead + trail offsets, one √intensity envelope, one chromatic split.
      const offset = film_off.add(acc_offset.mul(env))
      const s_r = frame.sample(screenUV.add(offset))
      const s_g = frame.sample(screenUV.add(offset.mul(1.006)))
      const s_b = frame.sample(screenUV.add(offset.mul(1.012)))
      const sampled = vec3(s_r.r, s_g.g, s_b.b)
      const darken = acc_darken.mul(env).min(float(LENS_WATER.darken_cap)) // round-10: soft cap (was 0.85) —
      // overlapping rims never go near-black; the flaw reads as a soft lens distortion
      const glint = acc_glint.mul(env).min(float(0.7))
      return vec4(sampled.mul(float(1).sub(darken)).add(vec3(glint, glint, glint)), 1)
    })()
  }

  /** @type {LensWaterPass['splash']} */
  const splash = () => {
    if (disposed) return
    seed = Math.random() * 1000 // vary droplet positions each dunk
    drops = build_droplets(seed, primary, splinter_count)
    trails = build_trails(drops, seed, trail_count)
    t_since_splash = 0
    sync_packed(0)
    u_intensity.value = 1
    u_film_t.value = 0
  }

  /** @type {LensWaterPass['update']} */
  const update = () => {
    // Self-clocked (no dt param — post_stack's per-frame update(camera) doesn't carry one). Frame-rate
    // independent: the decay is a function of ELAPSED wall time, never a per-frame multiply constant.
    const now = typeof performance !== 'undefined' ? performance.now() : last_frame_ms + 16.6
    const dt = primed ? Math.max(0, (now - last_frame_ms) / 1000) : 0
    last_frame_ms = now
    primed = true
    if (disposed || t_since_splash == null) return // never triggered (or already idled out) — stays free
    t_since_splash += dt
    if (t_since_splash > LENS_WATER.max_active_s) {
      // The film is drained and every bead/splinter/trail has certainly finished — park fully inactive.
      t_since_splash = null
      u_intensity.value = 0
      return
    }
    u_intensity.value = decay_intensity(t_since_splash, LENS_WATER.tau)
    u_film_t.value = t_since_splash
    sync_packed(t_since_splash)
  }

  return {
    apply,
    update,
    splash,
    intensity: u_intensity,
    dispose() {
      if (disposed) return
      disposed = true
      frame_rtt?.renderTarget?.dispose?.()
      t_since_splash = null
      u_intensity.value = 0
      u_film_t.value = 0
    },
  }
}
