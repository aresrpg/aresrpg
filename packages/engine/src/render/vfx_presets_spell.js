// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — the SPELL-CHAIN preset families (phase 2): the Godot magic packs ported into the same
// billboard-particle vocabulary as the Explosion/Hit library (vfx_presets_data.js), covering the cast beat's
// non-impact stages (CHARGE windup · BOLT projectile · LOOP remnant/status/aura · BURST eruption/soul/slash) so NO
// fight layer falls back to a sprite sheet. Each family's structure is documented at its builder below. The PORT
// (same as phase 1): the .tscn ParticleProcessMaterial numbers + ShaderMaterial primary/secondary/tertiary colours
// are transcribed into these rows; the Godot look is tinted billboards (the house idiom). Colour law: every channel
// ≤ 1 (sustained LOOP emitters clear the 2.05 bloom threshold, engine-tested); the white flash is a short CORE emitter.

/** @typedef {import('./vfx_preset_engine.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_engine.js').VfxEmitter} VfxEmitter */

// The BURST builders (earth eruption / death void / weapon slash) live in vfx_presets_burst.js — split out to
// keep both files ≤600 LoC. The assembly below composes them alongside the cast-chain + loop builders here.
import { eruption_preset, soul_preset, slash_preset } from './vfx_presets_burst.js'

const rgb = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) =>
  /** @type {[number,number,number]} */ ([r, g, b])
/** Fold an (HDR) colour to ≤1 per channel — the sustained-loop no-halo clamp. @param {[number,number,number]} c */
const clamp1 = (c) => /** @type {[number,number,number]} */ ([Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])])

// ── ELEMENT PALETTES (transcribed from the pack .tscn primary/secondary/tertiary). The bright CORE `hot` runs HDR
// (>1) so the bloom pass lifts it toward the pack previews (every hot luma <2.05, no-halo tested); SUSTAINED body
// colours stay ≤1 so a lingering remnant never screams. fire=FlameFX ember · water/ice=ElementalMagic cyan ·
// air=ElectricFX white-cyan · neutral=BattleFX BLANK GREY (B2 — was an UNSOURCED violet) · heal=holy gold · earth=loam · death=DarkMagic void magenta · weapon=BattleFX blank grey.
const EL = {
  fire: { hot: rgb(1.5, 1.02, 0.5), body: rgb(1, 0.42, 0.14), deep: rgb(0.5, 0.12, 0.04) },
  // water = SAPPHIRE gem identity (DECISIONS 2026-07-13): deepened + more saturated than the old pale-blue triple
  // (0.85,1.15,1.35 had all channels within 1.6x of each other — reads pale under the overlay's additive stacking,
  // same washout mechanism as air below) so it holds a clear cyan-blue hue instead of a near-white sliver.
  water: { hot: rgb(0.55, 1.25, 1.55), body: rgb(0.06, 0.5, 0.95), deep: rgb(0, 0.22, 0.68) },
  // air = EMERALD gem identity (DECISIONS 2026-07-13, tint-polish pass; was a blue-tinted near-white
  // 1.3,1.4,1.6 / 0.4,0.82,1 — every channel within ~1.6x of the others, so the overlay's additive accumulation
  // pins R/G/B together and reads WHITE regardless of brightness, exactly like the old fire-blob problem). A wide
  // channel SPREAD (G dominant, R suppressed ~4-5x) is what survives accumulation with hue intact — same trick
  // that makes fire's saturated orange body hold up. `hot` stays HDR/bright (bolt_preset's HEAD fades white→hot,
  // so the brief white flash at spawn is unchanged); `body`/`deep` are the sustained emerald energy.
  air: { hot: rgb(0.35, 1.6, 0.85), body: rgb(0.03, 0.9, 0.42), deep: rgb(0.01, 0.5, 0.25) },
  // neutral = the REAL BattleFX blank (colourless) charge (layermap-verified): white / grey (0.37) / dark (0.08) — was
  // an UNSOURCED arcane violet (audit #7). `hot` a mild cool-white HDR for bloom parity; body/deep the cited pack grey.
  neutral: { hot: rgb(1.2, 1.2, 1.3), body: rgb(0.37, 0.37, 0.37), deep: rgb(0.08, 0.08, 0.08) },
  heal: { hot: rgb(1.4, 1.28, 0.9), body: rgb(1, 0.82, 0.45), deep: rgb(0.7, 0.5, 0.2) },
  earth: { hot: rgb(1.05, 0.88, 0.55), body: rgb(0.55, 0.4, 0.22), deep: rgb(0.3, 0.2, 0.1) },
  // death = the REAL DarkMagicFX "void" variant (the green "soul" was an invention — the
  // purchased DarkMagicFX pack is magenta/void, "completely different"). primary magenta (0.937,0.11,1) · secondary
  // blue (0,0.30,0.78) — the exact vfx_ball_void_01.tscn colours; `hot` = a bright magenta-white flash core.
  death: { hot: rgb(1.35, 0.5, 1.4), body: rgb(0.94, 0.11, 1), deep: rgb(0.05, 0.32, 0.82) },
  // weapon = the REAL BattleFX vfx_blank_slash: primary white · secondary grey (0.369) · tertiary (0.078) — was an UNSOURCED red (audit #6).
  weapon: { hot: rgb(1, 1, 1), body: rgb(0.369, 0.369, 0.369), deep: rgb(0.078, 0.078, 0.078) },
}
const HOT = rgb(1, 1, 1)

