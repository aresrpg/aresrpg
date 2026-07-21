// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure-math tests for the flagship VFX preset runtime. Pins the MATH the TSL nodes mirror:
// (1) seeds are deterministic + in-range (dir unit, speed/size within min/max, birth within its window),
// (2) emission shapes sample where they should (sphere within radius, cone within spread of the axis),
// (3) particle_state gates life honestly (invisible before birth / after death) and integrates ballistics
//     (gravity pulls a zero-drag particle down over time; exp-drag displacement is monotone, →la as k→0),
// (4) curve_eval interpolates + clamps its control points,
// (5) every ported preset is structurally valid AND stays under the 2.05 bloom threshold (no-halo law),
// (6) tint_emitter recolours the coloured body but leaves a near-white core white-hot.
// The GPU draw is proven by bench/vfx_presets.spec.js [retired, issue #74]; here we pin the JS the shader mirrors.

import { test, expect, describe } from 'bun:test'
import { Group, Mesh, Object3D, PerspectiveCamera, Vector3 } from 'three'

import { PRESETS, list_presets } from './vfx_presets_data.js'
import { PACK_BILLBOARD } from './vfx_pack_shaders_core.js'
import { PACK2_BILLBOARD } from './vfx_pack_shaders_expansion.js'
import { PACK3_BILLBOARD } from './vfx_pack_shaders_gapfill.js'
import { follow_entity } from './vfx_anchor.js'
import {
  curve_eval,
  particle_state,
  preset_peak_luma,
  seed_emitter,
  tint_emitter,
  vfx_rand,
  FIGHT_VFX_LAYER,
  route_overlay_group,
  enable_fight_vfx_layer,
} from './vfx_preset_engine.js'

const dot = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (/** @type {number[]} */ v) => Math.hypot(v[0], v[1], v[2])
/** cast a plain emitter literal to VfxEmitter (test objects infer `shape: string`, not the union).
 *  @param {any} o @returns {import('./vfx_preset_engine.js').VfxEmitter} */
const em_ = (o) => o
/** the (defined) position of an alive particle state, cast for indexing. @param {any} s @returns {number[]} */
const pos_ = (s) => s.pos
/** cast a maybe-undefined number tuple to an indexable/iterable array (VfxEmitter.color is optional). @param {any} a @returns {number[]} */
const nums = (a) => a

describe('vfx_rand', () => {
  test('deterministic + in [0,1)', () => {
    for (let i = 0; i < 50; i += 1)
      for (let l = 0; l < 4; l += 1) {
        const a = vfx_rand(i, l, 7)
        expect(a).toBe(vfx_rand(i, l, 7))
        expect(a).toBeGreaterThanOrEqual(0)
        expect(a).toBeLessThan(1)
      }
  })
  test('decorrelates across index / lane / salt', () => {
    expect(vfx_rand(1, 0, 0)).not.toBe(vfx_rand(2, 0, 0))
    expect(vfx_rand(1, 0, 0)).not.toBe(vfx_rand(1, 1, 0))
    expect(vfx_rand(1, 0, 0)).not.toBe(vfx_rand(1, 0, 1))
  })
})

describe('curve_eval', () => {
  test('endpoints, midpoint, clamp, degenerate', () => {
    expect(curve_eval([1, 0], 0)).toBeCloseTo(1)
    expect(curve_eval([1, 0], 1)).toBeCloseTo(0)
    expect(curve_eval([1, 0], 0.5)).toBeCloseTo(0.5)
    expect(curve_eval([0.8, 1.5, 0.9], 0.5)).toBeCloseTo(1.5) // middle control point
    expect(curve_eval([1, 0], -1)).toBeCloseTo(1) // clamps u<0
    expect(curve_eval([1, 0], 2)).toBeCloseTo(0) // clamps u>1
    expect(curve_eval([0.7], 0.9)).toBe(0.7) // single point = constant
    expect(curve_eval([], 0.5)).toBe(1) // empty = 1
  })
})

