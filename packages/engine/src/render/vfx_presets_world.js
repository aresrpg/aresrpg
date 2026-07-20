// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — WORLD/AMBIENCE PROPS (class d_world). The FlameFX bonfire (6) + candle (12) pack scenes ported
// to PERSISTENT light-source fixtures for the dungeon rooms + the overworld: `world_bonfire_<tint>` campfires/
// braziers and `world_candle_<tint>_0N` wall-torches. Each is a LOOP preset (every particle's age wraps its
// lifetime → continuous rebirth) reusing the already-ported `fire` appearance (FlameFX fire_particle.gdshader in
// vfx_pack_shaders.js) — NO new shader (per the VFX_FULL_UTILIZATION_PLAN L7 "reuse fire_particle, no new shader").
//
// SOURCE OF TRUTH: every row in BONFIRE/CANDLE below is transcribed from its own `.tscn` (parsed with
// @fernforestgames/godot-resource-parser, census-verified 2026-07-12) — primary/secondary colour, particle
// `amount`, `lifetime`, and `initial_velocity`/`radial_velocity` off the ParticleProcessMaterial. The colour IS
// the scene identity (basic gold, cold pale, green, light cyan-white, purple, void deep-violet), so every fixture
// reads as its distinct pack scene.
//
// DIVERGENCES (documented per docs/VFX_PARITY_AUDIT.md — carried into code, not hidden):
//   • NO-HALO LAW. `preset_peak_luma` (the engine no-bloom unit test) caps a SUSTAINED emitter's colour luma under
//     the 2.05 bloom threshold; a persistent world fire must never blow a white halo. So every colour is clamp1'd
//     (≤1.0) — the pack's HDR values (void secondary (2.839,1.207,10.579); light/cold primaries >1) fold to ≤1
//     with NO visual loss: the `fire` shader picks the SATURATED (low-luma) slot for the flame body + drives its
//     own white-hot core, so it never consumed those HDR channels anyway. Emission is likewise capped to the
//     LOOP budget (pack emission 6/4 → ~2.2–2.6 bonfire / ~1.7–2.0 candle), relative bonfire>candle preserved.
//   • fire_particle's noise_scale/noise_scroll/color_curve are FIXED in the TSL port (the avatar-lane's shader),
//     so the per-scene values of those three params are not reproduced here — only the params the appearance
//     actually consumes (colour, emission) + the particle-system params (count, lifetime, velocity, gravity, size).
//   • The pack ships an OmniLight3D per scene; we render the flame GLOW via the particles' emission (the engine's
//     emissive idiom — cave_room lighting is emissive-block + BFS, not dynamic lights) and add NO per-fixture
//     dynamic light (ambient perf law: <0.3 ms, pooled/culled). fire_core.gdshader (the solid base mesh) is
//     evoked by a second denser low `fire` emitter — reuse, not a new shader.

import { create_vfx_preset } from './vfx_preset_engine.js'

/** @typedef {import('./vfx_preset_engine.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_engine.js').VfxEmitter} VfxEmitter */

/** Clamp a colour to ≤1 per channel — the no-bloom discipline for a SUSTAINED emitter (mirrors vfx_presets_spell).
 *  @param {[number,number,number]} c @returns {[number,number,number]} */
const clamp1 = (c) => [Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])]

/**
 * Build ONE persistent flame fixture (a LOOP fire) from a transcribed pack scene. Two emitters mirror the pack's
 * two visual nodes — a dense low `core` (the fire_core base heart) + a taller licking `flames` column
 * (fire_particle) — both reusing the `fire` appearance, rising on a gentle upward gravity and tapering out.
 * @param {object} s
 * @param {string} s.name preset id (e.g. `world_bonfire_basic`) — the gate greps `world_bonfire`/`world_candle`.
 * @param {[number,number,number]} s.pri pack primary_color — the flame's rendered hue (bright slot)
 * @param {[number,number,number]} s.sec pack secondary_color — transcribed PROVENANCE only. The pack's crimson
 *   mesh-secondary reads PINK on our blend_mix billboard (probe-proven), so the flame's 2nd hue is a warm EMBER
 *   deepened from the primary instead (see the ember note below) — a documented billboard-vs-mesh divergence.
 * @param {number} s.count pack GPUParticles3D `amount` @param {number} s.life pack `lifetime` (s)
 * @param {number} s.vel pack initial_velocity magnitude (isotropic flicker) @param {boolean} [s.radial] pack radial_velocity ±2 (bonfires)
 * @param {boolean} s.big bonfire (tall, bright) vs candle (small)
 * @returns {VfxPreset}
 */