// ── CHARGE (windup / caster-cell): a shell of motes IMPLODES to a bright growing core over the flare window —
// the gathering-energy read (Godot BattleFX `vfx_*_charge`: emission SPHERE r≈1.5, negative radial_accel = inward,
// explosiveness 0.5). The RENDERER places the origin (chest for the windup, feet for the caster-cell ground pulse),
// so the offset is a small lift from there — ONE preset serves both stages, positioned by fight_cast_vfx.
/** @param {{ name:string, hot:[number,number,number], body:[number,number,number], look?:string, core_look?:string, ember_look?:string, emission?:number }} s @returns {VfxPreset} */
export function charge_preset(s) {
  const y = 0.3
  const look = s.look ?? 'arcane_mote' // pack body appearance ('fire' = FlameFX faithful); default = BattleFX arcane
  const core_look = s.core_look ?? look // the gather CORE (water → the ElementalMagic cast_flare) — variety
  const ember_look = s.ember_look ?? 'arcane_mote' // the flicking embers (real pack mote — was the generic FBM `spark`)
  const em = s.emission ?? 2
  return {
    name: s.name,
    duration: 0.6,
    emitters: [
      // GATHER — a surface shell rushing inward, shrinking as it reaches the core, alpha swelling then settling.
      {
        name: 'gather',
        count: 44,
        lifetime: 0.5,
        explosiveness: 0.5,
        shape: 'shell',
        radius: 2.1,
        inward: true,
        offset: [0, y, 0],
        speed: [4.2, 5.4],
        drag: 1.4,
        size: [0.55, 1.15],
        size_curve: [1, 0.4],
        alpha_curve: [0, 1, 0.7],
        appearance: look,
        color: s.hot,
        color_end: s.body,
        emission: em,
        opacity: 0.9,
      },
      // CORE — the bright pip growing at the gather point (the energy about to release), fades as the bolt leaves.
      {
        name: 'core',
        count: 1,
        lifetime: 0.55,
        explosiveness: 1,
        shape: 'point',
        offset: [0, y, 0],
        size: [1.4, 1.4],
        size_curve: [0.2, 1.2, 0.9],
        alpha_curve: [0, 0.9, 0],
        appearance: core_look,
        color: HOT,
        color_end: s.hot,
        emission: em,
      },
      // EMBERS — a few motes flick up off the gather, spark-shaped, giving the windup life.
      {
        name: 'embers',
        count: 14,
        lifetime: 0.55,
        explosiveness: 0.4,
        shape: 'sphere',
        radius: 0.6,
        offset: [0, y, 0],
        spread: 180,
        speed: [1.5, 3],
        gravity: [0, 1.2, 0],
        drag: 1.5,
        size: [0.3, 0.6],
        size_curve: [1, 0.3],
        alpha_curve: [0.9, 0],
        appearance: ember_look,
        color: s.hot,
        color_end: s.body,
      },
    ],
  }
}

