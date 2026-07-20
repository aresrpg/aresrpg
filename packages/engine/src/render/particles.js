// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NG2-ATMO ambient particles — floating motes near the ground + drifting leaves near trees. Minimal
// GPU particles: a tier-gated count of instanced camera-facing quads whose motion is a PURE FUNCTION
// of (per-particle seed, time). NO per-frame simulation state, no feedback buffer, no collision — a
// "deterministic-free visual zone": each particle's static random params (cell offset, phase, drift
// speed, size, kind) are baked ONCE into a storage buffer by a compute kernel at init; every frame
// the vertex positionNode re-derives world position from seed+time and WRAPS it inside a bounded box
// that follows the camera, so motes are always around the viewer with zero streaming/state.
//
// Two kinds share one buffer (a per-particle `kind` in [0,1)): MOTES (slow dust hanging just above
// ground, everywhere) and LEAVES (faster, falling+swaying, biased to near-tree/near-ground band).
// Density scales with the frozen tier `weather_particle_count` (tiers.js) via `particle_count_for`.
//
// SINGLE SOURCE OF TRUTH (sky_node.js / froxels.js idiom): the pure-JS `mote_position` /
// `particle_bounds` / `particle_count_for` are unit-tested (in-bounds for all seeds/times, wrap
// continuity, tier monotonicity); the TSL `create_particles()` positionNode mirrors `mote_position`
// op-for-op. GPU-pass correctness (the instanced draw) is the wiring wave's concern.
//
// RAIN BLUEPRINT (spec appendix — weather wave, post-cinematic-landing; owner-sourced): base design =
// three's webgpu_compute_particles_rain example (in-tree MIT, TSL compute; the example HTML isn't
// shipped via npm — fetch examples/webgpu_compute_particles_rain.html from the three.js repo @ r185).
// Its trick: a TOP-DOWN ORTHOGRAPHIC DEPTH MAP of the scene; each GPU raindrop collides/splashes at
// the first covered height, so rain never falls into caves or under canopy. OUR two upgrades:
// (1) seed the top-down occlusion map from the FAR-SHELL SECTION HEIGHTMAPS (already resident,
//     ~8KB/section) instead of a dedicated render-to-texture depth pass — evaluate both at build;
// (2) cull rain SPAWN over occluded cells using the per-voxel BFS SKYLIGHT nibble (covered ground ⇒
//     no spawn, not just kill-on-impact — cheaper, and no drops visible through overhangs).
// Companions: splash particles at impact + a global humidity boost into the existing PBR humid-patch
// roughness dip (rain = wet ground for free). SNOW variant for cold biomes = same system, slower
// fall + no splash. Tier budget = the same `weather_particle_count` this module's ambient layer
// draws from (ambient keeps its small PARTICLE_BUDGET_FRAC slice).