function flame_fixture(s) {
  const pri = clamp1(s.pri)
  // 2-HUE FLAME — a single-hue read looks like flat smoke, not fire. The muddy read had TWO causes:
  // (1) capped emission (2.2 — too dim, the dark half of the flame read as
  // grey smoke) and (2) a lifeless darkened-primary accent (pri×0.5). fire_particle.gdshader's 2-hue model is
  // mix(primary, secondary, roll)·emission·(1−roll); the pack's raw secondary is a CRIMSON/magenta (basic
  // (0.686,0,0.18), G=0) authored for the MESH triplanar — fed to our `blend_mix` BILLBOARD at real emission it reads
  // PINK (probe-proven: after_world_bonfire_basic_pink.png). So the 2nd hue is a WARM EMBER deepened from the tint's
  // OWN primary → a gold→amber flame gradient, each scene deepening its own colour, never pink, never muddy.
  const ember = /** @type {[number,number,number]} */ ([pri[0], pri[1] * 0.55, pri[2] * 0.28])
  // Emission lifted well above the old dim 2.2/1.7 (the muddy read) but held to a warm-GLOW level (luma just over the
  // bloom knee), NOT the pack's raw 6.0 — a PERSISTENT world fire must glow without blowing a static white halo
  // (sustained-loop ceiling, same divergence class as the motion reinterpretation below). Blend stays NORMAL —
  // fire_particle.gdshader is `blend_mix` (verified vfx/extracted/**), NOT additive. The A/B still is the taste gate.
  const flame_em = s.big ? 3.2 : 2.6
  const core_em = s.big ? 3.6 : 3.0
  // Gentle upward drift + drag: the pack's gravity.y=4 over a ~2.4 s life would fling our BILLBOARD flame metres
  // high (the pack contains it with damping our 2D `fire` port lacks) — a softer rise + drag keeps a licking,
  // contained flame that reads right. A documented reinterpretation, same class as the audit's fire_particle note.
  const rise = s.big ? 2.2 : 1.4
  const base_r = s.big ? 0.5 : 0.16 // emission-base radius (foot of the flame)
  const fs = s.big ? /** @type {[number,number]} */ ([0.7, 1.6]) : /** @type {[number,number]} */ ([0.22, 0.5]) // licking-flame size
  const cs = s.big ? /** @type {[number,number]} */ ([0.7, 1.1]) : /** @type {[number,number]} */ ([0.22, 0.34]) // core size
  const core_off = s.big ? 0.35 : 0.1
  const flame_off = s.big ? 0.5 : 0.18
  /** @type {VfxEmitter[]} */
  const emitters = [
    // CORE — the fire_core base heart: a dense, low, short cluster hugging the fixture foot (the solid glowing base).
    {
      name: 'core',
      count: Math.max(6, Math.round(s.count * 0.35)),
      lifetime: s.life * 0.6,
      shape: 'sphere',
      radius: base_r,
      offset: [0, core_off, 0],
      speed: [0, s.vel * 0.4],
      spread: 180,
      gravity: [0, rise * 0.6, 0],
      drag: 1.8,
      size: cs,
      size_curve: [0.7, 1, 0.5],
      alpha_curve: [0.2, 1, 0.6, 0],
      appearance: 'fire',
      color: pri,
      color_end: ember,
      emission: core_em,
      opacity: 0.95,
    },
    // FLAMES — the fire_particle licking column: born at the base, rise + taper, isotropic flicker (+radial on
    // bonfires, the pack's radial_velocity ±2). `count`/`lifetime`/`vel` are the scene's own transcribed numbers.
    {
      name: 'flames',
      count: s.count,
      lifetime: s.life,
      shape: 'sphere',
      radius: base_r * 1.1,
      offset: [0, flame_off, 0],
      speed: [0, s.vel],
      spread: 180,
      ...(s.radial ? { radial: /** @type {[number,number]} */ ([-2, 2]) } : {}),
      gravity: [0, rise, 0],
      drag: 1.4,
      size: fs,
      size_curve: [0.5, 1, 0.35],
      alpha_curve: [0, 1, 0.75, 0],
      appearance: 'fire',
      color: pri,
      color_end: ember,
      emission: flame_em,
      opacity: 0.9,
    },
  ]
  return { name: s.name, duration: Math.max(1.6, s.life), loop: true, emitters }
}

