// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// F1 — CAST VFX: the FLAGSHIP 3D spell-effect player for a fight cast (windup at the caster → projectile in
// flight → impact burst at the target → lingering remnant). Every visible stage is a @aresrpg/engine3/vfx
// GPU-particle PRESET (vfx_map.js names them via `preset_3d`); the sprite sheets that used to play these attacks
// are DELETED (fully replaced by 3D effects). This module ONLY renders the presets at the
// footprint/anchor/trajectory the map gives it — it knows nothing of the board, the fight slice, sound, or timing
// contracts. The adapter (voxel_fight_adapter.play_cast) owns element resolution, the 2-layer SFX, and the impact
// package (camera shake / screen flash / screen grade); it calls in here for the visible sequences and gets an
// `on_impact` callback the instant the projectile lands, so every impact cue fires in one frame window.
//
// THE 5-LAYER CAST (reference-feel — the map's caster_cell / delivery / remnant rows drive it,
// ALL optional): cast_vfx composes, on ONE beat clock, up to five layers — a CASTER-CELL ground charge under the
// caster during the windup · the WINDUP gather · the DELIVERY projectile (arc lob | skyfall drop) · the IMPACT
// burst · and a lingering REMNANT residue LOOP that spawns AT impact on the target cell and self-disposes over
// ~2–3 s (the rAF loop stays alive until it clears). The projectile is a MOVING emitter: the runtime advances its
// `origin` along the trajectory each frame and sets `travel` (velocity) so its trail sheds a world-static wake.
//
// LIFECYCLE (unchanged invariant): this module drives its OWN rAF, out of phase with the engine render loop, so a
// preset handle is removed from the scene NOW and DISPOSED one frame later (freeing a node graph the transparent
// pass is mid-walk throws — the F1 "no visuals" crash). Reduced-motion (reduced_motion): the decorative remnant
// lingers a SHORTER window; the core windup/orb/impact beat is untouched (its particles ARE the motion).

import { CanvasTexture, Sprite, SpriteMaterial, Vector3 } from 'three'
import { create_vfx_preset, PRESETS } from '@aresrpg/engine3/vfx'

import { BEAT, BURST_VFX, CAST_VFX, asset_element, is_burst_element, prewarm_specs, resolve_impact, variant_layer } from './vfx_map.js'
import { spell_hash, variant_for } from './vfx_variants.js'

// ── 3D PRESET SPAWN (the ONE mount path): build + mount the named preset at `at`, ground-anchored layers dropped
// to the feet, sized from the layer footprint × the hit magnitude. Returns the live VfxHandle (age/origin/travel
// uniforms + dispose), or null when the preset name is unknown (a guard — every wired layer resolves).
/** @param {any} engine @param {{ preset:string, tint?:[number,number,number] }} spec the row's `preset_3d`
 *  @param {number[]} at world point (chest height) @param {{ magnitude:number, m:number, ground:boolean }} o */
function spawn_preset_3d(engine, spec, at, { magnitude, m, ground }) {
  const preset = spec && PRESETS[spec.preset]
  if (!preset) return null
  const pos = /** @type {[number,number,number]} */ (
    ground ? [at[0], at[1] - BEAT.ground_drop, at[2]] : [at[0], at[1], at[2]]
  )
  const scale = Math.max(1, (m / 4) * magnitude) // authored footprint (Godot ~4 m base) scaled by the hit, floored
  // overlay:true routes the whole fight-cast beat to the engine's POST-AgX display-space additive overlay (the FIGHT
  // bar — the purchased pack's saturated glow reads as pure light there, not the AgX-washed white of the main pass).
  const handle = create_vfx_preset(preset, { position: pos, scale, tint: spec.tint, overlay: true })
  try {
    engine.add_to_scene(handle.object3d)
  } catch {
    /* pre-boot no-op */
  }
  return handle
}

// Re-export the routing verdict from its map home so historical importers (the adapter, dev_probe) keep working.
export { is_burst_element }

