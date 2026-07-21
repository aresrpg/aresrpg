// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENVIRONMENT AMBIENCE DIRECTOR (S-AMBIENCE, owner wishlist: "terrain particles according to the
// environment — subtle leaves falling / dust under canopies, bubbles + blur underwater, heat vision in
// the desert, snowflakes in the mountains"). This is the PARTICLE POLICY layer over the ONE particle
// machinery (render/particles.js) — it never spawns a second particle system. particles.js owns the
// camera-following wrap-around field + the biome KINDS; this module owns WHICH kind plays where, the
// crossfade between them, the under-canopy gate, and the underwater bubble burst.
//
// HOME JUSTIFICATION (the brief's "pick ONE home, justify in a line"): particles.js is purpose-built for a
// camera-following, wrap-around, tier-budgeted ambient field — exactly this need; vfx_preset_engine.js is
// for world-ANCHORED ballistic fight bursts. So the machinery is particles.js; the GPU mount mirrors
// vfx_preset_engine's proven InstancedMesh(PlaneGeometry) pattern (demo/particles_probe.html renders it).
//
// ⚠️ TORMENTOR GATE, RESOLVED (2026-07-12, ruling): the ambient particle DRAW read as concentric
// arc-shells / "a huge low-res circle following me" from inside the camera box — root cause was
// particles.js's SQUARE sprite alpha, fixed by sprite_falloff's round soft-edge crop (unit-tested shape
// contract + a flat shell-test at every framing, 43 green). Gauntlet passed ⇒ this director is DEFAULT ON
// (engine.js) — LOW's weather_particle_count is 0 in tiers.js so it constructs to zero draws there for
// free, no tier check needed. Escape: ?ambience=0 (the falls/skycouple/sunfollow house convention).
// The SEPARATE legacy generic weather field at atmosphere.js:726 (its own create_particles() instance,
// never scene-mounted) stays owner-disabled — untouched by this flip, not resurrected. The PURE core
// below (table / selector / canopy / crossfade / burst) is unit-tested.
//
// ⚠️ BUBBLE-VISIBILITY ROOT-CAUSE CORRECTION (2026-07-12): a proof sweep read the submerged bubble field
// as invisible and pinned it on THIS file's ambience.js:285 gate (`slot.baked && slot.cur > 0.001`) never
// opening. Direct instrumentation (`debug_slots()` below + create_ambience.test.js) disproves that: the
// bubble slot bakes, ramps `cur` to its target, and flips `mesh.visible = true` exactly like every other
// kind — the sweep's mesh dump had no kind label and mis-picked two SNOW/MOTE meshes (coincidentally also
// count 2100, same density 0.35) as "the bubble ones". The REAL defect lives one layer up: the underwater
// screen-space fog (render/lighting/underwater.js `apply()`, woven in render/lighting/post_stack.js) grades
// on `frag_dist` reconstructed from the OPAQUE `scene_depth` buffer; these particles are `depthWrite:false`
// (correct, standard alpha-blend), so a bubble's pixel reads the depth of whatever opaque surface sits
// BEHIND it — usually far past `visibility_m` (15) in open water — and the fog mix (`out = mix(col,
// target, fog)`, fog≈1) overwrites the correctly-rendered bubble pixel with the flat fog colour. Confirmed
// by A/B (pin `window.__underwater.active.value` to 0 while genuinely submerged): bubbles are clearly
// visible with the fog composite bypassed, invisible with it on. That fix is out of this file's scope —
// tracked separately; this file's own contract (submerged → baked/cur/visible) is what's unit-tested here.
// ⚠️ SUBTLETY PASS (2026-07-12: particles fell too fast, reading as plain white bubbles instead of
// subtle colored motes): the per-kind palette/motion tuning lives in particles.js
// (PARTICLE_KINDS — see its own dated note); THIS file's contribution is ALPHA — BASE_OPACITY dropped
// 0.5→0.2 (peak sprite alpha now reads as "barely there" instead of a near-solid disc) and the emissive
// kinds (firefly/ember) get an explicit lower `opacity` row override (0.15) since a self-glowing sprite
// reads brighter than a flat one at the same alpha. Density (the OTHER subtlety knob) is UNCHANGED —
// tier-budgeted counts stay as authored; alpha + palette + motion carry this pass, not more particles.
// CONFIG-FIRST: the environment→emitter map is the exported AMBIENCE_TABLE data (keyed by biome NAME, the
// universal identity — for the 5 biome-recipe worlds the climate biome IS the identity; region worlds pin
// biomes too, though the main-thread selector uses the climate biome twin `world_biome_at`, same as the
// B5 mood driver). SUBTLE IS THE LAW: densities are small ×count knobs; LOW tier ⇒ base count 0 ⇒ off.