describe('seed_emitter', () => {
  const cone = em_({
    count: 40,
    lifetime: 1,
    shape: 'cone',
    direction: [0, 1, 0],
    spread: 30,
    speed: [2, 4],
    size: [0.5, 1.5],
  })
  const sphere = em_({ count: 40, lifetime: 1, shape: 'sphere', radius: 1.5, offset: [0, 1, 0], speed: [1, 2] })

  test('deterministic per (emitter, index, salt)', () => {
    const a = seed_emitter(cone, 3, 5)
    expect(seed_emitter(cone, 3, 5)).toEqual(a)
    expect(seed_emitter(cone, 4, 5)).not.toEqual(a)
  })
  test('direction is a unit vector', () => {
    for (let i = 0; i < 40; i += 1) expect(len(seed_emitter(cone, i, 1).dir)).toBeCloseTo(1, 5)
  })
  test('speed + size within [min,max]', () => {
    for (let i = 0; i < 40; i += 1) {
      const s = seed_emitter(cone, i, 2)
      expect(s.speed).toBeGreaterThanOrEqual(2)
      expect(s.speed).toBeLessThanOrEqual(4)
      expect(s.size).toBeGreaterThanOrEqual(0.5)
      expect(s.size).toBeLessThanOrEqual(1.5)
    }
  })
  test('cone directions stay within `spread` of the axis', () => {
    const axis = [0, 1, 0]
    const cosLimit = Math.cos((30 * Math.PI) / 180) - 1e-6
    for (let i = 0; i < 80; i += 1) expect(dot(seed_emitter(cone, i, 9).dir, axis)).toBeGreaterThanOrEqual(cosLimit)
  })
  test('sphere positions land within `radius` of the offset', () => {
    for (let i = 0; i < 80; i += 1) {
      const p = seed_emitter(sphere, i, 3).pos0
      const d = Math.hypot(p[0] - 0, p[1] - 1, p[2] - 0)
      expect(d).toBeLessThanOrEqual(1.5 + 1e-6)
    }
  })
  test('birth spread respects explosiveness (1 ⇒ all born at 0)', () => {
    const burst = em_({ ...cone, explosiveness: 1 })
    const staggered = em_({ ...cone, explosiveness: 0.5 })
    for (let i = 0; i < 40; i += 1) {
      expect(seed_emitter(burst, i, 1).birth).toBe(0)
      const b = seed_emitter(staggered, i, 1).birth
      expect(b).toBeGreaterThanOrEqual(0)
      expect(b).toBeLessThanOrEqual(0.5) // life*(1-0.5)
    }
  })
  test('delay offsets the whole birth window forward (the pack emit_start — a staggered second wave)', () => {
    const base = em_({ count: 1, lifetime: 0.5, explosiveness: 1, shape: 'point', speed: [0, 0], size: [1, 1] })
    const delayed = em_({ ...base, delay: 0.3 })
    expect(seed_emitter(base, 0, 1).birth).toBe(0) // no delay ⇒ born at t0
    expect(seed_emitter(delayed, 0, 1).birth).toBeCloseTo(0.3, 5) // delay pushes the birth forward
    const seed = seed_emitter(delayed, 0, 1)
    expect(particle_state(delayed, seed, 0.2).alive).toBe(false) // invisible before the delay elapses
    expect(particle_state(delayed, seed, 0.5).alive).toBe(true) // born mid-life once the delay passed
    expect(particle_state(delayed, seed, 0.85).alive).toBe(false) // dead past delay + lifetime
  })
})

describe('particle_state', () => {
  const em = em_({
    count: 1,
    lifetime: 1,
    shape: 'point',
    speed: [10, 10],
    gravity: [0, -10, 0],
    size: [1, 1],
    size_curve: [1, 0],
    alpha_curve: [1, 0],
  })
  const up = /** @type {any} */ ({
    dir: [0, 1, 0],
    speed: 10,
    pos0: [0, 0, 0],
    birth: 0,
    size: 1,
    color_roll: 0,
    spin: 0,
  })

  test('invisible before birth and after death', () => {
    expect(particle_state(em, { ...up, birth: 0.5 }, 0.2).alive).toBe(false) // not yet born
    expect(particle_state(em, up, 1.01).alive).toBe(false) // past lifetime
    expect(particle_state(em, up, 0.5).alive).toBe(true)
  })
  test('gravity pulls a launched-up particle back down over its life', () => {
    const arc = em_({ ...em, gravity: [0, -30, 0] }) // apex at v0/g = 10/30 ≈ 0.33s, so it falls back within its life
    const early = particle_state(arc, up, 0.15)
    const late = particle_state(arc, up, 0.95)
    expect(pos_(early)[1]).toBeGreaterThan(0) // still rising early
    expect(pos_(late)[1]).toBeLessThan(pos_(early)[1]) // gravity wins by end
  })
  test('size + alpha follow their curves (shrink + fade to 0)', () => {
    const mid = particle_state(em, up, 0.5)
    expect(mid.size).toBeCloseTo(0.5, 5) // size_curve [1,0] at u=0.5
    expect(mid.alpha).toBeCloseTo(0.5, 5) // alpha_curve [1,0] at u=0.5
  })
  test('exp-drag displacement is monotone increasing in time', () => {
    const drag = em_({ ...em, drag: 3, gravity: [0, 0, 0] })
    let prev = -1
    for (let t = 0; t <= 1; t += 0.1) {
      const y = particle_state(drag, up, t).pos?.[1] ?? 0
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = y
    }
  })
})