// ── PREWARM (D3 / the D221 terrain-prewarm class): compile every preset pipeline this fight CAN mount BEFORE the
// first cast, so the ~290ms WebGPU first-draw pipeline compile (mechanically confirmed — zero JS longtask) lands
// during the fight-enter intro beat instead of hitching the first cast. Each distinct {preset, tint} is built once
// and mounted FAR below any board — frustumCulled is false (vfx_preset_engine), so the engine's next render frame
// STILL submits its draw ⇒ compiles the pipeline, while the geometry is sub-pixel/off-screen (no visible flash) —
// then the whole set tears down. Fire-and-forget; no-ops headless / pre-boot. Returns a canceller for teardown. ──
const PREWARM_POS = /** @type {[number,number,number]} */ ([0, -600, 0])
const PREWARM_TEARDOWN_MS = 400 // ≥ several engine render frames; the pipeline compiles on the FIRST submit
// AMORTISED MOUNT (a fight-start freeze): mounting all ~27 preset pipelines in ONE frame made
// the engine's next render submit ~27 first-draw compiles at once = a fight-start hitch ON TOP of the board
// build. Mount a few per rAF instead so the compiles spread across ~14 frames, hidden entirely behind the
// ~3 s fight-start intro hold. Each batch's draws compile on the following engine frame (same mechanism).
const PREWARM_PER_FRAME = 2
/** @param {any} engine the EngineApi (add_to_scene/remove_from_scene) @param {Iterable<string>} elements fight elements
 *  @returns {() => void} cancel — drop the throwaway handles now (board teardown mid-prewarm) */
export function prewarm_fight_vfx(engine, elements) {
  if (!engine?.add_to_scene) return () => {}
  const specs = prewarm_specs(elements)
  /** @type {{ object3d: import('three').Object3D, dispose: () => void }[]} */
  const handles = []
  let done = false
  let raf = 0
  let timer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
  let i = 0
  // [float-pipeline 2026-07-13] the FLOATING-NUMBER pipeline compiles on its first draw too (a Sprite +
  // CanvasTexture with the exact material flags board_entities' make_float_sprite uses — transparent, no depth
  // test/write, toneMapped:false; the flag set IS the pipeline key). The first damage number of a session was
  // the one un-prewarmed fight visual left — mount ONE far-below throwaway with the same flags so the number's
  // pipeline compiles behind the intro beat with everything else. Headless/SSR (no document) skips it.
  if (typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 4
      canvas.height = 4 // blank ⇒ fully transparent texels; the draw still submits ⇒ the pipeline compiles
      const texture = new CanvasTexture(canvas)
      const material = new SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
      const sprite = new Sprite(material)
      sprite.position.set(PREWARM_POS[0], PREWARM_POS[1], PREWARM_POS[2])
      sprite.frustumCulled = false // culled = no draw submitted = NO compile — same law as the preset mounts
      engine.add_to_scene(sprite)
      handles.push({
        object3d: sprite,
        dispose() {
          texture.dispose()
          material.dispose()
        },
      })
    } catch {
      /* canvas unavailable — skip the float prewarm, never block the preset warmup */
    }
  }
  const mount_batch = () => {
    if (done) return
    for (let k = 0; k < PREWARM_PER_FRAME && i < specs.length; k += 1, i += 1) {
      const spec = specs[i]
      const preset = PRESETS[spec.preset]
      if (!preset) continue
      // overlay:true so the prewarm compiles the SAME (additive + layer-10 + depthWrite) pipeline the live cast
      // mounts — an overlay/main flag mismatch here would leave the first real cast to compile cold (the freeze bug).
      const handle = create_vfx_preset(preset, { position: PREWARM_POS, scale: 1, tint: spec.tint, overlay: true })
      try {
        engine.add_to_scene(handle.object3d)
        handle.age.value = 0.001 // nudge past birth so the emitters actually submit their draw (⇒ pipeline compile)
        handles.push(handle)
      } catch {
        handle.dispose() // pre-boot / no scene — never leak the throwaway
      }
    }
    if (i < specs.length)
      raf = requestAnimationFrame(mount_batch) // next slice next frame — spread the compiles
    else timer = setTimeout(teardown, PREWARM_TEARDOWN_MS) // all mounted → tear the throwaways down once compiled
  }
  const teardown = () => {
    if (done) return
    done = true
    for (const h of handles) {
      try {
        engine.remove_from_scene(h.object3d)
      } catch {
        /* already gone */
      }
      h.dispose()
    }
    handles.length = 0
  }
  raf = requestAnimationFrame(mount_batch)
  return () => {
    if (raf) cancelAnimationFrame(raf)
    if (timer) clearTimeout(timer)
    teardown()
  }
}

// ── Reduced-motion policy for the decorative remnant — mirrors the fight camera's matchMedia check. Under reduce,
// the remnant lingers for a SHORTER window; the core windup/orb/impact beat is UNCHANGED. ──
const REMNANT_REDUCED_S = 1.0
/** True when the OS asks for reduced motion (no window → false: bun unit tests / SSR). */
export const reduced_motion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
/** The remnant's on-cell lifetime: the row's `duration_s`, capped SHORTER under reduced motion. Pure — unit-tested.
 *  @param {number} duration_s @param {boolean} reduced */