// ── BOLT (delivery / projectile): a moving comet, run as a LOOP so head+trail+aura shed continuously while the
// runtime advances `origin` along the arc/skyfall path and sets `travel` (velocity). The TRAIL emitter subtracts
// travel·age → its particles stay where they were BORN (a real world wake), the head/aura ride the origin.
/** @param {{ name:string, hot:[number,number,number], body:[number,number,number], deep?:[number,number,number], look?:string, soft?:string, trail_look?:string, emission?:number, head_count?:number, head_size?:[number,number], head_sat?:boolean }} s @returns {VfxPreset} */
export function bolt_preset(s) {
  const look = s.look ?? 'arcane_mote'
  const soft = s.soft ?? look // the aura layer's appearance (a softer pack look per element — variety knob)
  const trail_look = s.trail_look ?? 'arcane_mote' // the world-static wake (real pack mote — was the generic FBM `spark`)
  const em = s.emission ?? 2
  const head_count = s.head_count ?? 6
  const head_size = s.head_size ?? [1.1, 1.7]
  // HEAD colours: default a white-hot core → element hot. `head_sat` (fire) instead runs a SATURATED pairing (element
  // hot → element body) so fire_particle's lower-luma `elem` pick stays COLOURED — a white-cored HDR head washes to a
  // featureless white blob under AgX+bloom at fight distance (measured: a tiny white dot, not tall flames).
  const head_c0 = s.head_sat ? s.hot : HOT
  const head_c1 = s.head_sat ? s.body : s.hot
  return {
    name: s.name,
    duration: 1.2, // loop — the runtime disposes it on impact (BEAT.travel_s); this is only the demo age ceiling
    loop: true,
    emitters: [
      // HEAD — a tight bright core riding the orb (local: no trail subtraction), regenerating every short cycle.
      {
        name: 'head',
        count: head_count,
        lifetime: 0.18,
        explosiveness: 0.4,
        shape: 'sphere',
        radius: 0.18,
        speed: [0.4, 0.9],
        size: head_size,
        size_curve: [1, 0.85],
        alpha_curve: [1, 0.9],
        appearance: look,
        color: head_c0,
        color_end: head_c1,
        emission: em,
      },
      // TRAIL — the world-static wake: low speed, short life, shed behind the flying head (trail: travel-anchored).
      {
        name: 'trail',
        count: 26,
        lifetime: 0.26,
        explosiveness: 0.2,
        shape: 'sphere',
        radius: 0.12,
        trail: true,
        spread: 180,
        speed: [0.6, 1.6],
        size: [0.5, 1],
        size_curve: [1, 0],
        alpha_curve: [0.9, 0],
        appearance: trail_look,
        color: s.hot,
        color_end: s.body,
      },
      // AURA — a soft coloured glow hugging the head (local), so the comet reads as an energy ball, not a dot.
      {
        name: 'aura',
        count: 12,
        lifetime: 0.2,
        explosiveness: 0.3,
        shape: 'sphere',
        radius: 0.34,
        speed: [0.5, 1.4],
        size: [0.9, 1.5],
        size_curve: [0.7, 1, 0.4],
        alpha_curve: [0.55, 0],
        appearance: soft,
        color: s.body,
        color_end: s.deep ?? s.body,
        emission: em,
        opacity: 0.55,
      },
    ],
  }
}

// ── LOOP (remnant / status / aura): a persistent column of rising, orbiting motes (Godot StatusFX: emission
// CYLINDER, direction +Y, gravity ~0.3–0.5 up, orbit + radial spin, scale 0.5–1.2, lifetime ~2). Each mote fades
// in and out over its cycle; the whole thing repeats until the caller disposes it. `rise` sets the updraft.
/** @param {{ name:string, hot:[number,number,number], body:[number,number,number], rise?:number, radius?:number, look?:string, soft?:string, emission?:number }} s @returns {VfxPreset} */
export function loop_preset(s) {
  const radius = s.radius ?? 1
  const rise = s.rise ?? 0.9
  const look = s.look ?? 'arcane_mote'
  const soft = s.soft ?? look // the base-glow layer's appearance (a softer pack look — variety knob)
  const em = s.emission ?? 2
  // SUSTAINED no-halo: a loop lingers for SECONDS, so its colours stay ≤1 — the HDR element cores are for the
  // BRIEF cast beats (charge/bolt/impact); a persistent remnant/aura at HDR would bloom into a white halo.
  const hot = clamp1(s.hot)
  const body = clamp1(s.body)
  return {
    name: s.name,
    duration: 2, // loop — the caller (remnant window / a future aura system) controls the real lifetime
    loop: true,
    emitters: [
      // MOTES — a rising, spinning column that continuously fades in→out (the lingering residue / status aura).
      {
        name: 'motes',
        count: 26,
        lifetime: 1.6,
        explosiveness: 0.15,
        shape: 'sphere',
        radius,
        offset: [0, 0.5, 0],
        direction: [0, 1, 0],
        spread: 55,
        speed: [0.4, 1],
        gravity: [0, rise, 0],
        drag: 0.8,
        size: [0.5, 1.15],
        size_curve: [0.4, 1, 0.5],
        alpha_curve: [0, 0.85, 0],
        appearance: look,
        color: body,
        color_end: hot,
        emission: em,
        opacity: 0.8,
        spin: 1.2,
      },
      // GLOW — a soft central bloom at the base, so the residue has a warm seat under the rising motes.
      {
        name: 'glow',
        count: 4,
        lifetime: 1.4,
        explosiveness: 0.2,
        shape: 'sphere',
        radius: radius * 0.5,
        offset: [0, 0.4, 0],
        speed: [0.2, 0.5],
        size: [1, 1.8],
        size_curve: [0.6, 1, 0.6],
        alpha_curve: [0, 0.5, 0],
        appearance: soft,
        color: hot,
        color_end: body,
        emission: em,
        opacity: 0.45,
      },
    ],
  }
}