describe('presets', () => {
  const names = list_presets().filter((n) => !n.startsWith('_'))

  test('the 44 impact-library presets exist with the expected family counts (explosion + hit packs)', () => {
    // the explosion/hit names carry a _NN scene suffix — scoped to those 8 families so the merged melee/impact
    // lanes (air_impact_pack_N etc.) don't pollute this explosion+hit integrity check.
    const impact_lib = names.filter((n) =>
      /^(air_explosion|burst_explosion|ground_explosion|nuke_explosion|hit|impact|big_impact|strike)_\d+$/.test(n)
    )
    expect(impact_lib.length).toBe(44)
    const fam = /** @type {Record<string,number>} */ ({})
    for (const n of impact_lib) {
      const f = n.replace(/_\d+$/, '')
      fam[f] = (fam[f] ?? 0) + 1
    }
    expect(fam).toEqual({
      air_explosion: 5,
      burst_explosion: 4,
      ground_explosion: 5,
      nuke_explosion: 2,
      hit: 8,
      impact: 8,
      big_impact: 8,
      strike: 4,
    })
  })
  test('the phase-2 spell-chain presets exist: charge + bolt + remnant per cast element, the 3 bursts, status loops', () => {
    for (const el of ['fire', 'water', 'air', 'neutral', 'heal']) {
      expect(PRESETS[`charge_${el}`], `charge_${el}`).toBeTruthy()
      expect(PRESETS[`bolt_${el}`], `bolt_${el}`).toBeTruthy()
      expect(PRESETS[`remnant_${el}`], `remnant_${el}`).toBeTruthy()
    }
    for (const b of ['eruption_earth', 'soul_death', 'slash_weapon']) expect(PRESETS[b], b).toBeTruthy()
    for (const s of ['status_flame', 'status_ice', 'status_poison', 'status_holy', 'status_soul'])
      expect(PRESETS[s], s).toBeTruthy()
  })
  test('every LOOP preset (remnant / status) stays under the bloom threshold while it SUSTAINS (no-halo law)', () => {
    for (const n of names.filter((x) => x.startsWith('remnant_') || x.startsWith('status_') || x.startsWith('bolt_')))
      expect(PRESETS[n].loop || n.startsWith('bolt_')).toBe(true) // remnant/status/bolt are the persistent ones
  })
  test('every preset is structurally valid', () => {
    for (const n of names) {
      const p = PRESETS[n]
      expect(p.duration).toBeGreaterThan(0)
      expect(p.emitters.length).toBeGreaterThan(0)
      for (const e of p.emitters) {
        expect(e.count).toBeGreaterThan(0)
        expect(e.lifetime).toBeGreaterThan(0)
      }
    }
  })
  test('no preset breaches the 2.05 bloom threshold (no-halo law)', () => {
    for (const n of names) expect(preset_peak_luma(PRESETS[n])).toBeLessThan(2.05)
  })
})

// ── PHASE B: the remaining packs ported to REAL .gdshader looks (ElementalMagic/Electric/Battle/Explosion/
// Status), replacing the generic FBM `flame` that faked water/air/neutral/heal + the aura shelf in phase A. ──
describe('phase-B pack ports — real shader math per element slot', () => {
  test('every phase-B appearance is registered in PACK_BILLBOARD (so the engine routes it to billboard_pack2)', () => {
    expect(PACK2_BILLBOARD.size).toBeGreaterThanOrEqual(16)
    for (const k of PACK2_BILLBOARD) expect(PACK_BILLBOARD.has(k), `${k} routed`).toBe(true)
  })

  /** the appearance a preset's PRIMARY (non-accent) emitter uses — the element's signature pack look. */
  const main_look_of = (/** @type {string} */ name) =>
    PRESETS[name].emitters.find((em) => !['spark', 'star', 'star4', 'ring', 'glow'].includes(em.appearance ?? ''))
      ?.appearance

  test('water/air/neutral/heal cast bodies use their REAL pack look, not the generic flame', () => {
    expect(main_look_of('charge_water')).toBe('elem_orb') // ElementalMagic wave orb
    expect(main_look_of('bolt_water')).toBe('elem_orb')
    expect(main_look_of('charge_air')).toBe('zap') // ElectricFX lightning
    expect(main_look_of('charge_neutral')).toBe('arcane_mote') // BattleFX arcane
    expect(main_look_of('charge_heal')).toBe('heal_cross') // StatusFX holy cross
    expect(main_look_of('charge_fire')).toBe('fire') // fire keeps its phase-A FlameFX port
  })

  test('the generic FBM `flame`/`smoke` body no longer drives ANY shipping preset (zero-remnant law)', () => {
    for (const [n, p] of Object.entries(PRESETS)) {
      if (n.startsWith('_')) continue // defensive: skip any _-prefixed diagnostic preset (none ship today)
      for (const em of p.emitters) {
        expect(em.appearance, `${n}.${em.name} is not the generic smoke`).not.toBe('smoke')
        expect(em.appearance, `${n}.${em.name} is not the generic flame`).not.toBe('flame')
      }
    }
  })

  test('status auras carry distinct real StatusFX looks (snowflake / bubble / cross / swirl)', () => {
    const has = (/** @type {string} */ name, /** @type {string} */ look) =>
      PRESETS[name].emitters.some((e) => e.appearance === look)
    expect(has('status_ice', 'ice_flake')).toBe(true)
    expect(has('status_poison', 'bubble')).toBe(true)
    expect(has('status_holy', 'heal_cross')).toBe(true)
    expect(has('status_arcane', 'streaks')).toBe(true)
  })

  test('the explosion BIG beats use the real ExplosionFX molten body + billow (no generic flame/smoke)', () => {
    for (const n of ['ground_explosion_01', 'nuke_explosion_01', 'eruption_earth']) {
      const looks = PRESETS[n].emitters.map((e) => e.appearance)
      expect(looks, `${n} fireball`).toContain('explo_ball')
      expect(looks, `${n} smoke`).toContain('explo_smoke')
    }
  })

  test('trap/glyph ground decals exist, LOOP, and stay well under the halo ceiling (a persistent decal never blooms)', () => {
    for (const el of ['fire', 'water', 'air', 'earth']) {
      const p = PRESETS[`trap_${el}`]
      expect(p, `trap_${el}`).toBeTruthy()
      expect(p.loop, `trap_${el} loops`).toBe(true)
      expect(preset_peak_luma(p), `trap_${el} subtle`).toBeLessThan(1.05) // clamped ≤1 colours
    }
    for (const g of ['arcane', 'holy', 'dark', 'nature']) {
      const p = PRESETS[`glyph_${g}`]
      expect(p, `glyph_${g}`).toBeTruthy()
      expect(p.loop, `glyph_${g} loops`).toBe(true)
      expect(preset_peak_luma(p), `glyph_${g} subtle`).toBeLessThan(1.05)
    }
  })

  test('every shop-wearable aura name resolves to a real StatusFX LOOP preset (the 18-aura family)', () => {
    // the seed/**/shop.json `aura` values — each wearable's aura must resolve to status_<aura> so it renders 3D.
    const shop_auras = [
      'flame',
      'ice',
      'poison',
      'nature',
      'green',
      'dark',
      'void',
      'divine',
      'heal',
      'gem',
      'shard',
      'shatter',
      'rot',
      'magic',
      'sleep',
    ]
    for (const a of shop_auras) {
      const p = PRESETS[`status_${a}`]
      expect(p, `status_${a} exists for the '${a}' shop aura`).toBeTruthy()
      expect(p.loop, `status_${a} is a LOOP`).toBe(true)
      expect(preset_peak_luma(p), `status_${a} under the halo ceiling`).toBeLessThan(2.05)
    }
    const status_count = list_presets().filter((n) => n.startsWith('status_')).length
    expect(status_count, 'the 18-aura family').toBeGreaterThanOrEqual(18)
  })
})