export const remnant_life = (duration_s, reduced) => (reduced ? Math.min(duration_s, REMNANT_REDUCED_S) : duration_s)

// ── Trajectory families (pure, exported for headless coverage). Each writes a world position into `out` (a
// scratch Vector3, allocation-free) at normalised stage-time k∈[0,1]. `from`/`to` are [x,y,z] arrays. ──
/** PROJECTILE-ARC: caster→target parabolic lob — flat lerp + a sine bow of `arc_h` metres, peaking at k=0.5. */
export const traj_arc = (
  /** @type {number[]} */ from,
  /** @type {number[]} */ to,
  /** @type {number} */ k,
  /** @type {number} */ arc_h,
  /** @type {import('three').Vector3} */ out
) =>
  out.set(
    from[0] + (to[0] - from[0]) * k,
    from[1] + (to[1] - from[1]) * k + Math.sin(k * Math.PI) * arc_h,
    from[2] + (to[2] - from[2]) * k
  )

// ── SKY-FALL CHAOS: dead-overhead + ruler-straight reads mechanical. A skyfall now (a) is
// BORN somewhere in a top-hemisphere CONE around the target instead of dead-center above it, and (b) bows gently
// sideways on the way down instead of a laser. Both knobs are hashed from a per-cast SEED — never `Math.random`
// straight in the flight math (DETERMINISM LAW): `spell_hash` is the repo's one FNV-1a home (vfx_variants.js,
// already used to decorrelate per-spell variant picks), reused here instead of a second hash implementation. A
// single smooth sine bow (not per-frame noise) keeps the house style law: slow and atmospheric, never snappy.
export const SKYFALL_CONE_DEG = 34 // half-angle off dead-vertical the birth point can land within
const SKYFALL_BOW_FRAC = 0.2 // sideways bow peak, as a fraction of sky_h
/** A chaos-neutral default (dead vertical, no bow) — `traj_skyfall` falls back to this when no seed/chaos is
 *  given, so every pre-chaos call site keeps its exact old straight-line behaviour. */
const VERTICAL_CHAOS = { azimuth: 0, tilt: 0, bow_dir: 1, bow_k: 0 }
/** `spell_hash` as a unit float in [0,1) — one hash, many independent lanes via a salted seed suffix. */
const unit01 = (/** @type {string} */ seed) => spell_hash(seed) / 0x100000000

/** This cast's fixed chaos knobs, hashed once from a stable per-cast seed (pure — unit-tested directly):
 *  `azimuth` (which side of the sky it drops in from, 0..2π), `tilt` (0..1 of SKYFALL_CONE_DEG off vertical),
 *  `bow_dir`/`bow_k` (which way + how hard the descent bows). Same seed ⇒ same knobs; different seeds land
 *  nowhere near each other (the salted lanes each get their own hash). @param {string} seed */
export const skyfall_chaos = (/** @type {string} */ seed) => ({
  azimuth: unit01(`${seed}#az`) * Math.PI * 2,
  tilt: unit01(`${seed}#tilt`),
  bow_dir: unit01(`${seed}#bow_dir`) < 0.5 ? -1 : 1,
  bow_k: unit01(`${seed}#bow_k`),
})

/** SKY-FALL: birth point `sky_h` metres ABOVE `to` (the vertical height never changes — only where under the sky
 *  it starts), offset within a top-hemisphere cone (`chaos.tilt`×SKYFALL_CONE_DEG off vertical, at
 *  `chaos.azimuth`), falling on a gravity ease (1−k²) with a gentle perpendicular bow (peaks at k=0.5, zero at
 *  both ends). CONTACT IS UNCHANGED: the ease AND the bow both hit exactly 0 at k=1, so it always lands dead-on
 *  `to` (the impact clock) no matter the chaos — a meteor's contact frame still hits the burst on time. Omit
 *  `chaos` for the old dead-straight drop (VERTICAL_CHAOS). */
export const traj_skyfall = (
  /** @type {number[]} */ to,
  /** @type {number} */ k,
  /** @type {number} */ sky_h,
  /** @type {import('three').Vector3} */ out,
  /** @type {{azimuth:number, tilt:number, bow_dir:number, bow_k:number}} */ chaos = VERTICAL_CHAOS
) => {
  const ease = 1 - k * k
  const radius = Math.tan((chaos.tilt * SKYFALL_CONE_DEG * Math.PI) / 180) * sky_h
  const bow = Math.sin(k * Math.PI) * chaos.bow_dir * chaos.bow_k * SKYFALL_BOW_FRAC * sky_h
  const perp = chaos.azimuth + Math.PI / 2 // sideways axis to the birth direction — the bow drifts ACROSS the fall, not along it
  return out.set(
    to[0] + Math.cos(chaos.azimuth) * radius * ease + Math.cos(perp) * bow,
    to[1] + sky_h * ease,
    to[2] + Math.sin(chaos.azimuth) * radius * ease + Math.sin(perp) * bow
  )
}

