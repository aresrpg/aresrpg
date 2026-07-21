// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — the fight-grade GPU particle PRESET RUNTIME (Godot 4 GPUParticles3D → Three.js/TSL port).
// A preset is plain data mirroring a .tscn node graph: N EMITTERS, each a burst of camera-facing billboards whose
// motion is a PURE FUNCTION of (per-particle seed, age) — analytic ballistics (velocity + exp-drag + gravity + the
// radial/orbit primitives), size/colour/alpha by over-life curves. NO sim state / feedback / compute: seeds are
// CPU-baked ONCE (deterministic, unit-tested) into instanced attributes; each frame the nodes re-derive from seed +
// a CPU-advanced `age` uniform (the particles.js idiom extended to fight bursts).
// NAGA care (the 127-nesting cliff): ONE shallow SpriteNodeMaterial per emitter (muls/adds + one exp + smoothsteps),
// curves UNROLLED at build time, appearance a COMPILE-TIME constant. No post passes.
// BLENDING (AgX law — board_vfx/title_aura/mana_barrier): AgX crushes AdditiveBlending, so particles use NORMAL blend
// + toneMapped=false + brightness carried in ALPHA. NO-BLOOM (white-halo class): sustained colour luma < the 2.05
// bloom threshold; the brief flash is a short-lived CORE emitter capped ≤ FLASH_MS.
// SINGLE SOURCE OF TRUTH: pure-JS seed_emitter / particle_state / curve_eval are unit-tested; the TSL nodes in
// build_emitter_material mirror particle_state op-for-op; the GPU draw is proven by the bench probe.