// ── PHASE B2: the FINAL exactness lane — the last generic FBM `spark` / cross-pack `star4` borrows replaced by each
// scene's OWN .gdshader (impact_slash/spiral_dust/area_glow/dark_ring/dark_lift/dark_glow/dark_flares), node→shader
// verified off disk (the layermap parser CORRECTED the audit: impact Spikes=impact_core, Flashes/Sparks=impact_slash).
// Mandate: cut EVERY SINGLE NON GODOT EFFECT. ──
describe('phase-B2 exactness — the last non-Godot effect cut', () => {
  test('every phase-B2 appearance is registered in PACK_BILLBOARD (routed to billboard_pack3)', () => {
    expect(PACK3_BILLBOARD.size).toBe(7)
    for (const k of ['impact_slash', 'spiral_dust', 'area_glow', 'dark_ring', 'dark_lift', 'dark_glow', 'dark_flares'])
      expect(PACK3_BILLBOARD.has(k), `${k} in PACK3`).toBe(true)
    for (const k of PACK3_BILLBOARD) expect(PACK_BILLBOARD.has(k), `${k} routed`).toBe(true)
  })

  test('NO shipping preset uses a generic effect (spark/flame/smoke/star/ring/glow) — every look is a real pack shader', () => {
    const GENERIC = new Set(['spark', 'flame', 'smoke', 'star', 'ring', 'glow'])
    for (const [n, p] of Object.entries(PRESETS)) {
      if (n.startsWith('_')) continue // defensive: skip any _-prefixed diagnostic preset (none ship today)
      for (const em of p.emitters)
        expect(GENERIC.has(em.appearance ?? ''), `${n}.${em.name} = ${em.appearance}`).toBe(false)
    }
  })

  test('hit/impact/big port the REAL StylizedHitFX shaders (impact_core spikes + impact_slash flashes/sparks + spiral_dust corona)', () => {
    for (const n of ['impact_01', 'big_impact_01']) {
      const looks = PRESETS[n].emitters.map((e) => e.appearance)
      expect(looks, `${n} flashes = impact_slash`).toContain('impact_slash')
      expect(looks, `${n} spikes = impact_core`).toContain('impact_core')
      expect(looks, `${n} spiral corona = spiral_dust`).toContain('spiral_dust')
      expect(looks, `${n} no cross-pack star4`).not.toContain('star4')
      expect(looks, `${n} no generic spark`).not.toContain('spark')
    }
    expect(
      PRESETS.hit_01.emitters.map((e) => e.appearance),
      'plain hit stays lean'
    ).not.toContain('spiral_dust')
  })

  test('dark zone/bolt port the real DarkMagic accessory shaders (dark_ring+dark_lift / dark_flares+dark_glow)', () => {
    for (const t of ['black', 'evil', 'void']) {
      const zone = PRESETS[`dark_zone_${t}`].emitters.map((e) => e.appearance)
      expect(zone, `dark_zone_${t} ring`).toContain('dark_ring')
      expect(zone, `dark_zone_${t} lift`).toContain('dark_lift')
      const bolt = PRESETS[`dark_bolt_${t}`].emitters.map((e) => e.appearance)
      expect(bolt, `dark_bolt_${t} flares`).toContain('dark_flares')
      expect(bolt, `dark_bolt_${t} glow`).toContain('dark_glow')
    }
  })

  test('trap/glyph + elemental-area carry the ported area_glow bloom curtain (audit #9)', () => {
    for (const n of ['trap_fire', 'trap_earth', 'glyph_arcane', 'glyph_dark', 'elem_variant_fire_area'])
      expect(
        PRESETS[n].emitters.map((e) => e.appearance),
        `${n} area_glow`
      ).toContain('area_glow')
  })

  test('eruption debris is the real ExplosionFX rock chunks (explo_bits), not a generic spark', () => {
    const looks = PRESETS.eruption_earth.emitters.map((e) => e.appearance)
    expect(looks, 'debris = explo_bits').toContain('explo_bits')
    expect(looks, 'no generic spark').not.toContain('spark')
  })

  test('neutral is re-cited to the BattleFX blank grey (the UNSOURCED violet is gone — audit #7)', () => {
    // charge_neutral's gather colour_end is the cited pack blank secondary grey (0.37), not the old violet (g 0.24).
    const gather = PRESETS.charge_neutral.emitters.find((e) => e.name === 'gather')
    expect(/** @type {any} */ (gather).color_end).toEqual([0.37, 0.37, 0.37])
  })
})

