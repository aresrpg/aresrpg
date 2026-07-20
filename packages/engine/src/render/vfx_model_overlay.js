// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — ON-MODEL MATERIAL OVERLAYS: effects rendered directly onto character/mob models, not just their projectiles/impacts.
// TWO faithful TSL ports, both applied as a slightly-GROWN SHELL of the ENTITY'S OWN mesh (Godot `material_overlay`
// on the demo mannequin's MeshInstance — the body's own humanoid silhouette glows, NOT an egg/ellipsoid):
//   1. create_model_overlay  — FlameFX fire_overlay.gdshader: a fire CRAWL up the surface, driven 0→1→0 for a HIT beat.
//   2. create_status_overlay — StatusFX status_overlay.gdshader: a SUSTAINED elemental body glow (the aura's body layer;
//      the pack preview all.png shows every mannequin's own silhouette washed in its element colour). effect held at 1.
// Both `VERTEX += NORMAL * offset` the char's OWN mesh (a rim/fill skin that tracks the exact silhouette), triplanar
// world-space noise, a fresnel rim; status adds the cull_disabled back-face SOLID FILL that colours the whole body.
//
// FENCE NOTE: this is the engine CAPABILITY (a mesh + material factory). The per-hit spawn (fire) is wired by the
// entity/fight-reaction lane; the sustained status glow rides the entity alongside the aura particle preset
// (create_vfx_preset + follow_entity). A SKINNED entity's shell must share the source SkinnedMesh's skeleton (same
// skinNode) — pass a cloned skinned geometry/material there; this static-geometry factory proves the shader + serves
// static props today. `ELEMENT_OVERLAY` (hit) + `STATUS_OVERLAY` (aura) supply the per-element colours.