import { Group, InstancedMesh, Mesh, PlaneGeometry, SphereGeometry, Vector3 } from 'three'
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu'
import {
  float,
  instanceIndex,
  instancedArray,
  mix,
  positionLocal,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'

import {
  PACK_BILLBOARD,
  PACK_SPHERE,
  appearance_alpha,
  billboard_pack,
  flame_field,
  sphere_pack,
} from './vfx_pack_shaders_core.js'

/** The flash-core lifetime ceiling (ms) — a bright brief pop, never a sustained bloom source (no-halo law). */
export const FLASH_MS = 250
/** EDGE-FEATHER border width (UV fraction). The POST-AgX overlay adds authored colour × gain STRAIGHT onto the frame,
 *  so ANY non-zero sprite alpha at a quad's UV edge reads as a bright rectangle outline — the "PNG pasted on the
 *  terrain" border the old tonemapper-wash used to hide. This forces every billboard's alpha
 *  to EXACTLY zero at the quad boundary (a smoothstep ramp 0→1 over the outer EDGE_FEATHER on each UV axis), so no
 *  additive gain can ever reveal the rectangle. Centre-weighted sprites keep their inner ~76% untouched. Shallow (naga law). */
const EDGE_FEATHER = 0.12
/** Build fingerprint — confirms WHICH shader build a live session runs (dev sanity check: "is my new code loaded"); logged ONCE. */
export const VFX_BUILD = 'vfx-2026-07-12b'
let vfx_build_logged = false
/** Drag floor so the analytic exp-drag displacement (1−e^{−k·t})/k never divides by zero (k→0 ⇒ ≈ t). */
const DRAG_EPS = 1e-4

/** three.js AdditiveBlending enum value (avoid an extra three import for one constant). */
const ADDITIVE_BLENDING = 2
/** The dedicated scene LAYER fight-cast VFX render on when routed to the POST-AgX overlay pass (vfx_overlay_pass.js).
 *  The main camera's default mask is layer 0, so the main scene pass AUTO-EXCLUDES this layer (never AgX-tonemaps the
 *  VFX); the overlay pass isolates it and composites it additively in DISPLAY space — the pack's saturated glow reads
 *  as pure coloured light, not the AgX-desaturated white the in-scene path produced. NOT 0 (default) / 31 (the
 *  webgl_fallback node-material park layer) — layer 10 is otherwise unused. */
export const FIGHT_VFX_LAYER = 10

/**
 * Route a built preset Group onto the POST-AgX overlay: every particle mesh moves to FIGHT_VFX_LAYER (so the main
 * scene pass skips it) and its material switches to DISPLAY-SPACE ADDITIVE — additive blend (the pack's blend_add /
 * additive-glow luminosity, which reads as pure light once it's out from under AgX), depthWrite ON so the overlay
 * pass records a representative particle depth for the composite's scene-occlusion mask, depthTest OFF so overlapping
 * particles still ACCUMULATE (the glow stacks). PURE (mirrors the park_node_material_objects idiom — traverse, touch
 * only objects with a material) so it's unit-testable without a GPU. Idempotent; returns how many meshes were routed.
 * @param {import('three').Object3D} root the preset handle's object3d
 * @returns {number} meshes routed
 */
export function route_overlay_group(root) {
  let routed = 0
  root.traverse((/** @type {*} */ o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    if (mats.length === 0) return
    o.layers.set(FIGHT_VFX_LAYER)
    for (const m of mats) {
      m.blending = ADDITIVE_BLENDING
      m.depthWrite = true
      m.depthTest = false
    }
    routed += 1
  })
  return routed
}

/**
 * WIDEN (never replace) `camera`'s layer mask to also see FIGHT_VFX_LAYER — layer 0 (ordinary scene content)
 * stays enabled. The ONE consumer: renderer.js's ARCHITECT-RESILIENCE bare-render fallback (`render_frame`'s
 * `else renderer.render(scene, camera)` branch), hit whenever the atmo/post stack throws during construction
 * or bake (a WebGPU/TSL compile failure on a given device — caught, console.warn'd, never rethrown, so it is
 * invisible on a phone with no attached devtools: owner iPhone/WebGPU/Low report "I seem to not really see vfx
 * on mobile"). That degraded path has NO overlay pass (post is null), so a plain camera's DEFAULT mask (layer 0
 * only) is all it ever renders — every fight-cast VFX (already routed to FIGHT_VFX_LAYER by route_overlay_group)
 * goes permanently dark while the rest of the game stays fully playable. Calling this once, the moment the
 * fallback engages, restores visibility — pre-overlay colour (no AgX-bypass composite: see vfx_overlay_pass.js),
 * but SEEN beats invisible ("no flags default ON" law). Idempotent (Layers.enable ORs the bit).
 * @param {import('three').Camera} camera
 */
export function enable_fight_vfx_layer(camera) {
  camera.layers.enable(FIGHT_VFX_LAYER)
}

// ── PURE CORE (unit-tested; the TSL mirrors this) ─────────────────────────────────────────────────────────

/**
 * Deterministic per-particle pseudo-random in [0,1) — a hash chain over (emitter salt, particle index, lane).
 * Same shape as particles.js `particle_seed` so the field is reproducible and testable without a GPU.
 * @param {number} i particle index @param {number} lane which random (0..) @param {number} salt emitter salt
 * @returns {number} value in [0,1)
 */
export function vfx_rand(i, lane, salt = 0) {
  let x = (Math.imul(i + 1, 0x9e3779b1) + Math.imul(lane + 1, 0x85ebca77) + Math.imul(salt + 1, 0xc2b2ae35)) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0
  x = Math.imul(x ^ (x >>> 13), 0x297a2d39) >>> 0
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

/** Linear-interpolate an evenly-spaced control-point curve at u∈[0,1]. `[a]`→a; `[a,b]`→lerp; `[a,b,c]`→2
 *  segments; etc. Pure — the TSL builder unrolls this identically. @param {number[]} pts @param {number} u */
export function curve_eval(pts, u) {
  if (!pts || pts.length === 0) return 1
  if (pts.length === 1) return pts[0]
  const uc = u < 0 ? 0 : u > 1 ? 1 : u
  const seg = pts.length - 1
  const f = uc * seg
  const i = Math.min(seg - 1, Math.floor(f))
  const t = f - i
  return pts[i] + (pts[i + 1] - pts[i]) * t
}

/** Normalize a 3-vector (returns [0,1,0] for a zero vector). @param {number[]} v */
function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2])
  return l < 1e-6 ? [0, 1, 0] : [v[0] / l, v[1] / l, v[2] / l]
}

/**
 * Generate the STATIC seed of particle `i` for an emitter — a pure function of (emitter params, index, salt).
 * The emission shape samples the birth position offset; the cone/sphere/ring samples the launch direction;
 * velocity/size/birth are rolled from the emitter's min/max. Returns the per-particle record the TSL reads
 * (uploaded as instanced attributes). Deterministic ⇒ unit-testable + reproducible.
 * @param {VfxEmitter} em @param {number} i @param {number} salt
 * @returns {{ dir:[number,number,number], speed:number, pos0:[number,number,number], birth:number, size:number, color_roll:number, spin:number, radial_v:number }}
 */