// ── FIRST-PLAY HITCH PROBE (freezes on first cast of a spell type, and again when the
// fight is over) ────────────────────────────────────────────────────────────────────────────────────────
// A cold GPU pipeline compile is a long RENDER FRAME, not a JS longtask (D3), so it can't be timed with a
// wall-clock around the JS. Instead measure the MAX gap between this beat's OWN rAF ticks: a main-thread stall
// (a compile) freezes every rAF, so a cold beat spikes one gap. Probed ONCE PER DISTINCT PIPELINE KEY (the
// element/kind) — so the FIRST cast of EACH spell type AND the first burst of each kind (earth/weapon and the
// fight-ENDING KO → soul_death) each get their OWN named reading, not just the session's very first cast (the
// old one-shot missed both the per-type first casts and the entire burst_vfx death path). On a hitch the warn
// NAMES the key + the preset names that likely compiled cold, so the evidence itself points at the prewarm gap.
const HITCH_BAR_MS = 50
/** Distinct pipeline keys already probed this session — each cast/burst identity is measured exactly once. */
const _probed_keys = new Set()
/**
 * Start a per-beat frame-gap probe for `key`, or return null if this key was already probed. Feed every rAF
 * timestamp to `.tick(now)`; call `.report()` once on teardown — it warns (naming the presets) past the bar,
 * infos when clean. @param {string} key pipeline identity (probed once) @param {string} label human beat name
 * @param {(string|undefined)[]} presets the preset names this beat mounts (named in the log)
 */
function make_hitch_probe(key, label, presets) {
  if (_probed_keys.has(key)) return null
  _probed_keys.add(key)
  let max_gap = 0
  let last = 0
  let ticks = 0
  return {
    tick(/** @type {number} */ now) {
      if (last) max_gap = Math.max(max_gap, now - last)
      last = now
      ticks += 1
    },
    report() {
      if (ticks <= 1) return
      const names = presets.filter(Boolean).join(', ') || '(none)'
      const line = `[vfx-probe] first ${label}: max frame gap ${max_gap.toFixed(1)}ms over ${ticks} ticks (bar ${HITCH_BAR_MS}ms — a spike = a cold pipeline the prewarm missed) · presets: ${names}`
      if (max_gap > HITCH_BAR_MS) console.warn(line)
      else console.info(line)
    },
  }
}

/**
 * Fire one cast beat's visible 3D sequences: caster-cell + windup at the caster, a projectile that flies to the
 * target, an impact burst on the land, and a lingering remnant. Self-driven (its own rAF); every preset tears down
 * (deferred a frame) as its window ends, and the loop stops once nothing is live. Returns `{ dispose }` so a board
 * teardown can cancel a mid-flight beat.
 * @param {object} opts
 * @param {import('@aresrpg/engine3').EngineApi} opts.engine scene add/remove + live camera
 * @param {[number, number, number]} opts.from caster world position (chest height)
 * @param {[number, number, number]} opts.to target world position (chest height)
 * @param {string} opts.element spell element (fire/water/air/neutral/heal); non-art elements fall back to neutral
 * @param {number} [opts.magnitude] size multiplier from the damage curve; default 1, floored to ≥1 for the footprint
 * @param {() => void} [opts.on_impact] called the instant the orb lands (the adapter fires the impact package)
 * @param {() => void} [opts.on_done] called once every preset has finished naturally (NOT on explicit dispose())
 * @param {{ id?:string, classType?:string, element?:string, role?:string }} [opts.spell] the cast's spell facts —
 *   when present, the ORB layer swaps to this spell's mapped variant preset (vfx_variants.variant_for), else the
 *   element default. A per-spell VFX-variety hook; every other layer stays element-keyed.
 * @returns {{ dispose: () => void }}
 */