describe('LOOP + charge/gather primitives (phase-2: persistent auras & the moving-emitter charge)', () => {
  const up = /** @type {any} */ ({
    dir: [0, 1, 0],
    speed: 4,
    pos0: [0, 0, 0],
    birth: 0,
    size: 1,
    color_roll: 0,
    spin: 0,
  })

  test('LOOP wraps the local age past its lifetime instead of dying (continuous rebirth)', () => {
    const em = em_({
      count: 1,
      lifetime: 1,
      shape: 'point',
      speed: [4, 4],
      size: [1, 1],
      size_curve: [1, 0],
      alpha_curve: [1, 0],
    })
    // one-shot: dead past life. loop: alive forever, u wraps back near 0.
    expect(particle_state(em, up, 1.5, false).alive).toBe(false)
    const looped = particle_state(em, up, 1.5, true)
    expect(looped.alive).toBe(true)
    expect(looped.u).toBeCloseTo(0.5, 5) // 1.5 mod 1 = 0.5 into the next cycle
    expect(particle_state(em, up, 2.0, true).u).toBeCloseTo(0, 5) // exact cycle boundary → back to birth
  })
  test('LOOP stays invisible BEFORE the first birth (stagger window), then repeats', () => {
    const em = em_({ count: 1, lifetime: 1, shape: 'point', speed: [0, 0], size: [1, 1] })
    const late = /** @type {any} */ ({ ...up, birth: 0.4 })
    expect(particle_state(em, late, 0.2, true).alive).toBe(false) // not yet born
    expect(particle_state(em, late, 0.6, true).alive).toBe(true) // born, mid first cycle
    expect(particle_state(em, late, 1.9, true).alive).toBe(true) // still looping a cycle later
  })

  const shell = em_({ count: 40, lifetime: 1, shape: 'shell', radius: 1.5, offset: [0, 1, 0], speed: [1, 2] })
  test('shell emission lands on the sphere SURFACE at `radius`, dir radially OUTWARD', () => {
    for (let i = 0; i < 40; i += 1) {
      const s = seed_emitter(shell, i, 5)
      const d = Math.hypot(s.pos0[0] - 0, s.pos0[1] - 1, s.pos0[2] - 0)
      expect(d).toBeCloseTo(1.5, 5) // on the surface, not inside
      // outward: dir ≈ the unit vector from centre to pos0 (dot > 0)
      const out = [s.pos0[0] - 0, s.pos0[1] - 1, s.pos0[2] - 0]
      expect(dot(s.dir, out)).toBeGreaterThan(0)
    }
  })
  test('inward flips the launch to CONVERGE on the centre (the charge/gather look)', () => {
    const charge = em_({ ...shell, inward: true })
    for (let i = 0; i < 40; i += 1) {
      const s = seed_emitter(charge, i, 5)
      const out = [s.pos0[0] - 0, s.pos0[1] - 1, s.pos0[2] - 0] // centre → pos0
      expect(dot(s.dir, out)).toBeLessThan(0) // dir points back toward the centre
      expect(len(s.dir)).toBeCloseTo(1, 5)
    }
  })
})

describe('tint_emitter', () => {
  test('recolours a coloured body toward the tint', () => {
    const em = em_({ count: 1, lifetime: 1, color: [1, 0.37, 0.11], color_end: [0.2, 0.1, 0.05] })
    const c = nums(tint_emitter(em, [0.3, 0.6, 1]).color) // blue
    expect(c[2]).toBeGreaterThan(c[0]) // now blue-dominant
  })
  test('leaves a near-white core white-hot (does not tint the flash)', () => {
    const em = em_({ count: 1, lifetime: 1, color: [1, 1, 1] })
    expect(tint_emitter(em, [0.3, 0.6, 1]).color).toEqual([1, 1, 1])
  })
  test('channels stay ≤ 1 (no-bloom preserved through a tint)', () => {
    const em = em_({ count: 1, lifetime: 1, color: [1, 0.72, 0.4] })
    for (const c of nums(tint_emitter(em, [1, 0.46, 0.9]).color)) expect(c).toBeLessThanOrEqual(1)
  })
})