// ── AURA (on-body status composition) — transcribed op-for-op from the StatusFX .tscn family (NOT the rejected egg):
// [Mesh?] + Particles(symbol)? + Aura emitting from a vertical ELLIPSOID VOLUME (emission_shape SPHERE × scale, e.g.
// ice 0.5,1,0.5) hugging the body. Layers: BODY GLOW = the on-model status_overlay (vfx_model_overlay, mounted by the
// consumer — NOT a particle); AURA = aura_particle motes (every status); SYMBOL = the element mote; BACKDROP = an
// aura_sphere CAPSULE or streaks billboard, only where the .tscn ships a Mesh node. MOTION = Godot orbit + radial_velocity
// 0.1 + radial_accel (signed) + vertical, from the SPHERE volume; the entity anchor rides it on the rig. Colours ≤1 +
// emission ≤1.5 — a persistent aura never blooms (the sustained halo ceiling, tested).
/** @param {{ name:string, hot:[number,number,number], body:[number,number,number], look?:string, sym?:number,
 *   backdrop?:'none'|'sphere'|'streaks', motion:{orbit:number,radial:number,grav:number,escale:[number,number,number]},
 *   emission?:number, symbol_life?:number }} s @returns {VfxPreset} */
export function aura_preset(s) {
  const hot = clamp1(s.hot) // PACK primary (bright core — white-ish)
  const body = clamp1(s.body) // PACK secondary (element colour)
  const em = s.emission ?? 1.4
  const y = 1.0 // body-local centre; the SPHERE radius 1 × emission_scale.y spans feet(0)→head(2). Anchor rides the rig.
  const M = s.motion
  // shared emission volume + Godot motion (both layers get it, exactly as the .tscn script sets every GPUParticles child).
  const vol = /** @type {const} */ ({
    shape: 'sphere',
    radius: 1,
    emission_scale: M.escale, // emission_shape_scale — the vertical body-hugging ellipsoid VOLUME
    offset: [0, y, 0],
    orbit: M.orbit, // particles_orbit
    radial: /** @type {[number,number]} */ ([0.1, 0.1]), // radial_velocity_min/max
    radial_accel: M.radial, // radial_accel (signed)
    gravity: /** @type {[number,number,number]} */ ([0, M.grav, 0]), // particles_vertical
    speed: /** @type {[number,number]} */ ([0, 0]), // no initial_velocity (direction is inert in the .tscn)
  })
  const emitters = /** @type {import('./vfx_preset_engine.js').VfxEmitter[]} */ ([])

  // BACKDROP (behind the motes) — only where the .tscn has a Mesh node.
  if (s.backdrop === 'sphere') {
    // aura_sphere CAPSULE — the translucent additive column (SphereMesh r0.8×h3.4). One mesh, one draw call.
    emitters.push({
      name: 'capsule',
      count: 1,
      lifetime: 2,
      geometry: 'sphere',
      appearance: 'aura_shell',
      ellipsoid: [0.8, 1.7, 0.8],
      offset: [0, y, 0],
      size_curve: [1, 1],
      alpha_curve: [0.7, 0.85, 0.7], // gentle breathe across the loop
      color: hot,
      color_end: body,
      emission: em,
      opacity: 0.4,
    })
  } else if (s.backdrop === 'streaks') {
    // the big streaks billboard behind the body (the swirl statuses' MeshInstance QuadMesh + streaks.gdshader).
    emitters.push({
      name: 'streaks',
      count: 1,
      lifetime: 2,
      shape: 'point',
      offset: [0, y, 0],
      size: [2.4, 2.4],
      size_curve: [1, 1],
      alpha_curve: [0.6, 0.85, 0.6],
      appearance: 'streaks',
      color: hot,
      color_end: body,
      emission: em,
      opacity: 0.55,
      spin: 0.15,
    })
  }

  // AURA — the soft aura_particle glow motes (2×2 quad × scale 0.5..1.2), grow→peak→shrink, linear fade.
  emitters.push({
    ...vol,
    name: 'aura',
    count: 32,
    lifetime: 2,
    explosiveness: 0,
    size: [1.0, 2.4], // QuadMesh 2×2 × scale_min/max 0.5..1.2
    size_curve: [0.51, 1.0, 0.5], // Curve_5xjai (grow → peak@48% → shrink)
    alpha_curve: [1, 0], // Curve_i7pcd linear fade
    appearance: 'aura_mote',
    color: hot,
    color_end: body,
    emission: em,
    opacity: 0.7,
  })

  // SYMBOL — the element symbol (small quad × 0.5..1.2), ease-in grow from 0, hold then fade. Absent for pure-swirl statuses.
  if (s.look) {
    const q = s.sym ?? 0.3
    emitters.push({
      ...vol,
      name: 'symbols',
      count: 32,
      lifetime: s.symbol_life ?? 2,
      explosiveness: 0.1,
      size: [q * 0.5, q * 1.2], // QuadMesh q×q × scale 0.5..1.2
      size_curve: [0, 0.3, 1], // Curve_l7om2 ease-in from 0
      alpha_curve: [1, 1, 1, 0], // Curve_m8ci0 hold (~0.8) then fade
      appearance: s.look,
      color: hot,
      color_end: body,
      emission: em,
      opacity: 0.9,
      spin: 0.6, // the symbols tumble gently
    })
  }

  return { name: s.name, duration: 2, loop: true, emitters }
}