import { SkinnedMesh } from 'three'
import { DoubleSide, Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import {
  float,
  frontFacing,
  mix,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  positionWorld,
  normalWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { PACK_NOISE } from './vfx_pack_shaders.js'

/** Element → { primary (hot core), secondary (cool base), emission } — the on-model overlay colour per element.
 *  Matches the fight element palette; the fight-reaction lane picks by the struck cast's element. */
export const ELEMENT_OVERLAY = /** @type {const} */ ({
  fire: { primary: [1, 0.95, 0.7], secondary: [1, 0.32, 0.06], emission: 2.4 },
  water: { primary: [0.85, 0.98, 1], secondary: [0.1, 0.5, 1], emission: 2.2 },
  air: { primary: [0.9, 1, 1], secondary: [0.35, 0.8, 1], emission: 2.4 },
  earth: { primary: [1, 0.85, 0.5], secondary: [0.5, 0.32, 0.12], emission: 2 },
  death: { primary: [1, 0.6, 1], secondary: [0.5, 0.05, 0.85], emission: 2.4 },
  heal: { primary: [1, 0.98, 0.8], secondary: [1, 0.82, 0.4], emission: 2.2 },
  neutral: { primary: [0.95, 0.75, 1], secondary: [0.5, 0.2, 0.9], emission: 2.2 },
  weapon: { primary: [1, 0.85, 0.8], secondary: [0.9, 0.3, 0.25], emission: 2.2 },
})

/** Status/aura → { primary (rim/fill core), secondary (body base) } — the SUSTAINED body-glow colours, transcribed
 *  EXACTLY from the pack's <element>_overlay.tres (StatusFX/effects/overlay/*). The consumer picks by the worn aura
 *  name (status_<k>); the aura particle preset shares the same palette. emission kept ≤1.6 (AgX no-bloom, pack authors 2). */
export const STATUS_OVERLAY = /** @type {const} */ ({
  ice: { primary: [1, 1, 1], secondary: [0, 0.7764706, 0.84313726] },
  poison: { primary: [0.696177, 1, 0.6038247], secondary: [0, 0.6, 0.23921569] },
  flame: { primary: [0.9999998, 0.81755334, 0.24100372], secondary: [0.9137255, 0.34117648, 0] },
  water: { primary: [0.47058824, 0.99607843, 1], secondary: [0, 0.4862745, 0.9411765] },
  void: { primary: [0.5764706, 0.12156863, 1], secondary: [0.08235294, 0, 0.6313726] },
  dark: { primary: [1, 0.24705882, 0.49803922], secondary: [0.5764706, 0.12156863, 1] },
  divine: { primary: [1, 0.98039216, 0.93333334], secondary: [1, 0.56078434, 0.38431373] },
  green: { primary: [0.7137255, 1, 0.54509807], secondary: [0, 0.6666667, 0.23529412] },
  shard: { primary: [0.20784314, 0.5921569, 1], secondary: [0, 0.5176471, 0.59607846] },
  heal: { primary: [0.60784316, 0.99607843, 0], secondary: [0.4627451, 0.6431373, 0] },
  nature: { primary: [0.5764706, 0.8745098, 0], secondary: [0.17254902, 0.7411765, 0] },
  magic: { primary: [0.9372549, 0.39607844, 0], secondary: [0.78039217, 0.05882353, 0.60784316] },
  // The 5 remaining pack overlays (rot/shatter/sleep/purple/glow), transcribed EXACTLY from their
  // StatusFX/effects/overlay/<k>_overlay.tres primary/secondary_color — so the cosmetic→aura map (frontend)
  // has a faithful on-model colour for every seeded aura. (No `gem_overlay.tres` ships → gem maps to shard.)
  rot: { primary: [1, 0.627451, 0.5019608], secondary: [0.8352941, 0, 0.17254902] },
  shatter: { primary: [1, 1, 1], secondary: [0.5686275, 0.5686275, 0.5686275] },
  sleep: { primary: [1, 0.92941177, 0.5568628], secondary: [0.5921569, 0.6039216, 0] },
  purple: { primary: [1, 0.3019608, 0.6862745], secondary: [0.9137255, 0.050980393, 0.68235296] },
  glow: { primary: [0.99215686, 0.8784314, 0.69411767], secondary: [1, 0.78431374, 0.5019608] },
})

/**
 * Build an on-model fire-crawl overlay shell for `geometry` (the entity's mesh geometry, in the entity's local
 * space). Returns a Mesh to add as a sibling/child at the entity's transform, plus the `age`/`effect` uniforms and
 * update/dispose. Nothing shows until `effect` > 0 — drive it 0→1→0 across the impact beat.
 * @param {import('three').BufferGeometry} geometry
 * @param {{ primary?:[number,number,number], secondary?:[number,number,number], emission?:number, scale?:number,
 *   speed?:number, noise_scale?:number, edge_bottom?:number, edge_top?:number, color_curve?:number }} [opts]
 * @returns {{ mesh: Mesh, age: * , effect: *, update:(dt:number)=>void, dispose:()=>void }}
 */
export function create_model_overlay(geometry, opts = {}) {
  const primary = opts.primary ?? [1, 0.95, 0.7]
  const secondary = opts.secondary ?? [1, 0.32, 0.06]
  const emission = opts.emission ?? 2.4
  const grow = opts.scale ?? 0.03 // grow_offset — the shell stands just off the surface
  const speed = opts.speed ?? 1
  const nscale = opts.noise_scale ?? 1
  const edge_bottom = opts.edge_bottom ?? 0.1
  const edge_top = opts.edge_top ?? 0.9
  const color_curve = opts.color_curve ?? 1.0

  const age = uniform(0)
  const effect = uniform(0) // 0 = invisible; drive 0→1→0 on the hit beat
  const clock = speed === 1 ? age : age.mul(speed)

  const mat = new MeshBasicNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false
  mat.toneMapped = false // bright emissive fire survives AgX (board_vfx/title_aura idiom)

  // sample_wobble(gradient) = sin(gradient·freq − TIME·scroll·speed) — the surface wobble (Godot fire_overlay).
  const wob = (g) => g.mul(12).sub(clock.mul(4)).sin()
  // VERTEX: grow the shell along the normal + a small breathing wobble (matches the .gdshader vertex()).
  const gy = positionWorld.y
  mat.positionNode = positionLocal.add(normalLocal.mul(grow)).add(normalLocal.mul(wob(gy).mul(0.5).add(0.5).mul(0.02)))

  // FRAGMENT: triplanar world noise scrolling UP, masked bottom→top by the world normal, a fresnel rim.
  const wobble = wob(gy).mul(0.1)
  const scroll = clock.mul(0.3) // noise_scroll.y default 0.3
  const xy = positionWorld.xy.mul(nscale).add(wobble)
  const zy = positionWorld.zy.mul(nscale).add(wobble)
  const n_xy = texture(PACK_NOISE, xy.sub(scroll)).r
  const n_zy = texture(PACK_NOISE, zy.sub(scroll)).r
  let noise = n_xy.mul(normalWorld.z.abs()).max(n_zy.mul(normalWorld.x.abs()))
  const mask = smoothstep(edge_bottom, edge_top, normalWorld.y.mul(0.5).add(0.5))
  noise = noise.sub(mask).max(0).add(mask.oneMinus().pow(16).mul(0.2))
  noise = smoothstep(0.1, 0.2, noise)
  const value = noise.max(mask.oneMinus().mul(0.3))
  const color = mix(vec3(...secondary), vec3(...primary), mask.oneMinus().pow(color_curve)).mul(emission)
  const fresnel = positionViewDirection.dot(normalView).clamp(0, 1).pow(0.5)
  mat.colorNode = vec4(color, value.mul(fresnel).mul(effect))

  const mesh = new Mesh(geometry, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 997

  return {
    mesh,
    age,
    effect,
    update(dt) {
      age.value += Math.max(0, dt)
    },
    dispose() {
      mat.dispose()
    },
  }
}

/**
 * Mount a SUSTAINED status glow on a LOADED character/entity: one create_status_overlay shell PER mesh under
 * `root`, each a CHILD of its source mesh (identity local transform ⇒ the exact same world matrix). A
 * SkinnedMesh source gets a SkinnedMesh shell bound to the SAME skeleton, so the glow deforms with every walk/
 * idle frame instead of freezing at the bind pose (the make_outline_material idiom — three applies skinning to
 * positionLocal/normalLocal BEFORE the material's positionNode); a static mesh (bone-parented hair) gets a plain
 * Mesh shell. The shell SHARES the source geometry (position/normal/skin attributes) — so dispose is REMOVE-ONLY
 * on the geometry (never disposed here; the avatar owns it) and frees only each shell's OWN material. Drive
 * update(dt) each frame for the noise scroll. THE consumer for STATUS_OVERLAY: a worn cosmetic → a body aura.
 * @param {import('three').Object3D} root the avatar/entity object3d — its meshes must already be loaded
 * @param {{ primary?:[number,number,number], secondary?:[number,number,number], emission?:number, offset?:number,
 *   speed?:number, noise_scale?:number, color_curve?:number }} [opts] a STATUS_OVERLAY[k] entry (+ optional tuning)
 * @returns {{ update:(dt:number)=>void, dispose:()=>void, count:number }}
 */
export function attach_status_overlay(root, opts = {}) {
  /** @type {import('three').Mesh[]} */ const shells = []
  /** @type {ReturnType<typeof create_status_overlay>[]} */ const handles = []
  /** @type {any[]} */ const targets = []
  root.traverse((/** @type {any} */ o) => {
    if (o.isMesh && !o.userData.__status_overlay) targets.push(o)
  })
  for (const src of targets) {
    const ov = create_status_overlay(src.geometry, opts) // builds the material + age/effect + update/dispose
    const mat = ov.mesh.material // reuse ONLY the material; ov.mesh (plain, never added to a scene) is GC'd
    /** @type {any} */ let shell
    if (src.isSkinnedMesh) {
      shell = new SkinnedMesh(src.geometry, mat)
      shell.bind(src.skeleton, src.bindMatrix) // SAME skeleton ⇒ identical deformation (build_outline law)
      shell.bindMode = src.bindMode
    } else {
      shell = new Mesh(src.geometry, mat)
    }
    shell.userData.__status_overlay = true
    shell.frustumCulled = false // skinned bounds lie during animation
    shell.castShadow = false
    shell.receiveShadow = false
    shell.renderOrder = 998
    src.add(shell) // child of the source mesh ⇒ the exact same world matrix (no separate tracking)
    shells.push(shell)
    handles.push(ov)
  }
  return {
    count: shells.length,
    update(dt) {
      for (const h of handles) h.update(dt)
    },
    dispose() {
      for (const s of shells) s.removeFromParent()
      for (const h of handles) h.dispose() // frees each shell's OWN material (the SHARED geometry is untouched)
      shells.length = 0
      handles.length = 0
    },
  }
}

/** Godot overlay() blend on two 0..1 nodes: step(0.5,base) ? screen : multiply. @param {*} base @param {*} blend */
function overlay_blend(base, blend) {
  const lo = base.mul(blend).mul(2)
  const hi = float(1).sub(base.oneMinus().mul(blend.oneMinus()).mul(2))
  return base.greaterThanEqual(0.5).select(hi, lo)
}

/**
 * Build a SUSTAINED on-model status glow for `geometry` (the entity's OWN mesh, in its local space) — the StatusFX
 * status_overlay.gdshader: the body's humanoid silhouette washed in the element colour (the aura's body layer). A
 * grown shell (VERTEX += NORMAL·offset) with a fresnel/underside rim, triplanar world noise, and a cull_disabled
 * back-face SOLID FILL that colours the whole body. `effect` holds at 1 (persistent); ride it on the entity next to
 * the aura particle preset. NOT an ellipsoid — it tracks the exact mesh silhouette (the fix for the egg strike).
 * @param {import('three').BufferGeometry} geometry
 * @param {{ primary?:[number,number,number], secondary?:[number,number,number], emission?:number, offset?:number,
 *   speed?:number, noise_scale?:number, color_curve?:number }} [opts]
 * @returns {{ mesh: Mesh, age: *, effect: *, update:(dt:number)=>void, dispose:()=>void }}
 */
export function create_status_overlay(geometry, opts = {}) {
  const primary = opts.primary ?? [1, 1, 1]
  const secondary = opts.secondary ?? [0, 0.7764706, 0.84313726] // ice
  const emission = opts.emission ?? 1.6 // pack authors 2.0; kept ≤1.6 under the AgX bloom ceiling (no-halo law)
  const grow = opts.offset ?? 0.02 // Godot offset — inflate the char's OWN mesh along its normals
  const speed = opts.speed ?? 1
  const nscale = opts.noise_scale ?? 1
  const color_curve = opts.color_curve ?? 1

  const age = uniform(0)
  const effect = uniform(1) // a status is PERSISTENT — held at 1 (unlike the fire hit-flash's 0→1→0)
  const clock = speed === 1 ? age : age.mul(speed)

  const mat = new MeshBasicNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide // cull_disabled — the back faces fill the silhouette solid (the whole-body colour wash)
  mat.toneMapped = false // bright emissive survives AgX (board_vfx/title_aura idiom)

  // VERTEX: grow the shell along the char mesh's OWN normal (Godot `VERTEX += NORMAL * offset`).
  mat.positionNode = positionLocal.add(normalLocal.mul(grow))

  // FRAGMENT (status_overlay.gdshader op-for-op):
  const fres = positionViewDirection.dot(normalView).clamp(0, 1) // dot(NORMAL, VIEW)
  const rim = fres.oneMinus() // 1 − fresnel
  const base = rim.max(normalWorld.y.negate()) // max(rim, −world_normal.y) — rim + the underside glow
  const scroll = vec2(0, clock.mul(0.1)) // noise_scroll (0, 0.1) · TIME
  const n_xy = texture(PACK_NOISE, positionWorld.xy.mul(nscale).sub(scroll)).r
  const n_zy = texture(PACK_NOISE, positionWorld.zy.mul(nscale).sub(scroll)).r
  const noise = mix(n_xy, n_zy, normalWorld.x.abs()) // triplanar blend by |world_normal.x|
  const value = overlay_blend(base, noise)
  const front_rgb = mix(vec3(...secondary), vec3(...primary), rim.pow(color_curve)).mul(emission)
  const front = vec4(front_rgb, value.mul(effect))
  // BACK faces (cull_disabled): solid primary — this is what fills the silhouette so the WHOLE body glows (not just a rim).
  const back = vec4(vec3(...primary).mul(emission), effect)
  mat.colorNode = frontFacing.select(front, back)

  const mesh = new Mesh(geometry, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 998 // over the entity, under the aura motes (994) is fine — depthWrite off, additive-ish read

  return {
    mesh,
    age,
    effect,
    update(dt) {
      age.value += Math.max(0, dt)
    },
    dispose() {
      mat.dispose()
    },
  }
}