import { Vector3 } from 'three'
import { SpriteNodeMaterial } from 'three/webgpu'
import {
  Discard,
  Fn,
  If,
  Return,
  cameraPosition,
  float,
  hash,
  instanceIndex,
  instancedArray,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'

import { lerp } from '../core/math_utils.js'

/** default half-extent (m) of the camera-following particle box on X/Z. Motes fill this footprint. */
export const PARTICLE_BOX_XZ = 42
/** vertical span (m) of the particle box: from a bit below the camera to a bit above (near-ground band). */
export const PARTICLE_BOX_Y = 26
/** cap the instanced draw so even ULTRA's weather budget can't explode the ambient layer. */
export const PARTICLE_MAX = 6000
/** fraction of the tier weather budget spent on ambient motes/leaves (the rest is rain/snow, not ours). */
export const PARTICLE_BUDGET_FRAC = 0.02
/** mote quad world size (m) — sub-voxel dust speck (subtlety pass: shrunk so it reads as a mote, not a bubble). */
export const MOTE_SIZE = 0.045
/** leaf quad world size (m) — larger, visible tumble. */
export const LEAF_SIZE = 0.14
/** fraction of particles that are leaves (vs motes). */
export const LEAF_FRACTION = 0.35

// ── BIOME PARTICLE KINDS (ENGINE_AAA_PLAN §2 P7 "motion richness") ───────────────────────────────
// A named kind turns the SAME stateless field (seed+time → wrapped world pos) into a biome-specific
// ambient: swamp fireflies, meadow pollen, scorched embers, arctic snow, under-canopy leaf-fall. Each
// is a plain params record the motion + colour math read; NO new pass, NO simulation. The DEFAULT kind
// is `ambient` — the shipped mixed mote+leaf field (parity: `create_particles` with no `kind` runs the
// pre-B7 mote+leaf MOTION — now world-anchored for every kind alike, the depth-parallax fix). Kinds are PRESET-DRIVEN: biome_mood presets carry a
// `particle_kind` the wiring wave maps to `create_particles({kind})`; LOW budget = 0 particles kills
// every kind structurally (particle_count_for(0) === 0).
//
// NO-BLOOM LAW (the white-halo incident class): every kind colour channel is ≤ 1.0, so scene-linear
// luma < the bloom threshold 2.05 — emissive kinds (firefly/ember) self-glow as bright points WITHOUT
// a halo. `particles.test.js` asserts the ≤1.0 cap on every kind.
//
// Motion fields: vertical drift = `fall_base + speed·fall_range` blocks/s of SINK (negative ⇒ RISE, so
// embers float up); horizontal sway = `sin(t·(sway_base+speed·sway_range))·sway_amp`, the amplitude
// scaled by the shared GUST (below). `emissive` kinds multiply their colour by a bounded time flicker
// (∈[0.55,1.0], never exceeding the 1.0 cap). `flicker` is the flicker rate (Hz-ish).
/**
 * @typedef {object} KindParams
 * @property {number} fall_base  base vertical SINK, blocks/s (negative ⇒ rise)
 * @property {number} fall_range extra sink scaled by the per-particle speed roll
 * @property {number} sway_base  base horizontal sway rate
 * @property {number} sway_range extra sway rate scaled by speed
 * @property {number} sway_amp   horizontal sway amplitude (× GUST at draw)
 * @property {number} size       quad world size, m
 * @property {[number,number,number]} color base colour (channels ≤ 1.0 — no-bloom law)
 * @property {number} emissive   1 ⇒ self-glow + flicker; 0 ⇒ flat sprite
 * @property {number} flicker    flicker rate for emissive kinds (ignored when emissive 0)
 */
// SUBTLETY PASS (2026-07-12: particles fell too fast and read as plain white bubbles instead of subtle
// colored motes). Root cause was NOT a severed tint (colorNode already wired kp.color through —
// see create_particles below); it was under-saturated palette values (several kinds sat within ~0.15 of
// neutral grey, reading as "white" despite technically having a hue) stacked with a flat 0.5 global opacity
// (ambience.js BASE_OPACITY) and near-zero fall on the hover kinds (mote/pollen) — a static, pale, opaque
// round disc reads as "a bubble" regardless of its true colour. This pass: (1) pushes every non-white kind's
// channels further apart (more saturated, still light enough to stay a "pastel" mote, never harsh), (2) gives
// mote/pollen ("dust") a real — if slow — downward drift instead of a pure hover (leaf/snow already fell; they
// only needed to slow down + let their existing sway read as flutter/meander), (3) shrinks the dust-family
// sizes toward sub-voxel. Peak alpha now lives in ambience.js (BASE_OPACITY + per-row overrides), not here.
/** The concrete single-kind params. `ambient` is NOT here — it's the special mixed mote+leaf path.
 *  @type {Record<string, KindParams>} */
export const PARTICLE_KINDS = Object.freeze({
  // dust motes: slow hover NOW A SLOW FALL (barely-settling), warm caramel dust — the `ambient` field's
  // mote half as a standalone kind (dry biomes).
  mote: {
    fall_base: 0.06,
    fall_range: 0.1,
    sway_base: 0.22,
    sway_range: 0.32,
    sway_amp: 0.045,
    size: MOTE_SIZE,
    color: [0.68, 0.56, 0.4],
    emissive: 0,
    flicker: 0,
  },
  // leaf-fall (under canopy): gentler sink + flutter-tumble, richer green-amber — the `ambient` leaf half
  // standalone. Slowed from the original fast sink so it flutters down instead of dropping like a stone.
  leaf: {
    fall_base: 0.35,
    fall_range: 0.45,
    sway_base: 0.7,
    sway_range: 0.9,
    sway_amp: 0.13,
    size: LEAF_SIZE,
    color: [0.58, 0.66, 0.28],
    emissive: 0,
    flicker: 0,
  },
  // fireflies (night swamp): near-hang with a lazy bob, warm amber-gold glow, EMISSIVE point that blinks.
  firefly: {
    fall_base: 0.015,
    fall_range: 0.04,
    sway_base: 0.3,
    sway_range: 0.5,
    sway_amp: 0.1,
    size: 0.08,
    color: [0.95, 0.72, 0.28],
    emissive: 1,
    flicker: 2.4,
  },
  // pollen (noon meadow): NOW barely-settles (a slow real fall, not a pure hover), warm gold — carries the
  // gust the most.
  pollen: {
    fall_base: 0.05,
    fall_range: 0.08,
    sway_base: 0.3,
    sway_range: 0.5,
    sway_amp: 0.16,
    size: 0.04,
    color: [0.92, 0.78, 0.36],
    emissive: 0,
    flicker: 0,
  },
  // embers (scorched badlands): RISE (negative fall) with a hot flicker, vivid orange, EMISSIVE.
  ember: {
    fall_base: -0.5,
    fall_range: -0.3,
    sway_base: 0.5,
    sway_range: 0.6,
    sway_amp: 0.1,
    size: 0.06,
    color: [1.0, 0.45, 0.13],
    emissive: 1,
    flicker: 3.6,
  },
  // snow (arctic/glacier): slowed fall so the existing sway reads as a MEANDER (wander) rather than a
  // straight drop, cool white-blue — no glow.
  snow: {
    fall_base: 0.22,
    fall_range: 0.18,
    sway_base: 0.4,
    sway_range: 0.4,
    sway_amp: 0.09,
    size: 0.1,
    color: [0.9, 0.94, 1.0],
    emissive: 0,
    flicker: 0,
  },
  // bubble (UNDERWATER ambience — S-AMBIENCE): RISES toward the surface (negative fall, slower than embers)
  // with a gentle side-to-side wobble; pale cyan-white, non-emissive (channels ≤1.0 no-bloom law).
  bubble: {
    fall_base: -0.4,
    fall_range: -0.25,
    sway_base: 0.5,
    sway_range: 0.6,
    sway_amp: 0.06,
    size: 0.07,
    color: [0.7, 0.85, 0.95],
    emissive: 0,
    flicker: 0,
  },
  // sand (DESERT dunes wisps — S-AMBIENCE): near-horizontal wind drift (low fall, the widest sway so it
  // carries the shared GUST most), richer warm sand, small. The dry-heat companion to the (declared) heat shimmer.
  sand: {
    fall_base: 0.12,
    fall_range: 0.08,
    sway_base: 0.6,
    sway_range: 0.7,
    sway_amp: 0.18,
    size: 0.04,
    color: [0.78, 0.6, 0.36],
    emissive: 0,
    flicker: 0,
  },
})

// ── SHARED WIND GUST (ENGINE_AAA_PLAN §2 P7 "wind-field tie") ────────────────────────────────────
// ONE scalar the whole world reads so "everything breathes in the same wave": the particle sway
// amplitude reads GUST here; the flora-sway vertex (terrain_flora.js) can import this SAME handle in
// the C5 grass wave so motes and grass gust TOGETHER (the plan's single-CPU-gust-value law). GUST is a
// module SINGLETON (one home) idling at 1.0 — a CPU driver calls `advance_gust(dt)` each frame to
// breathe it; with no driver it stays 1.0, so the shipped ambient field is byte-identical (parity).
/** Gust amplitude floor/ceiling (mean ≈ 1.0 so `×GUST` is neutral at rest). */
export const GUST_MIN = 0.55
export const GUST_MAX = 1.6
/** The shared gust scalar uniform (particles + flora sway read the SAME node). Idles at 1.0. */
export const GUST = uniform(1)
let _gust_t = 0
/**
 * Slow 2-octave breathing gust in [GUST_MIN, GUST_MAX] (mean ≈ 1.0). PURE — a CPU driver advances `t`;
 * the sum of the two sines is remapped [-1,1]→[0,1]→[MIN,MAX]. Bounded + continuous for all t.
 * @param {number} t seconds @returns {number} gust multiplier
 */
export function gust_at(t) {
  const s = 0.5 + 0.35 * Math.sin(t * 0.11) + 0.15 * Math.sin(t * 0.037 + 1.7) // ~[0,1], two decorrelated octaves
  const u = s < 0 ? 0 : s > 1 ? 1 : s
  return GUST_MIN + (GUST_MAX - GUST_MIN) * u
}
/**
 * Advance the shared gust by `dt` seconds and write GUST.value. The ONE driver seam (engine tick, or a
 * pose spec). Ignores negative dt. @param {number} dt @returns {number} the new gust value
 */
export function advance_gust(dt) {
  _gust_t += dt > 0 ? dt : 0
  GUST.value = gust_at(_gust_t)
  return GUST.value
}

/** @typedef {import('../core/quality/tiers.js').TierName} TierName */

/**
 * Ambient particle count for a tier, derived from its frozen `weather_particle_count`. A small
 * fraction of the weather budget (the bulk is precipitation, not ambient), clamped to `PARTICLE_MAX`.
 * low → 0 (weather budget is 0). Monotonic non-decreasing up the tier ladder.
 * @param {number} weather_particle_count the tier's `weather_particle_count` (tiers.js)
 * @returns {number} integer particle count
 */
export function particle_count_for(weather_particle_count) {
  const n = Math.floor(Math.max(0, weather_particle_count) * PARTICLE_BUDGET_FRAC)
  return Math.min(n, PARTICLE_MAX)
}

/**
 * The camera-following particle box as [min, max] world corners for a camera position. Particles are
 * wrapped into this AABB, so they always surround the viewer. Half-extent PARTICLE_BOX_XZ on X/Z; the
 * Y band sits mostly below the camera (near-ground motes) up to a little above eye level.
 * @param {[number,number,number]} cam world camera position
 * @returns {{ min:[number,number,number], max:[number,number,number] }}
 */
export function particle_bounds(cam) {
  return {
    min: [cam[0] - PARTICLE_BOX_XZ, cam[1] - PARTICLE_BOX_Y * 0.7, cam[2] - PARTICLE_BOX_XZ],
    max: [cam[0] + PARTICLE_BOX_XZ, cam[1] + PARTICLE_BOX_Y * 0.3, cam[2] + PARTICLE_BOX_XZ],
  }
}

/** @param {number} a @param {number} n @returns {number} positive modulo ∈ [0,n) (matches TSL `mod`). */
const mod = (a, n) => a - n * Math.floor(a / n)
// lerp imported from ../core/math_utils.js (canonical).

/**
 * World position of particle `i` at `t` seconds, given the camera position and per-particle random
 * seeds. PURE — no state; identical (i, t, cam, seeds) always yields the same point. The TSL
 * positionNode mirrors this exactly. Motion is WORLD-ANCHORED: a fixed world lattice point (a hash-seeded
 * offset) plus a world-space drift (leaves fall + sway faster than motes float) that ignores the camera;
 * the camera-following box only WRAPS it modulo the box span, re-centring the mote onto the trailing face.
 * So a mote holds its world position as the camera slides past — near-fast / far-slow depth parallax, not a
 * camera-glued screen sticker — while the field stays a seamless, stateless, infinite volume around the viewer.
 * A named `opts.kind` (∈ PARTICLE_KINDS) makes the whole field that kind (embers rise, snow sinks slow,
 * fireflies hang); omit it (or pass 'ambient') for the shipped mixed mote+leaf field — BYTE-IDENTICAL to
 * pre-B7. `opts.gust` (default 1) scales the horizontal sway (the shared wind gust); the TSL mirrors both.
 * @param {number} i particle index
 * @param {[number,number,number]} cam camera world position
 * @param {number} t time seconds
 * @param {{ off:[number,number,number], phase:number, speed:number, kind:number }} seed per-particle static params (kind<LEAF_FRACTION ⇒ leaf, ambient path only)
 * @param {{ kind?: string, gust?: number }} [opts] kind name (default 'ambient' mixed field) + gust multiplier
 * @returns {[number,number,number]} world position inside particle_bounds(cam)
 */
export function mote_position(i, cam, t, seed, opts = {}) {
  const b = particle_bounds(cam)
  const span_x = b.max[0] - b.min[0]
  const span_y = b.max[1] - b.min[1]
  const span_z = b.max[2] - b.min[2]
  const gust = opts.gust ?? 1
  const kp = opts.kind && opts.kind !== 'ambient' ? PARTICLE_KINDS[opts.kind] : null
  let fall
  let sway_rate
  let sway_amp
  if (kp) {
    // Named single-kind field: drift/sway from the kind params (negative fall ⇒ rise).
    const { fall_base, fall_range, sway_base, sway_range, sway_amp: kamp } = kp
    fall = fall_base + seed.speed * fall_range
    sway_rate = sway_base + seed.speed * sway_range
    sway_amp = kamp
  } else {
    // AMBIENT (default) — the shipped mixed field, unchanged: leaves sink, motes hover.
    const is_leaf = seed.kind < LEAF_FRACTION
    fall = is_leaf ? 0.9 + seed.speed * 0.8 : 0.02 + seed.speed * 0.05
    sway_rate = is_leaf ? 0.8 + seed.speed : 0.25 + seed.speed * 0.4
    sway_amp = is_leaf ? 0.14 : 0.05
  }
  sway_amp *= gust // shared wind gust (1 at rest ⇒ ambient parity)
  // WORLD-ANCHORED position (the parallax fix). `base` is a FIXED world lattice point (off·span) plus a
  // world-space drift (sway·span on XZ, −t·fall metres on Y) — it does NOT depend on the camera. The
  // camera-following box only WRAPS it: mod(base−min, span) re-centres the mote by a FULL span onto the
  // box's trailing face. So between wraps the mote holds its world position while the camera slides past it
  // ⇒ near motes sweep the view faster than far ones (depth parallax), NOT the old camera-space fract that
  // pinned every mote to a constant screen offset (the "sticker" read). The TSL positionNode mirrors this.
  const base_x = seed.off[0] * span_x + Math.sin(t * sway_rate + seed.phase) * sway_amp * span_x
  const base_y = seed.off[1] * span_y - t * fall
  const base_z = seed.off[2] * span_z + Math.cos(t * sway_rate * 0.9 + seed.phase) * sway_amp * span_z
  return [
    b.min[0] + mod(base_x - b.min[0], span_x),
    b.min[1] + mod(base_y - b.min[1], span_y),
    b.min[2] + mod(base_z - b.min[2], span_z),
  ]
}

/**
 * Derive a particle's static seed params from its index the SAME way the compute kernel does (a
 * small hash chain), so a test can validate `mote_position` against the shipped seeding.
 * @param {number} i particle index @param {number} salt run salt @returns {{off:[number,number,number],phase:number,speed:number,kind:number}}
 */
export function particle_seed(i, salt = 0) {
  const h = (/** @type {number} */ n) => {
    let x = (i * 0x9e3779b1 + n * 0x85ebca77 + salt) >>> 0
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0
    x = Math.imul(x ^ (x >>> 13), 0x297a2d39) >>> 0
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296
  }
  return {
    off: /** @type {[number,number,number]} */ ([h(1), h(2), h(3)]),
    phase: h(4) * Math.PI * 2,
    speed: h(5),
    kind: h(6),
  }
}

/** @param {number} kind @returns {number} quad world size for this particle kind. */
export function particle_size(kind) {
  return kind < LEAF_FRACTION ? LEAF_SIZE : MOTE_SIZE
}

/** Radial alpha below this (a quad corner) is DISCARDED — the round-sprite crop threshold. */
export const SPRITE_ALPHA_EPS = 0.01

/** @param {number} e0 @param {number} e1 @param {number} x @returns {number} scalar smoothstep (mirrors TSL). */
const smoothstep_s = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-9)))
  return t * t * (3 - 2 * t)
}