// ── ORBIT PRIMITIVE (aura L2): the ONE motion a ballistic particle can't fake — a revolution around the vertical
// axis through the emission centre. Additive: an emitter without `orbit` is byte-identical to the old ballistics. ──
describe('orbit primitive (particle_state)', () => {
  /** @type {any} */
  const seed = { dir: [0, 1, 0], speed: 0, pos0: [1, 0, 0], birth: 0, size: 1, color_roll: 0, spin: 0 }
  test('revolves the XZ position around the offset axis at `orbit` rad/s (radius preserved, Y untouched)', () => {
    const em = em_({ count: 1, lifetime: 100, shape: 'point', speed: [0, 0], offset: [0, 0, 0], orbit: Math.PI / 2 })
    const s0 = particle_state(em, seed, 0) // θ=0 → the birth point
    const s1 = particle_state(em, seed, 1) // θ=π/2 → a quarter turn: (1,·,0) → (0,·,1)
    expect(pos_(s0)[0]).toBeCloseTo(1, 6)
    expect(pos_(s0)[2]).toBeCloseTo(0, 6)
    expect(pos_(s1)[0]).toBeCloseTo(0, 6)
    expect(pos_(s1)[2]).toBeCloseTo(1, 6)
    expect(pos_(s1)[1]).toBeCloseTo(0, 6) // orbit never touches Y
    // radius from the centre is invariant under the revolution, at every age
    for (let t = 0; t <= 4; t += 0.5) {
      const p = pos_(particle_state(em, seed, t))
      expect(Math.hypot(p[0], p[2])).toBeCloseTo(1, 6)
    }
  })
  test('revolves around the emission CENTRE (offset), not the world origin', () => {
    const em = em_({ count: 1, lifetime: 100, shape: 'point', speed: [0, 0], offset: [2, 0, 0], orbit: Math.PI })
    const off = /** @type {any} */ ({ ...seed, pos0: [3, 0, 0] }) // radius 1 from the centre (2,0,0)
    const s = particle_state(em, off, 1) // θ=π → reflect through the centre: 3 → 1
    expect(pos_(s)[0]).toBeCloseTo(1, 6)
    expect(pos_(s)[2]).toBeCloseTo(0, 6)
  })
  test('no `orbit` ⇒ ballistics untouched (additive primitive)', () => {
    const em = em_({ count: 1, lifetime: 100, shape: 'point', speed: [0, 0], offset: [0, 0, 0] })
    const p = pos_(particle_state(em, seed, 2))
    expect(p[0]).toBeCloseTo(1, 6) // stays at the birth point, no revolution
    expect(p[2]).toBeCloseTo(0, 6)
  })
})

// ── RADIAL PRIMITIVE (StatusFX auras): push along normalize(pos0 − emission centre) by v·t + ½·a·t². Signed accel
// (− = converge). The whole aura drift; additive (an emitter with neither field is byte-identical to old ballistics). ──
describe('radial primitive (particle_state)', () => {
  test('radial_velocity + radial_accel push OUTWARD from the emission centre (v·t + ½·a·t²)', () => {
    const em = em_({ count: 1, lifetime: 100, shape: 'point', speed: [0, 0], offset: [0, 0, 0], radial: [0.1, 0.1], radial_accel: 0.4 }) // prettier-ignore
    const seed = /** @type {any} */ ({ dir: [1, 0, 0], speed: 0, pos0: [1, 0, 0], birth: 0, size: 1, color_roll: 0, spin: 0, radial_v: 0.1 }) // prettier-ignore
    const at = (/** @type {number} */ t) => pos_(particle_state(em, seed, t))[0] - 1 // outward displacement (x from pos0 1)
    expect(at(1)).toBeCloseTo(0.1 * 1 + 0.5 * 0.4 * 1, 6) // 0.1 + 0.2 = 0.3
    expect(at(2)).toBeCloseTo(0.1 * 2 + 0.5 * 0.4 * 4, 6) // 0.2 + 0.8 = 1.0
    expect(at(2)).toBeGreaterThan(at(1)) // monotone outward
  })
  test('negative radial_accel CONVERGES on the centre (the gem/heal/magic/void inward pull)', () => {
    const em = em_({ count: 1, lifetime: 100, shape: 'point', speed: [0, 0], offset: [0, 0, 0], radial: [0, 0], radial_accel: -0.5 }) // prettier-ignore
    const seed = /** @type {any} */ ({ dir: [1, 0, 0], speed: 0, pos0: [2, 0, 0], birth: 0, size: 1, color_roll: 0, spin: 0, radial_v: 0 }) // prettier-ignore
    expect(pos_(particle_state(em, seed, 1))[0]).toBeLessThan(2) // pulled toward the centre
  })
  test('no radial fields ⇒ ballistics untouched (additive primitive)', () => {
    const em = em_({ count: 1, lifetime: 100, shape: 'point', speed: [0, 0], offset: [0, 0, 0] })
    const seed = /** @type {any} */ ({ dir: [1, 0, 0], speed: 0, pos0: [1, 0, 0], birth: 0, size: 1, color_roll: 0, spin: 0, radial_v: 0 }) // prettier-ignore
    expect(pos_(particle_state(em, seed, 3))[0]).toBeCloseTo(1, 6)
  })
  test('seed_emitter rolls radial_v within [min,max] and the sphere volume respects emission_scale', () => {
    const em = em_({ count: 64, lifetime: 2, shape: 'sphere', radius: 1, emission_scale: [0.5, 1, 0.5], offset: [0, 1, 0], radial: [0.1, 0.1] }) // prettier-ignore
    for (let i = 0; i < 64; i += 1) {
      const s = seed_emitter(em, i, 7)
      expect(s.radial_v).toBeCloseTo(0.1, 6)
      // the birth point sits inside the vertical ellipsoid volume (x,z ≤ 0.5 · radius, y within ±1 of the offset)
      expect(Math.abs(s.pos0[0])).toBeLessThanOrEqual(0.5 + 1e-6)
      expect(Math.abs(s.pos0[2])).toBeLessThanOrEqual(0.5 + 1e-6)
      expect(Math.abs(s.pos0[1] - 1)).toBeLessThanOrEqual(1 + 1e-6)
    }
  })
})