// ── BONFIRE spec table — the 6 FlameFX bonfire scenes (vfx_<tint>_bonfire.tscn), census-transcribed 2026-07-12.
//    amount/lifetime/initial_velocity off the ParticleProcessMaterial; colours off fire_particle.gdshader params.
/** @type {Record<string, { pri:[number,number,number], sec:[number,number,number], count:number, life:number, vel:number }>} */
const BONFIRE = {
  basic: { pri: [1, 0.718, 0.29], sec: [0.686, 0, 0.18], count: 96, life: 2.4, vel: 1 },
  cold: { pri: [1, 1, 0.557], sec: [0.616, 0, 0.282], count: 96, life: 2.4, vel: 0.5 },
  green: { pri: [0.525, 1, 0.451], sec: [0, 0.357, 0.51], count: 64, life: 2.4, vel: 0.5 },
  light: { pri: [1.825, 1.643, 1.51], sec: [0, 0.788, 0.875], count: 64, life: 2.4, vel: 0.5 },
  purple: { pri: [0.776, 0.714, 1], sec: [0.063, 0, 0.973], count: 64, life: 2.4, vel: 0.5 },
  void: { pri: [0.02, 0, 0.137], sec: [2.839, 1.207, 10.579], count: 128, life: 2, vel: 0.2 },
}

// ── CANDLE spec table — the 12 FlameFX candle scenes (vfx_<tint>_candle_0N.tscn), census-transcribed 2026-07-12.
//    6 tints × 2 variants (a = scene _01, b = scene _02); candles carry no radial/initial_velocity (a still, small
//    flame), smaller counts + lives. Variant suffix is `_a`/`_b` (never a trailing `_NN`) so the name never collides
//    with the explosion/hit `_<scene>` impact-library naming the sibling preset test family-counts.
/** @type {Record<string, { pri:[number,number,number], sec:[number,number,number], count:number, life:number }>} */
const CANDLE = {
  basic_a: { pri: [1, 0.718, 0.29], sec: [0.686, 0, 0.18], count: 24, life: 0.8 }, // vfx_basic_candle_01
  basic_b: { pri: [1, 0.796, 0.285], sec: [0.747, 0.167, 0], count: 24, life: 0.8 }, // vfx_basic_candle_02
  cold_a: { pri: [0.998, 1, 0.558], sec: [0.617, 0, 0.281], count: 32, life: 0.9 }, // vfx_cold_candle_01
  cold_b: { pri: [0.999, 0.783, 0.704], sec: [0.967, 0.35, 0], count: 32, life: 0.8 }, // vfx_cold_candle_02
  green_a: { pri: [0.524, 1, 0.449], sec: [0, 0.357, 0.508], count: 24, life: 0.8 }, // vfx_green_candle_01
  green_b: { pri: [0.54, 1, 0.395], sec: [0, 0.377, 0.402], count: 32, life: 1.1 }, // vfx_green_candle_02
  light_a: { pri: [1.825, 1.643, 1.51], sec: [0, 0.788, 0.876], count: 24, life: 0.8 }, // vfx_light_candle_01
  light_b: { pri: [1.762, 1.587, 1.461], sec: [0, 0.788, 0.876], count: 32, life: 0.9 }, // vfx_light_candle_02
  purple_a: { pri: [0.776, 0.713, 1], sec: [0.061, 0, 0.972], count: 24, life: 0.8 }, // vfx_purple_candle_01
  purple_b: { pri: [0.776, 0.713, 1], sec: [0.061, 0, 0.972], count: 24, life: 0.8 }, // vfx_purple_candle_02
  void_a: { pri: [0.02, 0, 0.137], sec: [2.839, 1.207, 10.579], count: 24, life: 0.9 }, // vfx_void_candle_01
  void_b: { pri: [0.02, 0, 0.137], sec: [2.839, 1.207, 10.579], count: 24, life: 0.8 }, // vfx_void_candle_02
}

/** The 6 tints — a fixture picks a theme colour from here (world/dungeon biome → flame colour). */
export const FLAME_TINTS = /** @type {const} */ (['basic', 'cold', 'green', 'light', 'purple', 'void'])

/** The world/ambience LOOP presets, keyed by name (world_bonfire_<tint>, world_candle_<tint>_0N). Merged into the
 *  master PRESETS by vfx_presets_data.js exactly as SPELL_PRESETS is. @type {Record<string, VfxPreset>} */
export const WORLD_PRESETS = /** @type {Record<string, VfxPreset>} */ ({})
for (const [tint, r] of Object.entries(BONFIRE))
  WORLD_PRESETS[`world_bonfire_${tint}`] = flame_fixture({
    name: `world_bonfire_${tint}`,
    ...r,
    radial: true,
    big: true,
  })