import { InstancedMesh, PlaneGeometry } from 'three'

import { get_biome_by_id } from '../config/biome_registry.js'

import { advance_gust, create_particles, particle_count_for } from './particles.js'

/** Crossfade duration (s) when the resolved kind changes (biome / canopy / submerge) — no popping swarm. */
export const CROSSFADE_SECONDS = 3
/** Biome re-sample cadence (s) — the camera-column probe is cheap but need not run every frame. */
export const SAMPLE_INTERVAL_SECONDS = 1
/** Canopy re-probe cadence (s) — the upward occupancy walk; throttled off the render frame. */
export const CANOPY_INTERVAL_SECONDS = 0.4
/** Submerge bubble-burst duration (s) and peak opacity multiplier — a spike on entry, settling to the
 *  gentle ambient bubble stream. Alpha saturates at 1.0 in the shader, so the spike reads as "more bubbles". */
export const BURST_SECONDS = 1.2
export const BURST_PEAK = 2.2
/** Base ambient sprite opacity (deliberately subtle: barely perceptible existence, noticeable only when you
 *  look for them); density carries the rest. Per-spec `opacity` overrides (emissive kinds run lower still). */
export const BASE_OPACITY = 0.2
/** Build tag — answers "is my ambience code loaded" in one console line (VFX_BUILD idiom). */
export const AMBIENCE_BUILD = 'ambience-2026-07-21a'

/**
 * @typedef {object} AmbienceSpec one environment class' emitter recipe.
 * @property {string} kind PARTICLE_KINDS name played in this environment (the covered/primary kind).
 * @property {number} density ×the tier ambient count (particle_count_for) — SUBTLE (< 1) by law.
 * @property {boolean} [canopy_gate] leaves fall only UNDER canopy; in the open the field is `open_kind`.
 * @property {string} [open_kind] the kind shown when canopy_gate is set and the sky is OPEN (default 'mote').
 * @property {number} [open_density] density for the open_kind (default density × 0.6 — dust is sparser).
 * @property {number} [opacity] base sprite opacity for this spec (default BASE_OPACITY).
 */

/** The underwater STATE override (not a biome) — bubbles rise + a burst on submerge. Blur/distortion is the
 *  existing post pass (render/lighting/underwater.js warp). @type {AmbienceSpec} */
export const UNDERWATER_AMBIENCE = Object.freeze({ kind: 'bubble', density: 0.7, opacity: 0.4 })

/** The fallback for any biome without an authored row — a very sparse warm dust mote (barely-there). */
export const DEFAULT_AMBIENCE = Object.freeze({ kind: 'mote', density: 0.35 })

/**
 * ENVIRONMENT → EMITTER (config vocabulary). Keyed by biome_registry NAME. Maps the wishlist:
 *  • mountains/cold (taiga·arctic·glacier·alpine) → drifting SNOW (sparse)
 *  • forest/rainforest (temperate·dense·tropical) → LEAVES under canopy, DUST motes in the open (canopy gate)
 *  • desert dunes → SAND wisps (+ the declared heat shimmer, a separate post wave)
 *  • scorched/obsidian → rising EMBERS · swamp/marsh/hollows → night FIREFLIES · meadow → POLLEN
 * @type {Record<string, AmbienceSpec>}
 */
