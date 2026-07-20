// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// F1 — headless regression for the FLAGSHIP 3D cast player (phase 2: every layer is a GPU-particle preset, the
// sprite sheets are deleted). Proves the invariants that outlived the sprite→preset swap:
//   • the beat composes caster-cell + windup + a MOVING projectile at t0, then impact + a lingering remnant LOOP
//     on the land (the 5-layer cast), all as 3D preset Groups (no sprite meshes).
//   • the deferred dispose: a finished preset leaves the scene NOW and is disposed on the NEXT tick, so the
//     engine's separate render rAF never walks a torn-down node graph mid transparent-pass.
//   • the moving-emitter primitive: the projectile's world position rides its `origin` uniform along the arc/skyfall.
//   • the sheet-scale floor re-pinned to the 3D magnitude: a sub-1 hit never shrinks the preset below its authored scale.
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TextureLoader, Vector3 } from 'three'
import { PRESETS } from '@aresrpg/engine3/vfx'

import {
  burst_vfx,
  cast_vfx,
  is_burst_element,
  remnant_life,
  SKYFALL_CONE_DEG,
  skyfall_chaos,
  traj_arc,
  traj_skyfall,
} from './fight_cast_vfx.js'
import { BEAT, BURST_VFX, CAST_VFX, variant_layer } from './vfx_map.js'
import { variant_for } from './vfx_variants.js'

/** A headless fake-env for the self-driven rAF cast beat: a manual clock, a manual rAF pump (`tick(dt)` advances
 *  the clock and drains queued callbacks), and a recording engine. `create_vfx_preset` builds real preset Groups
 *  headlessly (no GPU until render), so the beat runs end-to-end. Returns `{ engine, tick, added, removed, restore }`;
 *  ALWAYS call restore() in a finally. */
function make_fake_env() {
  const load_orig = TextureLoader.prototype.load
  const raf_orig = globalThis.requestAnimationFrame
  const caf_orig = globalThis.cancelAnimationFrame
  const now_orig = performance.now
  TextureLoader.prototype.load = () => /** @type {any} */ ({ colorSpace: '', matrix: {}, dispose() {} })
  let clock = 0
  performance.now = () => clock
  let queued = /** @type {((t: number) => void)[]} */ ([])
  globalThis.requestAnimationFrame = /** @type {any} */ ((cb) => (queued.push(cb), queued.length))
  globalThis.cancelAnimationFrame = /** @type {any} */ (() => {})
  const tick = (/** @type {number} */ dt) => {
    clock += dt
    const cbs = queued
    queued = []
    for (const cb of cbs) cb(clock)
  }
  const added = /** @type {any[]} */ ([])
  const removed = /** @type {any[]} */ ([])
  const engine = {
    add_to_scene: (/** @type {any} */ o) => added.push(o),
    remove_from_scene: (/** @type {any} */ o) => removed.push(o),
    get_camera: () => null,
  }
  const restore = () => {
    TextureLoader.prototype.load = load_orig
    performance.now = now_orig
    globalThis.requestAnimationFrame = raf_orig
    globalThis.cancelAnimationFrame = caf_orig
  }
  return { engine, tick, added, removed, restore }
}

/** The live WORLD position of a mounted preset (it rides the `origin` uniform, NOT root.position). @param {any} g */
const origin_of = (g) => g.userData.origin.value

describe('is_burst_element — the adapter routing verdict (one home with the map art tables)', () => {
  it('burst elements (impact-only, no windup/orb) vs full-beat cast elements', () => {
    // BURSTS: earth = the ground eruption; death = the KO soul-burst; weapon = the no-arc melee slash.
    for (const el of ['earth', 'death', 'weapon']) expect(is_burst_element(el)).toBe(true)
    // FULL BEATS (and fallbacks): all five house cast elements carry their own projectile preset; a burst routing
    // here would fake a projectile. 'nope' is unknown → not a burst (it normalises to the neutral cast beat).
    for (const el of ['fire', 'water', 'air', 'neutral', 'heal', 'nope']) expect(is_burst_element(el)).toBe(false)
  })
})