// ── GROUND DECAL (trap / glyph): a persistent, SUBTLE ground-anchored LOOP — a flat radial rune/scorch ring
// hugging the cell floor + a few slow rising motes. The pack-sourced LAYER 2 that rides under the readable
// cell-blob (LAYER 1, adapter-painted). LOW emission + clamped colours: a persistent decal must never bloom.
/** @param {{ name:string, hot:[number,number,number], body:[number,number,number], look:string, rise?:number }} s @returns {VfxPreset} */
export function ground_decal_preset(s) {
  const hot = clamp1(s.hot)
  const body = clamp1(s.body)
  const rise = s.rise ?? 0.35
  return {
    name: s.name,
    duration: 2.6,
    loop: true,
    emitters: [
      // SEAT — a flat radial magic-circle / scorch ring on the floor (ElementalMagic area_ground polar shader),
      // the zone footprint that reads under the cell-blob. Slow breathing alpha so it never pulses like a cast.
      {
        name: 'seat',
        count: 1,
        lifetime: 2.4,
        shape: 'point',
        offset: [0, 0.06, 0],
        size: [2.7, 2.7],
        size_curve: [0.85, 1.05, 0.9],
        alpha_curve: [0, 0.4, 0.32, 0],
        appearance: 'elem_area',
        color: body,
        color_end: hot,
        emission: 0.9,
        opacity: 0.42,
      },
      // GLOW — the ElementalMagic area_glow curtain (Glow_01/Glow_02 bloom layer beside area_ground, audit #9): a low rising veil, clamped + low emission (no bloom).
      {
        name: 'glow',
        count: 1,
        lifetime: 2.4,
        shape: 'point',
        offset: [0, 0.5, 0],
        size: [2.3, 2.3],
        size_curve: [0.7, 1, 0.85],
        alpha_curve: [0, 0.32, 0.26, 0],
        appearance: 'area_glow',
        color: hot,
        color_end: body,
        emission: 0.9,
        opacity: 0.4,
      },
      // HAZE — a few slow low motes drifting up off the zone (burning heat / arcane wisps): the subtle life.
      {
        name: 'haze',
        count: 12,
        lifetime: 2.2,
        explosiveness: 0.1,
        shape: 'sphere',
        radius: 1.25,
        offset: [0, 0.2, 0],
        direction: [0, 1, 0],
        spread: 40,
        speed: [0.2, 0.6],
        gravity: [0, rise, 0],
        drag: 1,
        size: [0.4, 0.95],
        size_curve: [0.3, 1, 0.4],
        alpha_curve: [0, 0.55, 0],
        appearance: s.look,
        color: body,
        color_end: hot,
        emission: 1.0,
        opacity: 0.5,
        spin: 0.8,
      },
    ],
  }
}