export const AMBIENCE_TABLE = Object.freeze({
  // cold massifs — snowflakes in the mountains (sparse, drifting).
  taiga: { kind: 'snow', density: 0.35 },
  arctic: { kind: 'snow', density: 0.4 },
  glacier: { kind: 'snow', density: 0.4 },
  alpine: { kind: 'snow', density: 0.3 },
  // woodland — leaf-fall UNDER canopy, dust motes in the light (the under-canopy occupancy gate).
  temperate_forest: { kind: 'leaf', density: 0.5, canopy_gate: true, open_kind: 'mote', open_density: 0.3 },
  dense_forest: { kind: 'leaf', density: 0.6, canopy_gate: true, open_kind: 'mote', open_density: 0.3 },
  tropical: { kind: 'leaf', density: 0.5, canopy_gate: true, open_kind: 'pollen', open_density: 0.4 },
  // wetlands — night fireflies (the misty identity). Lower opacity: EMISSIVE self-glow already reads
  // brighter than a flat sprite at the same alpha, so the base opacity is trimmed to keep them subtle.
  swamp: { kind: 'firefly', density: 0.3, opacity: 0.15 },
  void_marsh: { kind: 'firefly', density: 0.35, opacity: 0.15 },
  crystal_hollows: { kind: 'firefly', density: 0.3, opacity: 0.15 },
  // arid — sand wisps (desert) + rising embers (scorched / obsidian, opacity trimmed — EMISSIVE glow).
  desert: { kind: 'sand', density: 0.4 },
  scorched_badlands: { kind: 'ember', density: 0.3, opacity: 0.15 },
  obsidian_spires: { kind: 'ember', density: 0.28, opacity: 0.15 },
  // meadow — noon pollen drift.
  grassland: { kind: 'pollen', density: 0.4 },
})

/** @param {number} x @returns {number} clamp to [0,1]. */
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * The ambience spec for a biome NAME — the authored row, else the sparse dust fallback. Pure.
 * @param {string|undefined} biome_name @returns {AmbienceSpec}
 */
export function resolve_ambience(biome_name) {
  return (biome_name && AMBIENCE_TABLE[biome_name]) || DEFAULT_AMBIENCE
}

/**
 * The concrete emitter (kind + density) to play RIGHT NOW, given the environment spec and the live state.
 * Underwater OVERRIDES the biome (bubbles everywhere submerged); a canopy-gated spec plays its leaf kind
 * only when the sky is covered, else the open kind (dust). Pure — the director's single decision seam.
 * @param {AmbienceSpec} spec the biome's ambience row (resolve_ambience)
 * @param {{ covered?: boolean, submerged?: boolean }} [state]
 * @returns {{ kind: string, density: number, opacity: number }}
 */
export function resolve_emitter(spec, { covered = false, submerged = false } = {}) {
  if (submerged)
    return {
      kind: UNDERWATER_AMBIENCE.kind,
      density: UNDERWATER_AMBIENCE.density,
      opacity: UNDERWATER_AMBIENCE.opacity ?? BASE_OPACITY,
    }
  if (spec.canopy_gate && !covered)
    return {
      kind: spec.open_kind ?? 'mote',
      density: spec.open_density ?? spec.density * 0.6,
      opacity: spec.opacity ?? BASE_OPACITY,
    }
  return { kind: spec.kind, density: spec.density, opacity: spec.opacity ?? BASE_OPACITY }
}

/**
 * Is the sky OVERHEAD covered (canopy / roof) above (x,y,z)? A bounded upward occupancy walk over the
 * resident-store `block_at` accessor (air === 0). PURE (accessor injected — unit-tests against a fake;
 * never touches the ring directly). Bounded by `max_scan` so it can never spin a frame.
 * @param {(x:number,y:number,z:number)=>number} block_at world-voxel id accessor (0 = air/unloaded)
 * @param {number} x @param {number} y @param {number} z eye/world position
 * @param {number} [max_scan] cells to walk upward @param {number} [start] cells above the head to begin
 * @returns {boolean} true if any solid/foliage cell sits within the band overhead
 */
export function canopy_above(block_at, x, y, z, max_scan = 22, start = 2) {
  const cx = Math.floor(x)
  const cz = Math.floor(z)
  const base = Math.floor(y) + start
  for (let i = 0; i < max_scan; i += 1) {
    if (block_at(cx, base + i, cz) !== 0) return true
  }
  return false
}

/**
 * Step an opacity toward `target` at a rate that spans the full [0,1] range in `seconds` (the no-pop
 * crossfade). Clamps to [0,1]; snaps when there's no time budget. Pure. @param {number} cur @param {number}
 * target @param {number} dt seconds @param {number} [seconds] fade duration @returns {number} the new opacity
 */