describe('trajectory families — position at stage-time k (the choreography the moving emitter follows)', () => {
  const from = [0, 1.2, 0]
  const to = [4, 1.2, 6]

  it('PROJECTILE-ARC lobs caster→target: k=0 at caster, k=1 exactly on target, k=0.5 bowed up by arc_h', () => {
    const arc_h = 1.4
    expect(traj_arc(from, to, 0, arc_h, new Vector3()).toArray()).toEqual([0, 1.2, 0])
    const end = traj_arc(from, to, 1, arc_h, new Vector3())
    expect(end.x).toBeCloseTo(4)
    expect(end.z).toBeCloseTo(6)
    expect(end.y).toBeCloseTo(1.2) // sin(π)=0 ⇒ contact lands EXACTLY on `to` (the impact clock)
    const mid = traj_arc(from, to, 0.5, arc_h, new Vector3())
    expect(mid.x).toBeCloseTo(2)
    expect(mid.z).toBeCloseTo(3)
    expect(mid.y).toBeCloseTo(1.2 + arc_h) // peak of the sine bow
  })

  it('SKY-FALL drops onto the target: k=0 sky_h above, k=1 contact on target, accelerating (1−k²) between', () => {
    const sky = 10
    expect(traj_skyfall(to, 0, sky, new Vector3()).y).toBeCloseTo(1.2 + sky)
    expect(traj_skyfall(to, 0.5, sky, new Vector3()).y).toBeCloseTo(1.2 + sky * 0.75)
    const hit = traj_skyfall(to, 1, sky, new Vector3())
    expect(hit.y).toBeCloseTo(1.2)
    expect(hit.x).toBeCloseTo(4)
    expect(hit.z).toBeCloseTo(6)
  })

  it('SKY-FALL contact is chaos-proof: even the WILDEST chaos knobs still land exactly on `to` at k=1', () => {
    const sky = 10
    const wild = { azimuth: 2.7, tilt: 0.999, bow_dir: -1, bow_k: 1 } // max tilt + max bow, off-axis azimuth
    const hit = traj_skyfall(to, 1, sky, new Vector3(), wild)
    expect(hit.x).toBeCloseTo(4)
    expect(hit.y).toBeCloseTo(1.2)
    expect(hit.z).toBeCloseTo(6)
  })
})