// ── STATUS CONFIG (transcribed per vfx_status_*.tscn — colours from <element>_overlay.tres; symbol shader + quad
// size + backdrop + motion from the scene tree; see scratchpad STATUSFX_INVENTORY / all.png). 18 LOOP presets cover
// every shop aura + the 3 internal title auras (holy/arcane/soul); a wearable's `aura` resolves to `status_<k>`.
// A(hot, body, look, sym, backdrop, orbit, radial, grav, escale, life?): look = the Particles SYMBOL shader (undefined
// = pure swirl); backdrop = the .tscn Mesh node ('sphere' capsule · 'streaks' billboard · 'none'); orbit/radial(signed)/
// grav = Godot particles_orbit / radial_accel / particles_vertical; escale = emission_shape_scale (the volume). ≤1 colours.
const V = /** @type {[number,number,number]} */ ([0.5, 1, 0.5]) // the common body-hugging ellipsoid emission volume
const TALL = /** @type {[number,number,number]} */ ([1, 1.5, 1]) // gem/heal/magic taller-wider volume
/** @param {[number,number,number]} hot @param {[number,number,number]} body @param {string|undefined} look
 *  @param {number} sym @param {'none'|'sphere'|'streaks'} backdrop @param {number} orbit @param {number} radial
 *  @param {number} grav @param {[number,number,number]} escale @param {number} [life] */
const A = (hot, body, look, sym, backdrop, orbit, radial, grav, escale, life) => ({ hot, body, look, sym, backdrop, motion: { orbit, radial, grav, escale }, symbol_life: life }) // prettier-ignore
const STATUS = {
  ice: A(rgb(1, 1, 1), rgb(0, 0.776, 0.843), 'ice_flake', 0.3, 'none', 0, 0.4, 0, V),
  flame: A(rgb(1, 0.818, 0.241), rgb(0.914, 0.341, 0), 'noise_mote', 0.5, 'sphere', 0.3, 0.2, 0.5, V),
  poison: A(rgb(0.696, 1, 0.604), rgb(0, 0.6, 0.239), 'bubble', 0.3, 'none', 0.3, 0.3, 0.3, V),
  nature: A(rgb(0.576, 0.875, 0), rgb(0.173, 0.741, 0), 'leaf', 0.2, 'none', 0.3, 0.2, 0.5, V), // texture_particle → the pack's leaf.png (vfx_pack_shaders_expansion `leaf`)
  green: A(rgb(0.714, 1, 0.545), rgb(0, 0.667, 0.235), 'noise_mote', 0.5, 'sphere', 0.3, 0.2, 0, V),
  dark: A(rgb(1, 0.247, 0.498), rgb(0.576, 0.122, 1), 'noise_mote', 0.3, 'sphere', 1.0, 0.5, 0, V),
  void: A(rgb(0.576, 0.122, 1), rgb(0.082, 0, 0.631), 'noise_mote', 0.3, 'streaks', 0.3, -0.5, 0, V),
  divine: A(rgb(1, 0.98, 0.933), rgb(1, 0.561, 0.384), 'noise_mote', 0.5, 'sphere', 0, 0.4, 0, V),
  heal: A(rgb(0.608, 0.996, 0), rgb(0.463, 0.643, 0), 'heal_cross', 0.2, 'none', 0, -0.7, 0, TALL, 1),
  shard: A(rgb(0.208, 0.592, 1), rgb(0, 0.518, 0.596), 'noise_mote', 0.4, 'sphere', 0, 0, 0.5, [0.8, 1.5, 0.8]),
  magic: A(rgb(0.937, 0.396, 0), rgb(0.78, 0.059, 0.608), 'noise_mote', 0.3, 'streaks', 0, -0.5, 0, TALL),
  // internal / non-.tscn auras — existing tuned palette, mapped onto the nearest scene family
  holy: A(rgb(1, 0.96, 0.72), rgb(1, 0.82, 0.4), 'heal_cross', 0.2, 'none', 0, -0.7, 0, TALL, 1),
  gem: A(rgb(0.85, 1, 1), rgb(0.4, 0.82, 1), 'noise_mote', 0.6, 'streaks', 0, -0.01, 0, TALL),
  shatter: A(rgb(1, 0.85, 0.95), rgb(0.7, 0.35, 0.6), undefined, 0, 'streaks', 0.3, -0.3, 0.4, V), // pure swirl
  rot: A(rgb(0.7, 0.82, 0.35), rgb(0.35, 0.42, 0.14), 'bubble', 0.1, 'none', 0.3, 0.3, 0.3, V),
  arcane: A(rgb(0.92, 0.6, 1), rgb(0.55, 0.25, 0.92), 'noise_mote', 0.3, 'streaks', 0, -0.5, 0, TALL),
  soul: A(rgb(0.7, 1, 0.78), rgb(0.2, 0.78, 0.45), 'aura_mote', 0.4, 'none', 0.3, 0.2, 0.3, V),
  sleep: A(rgb(0.72, 0.72, 1), rgb(0.35, 0.32, 0.7), 'sleep_z', 0.2, 'none', 0, 0.2, 0.5, V),
}