export function crossfade_step(cur, target, dt, seconds = CROSSFADE_SECONDS) {
  const t = clamp01(target)
  if (!(dt > 0) || !(seconds > 0)) return t
  const rate = dt / seconds
  if (cur < t) return Math.min(t, cur + rate)
  if (cur > t) return Math.max(t, cur - rate)
  return t
}

/**
 * The submerge bubble-burst opacity multiplier as the burst timer `t` counts DOWN from `dur`→0: a spike of
 * `peak` at entry decaying linearly to 1 (the settled ambient stream). Pure. @param {number} t remaining
 * burst seconds @param {number} [dur] @param {number} [peak] @returns {number} multiplier ≥ 1
 */
export function submerge_burst_env(t, dur = BURST_SECONDS, peak = BURST_PEAK) {
  if (!(t > 0)) return 1
  const u = t > dur ? 1 : t / dur
  return 1 + (peak - 1) * u
}

/**
 * @typedef {object} AmbienceDirector
 * @property {(dt:number, cam:{x:number,y:number,z:number}, state:{ submerged?:boolean }) => void} tick
 *   per-frame: re-sample the camera-column biome + canopy, resolve the emitter, crossfade the pooled
 *   fields, advance the submerge burst + the shared wind gust. Camera-local (the field follows `cam`).
 * @property {() => { kind:string, slots:number }} current live state (bench/observability).
 * @property {() => void} dispose two-phase teardown of every pooled field.
 */

/**
 * Build the ambience director over the ONE particle machinery. Pooled per-kind InstancedMeshes (built
 * lazily, baked once, kept + hidden between visits ⇒ ZERO steady-state allocation; a transition only
 * ramps opacities). Constructed by DEFAULT (?ambience=0 escapes) — see the file header.
 * @param {object} opts
 * @param {import('three').Scene} opts.scene the render scene to mount the fields into
 * @param {*} opts.renderer the WebGPU renderer (for the seed compute bake)
 * @param {number} opts.weather_particle_count the tier ambient budget (get_tier(tier).weather_particle_count)
 * @param {(x:number,z:number)=>number} opts.sample_biome camera-column biome-id probe (world_biome_at)
 * @param {(x:number,y:number,z:number)=>number} opts.block_at resident-store voxel accessor (canopy probe)
 * @param {number} [opts.crossfade_seconds]
 * @returns {AmbienceDirector}
 */