for (const [key, r] of Object.entries(CANDLE))
  WORLD_PRESETS[`world_candle_${key}`] = flame_fixture({ name: `world_candle_${key}`, ...r, vel: 0, big: false })

/** Resolve a world-fixture preset name for a (kind, tint[, variant]) — the mount points name fixtures this way.
 *  @param {'bonfire'|'candle'} kind @param {string} tint one of FLAME_TINTS @param {1|2} [variant] candle scene 01→a / 02→b
 *  @returns {string} */
export function world_fixture_preset(kind, tint, variant = 1) {
  const t = FLAME_TINTS.includes(/** @type {any} */ (tint)) ? tint : 'basic'
  return kind === 'bonfire' ? `world_bonfire_${t}` : `world_candle_${t}_${variant === 2 ? 'b' : 'a'}`
}

/**
 * A live GROUP of mounted world-fixture VFX — the ONE mount/animation/teardown home shared by the dungeon
 * (cave_scene) + overworld (world_props) consumers. It owns a single rAF that advances every live fixture's age
 * (LOOP wrap) and two-phase-disposes retirees (removed from the scene NOW, freed one frame later — the transparent
 * pass may be mid-walk, the F1 crash class). Callers feed a DESIRED set via `set()`; the group reconciles (add
 * new, retire gone). The overworld caller recomputes its in-range set to distance-cull; the cave feeds a static set.
 * @param {any} engine EngineApi (add_to_scene / remove_from_scene)
 * @returns {{ set: (specs: WorldFixtureSpec[]) => void, count: () => number, set_visible: (v:boolean)=>void, dispose: ()=>void }}
 */
export function create_world_fixture_group(engine) {
  /** @typedef {{ key:string, preset:string, x:number, y:number, z:number, scale?:number, tint?:[number,number,number] }} WorldFixtureSpec */
  /** @type {Map<string, any>} */
  const live = new Map()
  /** @type {{ dispose: ()=>void }[]} */
  const pending = []
  let raf = 0
  let last = 0
  let visible = true
  let disposed = false

  const flush = () => {
    for (const h of pending) h.dispose()
    pending.length = 0
  }
  const retire = (/** @type {any} */ h) => {
    try {
      engine.remove_from_scene(h.object3d)
    } catch {
      /* already gone / pre-boot */
    }
    pending.push(h)
  }
  const ensure_loop = () => {
    if (raf || disposed) return
    last = (typeof performance !== 'undefined' ? performance : Date).now()
    raf = requestAnimationFrame(frame)
  }
  const frame = (/** @type {number} */ now) => {
    if (disposed) return
    flush() // dispose the PREVIOUS frame's retirees (≥1 render has passed since they left the scene)
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    for (const h of live.values()) h.update(dt) // advance age → the LOOP wraps (continuous rebirth)
    if (live.size === 0 && pending.length === 0) {
      raf = 0 // nothing live and nothing pending — idle; set() re-arms the loop
      return
    }
    raf = requestAnimationFrame(frame)
  }

  return {
    /** Reconcile the desired fixture set: mount new keys, retire absent ones. @param {WorldFixtureSpec[]} specs */
    set(specs) {
      if (disposed) return
      const want = new Map(specs.map((s) => [s.key, s]))
      for (const [key, h] of live) {
        if (want.has(key)) continue
        retire(h)
        live.delete(key)
      }
      for (const [key, s] of want) {
        if (live.has(key)) continue
        const preset = WORLD_PRESETS[s.preset]
        if (!preset) continue // unknown fixture name — skip (never throw on a bad table row)
        const handle = create_vfx_preset(preset, { position: [s.x, s.y, s.z], scale: s.scale ?? 1, tint: s.tint })
        try {
          engine.add_to_scene(handle.object3d)
          handle.object3d.visible = visible
          handle.age.value = 0.001 // nudge past birth so the first frame submits (pipeline compile + no dark pop)
          live.set(key, handle)
        } catch {
          handle.dispose() // pre-boot / no scene — never leak
        }
      }
      if (live.size) ensure_loop()
    },
    /** live fixture count (telemetry / tests). */
    count() {
      return live.size
    },
    /** hide/show every fixture (clean cinematic footage — mirrors world_spawns.set_hidden). @param {boolean} v */
    set_visible(v) {
      visible = v
      for (const h of live.values()) h.object3d.visible = v
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      for (const h of live.values()) retire(h)
      live.clear()
      flush() // teardown: free every queued handle now (the surface is going away)
    },
  }
}