export function cast_vfx({ engine, from, to, element, magnitude = 1, spell, on_impact, on_done }) {
  if (!engine) return { dispose() {} }
  // SHEET-SCALE FLOOR (explosions read too small at low magnitude): the footprint never shrinks BELOW the authored
  // size — only magnitude_scale's ≥1 half (a real hit) may grow it. A sub-1 magnitude still reads at full size.
  magnitude = Math.max(1, magnitude)
  let raf = 0
  let disposed = false
  /**
   * @typedef {object} Live3
   * @property {any} preset3d the live VfxHandle (age/origin/travel uniforms + dispose)
   * @property {number} t0 spawn time (ms)
   * @property {number} [life] explicit window (s); absent ⇒ the preset's own duration (a static burst)
   * @property {((k:number)=>void)} [step] per-frame origin driver (the moving projectile only)
   * @property {(() => void) | null} [on_end] fired once when the window ends (the orb chains impact + remnant)
   * @property {Vector3} [prev] previous origin (finite-diff travel velocity for the trail) @property {number} [prevT]
   */
  /** @type {Live3[]} */
  const live = []

  // Preset handles awaiting a DEFERRED dispose — freed a frame after leaving the scene (rAF-phase invariant).
  const pending_dispose = /** @type {{ dispose: () => void }[]} */ ([])
  const flush_pending = () => {
    for (const h of pending_dispose) h.dispose()
    pending_dispose.length = 0
  }
  const retire = (/** @type {Live3} */ s) => {
    try {
      engine.remove_from_scene(s.preset3d.object3d)
    } catch {
      /* already gone */
    }
    pending_dispose.push(s.preset3d)
  }

  const prof = CAST_VFX[asset_element(element)]
  const reduced = reduced_motion() // shorter remnant under prefers-reduced-motion

  // [b_spell] PER-SPELL VARIANT + DELIVERY-LAYER ROUTING: variant_for names this spell's mapped preset; variant_layer
  // classifies it by name suffix into the layer it belongs on. PRESETS-guarded — variant_spec is non-null ONLY for a
  // real merged preset, so an unmapped/missing name never mounts (the element beat stands), never a null projectile.
  // An 'orb'-class variant swaps the traveling projectile (as before); a 'zone'/'strike' variant leaves the orb on
  // its element default and instead mounts on the ground-decal / impact-strike beat (spawn_variant_layer).
  const variant = spell ? variant_for(spell) : null
  const variant_spec = variant && PRESETS[variant] ? { preset: variant } : null
  const variant_slot = variant_spec ? variant_layer(variant) : 'orb'

  // Per-TYPE first-cast hitch probe (make_hitch_probe): measures the FIRST cast of THIS element once, NAMING the
  // windup/orb/impact presets it mounts — so "the first fire cast froze" tells us WHICH pipeline compiled cold.
  // [2026-07-13] the VARIANT rides the key: a 2nd fire spell mounting a DIFFERENT variant preset is its own cold
  // pipeline — under the old element-only key it compiled cold UNPROBED (the exact "still a lot of freezes"
  // blind spot). One probe per distinct (element, variant) identity, the variant named in the log.
  const probe = make_hitch_probe(`cast:${asset_element(element)}:${variant ?? ''}`, `cast (${element})`, [
    prof.windup?.preset_3d?.preset,
    prof.orb?.preset_3d?.preset,
    variant_spec ? variant : undefined, // the per-spell swap layer (orb/zone/strike) — its own pipeline
    resolve_impact(prof, magnitude).preset_3d?.preset,
  ])

  // ── the layers, chained: caster-cell + windup + orb at t0; orb.on_end → impact + remnant. Footprint/anchor/
  // trajectory come from the element's CAST_VFX row; only the projectile translates (its `step` drives `origin`). ──
  const spawn_static = (
    /** @type {any} */ row,
    /** @type {number[]} */ at,
    /** @type {boolean} */ ground,
    /** @type {number} */ life
  ) => {
    const handle = spawn_preset_3d(engine, row.preset_3d, at, { magnitude, m: row.m, ground })
    if (handle) live.push({ preset3d: handle, t0: performance.now(), life, on_end: null })
  }

  const spawn_windup = () => spawn_static(prof.windup, from, prof.windup.anchor === 'ground', BEAT.flare_s)
  // CASTER-CELL (the cell below the caster shakes): the SAME charge preset dropped to the caster's FEET (a ground pulse).
  const spawn_caster_cell = () => prof.caster_cell && spawn_static(prof.caster_cell, from, true, BEAT.flare_s)

  const spawn_orb = () => {
    // [b_spell] PER-SPELL ORB VARIETY: the projectile layer swaps to THIS spell's mapped variant ONLY when it is an
    // 'orb'-class variant (variant_slot) resolving to a real preset (variant_spec, PRESETS-guarded). A zone/strike
    // variant keeps the element default orb HERE and mounts on its own ground/impact layer (spawn_variant_layer); an
    // unmapped/missing name likewise keeps the default, never a null projectile. Variant orbs are element-coloured (no tint).
    const spec = variant_spec && variant_slot === 'orb' ? variant_spec : prof.orb?.preset_3d
    // DELIVERY (cast effects drop from the sky): 'skyfall' is the DEFAULT now — the orb
    // is BORN somewhere in the sky over the target and falls fast onto the cell; 'arc' lobs caster→target (still
    // supported, no house element uses it).
    const delivery = prof.delivery ?? 'skyfall'
    // CHAOS (a dead-straight drop reads mechanical — needs variety per cast): no adapter cast id reaches this
    // render-edge module, and `from`/`to`/`spell` alone are NOT a safe seed — a mob repeatedly nuking the same
    // cell (the exact repeat-cast scenario) casts with IDENTICAL facts every time, so a fact-only seed
    // would keep landing the same dead-straight drop (proved by a red integration test: 8 identical-input casts
    // collapsed to 1 distinct origin). `skyfall_chaos` itself stays pure/seeded (unit-tested on literal seeds);
    // only the RUNTIME seed's uniqueness comes from `Math.random()` here — sanctioned at this render edge (this
    // file drives its own rAF straight into the Three.js scene, never a fold/reducer) — hashed ONCE for the
    // WHOLE flight, so the birth point and every frame of the descent agree on the same tilt/bow.
    const chaos = skyfall_chaos(`skyfall:${Math.random()}`)
    // Spawning skyfall AT the chaos birth point (not `from`) keeps frame 1 snap-free: traj_skyfall(k=0, chaos)
    // in `step` below evaluates to this exact same point (one source, shared invariant).
    let spawn_at = from
    if (delivery === 'skyfall') {
      traj_skyfall(to, 0, BEAT.sky_h, _pv, chaos)
      spawn_at = /** @type {[number,number,number]} */ ([_pv.x, _pv.y, _pv.z])
    }
    const handle = spawn_preset_3d(engine, spec, spawn_at, { magnitude, m: prof.orb.m, ground: false })
    if (!handle) {
      // no projectile art (a guard) — still land the impact package + burst so the beat resolves.
      on_impact?.()
      spawn_impact()
      spawn_remnant()
      spawn_variant_layer()
      return
    }
    live.push({
      preset3d: handle,
      t0: performance.now(),
      life: BEAT.travel_s,
      step: (k) => {
        // SKY-FALL drops onto the target (this cast's cone birth + bow, `chaos`); ARC lobs caster→target — both
        // land on `to` at k=1 (the impact clock).
        const p =
          delivery === 'skyfall' ? traj_skyfall(to, k, BEAT.sky_h, _pv, chaos) : traj_arc(from, to, k, BEAT.arc_h, _pv)
        handle.origin.value.set(p.x, p.y, p.z)
      },
      on_end: () => {
        on_impact?.() // the adapter fires the target SFX + shake + flash on this exact frame
        spawn_impact()
        spawn_remnant() // the remnant spawns ON the impact frame and lingers past the whole beat
        spawn_variant_layer() // a zone/strike variant lands on its OWN layer (no-op for orb-class / unmapped)
      },
    })
  }

  const spawn_impact = () => {
    const row = resolve_impact(prof, magnitude) // heavy hits swap to the bigger explosion
    const handle = spawn_preset_3d(engine, row.preset_3d, to, { magnitude, m: row.m, ground: row.anchor === 'ground' })
    if (handle) live.push({ preset3d: handle, t0: performance.now(), on_end: null })
  }

  // REMNANT (a colored mana remnant lingers after cast): an element residue LOOP on the TARGET cell, ground-
  // anchored, self-disposing after `duration_s` (shorter under reduced motion). It OUTLIVES the whole beat; the rAF
  // loop stays alive until it clears.
  const spawn_remnant = () => {
    if (!prof.remnant?.preset_3d) return
    const { m, duration_s } = prof.remnant
    const handle = spawn_preset_3d(engine, prof.remnant.preset_3d, to, { magnitude, m, ground: true })
    if (handle)
      live.push({ preset3d: handle, t0: performance.now(), life: remnant_life(duration_s, reduced), on_end: null })
  }

  // [b_spell] DELIVERY-LAYER VARIANT (zone/strike): the routed variant mounts on the TARGET cell at the impact beat,
  // ground-anchored — a 'zone' variant as a lingering ground decal (a remnant-style linger, reduced-motion aware),
  // a 'strike' variant as a burst over the impact window. Both PRESETS-guarded (variant_spec is a real preset) and
  // carry an EXPLICIT life: every variant preset is a LOOP, so an implicit (preset-duration) life would never retire.
  // 'orb'-class + unmapped ⇒ a no-op here (any orb-class variant already rides the projectile in spawn_orb).
  const spawn_variant_layer = () => {
    if (!variant_spec || variant_slot === 'orb') return
    const zone = variant_slot === 'zone'
    const m = zone ? prof.remnant?.m ?? prof.orb.m : resolve_impact(prof, magnitude).m
    const life = zone ? remnant_life(prof.remnant?.duration_s ?? BEAT.impact_s, reduced) : BEAT.impact_s
    const handle = spawn_preset_3d(engine, variant_spec, to, { magnitude, m, ground: true })
    if (handle) live.push({ preset3d: handle, t0: performance.now(), life, on_end: null })
  }

  const frame = (/** @type {number} */ now) => {
    probe?.tick(now)
    flush_pending() // dispose what was retired on the PREVIOUS frame (≥1 render has passed since it left the scene)
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const s = live[i]
      const elapsed = (now - s.t0) / 1000
      const life = s.life ?? s.preset3d.duration
      if (s.step) {
        const k = Math.min(1, elapsed / life)
        s.step(k) // drive the moving origin along the trajectory
        // finite-diff travel velocity → the trail emitters shed a world-static wake (moving-emitter primitive).
        const o = s.preset3d.origin.value
        if (s.prev) {
          const dts = Math.max(1e-3, elapsed - (s.prevT ?? 0))
          s.preset3d.travel.value.set((o.x - s.prev.x) / dts, (o.y - s.prev.y) / dts, (o.z - s.prev.z) / dts)
        } else s.prev = new Vector3()
        s.prev.copy(o)
        s.prevT = elapsed
      }
      s.preset3d.age.value = elapsed // drives every particle (and wraps a LOOP preset)
      if (elapsed >= life) {
        const end = s.on_end
        retire(s) // remove from the scene now; dispose on the next tick
        live.splice(i, 1)
        end?.() // chain the next beat AFTER the finished one is retired (may push a fresh handle into live)
      }
    }
    // keep looping while anything is live OR a deferred dispose is still pending; once BOTH clear the beat is fully
    // torn down — stop and notify (one extra idle tick flushes the final retire through flush_pending).
    if (disposed) return
    if (live.length === 0 && pending_dispose.length === 0) {
      raf = 0
      probe?.report()
      on_done?.()
      return
    }
    raf = requestAnimationFrame(frame)
  }

  spawn_windup()
  spawn_caster_cell() // rides the windup window (both one-shot over flare_s)
  spawn_orb()
  raf = requestAnimationFrame(frame)

  return {
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      for (const s of live) retire(s) // remove every live handle from the scene (+ queue its dispose)
      live.length = 0
      flush_pending() // teardown: the board is going away — free the queued handles now
    },
  }
}