describe('SKY-FALL CHAOS — top-hemisphere cone + bow, deterministic per-cast (a straight-line drop reads mechanical; the fix reads more chaotic)', () => {
  const to = [4, 1.2, 6]
  const sky = 10
  const cone_rad = (SKYFALL_CONE_DEG * Math.PI) / 180
  const max_radius = Math.tan(cone_rad) * sky // the birth point's furthest allowed horizontal offset from `to`

  it('the RED case: distinct cast seeds do NOT all birth the orb dead-overhead in a straight line', () => {
    const seeds = Array.from({ length: 16 }, (_, i) => `cast-${i}:fireball`)
    const origins = seeds.map((seed) => {
      const p = traj_skyfall(to, 0, sky, new Vector3(), skyfall_chaos(seed))
      return { x: p.x, z: p.z }
    })
    // NOT collinear/identical: the straight-line bug spawned every one of these at exactly (to[0], to[2]).
    const distinct = new Set(origins.map((o) => `${o.x.toFixed(3)},${o.z.toFixed(3)}`))
    expect(distinct.size).toBeGreaterThan(1) // fails red against the old dead-overhead formula
    expect(distinct.size).toBeGreaterThanOrEqual(Math.ceil(seeds.length * 0.8)) // genuinely varied, not a fluke pair

    // spread, not a fluke pair: the furthest two sampled origins are meaningfully apart.
    let max_dist = 0
    for (const a of origins)
      for (const b of origins) max_dist = Math.max(max_dist, Math.hypot(a.x - b.x, a.z - b.z))
    expect(max_dist).toBeGreaterThan(sky * 0.1)

    // CONE BOUND (angle limits): every birth point stays within SKYFALL_CONE_DEG of dead-vertical over `to`.
    for (const o of origins) {
      const radius = Math.hypot(o.x - to[0], o.z - to[2])
      expect(radius).toBeLessThanOrEqual(max_radius + 1e-9)
    }
  })

  it('the birth point vertical height is UNCHANGED by chaos — still exactly sky_h above the target', () => {
    for (const seed of ['a', 'b', 'c', 'd'])
      expect(traj_skyfall(to, 0, sky, new Vector3(), skyfall_chaos(seed)).y).toBeCloseTo(1.2 + sky)
  })

  it('skyfall_chaos is deterministic: the SAME seed always yields the SAME knobs (reproducible, not Math.random)', () => {
    expect(skyfall_chaos('cast-7:fireball')).toEqual(skyfall_chaos('cast-7:fireball'))
  })

  it('skyfall_chaos knobs stay in their documented ranges', () => {
    for (let i = 0; i < 20; i += 1) {
      const c = skyfall_chaos(`range-check-${i}`)
      expect(c.azimuth).toBeGreaterThanOrEqual(0)
      expect(c.azimuth).toBeLessThan(Math.PI * 2)
      expect(c.tilt).toBeGreaterThanOrEqual(0)
      expect(c.tilt).toBeLessThan(1)
      expect([-1, 1]).toContain(c.bow_dir)
      expect(c.bow_k).toBeGreaterThanOrEqual(0)
      expect(c.bow_k).toBeLessThan(1)
    }
  })
})

describe('cast_vfx — dispose ordering (no use-after-free across the engine render loop)', () => {
  it('removes a finished preset from the scene BEFORE disposing it, and defers the dispose by one frame', () => {
    const env = make_fake_env()
    try {
      const from = /** @type {[number,number,number]} */ ([0, 1.2, 0])
      const to = /** @type {[number,number,number]} */ ([3, 1.2, 0])
      cast_vfx({ engine: /** @type {any} */ (env.engine), from, to, element: 'fire' })
      // construction mounts windup + caster-cell + projectile (all added immediately, as 3D preset Groups).
      expect(env.added.length).toBe(3)
      const windup = env.added[0]
      expect(windup.name).toMatch(/^vfx_/) // a preset root Group, not a sprite mesh
      expect(windup.material).toBeUndefined()
      // listen for the windup's material dispose (handle.dispose frees each emitter material).
      let mat_disposed = false
      windup.children[0].material.addEventListener('dispose', () => (mat_disposed = true))

      // advance past the windup's life (BEAT.flare_s=0.45s) but before the projectile's (travel_s=0.55s).
      env.tick(470)
      expect(env.removed).toContain(windup) // left the scene THIS frame …
      expect(mat_disposed).toBe(false) // … but its material is NOT freed the same frame (deferred)

      env.tick(20) // the next tick's flush disposes what left the scene last frame.
      expect(mat_disposed).toBe(true)
    } finally {
      env.restore()
    }
  })
})