export function seed_emitter(em, i, salt = 0) {
  const r = (/** @type {number} */ lane) => vfx_rand(i, lane, salt)
  const life = em.lifetime ?? 1
  const expl = em.explosiveness ?? 1
  const [smin, smax] = em.speed ?? [0, 0]
  const [zmin, zmax] = em.size ?? [1, 1]
  const off = em.offset ?? [0, 0, 0]
  const shape = em.shape ?? 'point'

  // launch DIRECTION — a cone about `direction` of half-angle `spread`, or isotropic for sphere/box/point.
  const axis = normalize3(em.direction ?? [0, 1, 0])
  let dir
  if (shape === 'sphere' || shape === 'box' || (em.spread ?? 0) >= 180) {
    // isotropic: a uniform point on the unit sphere (z in [-1,1], azimuth θ).
    const z = r(0) * 2 - 1
    const th = r(1) * Math.PI * 2
    const rr = Math.sqrt(Math.max(0, 1 - z * z))
    dir = [rr * Math.cos(th), z, rr * Math.sin(th)]
  } else {
    // a cone about `axis`: polar within `spread` degrees, uniform azimuth, then rotate onto the axis.
    const half = ((em.spread ?? 0) * Math.PI) / 180
    const cosT = 1 - r(0) * (1 - Math.cos(half))
    const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT))
    const ph = r(1) * Math.PI * 2
    const local = [sinT * Math.cos(ph), cosT, sinT * Math.sin(ph)] // cone about +Y
    dir = rotate_y_to(axis, local)
  }

  // birth POSITION offset — shape sample around `offset`.
  let pos0 = [off[0], off[1], off[2]]
  if (shape === 'shell') {
    // sphere SURFACE at `radius` — a uniform point on the unit sphere scaled out (the charge/gather shell).
    const z = r(2) * 2 - 1
    const th = r(3) * Math.PI * 2
    const rr = Math.sqrt(Math.max(0, 1 - z * z))
    const u = [rr * Math.cos(th), z, rr * Math.sin(th)]
    const rad = em.radius ?? 1
    pos0 = [off[0] + u[0] * rad, off[1] + u[1] * rad, off[2] + u[2] * rad]
    dir = u // radially outward by default; `inward` (below) flips it to converge
  } else if (shape === 'sphere') {
    // a uniform point in the unit BALL, scaled by radius × per-axis `emission_scale` (Godot emission_shape_scale):
    // the vertical-ellipsoid emission VOLUME the StatusFX auras hug the body with (ice 0.5,1,0.5 ⇒ tall + thin).
    const z = r(2) * 2 - 1
    const th = r(3) * Math.PI * 2
    const rr = Math.sqrt(Math.max(0, 1 - z * z))
    const rad = (em.radius ?? 1) * Math.cbrt(r(4)) // uniform in volume
    const es = em.emission_scale ?? [1, 1, 1]
    pos0 = [
      off[0] + rr * Math.cos(th) * rad * es[0],
      off[1] + z * rad * es[1],
      off[2] + rr * Math.sin(th) * rad * es[2],
    ]
  } else if (shape === 'ring') {
    const inner = em.inner ?? 0
    const outer = em.radius ?? 1
    const rad = Math.sqrt(inner * inner + r(2) * (outer * outer - inner * inner))
    const th = r(3) * Math.PI * 2
    pos0 = [off[0] + Math.cos(th) * rad, off[1], off[2] + Math.sin(th) * rad]
    dir = normalize3([Math.cos(th), 0.15, Math.sin(th)]) // ring particles billow outward+up
  } else if (shape === 'box') {
    const rad = em.radius ?? 1
    pos0 = [off[0] + (r(2) * 2 - 1) * rad, off[1] + (r(3) * 2 - 1) * rad, off[2] + (r(4) * 2 - 1) * rad]
  }

  // INWARD (the charge/gather): launch back toward the emission centre so a shell IMPLODES to the caster's core.
  if (em.inward) {
    const to_c = normalize3([off[0] - pos0[0], off[1] - pos0[1], off[2] - pos0[2]])
    dir = to_c
  }

  return {
    dir: /** @type {[number,number,number]} */ (dir),
    speed: smin + (smax - smin) * r(5),
    pos0: /** @type {[number,number,number]} */ (pos0),
    // `delay` (the pack's per-emitter emit_start) offsets the whole birth window forward — a staggered SECOND
    // flash wave lands after the core pop (folded into birth so the born-gate + death math need no other change).
    birth: (em.delay ?? 0) + life * (1 - expl) * r(6),
    size: zmin + (zmax - zmin) * r(7),
    color_roll: r(8),
    spin: (r(9) * 2 - 1) * (em.spin ?? 0),
    // RADIAL initial velocity (Godot radial_velocity_min/max): outward speed from the emission centre. Paired with
    // `radial_accel` (a signed constant, applied in particle_state) — the StatusFX auras' whole drift is radial.
    radial_v: em.radial ? em.radial[0] + (em.radial[1] - em.radial[0]) * r(10) : 0,
  }
}

/** Rotate a vector given in a +Y-up local frame onto `axis` (so a cone about +Y aligns to `axis`). Pure.
 *  @param {number[]} axis unit target @param {number[]} local vector in +Y frame */