/**
 * THE ROUND-SPRITE SOFT FALLOFF (THE TORMENTOR fix) — the alpha multiplier at a quad UV, the exact shape
 * the material's `colorNode` mirrors op-for-op. The quad is a PlaneGeometry(1,1) (uv 0→1); alpha fades from
 * 1 at the centre to 0 at the inscribed-circle edge (radius 0.5) via a SQUARED smoothstep, so the square
 * CORNERS (dist > 0.5, up to 0.707) read 0 and never accumulate into camera-concentric arc-shells. PURE —
 * unit-tested against the shape contract (centre opaque, corners transparent, monotonic, no crisp rim).
 * @param {number} u @param {number} v quad UV in [0,1] @returns {number} alpha multiplier ∈ [0,1]
 */
export function sprite_falloff(u, v) {
  const dx = u - 0.5
  const dy = v - 0.5
  const s = smoothstep_s(0.5, 0.0, Math.sqrt(dx * dx + dy * dy))
  return s * s
}

// unused-import guard (kept for symmetry with the sibling atmosphere factories' toolkits).
void lerp

// --- TSL factory ---------------------------------------------------------------------------------

/**
 * @typedef {object} ParticlesOptions
 * @property {number} [count] explicit particle count (else derive from `weather_particle_count`).
 * @property {number} [weather_particle_count] tier weather budget → `particle_count_for` (default 0).
 * @property {number} [salt] seeding salt (forks the field deterministically).
 * @property {[number,number,number]} [tint] base particle color (default warm dust; AMBIENT kind only).
 * @property {string} [kind] a PARTICLE_KINDS name (firefly/pollen/ember/snow/leaf/mote/bubble/sand) — the
 *   whole field becomes that ambient. Omit / 'ambient' ⇒ the shipped mixed mote+leaf field (byte-identical).
 */