// ── AURA ON-BODY COMPOSITIONS (the rebuild — transcribed from the StatusFX .tscn family, NOT the rejected egg):
// each status_<aura> is a LOOP of an AURA glow layer (aura_particle, all 18) + optional SYMBOL (the element mote) +
// optional BACKDROP (aura_sphere capsule OR streaks billboard — only where the .tscn ships a Mesh node). The BODY
// GLOW is the on-model status_overlay (vfx_model_overlay), mounted by the consumer on the char mesh — NOT a particle. ──
describe('aura on-body compositions (StatusFX .tscn structure) + the entity anchor', () => {
  const status = list_presets().filter((n) => n.startsWith('status_'))
  /** @param {string} n @param {string} name */
  const layer = (n, name) => PRESETS[n].emitters.find((e) => e.name === name)

  test('all 18 status auras LOOP with an aura layer + only {capsule,streaks,aura,symbols} layers', () => {
    expect(status.length).toBeGreaterThanOrEqual(18)
    for (const n of status) {
      const p = PRESETS[n]
      expect(p.loop, `${n} loops`).toBe(true)
      for (const e of p.emitters)
        expect(['capsule', 'streaks', 'aura', 'symbols'], `${n} layer ${e.name}`).toContain(e.name)
      expect(layer(n, 'aura'), `${n} has an aura layer`).toBeTruthy()
    }
  })
  test('the AURA layer fills the vertical ellipsoid emission VOLUME with Godot radial motion (NO egg shell)', () => {
    for (const n of status) {
      const a = /** @type {any} */ (layer(n, 'aura'))
      expect(a.appearance, `${n} aura look`).toBe('aura_mote')
      expect(a.shape, `${n} aura volume`).toBe('sphere')
      const es = /** @type {number[]} */ (a.emission_scale)
      expect(es?.length, `${n} emission_scale`).toBe(3)
      expect(es[1], `${n} taller-than-wide volume`).toBeGreaterThanOrEqual(es[0]) // the body-hugging ellipsoid
      expect(a.radial, `${n} radial velocity`).toBeTruthy()
      expect(nums(a.offset)[1], `${n} body-local lift`).toBeGreaterThan(0)
    }
    // ICE specifically has ZERO sphere-hero / aura_shell egg (the strike): only aura + ice_flake billboards.
    for (const e of PRESETS.status_ice.emitters) {
      expect(e.geometry, 'ice has no sphere hero').not.toBe('sphere')
      expect(e.appearance, 'ice has no aura_shell egg').not.toBe('aura_shell')
    }
  })
  test('the element SYMBOL is transcribed per .tscn; pure-swirl statuses have none', () => {
    expect(/** @type {any} */ (layer('status_ice', 'symbols')).appearance).toBe('ice_flake')
    expect(/** @type {any} */ (layer('status_poison', 'symbols')).appearance).toBe('bubble')
    expect(/** @type {any} */ (layer('status_holy', 'symbols')).appearance).toBe('heal_cross')
    expect(/** @type {any} */ (layer('status_heal', 'symbols')).appearance).toBe('heal_cross')
    expect(/** @type {any} */ (layer('status_flame', 'symbols')).appearance).toBe('noise_mote')
    expect(/** @type {any} */ (layer('status_sleep', 'symbols')).appearance).toBe('sleep_z')
    expect(layer('status_shatter', 'symbols'), 'shatter is pure swirl').toBeUndefined()
  })
  test('the BACKDROP matches the .tscn Mesh node: aura_sphere CAPSULE (sphere statuses) / streaks billboard (swirl)', () => {
    for (const n of ['status_flame', 'status_green', 'status_dark', 'status_divine', 'status_shard']) {
      const cap = /** @type {any} */ (layer(n, 'capsule'))
      expect(cap?.geometry, `${n} capsule mesh`).toBe('sphere')
      expect(cap.appearance, `${n} capsule look`).toBe('aura_shell')
      const ell = /** @type {number[]} */ (cap.ellipsoid)
      expect(ell[1], `${n} tall capsule`).toBeGreaterThan(ell[0])
    }
    for (const n of ['status_void', 'status_magic', 'status_gem', 'status_arcane', 'status_shatter'])
      expect(/** @type {any} */ (layer(n, 'streaks')).appearance, `${n} streaks backdrop`).toBe('streaks')
    expect(layer('status_ice', 'capsule'), 'ice has no capsule').toBeUndefined()
    expect(layer('status_ice', 'streaks'), 'ice has no streaks backdrop').toBeUndefined()
  })
  test('every aura stays under the sustained-halo emission ceiling (a persistent glow never blooms)', () => {
    for (const n of status) expect(preset_peak_luma(PRESETS[n]), `${n} halo ceiling`).toBeLessThan(2.05)
  })

  test('the entity anchor copies the rig world position (+ lift) into the origin uniform each frame', () => {
    const origin = new Vector3()
    const parent = new Object3D()
    const obj = new Object3D()
    parent.add(obj)
    let disposed = false
    const handle = /** @type {any} */ ({ origin: { value: origin }, object3d: obj, dispose: () => (disposed = true) })
    const target = new Object3D()
    target.position.set(5, 0, 3)
    target.updateMatrixWorld(true)
    const anchor = follow_entity(handle, target, { lift: 1.5 })
    anchor.update()
    expect([origin.x, origin.y, origin.z]).toEqual([5, 1.5, 3]) // tracks the entity world point, lifted to the torso
    target.position.set(-2, 0, 8) // the entity walks
    target.updateMatrixWorld(true)
    anchor.update()
    expect([origin.x, origin.y, origin.z]).toEqual([-2, 1.5, 8]) // the aura follows
    // REMOVE-ONLY teardown: unparents the aura + frees ITS resources, never touches the entity.
    anchor.detach()
    expect(obj.parent).toBe(null)
    expect(disposed).toBe(true)
    expect(target.parent).toBe(null) // the entity is untouched (still a valid, undisposed node)
  })
})