/**
 * Fire one BURST beat: a single anchored 3D preset at `at`, no windup/projectile. Waits the element's `contact_s`
 * (BURST_VFX — the contact clock for earth/weapon so the swing beat still reads; 0 for death), then fires
 * `on_impact` and mounts the preset in the same frame window. Same deferred-dispose invariant as cast_vfx; a
 * self-contained sibling so the cast beat stays untouched. Returns `{ dispose }` for board teardown.
 * @param {object} opts
 * @param {import('@aresrpg/engine3').EngineApi} opts.engine scene add/remove + live camera
 * @param {[number, number, number]} opts.at strike-cell world position (chest height — ground-anchored layers drop it)
 * @param {string} opts.element a BURST_VFX key (earth/death/weapon); unknown keys burst as 'weapon'
 * @param {number} [opts.magnitude] size multiplier from the damage curve; default 1
 * @param {{ id?:string, classType?:string, element?:string, role?:string }} [opts.spell] the cast's spell facts —
 *   when present, the burst preset swaps to this spell's mapped variant (vfx_variants.variant_for) IF that variant
 *   suits an impact-only beat (a ground-zone / impact-strike; never an orb-class that needs a projectile). Mirrors
 *   cast_vfx's per-spell variety hook so earth/weapon strikes read per-spell, not one hardcoded burst.
 * @param {() => void} [opts.on_impact] fired the instant the burst spawns (the adapter's impact package)
 * @param {() => void} [opts.on_done] called once the burst finished naturally (NOT on explicit dispose())
 * @param {{preset_3d:object, m:number, anchor?:string, contact_s?:number}} [opts.preset_row] an explicit row
 *   that skips the BURST_VFX[element] lookup — arrival_vfx (below) rides this lifecycle with a CAST_VFX row.
 * @returns {{ dispose: () => void }}
 */