/**
 * @typedef {object} ParticlesHandle
 * @property {*} object the `Sprite`/instanced draw node object to `scene.add` (null when count 0).
 * @property {number} count live particle count.
 * @property {*} opacity `uniform(float)` — global fade (day/weather driven; wiring sets it).
 * @property {(renderer:*)=>Promise<void>} bake run the seed compute kernel once (await at setup).
 * @property {()=>void} dispose release GPU buffers.
 */

/**
 * Build the ambient particle system: a compute kernel that bakes per-particle seeds ONCE, an
 * instanced sprite whose positionNode animates them from seed+`time` (mirrors `mote_position`), and
 * a global opacity uniform. Nothing runs until `bake(renderer)`; the draw is added by the wiring
 * wave. Count 0 (low / no budget) ⇒ `object` is null and bake is a no-op.
 * @param {ParticlesOptions} [opts]
 * @returns {ParticlesHandle}
 */
export function create_particles(opts = {}) {
  const count = opts.count ?? particle_count_for(opts.weather_particle_count ?? 0)
  const salt = opts.salt ?? 0
  const tint = opts.tint ?? [0.86, 0.82, 0.72]
  const opacity = uniform(0.5)
  // Named biome kind (null ⇒ the ambient mixed field). Unknown key fails LOUD (never silently mis-draws).
  const kp = opts.kind && opts.kind !== 'ambient' ? PARTICLE_KINDS[opts.kind] : null
  if (opts.kind && opts.kind !== 'ambient' && !kp) throw new Error(`unknown particle kind "${opts.kind}"`)

  if (count <= 0) {
    return {
      object: null,
      count: 0,
      opacity,
      bake: async () => {},
      dispose: () => {},
    }
  }

  // per-particle static seed buffer: vec4(offX, offY, offZ, packed) where packed encodes phase/speed/
  // kind; a second vec4 carries (kind, size, phase, speed) so the position math has them directly.
  const seeds = instancedArray(count, 'vec4') // off.xyz + kind
  const params = instancedArray(count, 'vec4') // phase, speed, size, _

  const seed_kernel = Fn(() => {
    const i = instanceIndex
    If(i.greaterThanEqual(count), () => {
      Return()
    })
    const fi = float(i)
    // hash chain mirrors particle_seed() closely enough for the visual field (exact bit-match is not
    // required — the JS reference is the TESTED contract; the GPU seeds just need the same statistics).
    const s = float(salt)
    const ox = hash(fi.add(s).add(11.1))
    const oy = hash(fi.add(s).add(22.2))
    const oz = hash(fi.add(s).add(33.3))
    const kind = hash(fi.add(s).add(44.4))
    const phase = hash(fi.add(s).add(55.5)).mul(Math.PI * 2)
    const speed = hash(fi.add(s).add(66.6))
    const size = kind.lessThan(LEAF_FRACTION).select(float(LEAF_SIZE), float(MOTE_SIZE))
    seeds.element(i).assign(vec4(ox, oy, oz, kind))
    params.element(i).assign(vec4(phase, speed, size, 0))
  })().compute(count)
  seed_kernel.setName('ambientParticleSeed')

  const material = new SpriteNodeMaterial()
  material.transparent = true
  // Bubbles WRITE depth; every other ambient kind stays depthWrite:false (standard alpha-blend). WHY: the
  // underwater immersion fog (render/lighting/underwater.js `apply()`, woven in post_stack.js) grades each
  // pixel by frag_dist reconstructed from the OPAQUE scene_depth buffer. A depthWrite:false bubble leaves
  // the depth of the far surface BEHIND it in that buffer, so the post fogs the bubble by THAT distance
  // (open water ⇒ dist ≫ visibility_m 15 ⇒ fog≈1) and `mix(col, target, fog)` overwrites the bubble with
  // flat fog colour — the invisible-bubble bug (ambience.js root-cause note). Writing the bubble's OWN
  // (near) depth makes the SAME post fog grade each bubble by its true distance: near bubbles read through,
  // far bubbles dissolve into the murk — physically honest, and NO extra pass / mask / fog rework. Safe
  // because the ambient bubble field is SPARSE (~2.8 m mean spacing, 0.08 m sprites) so depth-write
  // self-occlusion between overlapping bubbles is vanishingly rare, and the round-disc corners are
  // Discard()ed below (no depth written there ⇒ no square silhouettes, the TORMENTOR class stays dead).
  material.depthWrite = opts.kind === 'bubble'

  // positionNode: mirror mote_position — camera-following box, seed offset + time drift, wrapped.
  const seed = seeds.element(instanceIndex)
  const par = params.element(instanceIndex)
  const kind = seed.w
  const is_leaf = kind.lessThan(LEAF_FRACTION)
  const off = seed.xyz
  const phase = par.x
  const speed = par.y
  const size = par.z

  const box_min = cameraPosition.sub(vec3(PARTICLE_BOX_XZ, PARTICLE_BOX_Y * 0.7, PARTICLE_BOX_XZ))
  const span = vec3(PARTICLE_BOX_XZ * 2, PARTICLE_BOX_Y, PARTICLE_BOX_XZ * 2)

  // Motion + look: a named kind (kp) uses constant params + the kind colour; ambient keeps the shipped
  // mote/leaf selects + tint. The shared GUST scales sway either way (1 at rest ⇒ ambient parity). The
  // fx/fy/fz wrap math is identical to `mote_position` (the tested JS reference) in both branches.
  let fall
  let sway_rate
  let sway_amp
  let size_node
  let col
  if (kp) {
    fall = float(kp.fall_base).add(speed.mul(kp.fall_range)) // negative ⇒ rise (embers)
    sway_rate = float(kp.sway_base).add(speed.mul(kp.sway_range))
    sway_amp = float(kp.sway_amp).mul(GUST)
    size_node = float(kp.size)
    const base = vec3(kp.color[0], kp.color[1], kp.color[2])
    // emissive kinds (firefly/ember) breathe a BOUNDED flicker ∈[0.55,1.0] — never over the 1.0 colour
    // cap, so scene-linear luma stays < the 2.05 bloom threshold (no halo — the white-halo incident law).
    col = kp.emissive ? base.mul(time.mul(kp.flicker).add(phase).sin().mul(0.225).add(0.775)) : base
  } else {
    fall = is_leaf.select(float(0.9).add(speed.mul(0.8)), float(0.02).add(speed.mul(0.05)))
    sway_rate = is_leaf.select(float(0.8).add(speed), float(0.25).add(speed.mul(0.4)))
    sway_amp = is_leaf.select(float(0.14), float(0.05)).mul(GUST)
    size_node = size
    // Leaves read a touch greener than the warm dust tint.
    const leaf_tint = vec3(tint[0] * 0.72, tint[1] * 0.85, tint[2] * 0.5)
    col = is_leaf.select(leaf_tint, vec3(tint[0], tint[1], tint[2]))
  }

  // WORLD-ANCHORED position (parallax fix) — mirrors mote_position() op-for-op. `base` is a FIXED world
  // lattice point (off·span) + world-space drift (sway·span on XZ, −t·fall metres on Y); it does NOT read
  // the camera. The camera box only WRAPS it: mod(base−box_min, span) re-centres each mote by a FULL span
  // onto the trailing face, so between wraps the mote keeps its world position while the camera slides past
  // ⇒ near-fast / far-slow depth parallax, not the old camera-space fract that pinned motes to a constant
  // screen offset (the "sticker" read).
  const drift_x = time.mul(sway_rate).add(phase).sin().mul(sway_amp).mul(span.x)
  const drift_z = time.mul(sway_rate.mul(0.9)).add(phase).cos().mul(sway_amp).mul(span.z)
  const drift_y = time.mul(fall).negate() // world metres of sink (negative fall ⇒ rise)
  const base = vec3(off.x.mul(span.x).add(drift_x), off.y.mul(span.y).add(drift_y), off.z.mul(span.z).add(drift_z))
  const world = box_min.add(base.sub(box_min).mod(span))

  material.positionNode = world
  material.scaleNode = size_node
  // ROUND SOFT SPRITE (THE TORMENTOR fix — kills the square-sprite read). The quad is a PlaneGeometry(1,1),
  // so `uv()` runs 0→1 across it; fade alpha radially from the centre with a SQUARED smoothstep (the glow-disc
  // idiom, mirrors `sprite_falloff`) so the corners (dist > 0.5) vanish — no hard translucent squares to
  // accumulate into camera-concentric arc-shells. The Discard rides the colorNode Fn OUTPUT GRAPH (phantom-
  // discard law: a bare .discard() at material-build scope is dead code, never reaches the WGSL — far_field.js);
  // corner fragments below EPS drop out, sparing the blend on the invisible ring. Alpha only ever SHRINKS
  // (× soft ≤ 1) so the written colour = col·opacity·soft ≤ col ≤ 1.0 — the no-bloom luma cap is preserved.
  material.colorNode = Fn(() => {
    const p = uv().sub(0.5)
    const shape = smoothstep(0.5, 0.0, p.length()) // 1 at centre → 0 at the inscribed-circle edge (radius 0.5)
    const soft = shape.mul(shape) // squared ⇒ a soft gaussian-ish dust dot (no crisp rim)
    If(soft.lessThan(SPRITE_ALPHA_EPS), () => Discard())
    return vec4(col, opacity.mul(soft))
  })()

  // The concrete instanced draw object (Sprite over the instanced material) is assembled at wiring —
  // this factory owns the material + seed kernel; the wiring wave attaches it to a count-instanced
  // Sprite/Mesh and scene.add's it. We expose the material as `object` for the wiring to mount.
  const object = material

  /** @param {*} renderer */
  const bake = async (renderer) => {
    await renderer.computeAsync(seed_kernel)
  }
  const dispose = () => {
    material.dispose()
  }

  return { object, count, opacity, bake, dispose }
}