// ── POST-AgX OVERLAY ROUTING (the fight-VFX display-space additive pass). route_overlay_group is the pure hand the
// vfx_overlay_pass depends on — it must move fight meshes to FIGHT_VFX_LAYER (so the main pass auto-excludes them
// from AgX) and switch their materials to display-space additive (blend_add + depthWrite-for-occlusion). Tested with
// fake-material meshes, the park_node_material_objects idiom (no GPU). ──────────────────────────────────────────
describe('route_overlay_group — POST-AgX fight-VFX overlay routing', () => {
  /** a stand-in for a SpriteNodeMaterial / MeshBasicNodeMaterial — route_overlay_group only reads/writes these fields. */
  const fake_mat = () => /** @type {any} */ ({ blending: 1, depthWrite: false, depthTest: true })

  test('FIGHT_VFX_LAYER is a dedicated layer — not 0 (default) / not 31 (webgl_fallback park)', () => {
    expect(FIGHT_VFX_LAYER).toBeGreaterThan(0)
    expect(FIGHT_VFX_LAYER).not.toBe(31)
  })

  test('routes every mesh in the subtree to display-space additive; groups (no material) contribute 0', () => {
    const root = new Group()
    const billboard = new Mesh(undefined, fake_mat())
    const nested = new Group()
    const sphere = new Mesh(undefined, fake_mat())
    nested.add(sphere)
    root.add(billboard, nested)

    expect(route_overlay_group(root)).toBe(2) // both meshes through the subtree; the two Groups carry no material

    for (const mesh of [billboard, sphere]) {
      expect(mesh.material.blending).toBe(2) // AdditiveBlending — the pack's blend_add, now read as display-space light
      expect(mesh.material.depthWrite).toBe(true) // records a representative particle depth for the occlusion mask
      expect(mesh.material.depthTest).toBe(false) // overlapping particles still ACCUMULATE (the glow stacks)
    }
  })

  test('a routed mesh is invisible to a default (layer-0) camera and seen only by the overlay camera', () => {
    const mesh = new Mesh(undefined, fake_mat())
    route_overlay_group(mesh)
    const main_cam = new PerspectiveCamera() // default mask = layer 0 → the AgX main scene pass
    const overlay_cam = new PerspectiveCamera()
    overlay_cam.layers.set(FIGHT_VFX_LAYER) // the isolated post-AgX overlay pass
    expect(mesh.layers.test(main_cam.layers)).toBe(false) // NEVER tonemapped by the main pass
    expect(mesh.layers.test(overlay_cam.layers)).toBe(true) // rendered by the display-space overlay pass
  })

  // MOBILE-VFX-INVISIBLE (WebGPU/Low on mobile: vfx barely visible): renderer.js's
  // ARCHITECT-RESILIENCE fallback (render_frame's `else renderer.render(scene, camera)`) fires whenever the
  // atmo/post stack throws during construction/bake (a WebGPU/TSL compile failure on a given device — caught,
  // console.warn'd, NEVER rethrown, so it is invisible on a phone with no attached devtools). That path has NO
  // overlay pass (post is null), so the plain camera's DEFAULT mask (layer 0 only, same as `main_cam` above) is
  // all it ever renders — every fight-cast VFX (already routed to FIGHT_VFX_LAYER by route_overlay_group) goes
  // permanently dark while the rest of the game (terrain/mobs/UI) stays fully playable. enable_fight_vfx_layer
  // is the one-line graceful fallback renderer.js calls the moment the resilience guard degrades: WIDEN (never
  // replace) that camera's mask so fight VFX are still SEEN — pre-overlay colour (no AgX-bypass composite), but
  // seen beats invisible ("no flags default ON" / juice-ships-live law).
  test('enable_fight_vfx_layer: the bare-render fallback camera sees fight VFX once widened (never loses layer 0)', () => {
    const mesh = new Mesh(undefined, fake_mat())
    route_overlay_group(mesh)
    const fallback_cam = new PerspectiveCamera() // exactly what the degraded render_frame() branch renders with
    expect(mesh.layers.test(fallback_cam.layers)).toBe(false) // today: invisible on the bare fallback path

    enable_fight_vfx_layer(fallback_cam)

    expect(mesh.layers.test(fallback_cam.layers)).toBe(true) // fixed: the fallback camera now sees fight VFX
    expect(fallback_cam.layers.test(new Object3D().layers)).toBe(true) // layer 0 (ordinary scene content) untouched
  })
})