export function create_ambience({
  scene,
  renderer,
  weather_particle_count,
  sample_biome,
  block_at,
  crossfade_seconds = CROSSFADE_SECONDS,
}) {
  if (typeof console !== 'undefined') console.info('[AresRPG Ambience] build ' + AMBIENCE_BUILD)
  const base_count = particle_count_for(weather_particle_count)

  /** @typedef {{ kind:string, handle:ReturnType<typeof create_particles>, mesh:InstancedMesh|null, cur:number, baked:boolean, bake_error:string|null }} Slot */
  /** @type {Map<string, Slot>} */
  const slots = new Map()
  let current_kind = ''
  let since_sample = SAMPLE_INTERVAL_SECONDS
  let since_canopy = CANOPY_INTERVAL_SECONDS
  let covered = false
  let spec = DEFAULT_AMBIENCE
  let was_submerged = false
  let burst_t = 0

  /** Lazily build+mount+bake a pooled field for `kind` at `density`. Count 0 (LOW / no budget) ⇒ no draw. */
  const ensure = (/** @type {string} */ kind, /** @type {number} */ density) => {
    let slot = slots.get(kind)
    if (slot) return slot
    const count = Math.round(base_count * density)
    if (count <= 0 || base_count <= 0) {
      slot = { kind, handle: /** @type {*} */ (null), mesh: null, cur: 0, baked: false, bake_error: null }
      slots.set(kind, slot)
      return slot
    }
    const handle = create_particles({ kind, count })
    handle.opacity.value = 0
    const mesh = new InstancedMesh(new PlaneGeometry(1, 1), handle.object, handle.count)
    mesh.frustumCulled = false // billboards move in-shader; CPU bounds lie (particles.js / probe idiom)
    mesh.renderOrder = 990 // under the fight VFX (994+) — ambient is background
    mesh.visible = false
    scene.add(mesh)
    slot = { kind, handle, mesh, cur: 0, baked: false, bake_error: null }
    slots.set(kind, slot)
    // Fire-and-forget the seed compute; reveal the field only once baked (unseeded zeros never flash).
    // #225: the bake failure used to vanish into an empty catch — a broken backend left this field
    // permanently invisible with ZERO console evidence. Now: the real reason is LOUD (particles.js's
    // own bake() already console.error's + falls back to a CPU-seeded bake), and `bake_error` rides
    // the existing debug surface (window.__ambience.debug_slots()) so a probe can read WHY without
    // guessing from an unlabeled scene dump (the same guesswork that misdiagnosed the 2026-07-12 note above).
    handle
      .bake(renderer)
      .then((result) => {
        slot.baked = true
        slot.bake_error = result?.error ?? null
      })
      .catch((err) => {
        // Should never fire — particles.js's bake() catches internally and always resolves — but stay
        // loud instead of re-swallowing if some future bake() variant still rejects (#225's whole point).
        slot.bake_error = err?.message ?? String(err)
        console.error(`[ambience] "${kind}" slot bake rejected unexpectedly: ${slot.bake_error}`)
      })
    return slot
  }

  /** @type {AmbienceDirector['tick']} */
  const tick = (dt, cam, state = {}) => {
    if (!(dt >= 0)) dt = 0
    advance_gust(dt) // the ONE shared wind-gust driver (idles at 1.0 when ambience is off ⇒ flora parity)
    const submerged = state.submerged === true

    // re-sample the camera-column biome ≤1/s (cheap pure probe — the B5 mood driver cadence).
    since_sample += dt
    if (since_sample >= SAMPLE_INTERVAL_SECONDS) {
      since_sample = 0
      const def = get_biome_by_id(sample_biome(cam.x, cam.z))
      spec = resolve_ambience(def?.name)
    }
    // re-probe the canopy only for a gated spec, throttled (the upward occupancy walk).
    since_canopy += dt
    if (spec.canopy_gate && since_canopy >= CANOPY_INTERVAL_SECONDS) {
      since_canopy = 0
      covered = canopy_above(block_at, cam.x, cam.y, cam.z)
    }

    // submerge burst edge: spike the bubble field on entry, decay each frame.
    if (submerged && !was_submerged) burst_t = BURST_SECONDS
    was_submerged = submerged
    if (burst_t > 0) burst_t = Math.max(0, burst_t - dt)

    const emitter = resolve_emitter(spec, { covered, submerged })
    current_kind = emitter.kind
    ensure(emitter.kind, emitter.density)

    // crossfade: the resolved kind ramps to its (burst-scaled) opacity; every other slot ramps to 0 and
    // hides at rest. Zero steady-state allocation — only opacity uniforms move.
    for (const slot of slots.values()) {
      const is_active = slot.kind === current_kind
      let target = is_active ? emitter.opacity : 0
      if (is_active && slot.kind === UNDERWATER_AMBIENCE.kind) target *= submerge_burst_env(burst_t)
      slot.cur = crossfade_step(slot.cur, target, dt, crossfade_seconds)
      if (slot.handle) slot.handle.opacity.value = slot.cur
      if (slot.mesh) slot.mesh.visible = slot.baked && slot.cur > 0.001
    }
  }

  return {
    tick,
    current: () => ({ kind: current_kind, slots: slots.size }),
    // Per-slot observability (bench/probe idiom, same spirit as `current()`): kind/baked/cur/visible/count
    // for every live slot, so a probe can tell WHICH half of the ambience.js:285 gate is open without
    // guessing from an unlabeled `scene.traverse()` mesh dump (see the 2026-07-12b note above — that
    // guesswork is exactly what misdiagnosed this director as the bug).
    debug_slots: () =>
      [...slots.values()].map((s) => ({
        kind: s.kind,
        baked: s.baked,
        bake_error: s.bake_error,
        cur: s.cur,
        mesh: !!s.mesh,
        visible: s.mesh?.visible ?? null,
        count: s.mesh?.count ?? null,
      })),
    dispose: () => {
      // two-phase: detach every field NOW, release GPU resources on the next microtask (render-loop law).
      const dead = [...slots.values()]
      for (const s of dead) if (s.mesh) scene.remove(s.mesh)
      slots.clear()
      Promise.resolve().then(() => {
        for (const s of dead) {
          s.mesh?.geometry.dispose()
          s.handle?.dispose()
        }
      })
    },
  }
}