// ── ELEMENT APPEARANCE MAP (phase B): each cast element drives its REAL pack .gdshader look (vfx_pack_shaders_expansion.js),
// retiring the generic FBM `flame` that faked water/air/neutral/heal in phase A. `main` = the primary emitters
// (gather / head / motes); `soft` = the secondary aura/glow layer (a different pack look per element = variety).
// fire keeps FlameFX `fire`; water→ElementalMagic wave-orb; air→ElectricFX lightning; neutral→BattleFX arcane
// mote; heal→StatusFX holy cross. The `flame`/`smoke` generic bodies these replaced are now UNREFERENCED (dead).
const LOOK =
  /** @type {Record<string, { main: string, soft: string, core?: string, ember?: string, trail?: string }>} */ ({
    // ember/trail default to a REAL pack look per element (was the generic FBM `spark` — constraint: cut EVERY non-Godot
    // effect): fire → its own FlameFX `fire`; air/heal → the StatusFX aura_mote; neutral → BattleFX arcane_mote.
    fire: { main: 'fire', soft: 'fire', ember: 'fire', trail: 'fire' },
    // water = the FULL ElementalMagic projectile set on screen (all six sub-shaders): orb (projectile_core head/
    // gather) · streak (projectile_streaks aura) · tail (projectile_tail wake) · flare (cast_flare gather core) ·
    // mote (projectile_particles embers) · area (area_ground eruption/glyph ground). The richest, most varied cast.
    water: { main: 'elem_orb', soft: 'elem_streak', core: 'elem_flare', ember: 'elem_mote', trail: 'elem_tail' },
    air: { main: 'zap', soft: 'aura_mote', ember: 'aura_mote', trail: 'aura_mote' },
    neutral: { main: 'arcane_mote', soft: 'aura_mote', ember: 'arcane_mote', trail: 'arcane_mote' },
    heal: { main: 'heal_cross', soft: 'aura_mote', ember: 'aura_mote', trail: 'aura_mote' },
  })