function rotate_y_to(axis, local) {
  // Build an orthonormal basis (t, axis, b) and express local in it.
  const up = Math.abs(axis[1]) > 0.999 ? [1, 0, 0] : [0, 1, 0]
  const t = normalize3(cross(up, axis))
  const b = cross(axis, t)
  return [
    t[0] * local[0] + axis[0] * local[1] + b[0] * local[2],
    t[1] * local[0] + axis[1] * local[1] + b[1] * local[2],
    t[2] * local[0] + axis[2] * local[1] + b[2] * local[2],
  ]
}
/** @param {number[]} a @param {number[]} b */
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/**
 * The live state of particle `i` at absolute preset `age` (seconds). PURE — the TSL positionNode/scaleNode/
 * colorNode mirror this exactly. `pos` is the LOCAL offset from the preset origin; the caller (or the
 * positionNode's origin uniform) adds the world spawn point. Returns `alive:false` before birth / after death.
 * In LOOP mode the local age WRAPS its lifetime (continuous rebirth): a particle is invisible only BEFORE its
 * first birth, then repeats its life forever (the caller stops it by disposing the handle).
 * @param {VfxEmitter} em @param {ReturnType<typeof seed_emitter>} seed @param {number} age @param {boolean} [loop]
 * @returns {{ alive:boolean, pos?:[number,number,number], size?:number, alpha?:number, u?:number }}
 */
export function particle_state(em, seed, age, loop = false) {
  const raw = age - seed.birth
  const life = em.lifetime ?? 1
  if (raw < 0) return { alive: false } // not yet born (its stagger window hasn't opened)
  if (!loop && raw > life) return { alive: false } // one-shot: dead past its lifetime
  const la = loop ? raw - Math.floor(raw / life) * life : raw // LOOP wraps within [0,life)
  const u = la / life
  const k = Math.max(em.drag ?? 0, DRAG_EPS)
  const disp = (1 - Math.exp(-k * la)) / k // ∫v dt with exp drag (→ la as k→0)
  const g = em.gravity ?? [0, 0, 0]
  const pos = /** @type {[number,number,number]} */ ([
    seed.pos0[0] + seed.dir[0] * seed.speed * disp + 0.5 * g[0] * la * la,
    seed.pos0[1] + seed.dir[1] * seed.speed * disp + 0.5 * g[1] * la * la,
    seed.pos0[2] + seed.dir[2] * seed.speed * disp + 0.5 * g[2] * la * la,
  ])
  // RADIAL primitive (Godot radial_velocity + radial_accel): push the particle out from / in toward the emission
  // centre along its BIRTH radial direction. disp = v·t + ½·a·t² (a signed ⇒ negative = converge, the gem/heal/
  // magic/void inward pull). The StatusFX auras' entire drift is radial (no initial_velocity). Additive — an
  // emitter with neither field is byte-untouched. PURE (the TSL mirror matches op-for-op).
  const radial_a = em.radial_accel ?? 0
  if (seed.radial_v || radial_a) {
    const c = em.offset ?? [0, 0, 0]
    const rx = seed.pos0[0] - c[0]
    const ry = seed.pos0[1] - c[1]
    const rz = seed.pos0[2] - c[2]
    const rl = Math.hypot(rx, ry, rz)
    if (rl > 1e-4) {
      const rdisp = seed.radial_v * la + 0.5 * radial_a * la * la
      pos[0] += (rx / rl) * rdisp
      pos[1] += (ry / rl) * rdisp
      pos[2] += (rz / rl) * rdisp
    }
  }
  // ORBIT primitive (the ONE motion a ballistic particle can't fake — Godot orbit_velocity): revolve the XZ
  // position around the vertical axis through the emission centre (`offset`) at `orbit` rad/s. Additive — an
  // emitter without `orbit` is untouched (θ=0). Powers the swirling aura statuses (Godot particles_orbit). PURE (TSL mirrors).
  if (em.orbit) {
    const c = em.offset ?? [0, 0, 0]
    const th = em.orbit * la
    const ct = Math.cos(th)
    const st = Math.sin(th)
    const rx = pos[0] - c[0]
    const rz = pos[2] - c[2]
    pos[0] = c[0] + rx * ct - rz * st
    pos[2] = c[2] + rx * st + rz * ct
  }
  const size = seed.size * curve_eval(em.size_curve ?? [1, 1], u)
  const alpha = (em.opacity ?? 1) * curve_eval(em.alpha_curve ?? [1, 0], u)
  return { alive: true, pos, size, alpha, u }
}

/** Peak scene-linear luma a preset can emit at any frame (max over emitters of colour luma × peak alpha-ish).
 *  Used by the no-bloom unit test: sustained emitters must stay < the 2.05 bloom threshold. @param {VfxPreset} p */