export function burst_vfx({ engine, at, element, magnitude = 1, spell, preset_row, on_impact, on_done }) {
  if (!engine) return { dispose() {} }
  magnitude = Math.max(1, magnitude) // SHEET-SCALE FLOOR — one law with cast_vfx (a sub-1 magnitude never shrinks it)
  const prof = preset_row ?? BURST_VFX[element] ?? BURST_VFX.weapon
  // [b_spell] PER-SPELL BURST VARIETY — the same hook cast_vfx runs, for the impact-only beats. variant_for names
  // this spell's mapped preset; a burst has NO projectile, so only a ground-zone / impact-strike variant (variant_layer
  // ≠ 'orb') can stand in for the anchored burst — an orb-class variant needs travel, so it keeps the element's
  // authored burst (earth→eruption, weapon→slash, death→soul). PRESETS-guarded: an unmapped/missing name keeps the
  // default. Today's seed (plain damage/heal roles) resolves every earth/weapon burst to its default; the routing
  // lights up per-spell the moment content carries zone/strike roles. Element-coloured (no tint), like the default.
  const variant = spell ? variant_for(spell) : null
  const variant_spec = variant && PRESETS[variant] && variant_layer(variant) !== 'orb' ? { preset: variant } : null
  const burst_spec = variant_spec ?? prof.preset_3d
  // Per-TYPE first-BURST hitch probe (make_hitch_probe) — instruments the path the cast probe NEVER covered:
  // earth/weapon strikes AND the fight-ENDING KO (element 'death' → soul_death, the "freezes when the
  // fight is over"). Keyed by the RESOLVED preset so an alias probes once; NAMES the burst preset on a hitch.
  const probe = make_hitch_probe(`burst:${burst_spec?.preset}`, `burst (${element})`, [burst_spec?.preset])
  let raf = 0
  let disposed = false
  /** @type {any} */
  let handle = null
  const pending_dispose = /** @type {{ dispose: () => void }[]} */ ([])
  const flush_pending = () => {
    for (const h of pending_dispose) h.dispose()
    pending_dispose.length = 0
  }
  const retire = () => {
    if (!handle) return
    try {
      engine.remove_from_scene(handle.object3d)
    } catch {
      /* already gone */
    }
    pending_dispose.push(handle)
    handle = null
  }

  let t0 = 0
  const frame = (/** @type {number} */ now) => {
    if (disposed) return
    probe?.tick(now)
    flush_pending()
    const elapsed = (now - t0) / 1000
    if (handle) {
      handle.age.value = elapsed
      if (elapsed >= handle.duration) retire()
    }
    if (!handle && pending_dispose.length === 0) {
      raf = 0
      probe?.report()
      on_done?.()
      return
    }
    raf = requestAnimationFrame(frame)
  }

  const spawn = () => {
    if (disposed) return
    on_impact?.() // the burst IS the impact instant — the impact package lands with the first frame
    handle = spawn_preset_3d(engine, burst_spec, at, { magnitude, m: prof.m, ground: prof.anchor === 'ground' })
    t0 = performance.now()
    raf = requestAnimationFrame(frame)
  }

  const timer = prof.contact_s > 0 ? setTimeout(spawn, prof.contact_s * 1000) : (spawn(), 0)

  return {
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      retire()
      flush_pending() // teardown: the board is going away — free now
    },
  }
}

/** TELEPORT ARRIVAL beat: a single anchored puff at the LANDING cell, riding burst_vfx's lifecycle with the
 *  element's own ground-charge preset (the SAME `caster_cell` pulse the origin windup played) instead of a
 *  BURST_VFX row — a portal opens at both ends of the jump, no new preset needed (the
 *  teleport sequences after the vfx, with its own vfx at the target too).
 *  @param {{ engine:any, at:[number,number,number], element:string, magnitude?:number, on_done?:()=>void }} opts
 *  @returns {{ dispose: () => void }} */
export function arrival_vfx({ engine, at, element, magnitude, on_done }) {
  const row = CAST_VFX[asset_element(element)]?.caster_cell
  if (!row) return { dispose() {} }
  return burst_vfx({ engine, at, element, magnitude, preset_row: { ...row, anchor: 'ground', contact_s: 0 }, on_done })
}

/** Scratch vector the trajectory helpers write into (allocation-free per frame / per spawn). */
const _pv = new Vector3()