describe('cast_vfx — the 5-layer stack (caster-cell · delivery · impact · remnant) on ONE beat clock', () => {
  it('composes caster-cell + windup + orb at t0, then impact + a lingering remnant LOOP on the land', () => {
    const env = make_fake_env()
    try {
      let done = 0
      const from = /** @type {[number,number,number]} */ ([0, 1.2, 0])
      const to = /** @type {[number,number,number]} */ ([4, 1.2, 6])
      cast_vfx({ engine: /** @type {any} */ (env.engine), from, to, element: 'fire', on_done: () => (done += 1) })

      // LAYER 1+2+DELIVERY: construction mounts caster-cell + windup + orb together (3 preset Groups).
      expect(env.added.length).toBe(3)
      const caster_cell = env.added[1] // spawn order: windup(0), caster_cell(1), orb(2)
      expect(origin_of(caster_cell).x).toBeCloseTo(from[0]) // anchored on the CASTER's cell …
      expect(origin_of(caster_cell).z).toBeCloseTo(from[2])
      expect(origin_of(caster_cell).y).toBeCloseTo(from[1] - BEAT.ground_drop) // … dropped to the feet (a ground pulse)

      // one frame past the projectile's travel (BEAT.travel_s) fires the land → IMPACT + REMNANT mount together.
      env.tick(BEAT.travel_s * 1000 + 20)
      expect(env.added.length).toBe(5)
      const impact = env.added[3]
      const remnant = env.added[4]
      expect(impact.name).toMatch(/^vfx_impact_/) // fire's impact is the shared Hit-pack preset (impact_05), tinted
      expect(remnant.name).toBe('vfx_remnant_fire') // the element residue LOOP
      expect(remnant.userData.loop).toBe(true) // it's a persistent loop, not a one-shot
      expect(origin_of(remnant).x).toBeCloseTo(to[0]) // on the STRIKE cell, not the caster
      expect(origin_of(remnant).z).toBeCloseTo(to[2])

      // LIFECYCLE: the impact preset (impact_05, 1.3 s) ends before the remnant (2.4 s); on_done gates on the
      // REMNANT clearing (it outlives the whole beat), and its dispose is deferred one idle tick.
      env.tick(1400) // → ~1.97 s: impact past its 1.3 s duration; remnant (2.4 s) lingers on
      expect(env.removed).toContain(impact)
      expect(env.removed).not.toContain(remnant)
      expect(done).toBe(0)

      env.tick(1150) // → ~3.12 s: past the remnant's 2.4 s window; it drops from the scene
      expect(env.removed).toContain(remnant)
      expect(done).toBe(0) // its dispose flushes on the NEXT idle tick (deferred-dispose invariant)

      env.tick(20) // the final flush → the beat is fully torn down
      expect(done).toBe(1) // on_done fires ONLY once the lingering remnant is gone
    } finally {
      env.restore()
    }
  })

  it('the projectile is a MOVING emitter: EVERY cast SKY-FALLS the orb from high above the target, within the chaos cone', () => {
    const from = /** @type {[number,number,number]} */ ([0, 1.2, 0])
    const to = /** @type {[number,number,number]} */ ([4, 1.2, 6])
    const max_radius = Math.tan((SKYFALL_CONE_DEG * Math.PI) / 180) * BEAT.sky_h
    // AIR = skyfall: the comet's origin spawns HIGH over the target, inside
    // a top-hemisphere cone around it (no longer pinned dead-center over the column — that read as
    // mechanical), never further out than the cone's radius at BEAT.sky_h.
    const air = make_fake_env()
    try {
      cast_vfx({ engine: /** @type {any} */ (air.engine), from, to, element: 'air' })
      air.tick(16) // one frame runs the orb's step (drives its origin uniform)
      const orb = air.added[2]
      expect(origin_of(orb).y).toBeGreaterThan(to[1] + 8) // dropping from ~BEAT.sky_h (10) above the target
      const radius = Math.hypot(origin_of(orb).x - to[0], origin_of(orb).z - to[2])
      expect(radius).toBeLessThanOrEqual(max_radius + 1e-9) // within the cone, not necessarily dead-center anymore
    } finally {
      air.restore()
    }
    // FIRE = skyfall NOW too (cast effects drop from the sky for ALL casts, not just
    // air; fire/water/neutral/heal used to lob 'arc' up from the caster). The meteor is born high over the target.
    const fire = make_fake_env()
    try {
      cast_vfx({ engine: /** @type {any} */ (fire.engine), from, to, element: 'fire' })
      fire.tick(16)
      const orb = fire.added[2]
      expect(origin_of(orb).y).toBeGreaterThan(to[1] + 8) // spawns from ~sky_h above the target, like air
      const radius = Math.hypot(origin_of(orb).x - to[0], origin_of(orb).z - to[2])
      expect(radius).toBeLessThanOrEqual(max_radius + 1e-9)
    } finally {
      fire.restore()
    }
  })

  it('consecutive REAL casts (same from/to/element/spell) arrive from VISIBLY DIFFERENT directions', () => {
    const from = /** @type {[number,number,number]} */ ([0, 1.2, 0])
    const to = /** @type {[number,number,number]} */ ([4, 1.2, 6])
    const spell = { id: 'fireball', classType: 'senshi', element: 'fire', role: 'damage' }
    const xz = () => {
      const env = make_fake_env()
      try {
        cast_vfx({ engine: /** @type {any} */ (env.engine), from, to, element: 'fire', spell })
        env.tick(16)
        const orb = env.added[2]
        return { x: origin_of(orb).x, z: origin_of(orb).z }
      } finally {
        env.restore()
      }
    }
    const samples = Array.from({ length: 8 }, xz)
    const distinct = new Set(samples.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`))
    // the old dead-overhead formula would collapse every one of these to the SAME (to[0], to[2]) column.
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('the moving orb sets a non-zero TRAVEL velocity so its trail sheds a world-static wake', () => {
    const env = make_fake_env()
    try {
      cast_vfx({ engine: /** @type {any} */ (env.engine), from: [0, 1.2, 0], to: [4, 1.2, 6], element: 'fire' })
      env.tick(16) // frame 1: origin set, prev seeded (travel still 0 — no previous sample yet)
      env.tick(16) // frame 2: travel = (origin − prev)/dt → non-zero along the fall
      const orb = env.added[2]
      expect(orb.userData.travel.value.length()).toBeGreaterThan(0)
    } finally {
      env.restore()
    }
  })
})

describe('sheet-scale floor re-pinned to the 3D magnitude (2026-07-11) — the preset never shrinks below its authored scale', () => {
  it('cast_vfx: a sub-1 magnitude (a near-zero-effect cast) still mounts the windup at its FLOORED authored scale', () => {
    const env = make_fake_env()
    try {
      cast_vfx({ engine: /** @type {any} */ (env.engine), from: [0, 1.2, 0], to: [4, 1.2, 6], element: 'fire', magnitude: 0.5 })
      // magnitude floors to 1; scale = max(1, m/4 · 1). For fire windup m=3.4 → 0.85 → floored to 1.
      expect(env.added[0].userData.scale).toBeCloseTo(Math.max(1, (CAST_VFX.fire.windup.m / 4) * 1))
    } finally {
      env.restore()
    }
  })
  it('cast_vfx: a magnitude ABOVE 1 (a real nuke) grows the impact_big preset past its authored scale', () => {
    const env = make_fake_env()
    try {
      // magnitude 1.5 ≥ IMPACT_BIG_AT (1.25) → the impact_big preset (ground_explosion_01), scale = m/4 · 1.5.
      cast_vfx({ engine: /** @type {any} */ (env.engine), from: [0, 1.2, 0], to: [4, 1.2, 6], element: 'fire', magnitude: 1.5 })
      env.tick(BEAT.travel_s * 1000 + 20) // land → the impact preset mounts (added[3])
      const impact = env.added[3]
      expect(impact.name).toBe('vfx_ground_explosion_01') // the heavy-hit swap
      expect(impact.userData.scale).toBeCloseTo(Math.max(1, (CAST_VFX.fire.impact_big.m / 4) * 1.5))
      expect(impact.userData.scale).toBeGreaterThan(1) // genuinely grown, not floored
    } finally {
      env.restore()
    }
  })
  it('burst_vfx: a sub-1 magnitude burst (death, contact_s=0 — fires immediately) floors at the authored scale too', () => {
    const env = make_fake_env()
    try {
      burst_vfx({ engine: /** @type {any} */ (env.engine), at: [4, 1.2, 6], element: 'death', magnitude: 0.7 })
      const burst = env.added[0]
      expect(burst.name).toBe('vfx_soul_death') // the 3D KO burst, not a sprite
      expect(burst.userData.scale).toBeCloseTo(Math.max(1, (BURST_VFX.death.m / 4) * 1))
    } finally {
      env.restore()
    }
  })
})

describe('remnant reduced-motion policy', () => {
  it('remnant_life caps the linger SHORTER under reduced motion, else keeps the row duration', () => {
    expect(remnant_life(2.4, false)).toBe(2.4)
    expect(remnant_life(2.4, true)).toBe(1.0) // capped to REMNANT_REDUCED_S
    expect(remnant_life(0.8, true)).toBe(0.8) // already shorter than the cap → unchanged
  })

  it('under prefers-reduced-motion the remnant lingers a shorter window (gone well before its 2.4 s row duration)', () => {
    const g = /** @type {any} */ (globalThis)
    const win_orig = g.window
    g.window = { matchMedia: () => ({ matches: true }) } // prefers-reduced-motion: reduce → reduced_motion() true
    const env = make_fake_env()
    try {
      cast_vfx({ engine: /** @type {any} */ (env.engine), from: [0, 1.2, 0], to: [4, 1.2, 6], element: 'fire' })
      env.tick(BEAT.travel_s * 1000 + 20) // → the land mounts the remnant (added[4])
      const remnant = env.added[4]
      env.tick(1150) // ~1.15 s past the land → past the 1.0 s reduced linger (a full 2.4 s remnant would still be live)
      expect(env.removed).toContain(remnant)
    } finally {
      env.restore()
      if (win_orig === undefined) delete g.window
      else g.window = win_orig
    }
  })
})

// [b_spell] the per-spell VFX-variety WIRE (this lane): cast_vfx swaps the ORB layer to a spell's mapped variant
// preset (vfx_variants.variant_for), PRESETS-guarded so an unmapped/missing name keeps the element default orb.
describe('cast_vfx — per-spell ORB variant swap (b_spell wiring)', () => {
  const from = /** @type {[number,number,number]} */ ([0, 1.2, 0])
  const to = /** @type {[number,number,number]} */ ([4, 1.2, 6])
  // the projectile is added THIRD (windup 0, caster-cell 1, orb 2) for every element that ships a caster_cell.
  const orb_name = (/** @type {any} */ env) => env.added[2].name

  it('a MAPPED spell swaps the orb to its variant preset; an UNMAPPED spell keeps the element default; no spell = default', () => {
    // MAPPED: a senshi fire damage spell → elem_variant_fire_bolt (a real ElementalMagic bolt).
    const fire = make_fake_env()
    try {
      cast_vfx({
        engine: /** @type {any} */ (fire.engine),
        from,
        to,
        element: 'fire',
        spell: { id: 'senshi_fire_test', classType: 'senshi', element: 'fire', role: 'damage' },
      })
      expect(orb_name(fire)).toBe('vfx_elem_variant_fire_bolt')
    } finally {
      fire.restore()
    }

    // UNMAPPED: water damage → variant_for returns null → the orb keeps the element default (bolt_water), never null.
    const water = make_fake_env()
    try {
      cast_vfx({
        engine: /** @type {any} */ (water.engine),
        from,
        to,
        element: 'water',
        spell: { id: 'x_water', element: 'water', role: 'damage' },
      })
      expect(orb_name(water)).toBe('vfx_bolt_water')
    } finally {
      water.restore()
    }

    // NO spell param (back-compat: a mob / legacy caller) → the element default orb.
    const bare = make_fake_env()
    try {
      cast_vfx({ engine: /** @type {any} */ (bare.engine), from, to, element: 'fire' })
      expect(orb_name(bare)).toBe('vfx_bolt_fire')
    } finally {
      bare.restore()
    }
  })

  it('the YAJIN necromancer family plays a DarkMagic orb (class-driven, element-agnostic)', () => {
    const env = make_fake_env()
    try {
      cast_vfx({
        engine: /** @type {any} */ (env.engine),
        from,
        to,
        element: 'neutral',
        spell: { id: 'yajin_soul_test', classType: 'yajin', element: 'neutral', role: 'damage' },
      })
      // classType wins over element: a yajin cast plays a dark orb (hash-picked tint), not the neutral bolt.
      expect(orb_name(env)).toMatch(/^vfx_dark_orb_(black|evil|void)$/)
    } finally {
      env.restore()
    }
  })

  it('a nonsense spell object never null-orbs — the PRESETS guard falls back to the element default', () => {
    const env = make_fake_env()
    try {
      cast_vfx({
        engine: /** @type {any} */ (env.engine),
        from,
        to,
        element: 'neutral',
        spell: { id: 'nonsense', element: 'nonelement', role: 'nonrole' },
      })
      expect(orb_name(env)).toBe('vfx_bolt_neutral')
    } finally {
      env.restore()
    }
  })
})

// [b_spell] DELIVERY-LAYER ROUTING (this lane): variant_layer classifies a variant by name suffix into the cast
// layer it belongs on — an orb-class rides the projectile (above), a ZONE-class (*_area / *_zone_) drops a GROUND
// decal on the target cell while the orb stays the element default, a STRIKE-class (air_zap_strike_*) fires on the
// IMPACT beat. PRESETS-guarded throughout; the 67-test orb-class beat stays untouched.
describe('cast_vfx — delivery-layer routing (zone → ground, strike → impact, orb unchanged)', () => {
  const from = /** @type {[number,number,number]} */ ([0, 1.2, 0])
  const to = /** @type {[number,number,number]} */ ([4, 1.2, 6])

  it('variant_layer classifies by name suffix: *_area / *_zone_ → zone, *_strike_ → strike, else orb', () => {
    expect(variant_layer('elem_variant_fire_area')).toBe('zone')
    expect(variant_layer('dark_zone_void')).toBe('zone')
    expect(variant_layer('air_zap_strike_03')).toBe('strike')
    expect(variant_layer('elem_variant_fire_bolt')).toBe('orb')
    expect(variant_layer('dark_orb_black')).toBe('orb')
    expect(variant_layer('air_bolt_orb_02')).toBe('orb')
    expect(variant_layer('flame_variant_void')).toBe('orb')
    expect(variant_layer(null)).toBe('orb') // no variant → default orb
  })

  it('a ZONE-class variant drops a GROUND decal on the target cell and KEEPS the element default orb', () => {
    const env = make_fake_env()
    try {
      // fire + role 'glyph' → variant_for = elem_variant_fire_area (a zone-class magic-circle ground zone).
      cast_vfx({
        engine: /** @type {any} */ (env.engine),
        from,
        to,
        element: 'fire',
        spell: { id: 'x_fire_glyph', element: 'fire', role: 'glyph' },
      })
      // the traveling orb STAYS the element default (bolt_fire) — a ground zone must never ride the projectile.
      expect(env.added[2].name).toBe('vfx_bolt_fire')
      env.tick(BEAT.travel_s * 1000 + 20) // land → impact + remnant + the zone variant all mount
      const zone = env.added.find((o) => o.name === 'vfx_elem_variant_fire_area')
      expect(zone).toBeDefined() // the zone variant mounted as its OWN layer …
      expect(origin_of(zone).x).toBeCloseTo(to[0]) // … on the STRIKE cell (the target), not the caster
      expect(origin_of(zone).z).toBeCloseTo(to[2])
      expect(origin_of(zone).y).toBeCloseTo(to[1] - BEAT.ground_drop) // ground-anchored (dropped to the cell floor)
    } finally {
      env.restore()
    }
  })

  it('a STRIKE-class variant (air_zap_strike_*) fires on the IMPACT beat, not as the traveling orb', () => {
    const env = make_fake_env()
    try {
      // air + role 'push' → variant_for = air_zap_strike_0N (the skyfall lightning-strike delivery).
      cast_vfx({
        engine: /** @type {any} */ (env.engine),
        from,
        to,
        element: 'air',
        spell: { id: 'x_air_push', element: 'air', role: 'push' },
      })
      expect(env.added[2].name).toBe('vfx_bolt_air') // orb stays the element default — the strike is NOT the orb
      env.tick(BEAT.travel_s * 1000 + 20) // land → the strike variant fires on the impact beat
      const strike = env.added.find((o) => /^vfx_air_zap_strike_0[1-6]$/.test(o.name))
      expect(strike).toBeDefined()
      expect(origin_of(strike).x).toBeCloseTo(to[0]) // on the target cell
      expect(origin_of(strike).z).toBeCloseTo(to[2])
    } finally {
      env.restore()
    }
  })

  it('an ORB-class variant still swaps the projectile and mounts NO extra delivery layer (67-class unchanged)', () => {
    const env = make_fake_env()
    try {
      // fire + role 'damage' → elem_variant_fire_bolt (orb-class): the orb swaps, no ground/strike layer added.
      cast_vfx({
        engine: /** @type {any} */ (env.engine),
        from,
        to,
        element: 'fire',
        spell: { id: 'x_fire_dmg', element: 'fire', role: 'damage' },
      })
      expect(env.added[2].name).toBe('vfx_elem_variant_fire_bolt') // the orb IS the variant
      env.tick(BEAT.travel_s * 1000 + 20)
      // exactly the 5-layer beat (windup · caster_cell · orb · impact · remnant) — no 6th delivery layer.
      expect(env.added.length).toBe(5)
    } finally {
      env.restore()
    }
  })
})

describe('b_spell variant selector ↔ engine PRESETS (merge-drift regression guard)', () => {
  // EVERY name variant_for can emit, hand-derived from vfx_variants.js — the merge (DARK/AIR/ELEM/FLAME → PRESETS)
  // must back each one, or a live cast would silently fall back. Mirrors the STEP-0 runtime gate as a standing test.
  const tints = ['black', 'evil', 'void']
  const nn = ['01', '02', '03', '04', '05', '06']
  const REACHABLE = [
    ...tints.flatMap((t) => [`dark_orb_${t}`, `dark_bolt_${t}`, `dark_zone_${t}`]),
    ...nn.flatMap((n) => [`air_bolt_orb_${n}`, `air_zap_strike_${n}`]),
    'elem_variant_electric_bolt',
    'elem_variant_electric_area',
    'elem_variant_fire_bolt',
    'elem_variant_fire_area',
    'elem_variant_nature_bolt',
    'elem_variant_nature_area',
    'flame_variant_void',
    'flame_variant_green',
    'flame_variant_cold',
    'flame_variant_light',
    'flame_variant_purple',
  ]

  it('every reachable variant name is a real merged preset', () => {
    const missing = REACHABLE.filter((n) => !(n in PRESETS))
    expect(missing, `unresolved variant presets: ${missing.join(', ')}`).toEqual([])
    expect(REACHABLE.length).toBe(32)
  })

  it('over the whole 240-spell corpus, every produced variant resolves in PRESETS (no typos, no merge gaps)', () => {
    const dir = join(import.meta.dir, '../../../../seed/mainnet/spells')
    let total = 0
    let mapped = 0
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const arr = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      for (const s of Array.isArray(arr) ? arr : Object.values(arr)) {
        total += 1
        const v = variant_for(s)
        if (v == null) continue
        mapped += 1
        expect(v in PRESETS, `${s.id} → ${v} must resolve in PRESETS`).toBe(true)
      }
    }
    expect(total).toBe(240)
    expect(mapped).toBeGreaterThan(150) // the majority of the book gets a real variant orb
  })
})