// ── ASSEMBLE the spell-chain library. Charge + bolt per cast element; a remnant loop per cast element; the three
// bursts; the status-aura loops; the trap/glyph ground decals. All merged into PRESETS by vfx_presets_data.js.
export const SPELL_PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
for (const el of /** @type {const} */ (['fire', 'water', 'air', 'neutral', 'heal'])) {
  const p = EL[el]
  const L = LOOK[el]
  const soft = L.soft ?? L.main
  SPELL_PRESETS[`charge_${el}`] = charge_preset({
    name: `charge_${el}`,
    hot: p.hot,
    body: p.body,
    look: L.main,
    core_look: L.core,
    ember_look: L.ember,
    emission: 1.5,
  })
  SPELL_PRESETS[`bolt_${el}`] = bolt_preset({
    name: `bolt_${el}`,
    hot: p.hot,
    body: p.body,
    deep: p.deep,
    look: L.main,
    soft,
    trail_look: L.trail,
    emission: 1.5,
    // fire's head read as a tiny white blob at fight distance (measured); give it a bigger, denser, SATURATED
    // head so it reads as tall COLOURED flames (the FlameFX pack look), not a white-washed dot.
    ...(el === 'fire'
      ? { head_sat: true, head_count: 11, head_size: /** @type {[number,number]} */ ([1.7, 2.5]) }
      : {}),
    // water's elem_orb/elem_tail/elem_streak shaders are thin wobble/noise silhouettes (low peak alpha by
    // design — a flowing wisp, not a filled disc) that stayed near-invisible even after a count/size bump alone
    // (tint-polish pass, 2026-07-13 — air/water read as washed out; measured: bigger head_size barely moved
    // the rendered footprint — the shape reads thin no matter the quad scale, so BRIGHTNESS is the working lever).
    // head_sat swaps the white→pale-hot fade for hot→body (drops the white, holds the sapphire hue); the emission
    // bump (shared by head+trail+aura) is what actually lifts it to fire's presence.
    ...(el === 'water'
      ? { head_sat: true, head_count: 14, head_size: /** @type {[number,number]} */ ([2.0, 2.8]), emission: 3 }
      : {}),
  })
  SPELL_PRESETS[`remnant_${el}`] = loop_preset({
    name: `remnant_${el}`,
    hot: p.hot,
    body: p.body,
    look: L.main,
    soft,
    emission: 1.3,
  })
}
// heal's remnant reads gentler (a soothe, not a residue) — a softer, lower column of rising holy crosses.
SPELL_PRESETS.remnant_heal = loop_preset({
  name: 'remnant_heal',
  hot: EL.heal.hot,
  body: EL.heal.body,
  look: 'heal_cross',
  soft: 'aura_mote',
  rise: 0.6,
  radius: 0.8,
})

SPELL_PRESETS.eruption_earth = eruption_preset({ name: 'eruption_earth', ...EL.earth })
SPELL_PRESETS.soul_death = soul_preset({ name: 'soul_death', ...EL.death })
SPELL_PRESETS.slash_weapon = slash_preset({ name: 'slash_weapon', hot: EL.weapon.hot, body: EL.weapon.body })

for (const [k, c] of Object.entries(STATUS)) {
  // REBUILT to the true StatusFX .tscn structure: aura + symbol + optional backdrop (sphere capsule / streaks), from
  // the ellipsoid emission VOLUME with Godot orbit/radial/vertical motion. Body glow = the on-model status_overlay
  // (create_status_overlay, mounted by the consumer on the char mesh) — NOT an egg. See STATUSFX_INVENTORY.
  SPELL_PRESETS[`status_${k}`] = aura_preset({
    name: `status_${k}`,
    hot: c.hot,
    body: c.body,
    look: c.look,
    sym: c.sym,
    backdrop: c.backdrop,
    motion: c.motion,
    symbol_life: c.symbol_life,
    emission: 1.4,
  })
}

// ── TRAP / GLYPH GROUND DECALS — persistent board decals (LAYER 2 — subtle pack-sourced
// ground ambiance UNDER the readable cell-blob LAYER 1; see vfx_map TRAP_GLYPH_VFX). Traps = warm HAZARD ground,
// glyphs = cool ARCANE rune zones. Low emission, colours ≤1 — persistent ⇒ never blooms (the sustained halo ceiling).
for (const el of /** @type {const} */ (['fire', 'water', 'air', 'earth'])) {
  const p = EL[el]
  const haze = el === 'air' ? 'zap_burst' : el === 'water' ? 'bubble' : 'aura_mote'
  SPELL_PRESETS[`trap_${el}`] = ground_decal_preset({
    name: `trap_${el}`,
    hot: p.hot,
    body: p.body,
    look: haze,
    rise: 0.35,
  })
}
const GLYPH = /** @type {Record<string, { hot:[number,number,number], body:[number,number,number] }>} */ ({
  arcane: { hot: EL.neutral.hot, body: EL.neutral.body },
  holy: { hot: EL.heal.hot, body: EL.heal.body },
  dark: { hot: EL.death.hot, body: EL.death.body },
  nature: { hot: STATUS.nature.hot, body: STATUS.nature.body },
})
for (const [k, c] of Object.entries(GLYPH))
  SPELL_PRESETS[`glyph_${k}`] = ground_decal_preset({
    name: `glyph_${k}`,
    hot: c.hot,
    body: c.body,
    look: 'aura_mote',
    rise: 0.3,
  })