export function preset_peak_luma(p) {
  let peak = 0
  for (const em of p.emitters) {
    for (const c of [em.color, em.color_end]) {
      if (!c) continue
      peak = Math.max(peak, 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
    }
  }
  return peak
}

// ── TSL MATERIAL (mirrors particle_state op-for-op) ───────────────────────────────────────────────────────

/** Build the piecewise-linear curve value node at u (unrolled — shallow, no loop). @param {number[]} pts
 *  @param {*} u @returns {*} a float node */
function curve_node(pts, u) {
  if (!pts || pts.length === 0) return float(1)
  if (pts.length === 1) return float(pts[0])
  const seg = pts.length - 1
  const f = u.clamp(0, 1).mul(seg)
  // node = pts[i] + (pts[i+1]-pts[i]) * clamp(f - i, 0, 1), summed so each segment contributes its delta.
  let node = /** @type {*} */ (float(pts[0]))
  for (let i = 0; i < seg; i += 1) node = node.add(float(pts[i + 1] - pts[i]).mul(f.sub(i).clamp(0, 1)))
  return node
}

/**
 * Build ONE emitter's SpriteNodeMaterial + its three instanced-attribute buffers, seeded on the CPU. The
 * shared `age` uniform (advanced by the runtime) drives every particle; `origin` places the whole emitter in
 * the world. Returns `{ material, count }` — the caller mounts it on an InstancedMesh(PlaneGeometry(1,1)).
 * @param {VfxEmitter} em @param {*} age uniform(float) shared by the preset @param {*} origin uniform(vec3) world spawn
 * @param {*} travel uniform(vec3) the emitter's CURRENT travel velocity (moving-emitter primitive; 0 for a static preset)
 * @param {number} salt @param {number} scale world-size multiplier (magnitude) @param {boolean} loop wrap age (persistent)
 * @param {{ e:number, s:number }} mul brightness (emission) + speed (animation clock) multipliers — the per-spell knobs
 */
function build_emitter_material(em, age, origin, travel, salt, scale, loop, mul) {
  const count = Math.max(1, em.count | 0)
  // Per-particle static seeds in three CPU-filled storage buffers, read via the particles.js
  // `.element(instanceIndex)` path (proven at every count — a raw-array instancedBufferAttribute MISBINDS at
  // tiny instance counts on the WebGPU backend; a storage buffer does not). Filled on the CPU (no compute
  // kernel, so no renderer/bake needed).
  const ds = instancedArray(count, 'vec4') // dir.xyz, speed
  const pb = instancedArray(count, 'vec4') // pos0.xyz, birth
  const mc = instancedArray(count, 'vec4') // size, color_roll, spin, _
  const a_ds = ds.value.array
  const a_pb = pb.value.array
  const a_mc = mc.value.array
  for (let i = 0; i < count; i += 1) {
    const s = seed_emitter(em, i, salt)
    a_ds.set([s.dir[0], s.dir[1], s.dir[2], s.speed], i * 4)
    a_pb.set([s.pos0[0] * scale, s.pos0[1] * scale, s.pos0[2] * scale, s.birth], i * 4)
    a_mc.set([s.size * scale, s.color_roll, s.spin, s.radial_v * scale], i * 4) // .w = radial velocity (scaled)
  }
  ds.value.needsUpdate = true
  pb.value.needsUpdate = true
  mc.value.needsUpdate = true
  const dsn = ds.element(instanceIndex)
  const pbn = pb.element(instanceIndex)
  const mcn = mc.element(instanceIndex)

  const life = float(em.lifetime ?? 1)
  const k = Math.max(em.drag ?? 0, DRAG_EPS)
  const g = em.gravity ?? [0, 0, 0]

  const raw = age.sub(pbn.w).max(0) // age since birth (clamped ≥0)
  const la = loop ? raw.sub(raw.div(life).floor().mul(life)) : raw // LOOP wraps the local age within [0,life)
  const u = la.div(life)
  const disp = float(1).sub(la.mul(-k).exp()).div(k) // (1−e^{−k·la})/k
  const grav = vec3(g[0], g[1], g[2]).mul(0.5).mul(la).mul(la)
  // LOCAL position (before origin) — pos0(scaled) + ballistic travel + gravity. Radial then orbit rotate it.
  let local = pbn.xyz.add(dsn.xyz.mul(dsn.w).mul(disp)).add(grav)
  // RADIAL (mirrors particle_state): push along the BIRTH radial direction normalize(pos0 − centre) by
  // v·la + ½·a·la² (v = mcn.w scaled, a a build-time const × scale). Guarded so non-radial emitters stay byte-identical.
  if (em.radial || em.radial_accel) {
    const off = em.offset ?? [0, 0, 0]
    const centre = vec3(off[0] * scale, off[1] * scale, off[2] * scale)
    const rvec = pbn.xyz.sub(centre)
    const rdir = rvec.div(rvec.length().max(1e-4))
    const rdisp = mcn.w.mul(la).add(
      float(0.5 * (em.radial_accel ?? 0) * scale)
        .mul(la)
        .mul(la)
    )
    local = local.add(rdir.mul(rdisp))
  }
  // ORBIT (mirrors particle_state): revolve XZ around the emission centre (offset×scale, a build-time constant) at `orbit` rad/s; guarded so non-orbit emitters stay byte-identical.
  if (em.orbit) {
    const off = em.offset ?? [0, 0, 0]
    const cx = off[0] * scale
    const cz = off[2] * scale
    const th = float(em.orbit).mul(la)
    const ct = th.cos()
    const st = th.sin()
    const rx = local.x.sub(cx)
    const rz = local.z.sub(cz)
    local = vec3(rx.mul(ct).sub(rz.mul(st)).add(cx), local.y, rx.mul(st).add(rz.mul(ct)).add(cz))
  }
  // trail emitters (moving-emitter primitive): subtract travel·age so the particle stays at its BIRTH world point
  // (origin has advanced ~travel·la since then) — a flying orb sheds a world-static wake instead of dragging its puff.
  const moved = origin.add(local)
  const world = em.trail ? moved.sub(travel.mul(la)) : moved

  const mat = new SpriteNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false
  mat.depthTest = false // fight burst reads over the flat board/avatars (board_vfx idiom); no inter-quad z-fight
  mat.toneMapped = false // NORMAL-blend bright glow that survives AgX (title_aura/board_vfx law)
  if (em.blend === 'additive') mat.blending = 2 // AdditiveBlending — probe/opt-in only; default NORMAL (AgX-safe)

  mat.positionNode = world
  mat.scaleNode = mcn.x.mul(curve_node(em.size_curve ?? [1, 1], u))
  if (em.spin) mat.rotationNode = mcn.z.mul(la)

  const c0 = em.color ?? [1, 1, 1]
  const c1 = em.color_end ?? c0
  const kind = em.appearance ?? 'flame'
  // The pack shader ANIMATION clock (Godot TIME × the per-preset speed knob — one of the {tint,scale,brightness,
  // speed} tunables the ~272 spells map through). Motion/gates keep the real `age`; only the churn scales.
  const clock = mul.s === 1 ? age : age.mul(mul.s)
  let col
  let shape_alpha
  if (PACK_BILLBOARD.has(kind)) {
    // PACK APPEARANCE — the real .gdshader per-pixel look. Colour is the pack idiom mix(secondary, primary, value)
    // × emission (brightness knob), NOT the engine's over-life mix; primary ≡ color (tinted), secondary ≡ color_end.
    const pri = vec3(c0[0], c0[1], c0[2])
    const sec = vec3(c1[0], c1[1], c1[2])
    const emission = float((em.emission ?? 2) * mul.e)
    const r = billboard_pack(kind, { age: clock, seed: mcn.y, grow: u, pri, sec, emission })
    col = r.rgb
    shape_alpha = r.alpha
  } else if (kind === 'flame' || kind === 'spark') {
    // GENERIC fiery billboard (the _debug probe + the spark embers/trails/debris) — noise silhouette + life-mix.
    col = mix(vec3(c0[0], c0[1], c0[2]), vec3(c1[0], c1[1], c1[2]), u.clamp(0, 1))
    const shape = flame_field(kind, { age: clock, seed: mcn.y })
    if (kind === 'flame') col = mix(col.mul(vec3(0.6, 0.2, 0.1)), col, shape.heat.clamp(0, 1).pow(0.55))
    shape_alpha = shape.alpha
  } else {
    // GENERIC crisp graphic (ring/glow/star fallback) — life-mix colour.
    col = mix(vec3(c0[0], c0[1], c0[2]), vec3(c1[0], c1[1], c1[2]), u.clamp(0, 1))
    shape_alpha = appearance_alpha(kind)
  }
  // alive gate: before birth (la clamped 0 ⇒ u 0) we must still hide the particle until its birth; after
  // death (u>1) hide it. `born` = age has passed birth; `dead` = u≥1. Multiply alpha by the gate.
  const born = age.greaterThanEqual(pbn.w).select(float(1), float(0))
  const notDead = u.lessThanEqual(1).select(float(1), float(0))
  // EDGE FEATHER: force the billboard's alpha to ZERO at the quad UV border so the POST-AgX additive overlay can never
  // amplify a faint edge texel into a visible rectangle. A smoothstep inset on each axis (0 at the edge → 1 by
  // EDGE_FEATHER inward), multiplied together = a soft rounded border; the inner ~76% is untouched. Shallow (naga law).
  const quv = uv()
  const feather = smoothstep(0, EDGE_FEATHER, quv.x)
    .mul(smoothstep(0, EDGE_FEATHER, quv.x.oneMinus()))
    .mul(smoothstep(0, EDGE_FEATHER, quv.y))
    .mul(smoothstep(0, EDGE_FEATHER, quv.y.oneMinus()))
  const alpha = curve_node(em.alpha_curve ?? [1, 0], u)
    .mul(shape_alpha)
    .mul(float(em.opacity ?? 1))
    .mul(born)
    .mul(notDead)
    .mul(feather)
  mat.colorNode = vec4(col, alpha)

  return { material: mat, count }
}

/**
 * Build a SPHERE-HERO mesh (real geometry — the ONE capability a billboard can't fake): vertex displacement along
 * the true normal + view-space fresnel N·V, so the DarkMagic void ball reads as a 3D dark-energy orb and its core
 * as a real hole (a flat sprite reads as generic, not "dark magic" — a hero mesh is the fix). A hero is a single
 * mesh (count 1), placed at the `origin` uniform (so a projectile orb rides its path). @param {VfxEmitter} em
 * @param {*} age preset clock @param {*} origin world spawn uniform @param {*} scale_u world-size uniform (one pipeline across all magnitudes — the prewarm-warm/live-cast pipeline match) @param {{e:number,s:number}} mul
 * @returns {{ mesh: Mesh, geo: SphereGeometry, mat: MeshBasicNodeMaterial }}
 */
function build_sphere_hero(em, age, origin, scale_u, mul, loop = false) {
  const geo = new SphereGeometry(1, 32, 24)
  const mat = new MeshBasicNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false
  mat.depthTest = false
  mat.toneMapped = false
  if (em.blend === 'additive') mat.blending = 2

  const life = float(em.lifetime ?? 1)
  const clock = mul.s === 1 ? age : age.mul(mul.s) // ANIMATION clock stays continuous (noise scroll never resets)
  const la = loop ? age.sub(age.div(life).floor().mul(life)) : age // LOOP wraps the curve param within [0,life)
  const u = la.div(life)
  // ELLIPSOID (aura capsule): per-axis half-extents [rx,ry,rz]×scale instead of a uniform radius — a tall body column.
  const rvec = em.ellipsoid
    ? vec3(em.ellipsoid[0], em.ellipsoid[1], em.ellipsoid[2]).mul(scale_u)
    : float(em.size ? em.size[1] : 1).mul(scale_u)
  const grow = curve_node(em.size_curve ?? [1, 1], u)

  const c0 = em.color ?? [1, 1, 1]
  const c1 = em.color_end ?? c0
  const pri = vec3(c0[0], c0[1], c0[2])
  const sec = vec3(c1[0], c1[1], c1[2])
  const emission = float((em.emission ?? 2) * mul.e)
  const {
    displace,
    rgb,
    alpha: shape_alpha,
  } = sphere_pack(em.appearance ?? 'void_ball', {
    age: clock,
    pri,
    sec,
    emission,
    amount: em.displace ?? 0.5,
  })

  // world = centre + (unit sphere + normal displacement) × extent×grow. `centre` lifts the hero body-local (offset,
  // e.g. torso height for an aura); extent is the ellipsoid vec3 or the uniform radius. Displacement rides local space.
  const off = em.offset ?? [0, 0, 0]
  const centre = origin.add(vec3(off[0], off[1], off[2]).mul(scale_u))
  mat.positionNode = centre.add(positionLocal.add(displace).mul(rvec).mul(grow))
  const notDead = loop ? float(1) : u.lessThanEqual(1).select(float(1), float(0)) // a LOOP shell never self-expires
  const alpha = shape_alpha
    .mul(curve_node(em.alpha_curve ?? [1, 1], u))
    .mul(float(em.opacity ?? 1))
    .mul(notDead)
  mat.colorNode = vec4(rgb, alpha)

  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  // void core reads IN FRONT of the ball; the aura CAPSULE reads BEHIND the billboard motes (993 < 994) so the
  // aura + element symbols pop over the translucent column instead of being veiled by it.
  mesh.renderOrder = em.appearance === 'aura_shell' ? 993 : em.appearance === 'void_core' ? 996 : 995
  return { mesh, geo, mat }
}

// ── RUNTIME HANDLE ────────────────────────────────────────────────────────────────────────────────────────

/** @typedef {import('./vfx_preset_types.js').VfxEmitter} VfxEmitter */
/** @typedef {import('./vfx_preset_types.js').VfxPreset} VfxPreset */
/** @typedef {import('./vfx_preset_types.js').VfxHandle} VfxHandle */

/**
 * Instantiate a preset: one Group of InstancedMesh billboards (one per emitter), a shared `age` uniform, and
 * an `origin` uniform. Nothing animates until `update(dt)` advances age. Camera billboarding is free
 * (SpriteNodeMaterial). No renderer / no compute needed — seeds are CPU-baked into instanced attributes.
 * @param {VfxPreset} preset
 * @param {{ position?:[number,number,number], scale?:number, salt?:number, tint?:[number,number,number], emission?:number, speed?:number, overlay?:boolean }} [opts]
 *   The per-spell PARAMETRIC knobs (one ported effect serves the ~272 spells): `scale` = world-size / footprint,
 *   `tint` = element recolour, `emission` = brightness multiplier, `speed` = animation-clock multiplier. `overlay` =
 *   route this handle to the POST-AgX display-space additive overlay (the FIGHT bar — see route_overlay_group); world
 *   ambience / gather / dust presets omit it and stay in the AgX'd main pass (tuned for the world lighting).
 * @returns {VfxHandle}
 */
export function create_vfx_preset(preset, opts = {}) {
  if (!vfx_build_logged) {
    vfx_build_logged = true
    console.info('[AresRPG VFX] build ' + VFX_BUILD)
  }
  const scale = opts.scale ?? 1
  // The world-size multiplier as a UNIFORM (not a baked node constant) for the sphere-hero mount: a magnitude-scaled
  // burst (scale ≈ 1..1.6) must reuse the SAME compiled pipeline the fight-enter prewarm warmed at scale 1 — baking
  // scale into the WGSL minted a fresh pipeline per magnitude, so the first BIG death/impact compiled cold on the
  // live cast (measured regression: [vfx-probe] first burst (death) 983ms). Billboards bake scale
  // into their CPU seed attributes (data, not shader), so only the sphere hero needed this. (build fingerprint bumped.)
  const scale_u = uniform(scale)
  const salt = opts.salt ?? 0
  const pos = opts.position ?? [0, 0, 0]
  const mul = { e: opts.emission ?? 1, s: opts.speed ?? 1 } // brightness + speed knobs (default = pack-authored)
  const origin = uniform(new Vector3(pos[0], pos[1], pos[2]))
  const travel = uniform(new Vector3(0, 0, 0))
  const loop = !!preset.loop
  const age = uniform(0)
  const root = new Group()
  root.name = `vfx_${preset.name}`
  // Observability (fight_cast_vfx drives these + the moving-emitter test reads them): the WORLD placement lives in
  // the `origin` uniform, NOT root.position (particles add the uniform), so mirror the live state onto userData.
  root.userData = { origin, travel, scale, loop }
  /** @type {{ geo: PlaneGeometry|SphereGeometry, mat: SpriteNodeMaterial|MeshBasicNodeMaterial }[]} */
  const parts = []
  let particle_count = 0

  for (const raw of preset.emitters) {
    const em = opts.tint ? tint_emitter(raw, opts.tint) : raw
    if (em.geometry === 'sphere' || PACK_SPHERE.has(em.appearance ?? '')) {
      // SPHERE HERO — a single real mesh (displacement + fresnel). One draw call, one "particle".
      const { mesh, geo, mat } = build_sphere_hero(em, age, origin, scale_u, mul, loop)
      root.add(mesh)
      parts.push({ geo, mat })
      particle_count += 1
      continue
    }
    const { material, count } = build_emitter_material(
      em,
      age,
      origin,
      travel,
      salt + parts.length * 101,
      scale,
      loop,
      mul
    )
    const geo = new PlaneGeometry(1, 1)
    const mesh = new InstancedMesh(geo, material, count)
    mesh.frustumCulled = false // billboards move in-shader; CPU bounds lie (particles.js / waterfall idiom)
    mesh.renderOrder = 994 // above the sprite-sheet burst (993) — the 3D burst reads on top
    root.add(mesh)
    parts.push({ geo, mat: material })
    particle_count += count
  }

  // FIGHT bar: route the whole handle to the POST-AgX display-space additive overlay (layer + additive blend +
  // occlusion depth). Default (world VFX) stays in the AgX'd main pass, byte-identical to before this opt existed.
  if (opts.overlay) route_overlay_group(root)

  return {
    object3d: root,
    age,
    origin,
    travel,
    scale,
    duration: preset.duration,
    loop,
    particle_count,
    draw_calls: preset.emitters.length,
    update(dt) {
      age.value += Math.max(0, dt)
      return loop || age.value <= preset.duration // a loop handle lives until the caller disposes it
    },
    dispose() {
      for (const p of parts) {
        p.geo.dispose()
        p.mat.dispose()
      }
    },
  }
}

/** Recolour an emitter toward `rgb` (element tint) — scales its start/end colours toward the tint hue while
 *  keeping the original luminance envelope (so a fire preset reads blue for water without going dim). Pure.
 *  @param {VfxEmitter} em @param {[number,number,number]} rgb @returns {VfxEmitter} */
export function tint_emitter(em, rgb) {
  const relum = (/** @type {[number,number,number]|undefined} */ c) => {
    if (!c) return c
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    const tl = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] || 1
    const g = l / tl // preserve the source channel's brightness relative to the tint
    return /** @type {[number,number,number]} */ ([
      Math.min(1, rgb[0] * g),
      Math.min(1, rgb[1] * g),
      Math.min(1, rgb[2] * g),
    ])
  }
  // near-white cores (all channels high) stay white-hot; only the coloured body/edge takes the tint.
  const is_white = (/** @type {[number,number,number]|undefined} */ c) =>
    !!c && c[0] > 0.85 && c[1] > 0.85 && c[2] > 0.85
  return {
    ...em,
    color: is_white(em.color) ? em.color : relum(em.color),
    color_end: is_white(em.color_end) ? em.color_end : relum(em.color_end),
  }
}
