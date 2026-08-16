// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Water — the legacy NG2-C optics (deprecated/engine/src/render/water_material.js) ported onto
// this engine's ANALYTIC bed: per-vertex ground height + bed color sampled by the far worker,
// so depth-driven transparency, Beer-Lambert see-through, and shore gradients need no
// framebuffer depth grab. Two tiers of geometry: a fine near grid (real shorelines) and the
// horizon plane (uniform deep body). Every knob below traces to an owner-graded decision
// (legacy baseline + the 2026-08-15 blue-depth retune); do not retune casually.

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, type Scene } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  attribute,
  cameraPosition,
  clamp,
  cos,
  float,
  max,
  mix,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  sin,
  screenUV,
  smoothstep,
  time,
  uint,
  vec3,
  viewportSharedTexture,
} from 'three/tsl'
import type { Node } from 'three/webgpu'

import type { Clouds } from './clouds.ts'
import type { FlattenUniform } from './flatten.ts'
import type { create_sky_node } from './sky/sky_node.ts'
import type { EngineQuality } from './types.ts'
import { macro_tint_nodes, material_color_node } from './terrain_tint.ts'
import { compile_world_recipe, type WorldRecipe } from './world_recipe.ts'
import type { CompiledMaterials } from './world_materials.ts'

type AnalyticSky = Pick<ReturnType<typeof create_sky_node>, 'sample_sky_dome' | 'sun_direction'>

export type Water = Readonly<{
  set_focus: (x: number, z: number) => void
  set_quality: (quality: EngineQuality) => void
  dispose: () => void
}>

// ── tuning constants (legacy owner-graded baseline; DEPTH GROUP retuned 2026-08-15 on the
// owner's "too transparent — real blue depth" order: richer blue body, stronger absorption,
// earlier and higher opacity ramps — the read is a saturated blue that closes fast) ──
export const WATER_BODY_COLOR = [0.012, 0.062, 0.185] as const
const WATER_SHALLOW_COLOR = [0.025, 0.56, 0.68] as const
const WATER_SIGMA = [1.15, 0.78, 0.55] as const
const WATER_FADE_START = 1.2
const WATER_TINT_DEPTH = 11.0
const WATER_DEEP_FLOOR = 0.16
const WATER_ALPHA_BASE = 0.34
const WATER_ALPHA_DEEP = 0.95
const WATER_ALPHA_VDEPTH_START = 0.7
const WATER_ALPHA_VDEPTH_END = 3.2
const WATER_ALPHA_VIEW_LEAN = 0.15
const WATER_SHALLOW_PRESENCE = 0.58
const WATER_PRESENCE_FEATHER = 0.05
const WATER_PRESENCE_FULL = 1.25
const WATER_SHALLOW_SKY_MIN = 0.3
const WATER_DETAIL_FADE_NEAR = 34
const WATER_DETAIL_FADE_FAR = 150
const WATER_DISTANT_RIPPLE = 0.12
const WATER_SHORE_GUARD_DEPTH_START = 0.05
const WATER_SHORE_GUARD_DEPTH_END = 1.25
// Near-grid coverage: real shorelines within this span; beyond it the horizon plane is deep body.
const NEAR_SPAN = 512
const NEAR_STEP = 4
const FOCUS_SNAP = 64
const HORIZON_SPAN = 4096

const smooth_profile = (edge_0: number, edge_1: number, value: number): number => {
  const amount = Math.max(0, Math.min(1, (value - edge_0) / (edge_1 - edge_0)))
  return amount * amount * (3 - 2 * amount)
}

export const shore_foam_profile = (depth: number): number =>
  smooth_profile(0.08, 0.32, depth) * (1 - smooth_profile(0.55, 1.25, depth))

export const shore_wave_displacement = (displacement: number, depth: number): number => {
  const guard = 1 - smooth_profile(WATER_SHORE_GUARD_DEPTH_START, WATER_SHORE_GUARD_DEPTH_END, depth)
  return displacement * (1 - guard) + Math.max(displacement, 0) * guard
}

type WaterSample = Readonly<{
  type: 'water'
  id: number
  center: readonly [number, number]
  side: number
  bed_heights: Float32Array
  bed_material_ids: Float32Array
}>

/** The animated surface normal: two scrolling ripple octaves + a broad swell that persists to
 * the horizon; the high-frequency chop fades with camera distance and its variance converts to
 * roughness downstream (the legacy anti-waffle / anti-mirror law). */
const surface_nodes = (quality: EngineQuality) => {
  const distance = positionWorld.sub(cameraPosition).length()
  const detail_fade = float(1).sub(smoothstep(WATER_DETAIL_FADE_NEAR, WATER_DETAIL_FADE_FAR, distance))
  const chop = mix(float(WATER_DISTANT_RIPPLE), float(1), detail_fade)
  // THREE wave directions per axis at incommensurate angles/frequencies — a single plane
  // wave reads as repeating TV lines; the tri-directional sum breaks into cross-chop.
  const wave = (fx: number, fz: number, speed: number) =>
    sin(positionWorld.x.mul(fx).add(positionWorld.z.mul(fz)).add(time.mul(speed)))
  const ripple_x = wave(0.53, 0.31, 1.4)
    .add(wave(-0.27, 0.47, 1.13))
    .add(wave(0.11, -0.59, 0.9))
  const ripple_z = wave(0.19, 0.61, 1.21)
    .add(wave(-0.51, -0.13, 0.97))
    .add(wave(0.37, -0.29, 1.53))
  const swell_x = wave(0.041, 0.017, 0.32).add(wave(-0.023, 0.031, 0.24))
  const swell_z = wave(0.013, 0.037, 0.27).add(wave(0.029, -0.019, 0.21))
  const slope_x = ripple_x.mul(0.06).mul(chop).add(swell_x.mul(0.026))
  const slope_z = ripple_z.mul(0.052).mul(chop).add(swell_z.mul(0.024))
  const normal = quality === 'low' ? vec3(0, 1, 0) : vec3(slope_x.negate(), 1, slope_z.negate()).normalize()
  return { normal, detail_fade, ripple: ripple_x.add(ripple_z).mul(0.33) }
}

const build_material = (
  quality: EngineQuality,
  flatten: FlattenUniform,
  sky: AnalyticSky,
  clouds: Clouds,
  materials: CompiledMaterials,
  bed: Readonly<{ height: Node<'float'>; material_id: Node<'uint'> }> | null
): MeshBasicNodeMaterial => {
  // DoubleSide: the surface is seen from BELOW when diving, and the sampled grid's winding
  // must never decide visibility (the 2026-08-15 invisible-water bug was backface culling).
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide })
  if (quality === 'low') {
    const depth = bed === null ? float(6) : max(positionWorld.y.sub(bed.height), 0)
    material.colorNode = mix(vec3(...WATER_SHALLOW_COLOR), vec3(...WATER_BODY_COLOR), smoothstep(0.5, 4, depth))
    material.opacityNode = smoothstep(0, 1, depth).mul(0.78).mul(float(1).sub(flatten.amount))
    material.alphaTest = 0.02
    material.fog = true
    return material
  }
  const { normal, detail_fade, ripple } = surface_nodes(quality)
  const broad_displacement = sin(positionLocal.x.mul(0.055).add(positionLocal.z.mul(0.021)).add(time.mul(0.42)))
    .mul(0.16)
    .add(sin(positionLocal.x.mul(-0.027).add(positionLocal.z.mul(0.048)).add(time.mul(0.31))).mul(0.11))
  // The terrain's last submerged block ends exactly at y=0 while wave troughs reach -0.27.
  // Shoaling removes only that downward motion near the coast, preventing the water surface
  // from falling through sea-level voxels without lifting the whole ocean or flattening deep waves.
  const shore_guard =
    bed === null
      ? float(0)
      : float(1).sub(
          smoothstep(WATER_SHORE_GUARD_DEPTH_START, WATER_SHORE_GUARD_DEPTH_END, max(bed.height.negate(), 0))
        )
  const guarded_displacement = mix(broad_displacement, max(broad_displacement, 0), shore_guard)
  material.positionNode = positionLocal.add(vec3(0, guarded_displacement.mul(detail_fade), 0))
  const view = cameraPosition.sub(positionWorld).normalize()
  const view_up = clamp(view.y.abs(), 0.1, 1)

  // Depth law (ENG-18): alpha keys on the VERTICAL bed depth — rotation-invariant, so the
  // transparent→opaque boundary never sweeps with the camera. Horizon plane = fully deep.
  const vdepth = bed === null ? float(WATER_ALPHA_VDEPTH_END + 3) : max(positionWorld.y.sub(bed.height), 0)
  const slant = vdepth.div(view_up)
  const deep_ramp = smoothstep(WATER_ALPHA_VDEPTH_START, WATER_ALPHA_VDEPTH_END, vdepth)
  const presence = smoothstep(WATER_PRESENCE_FEATHER, WATER_PRESENCE_FULL, vdepth).mul(WATER_SHALLOW_PRESENCE)
  const alpha = clamp(
    max(
      float(WATER_ALPHA_BASE)
        .add(deep_ramp.mul(WATER_ALPHA_DEEP))
        .add(float(1).sub(view_up).mul(WATER_ALPHA_VIEW_LEAN)),
      presence
    ),
    0,
    1
  )

  // Transmitted bed color (Beer-Lambert along the slant ray, red dies first) + the tuned
  // shallow→deep body ramp; the bed vanishes by ~6-8 blocks (the "no deep see-through" law).
  const tint_t = smoothstep(WATER_FADE_START, WATER_TINT_DEPTH, slant)
  const body = mix(vec3(...WATER_SHALLOW_COLOR), vec3(...WATER_BODY_COLOR), tint_t)
  const analytic_transmitted =
    bed === null
      ? vec3(...WATER_BODY_COLOR)
      : macro_tint_nodes({
          material_id: bed.material_id,
          position_world: { x: positionWorld.x, z: positionWorld.z },
          materials,
        })
          .tint_albedo(material_color_node(materials, bed.material_id))
          .mul(
            vec3(slant.mul(-WATER_SIGMA[0]).exp(), slant.mul(-WATER_SIGMA[1]).exp(), slant.mul(-WATER_SIGMA[2]).exp())
          )
  // The opaque scene already exists when transparent water renders. Perturbing that sample by
  // the physical surface normal gives real shoreline/bed refraction without another scene pass.
  // The analytic vertical depth still owns the blend, so rotating the camera cannot move the shore.
  const refract_strength = detail_fade.mul(float(1).sub(deep_ramp)).mul(0.011)
  const refracted_scene = viewportSharedTexture(screenUV.add(normal.xz.mul(refract_strength))).rgb.mul(
    vec3(0.72, 1, 1.08)
  )
  const transmitted = mix(analytic_transmitted, refracted_scene, float(1).sub(deep_ramp).mul(0.72))
  // Once the bed is extinguished only the residual body glow remains (BODY × DEEP_FLOOR × the
  // scatter lighting below) — the owner's "opaque dark deep surface" law.
  const deep_surface = vec3(...WATER_BODY_COLOR).mul(1.6)
  const shallow_scatter = transmitted.mul(0.74).add(body.mul(tint_t.mul(0.45).add(0.55)))
  const scatter = mix(shallow_scatter, deep_surface, tint_t)

  // Reflection: sky in the reflected direction; at distance the removed chop becomes roughness —
  // the sharp sample dilutes toward the mean overhead sky (soft haze, never a boiling mirror).
  const reflected = reflect(view.negate(), normal).normalize()
  const sharp_sky = sky.sample_sky_dome(reflected)
  const mean_sky = sky.sample_sky_dome(vec3(0, 1, 0))
  const sky_color = mix(mean_sky, sharp_sky, detail_fade.mul(0.75).add(0.25))
  const facing = clamp(view.dot(normal), 0, 1)
  // Legacy anti-chrome law: F0 0.02, power 7, grazing cap 0.7 — water must never be a mirror.
  const fresnel_raw = clamp(pow(float(1).sub(facing), 7).mul(0.98).add(0.02), 0, 0.7)
  // The surface ALWAYS catches some sky — deep water must read as water, not wet mud; the
  // shallow zone keeps the stronger legacy floor (the dry-lagoon fix).
  const shallow_sky_floor = float(WATER_SHALLOW_SKY_MIN).mul(float(1).sub(deep_ramp))
  const fresnel = max(max(fresnel_raw, float(0.15)), bed === null ? float(0.15) : shallow_sky_floor)

  // Sun road: broadens + dims as the chop converts to roughness (never a clean far ellipse).
  const daylight = smoothstep(-0.08, 0.18, sky.sun_direction.y)
  const cloud_light = clouds.shadow_at(positionWorld.xz, positionWorld.y)
  // The old single specular power produced an obvious circular disc on the plane. Keep only a
  // broad directional envelope, then cut it into thin wave-aligned streaks and broken crests.
  const road_power = mix(float(12), float(72), detail_fade)
  const road_gain = mix(float(0.65), float(1.8), detail_fade)
  const crest = pow(clamp(ripple.mul(0.2).add(0.5), 0, 1), 5)
  const streak_breakup = smoothstep(
    0.48,
    0.88,
    sin(positionWorld.x.mul(1.13).sub(positionWorld.z.mul(0.37)).add(time.mul(0.83)))
      .mul(0.5)
      .add(0.5)
  )
  const glint = pow(max(reflected.dot(sky.sun_direction), 0), road_power)
    .mul(crest)
    .mul(streak_breakup)
    .mul(daylight)
    .mul(cloud_light)
    .mul(road_gain)
  const foam_band = smoothstep(0.08, 0.32, vdepth).mul(float(1).sub(smoothstep(0.55, 1.25, vdepth)))
  const foam_breakup = smoothstep(
    0.18,
    0.72,
    sin(positionWorld.x.mul(0.7).add(positionWorld.z.mul(0.43)).add(time.mul(1.1)))
      .mul(0.5)
      .add(0.5)
  )
  const foam = foam_band.mul(mix(float(0.35), float(1), foam_breakup)).mul(daylight.mul(0.5).add(0.5))
  const caustic_cross = pow(
    max(sin(positionWorld.x.mul(1.7).add(time.mul(1.3))).mul(sin(positionWorld.z.mul(1.43).sub(time.mul(1.07)))), 0),
    5
  )
    .mul(float(1).sub(deep_ramp))
    .mul(daylight)
    .mul(0.22)
  const lit_scatter = scatter.mul(mix(float(0.22), cloud_light, daylight))
  material.colorNode = mix(
    mix(lit_scatter, sky_color, fresnel)
      .add(vec3(glint))
      .add(vec3(0.18, 0.52, 0.64).mul(caustic_cross)),
    vec3(0.72, 0.88, 0.88),
    foam.mul(0.72)
  )
  // The flat-world projection dissolves the water with the terrain burn.
  material.opacityNode = alpha.mul(float(1).sub(flatten.amount))
  material.alphaTest = 0.02
  material.fog = true
  return material
}

export const create_water = ({
  scene,
  quality,
  flatten,
  sky,
  clouds,
  world,
}: Readonly<{
  scene: Scene
  quality: EngineQuality
  flatten: FlattenUniform
  sky: AnalyticSky
  clouds: Clouds
  world: WorldRecipe
}>): Water => {
  if (world.liquid === undefined)
    return Object.freeze({ set_focus: () => {}, set_quality: () => {}, dispose: () => {} })
  const { materials } = compile_world_recipe(world)

  // ── near grid: real shorelines from the analytic bed (sampled by the far worker) ──
  const side = Math.floor(NEAR_SPAN / NEAR_STEP) + 1
  const near_geometry = new BufferGeometry()
  const positions = new Float32Array(side * side * 3)
  const bed_heights = new Float32Array(side * side)
  const bed_material_ids = new Float32Array(side * side)
  const indices: number[] = []
  for (let z = 0; z < side; z += 1)
    for (let x = 0; x < side; x += 1) {
      positions.set([-NEAR_SPAN / 2 + x * NEAR_STEP, 0, -NEAR_SPAN / 2 + z * NEAR_STEP], (z * side + x) * 3)
      if (x < side - 1 && z < side - 1) {
        const top_left = z * side + x
        indices.push(top_left, top_left + 1, top_left + side, top_left + side, top_left + 1, top_left + side + 1)
      }
    }
  near_geometry.setAttribute('position', new BufferAttribute(positions, 3))
  near_geometry.setAttribute('bed_height', new BufferAttribute(bed_heights, 1))
  near_geometry.setAttribute('bed_material_id', new BufferAttribute(bed_material_ids, 1))
  near_geometry.setIndex(indices)

  const bed = Object.freeze({
    height: attribute('bed_height', 'float' as const).add(0), // world y of the ground under this vertex
    material_id: uint(attribute('bed_material_id', 'float' as const)),
  })
  const near_materials = Object.freeze({
    low: build_material('low', flatten, sky, clouds, materials, bed),
    medium: build_material('medium', flatten, sky, clouds, materials, bed),
    high: build_material('high', flatten, sky, clouds, materials, bed),
  })
  const near = new Mesh(near_geometry, near_materials[quality])
  near.frustumCulled = false
  near.matrixAutoUpdate = false
  near.position.y = 0.04
  near.renderOrder = 1
  near.visible = false // until the first bed sample lands
  scene.add(near)

  // ── horizon RING: uniform deep body beyond the sampled span — a HOLE under the near grid,
  // or its opaque deep pixels paint over the shore transparency ──
  const far_geometry = (() => {
    const ring = new BufferGeometry()
    const hole = NEAR_SPAN / 2 - NEAR_STEP
    const out = HORIZON_SPAN / 2
    // 8 vertices: inner square (hole) + outer square, stitched into the ring.
    const ring_positions = new Float32Array([
      -hole,
      0,
      -hole,
      hole,
      0,
      -hole,
      hole,
      0,
      hole,
      -hole,
      0,
      hole,
      -out,
      0,
      -out,
      out,
      0,
      -out,
      out,
      0,
      out,
      -out,
      0,
      out,
    ])
    ring.setAttribute('position', new BufferAttribute(ring_positions, 3))
    ring.setIndex([0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0])
    return ring
  })()
  const far_materials = Object.freeze({
    low: build_material('low', flatten, sky, clouds, materials, null),
    medium: build_material('medium', flatten, sky, clouds, materials, null),
    high: build_material('high', flatten, sky, clouds, materials, null),
  })
  const far = new Mesh(far_geometry, far_materials[quality])
  far.frustumCulled = false
  far.matrixAutoUpdate = false
  far.position.y = 0.03
  far.renderOrder = 1
  scene.add(far)

  const worker = new Worker(new URL('./far_worker.ts', import.meta.url), { type: 'module' })
  worker.addEventListener('error', (event) => console.error('[engine] water bed sampling failed.', event.message))
  worker.postMessage({ type: 'initialize', world })
  let request_id = 0
  let focus_x = 0
  let focus_z = 0
  let disposed = false
  worker.addEventListener('message', ({ data }: MessageEvent<WaterSample>) => {
    if (disposed || data.type !== 'water' || data.id !== request_id) return
    ;(near_geometry.getAttribute('bed_height') as BufferAttribute & { array: Float32Array }).array.set(data.bed_heights)
    near_geometry.getAttribute('bed_height').needsUpdate = true
    ;(near_geometry.getAttribute('bed_material_id') as BufferAttribute & { array: Float32Array }).array.set(
      data.bed_material_ids
    )
    near_geometry.getAttribute('bed_material_id').needsUpdate = true
    near.position.set(data.center[0], 0.04, data.center[1])
    near.updateMatrix()
    near.visible = true
  })
  const request = (): void => {
    request_id += 1
    worker.postMessage({ type: 'water', id: request_id, center: [focus_x, focus_z], span: NEAR_SPAN, step: NEAR_STEP })
  }
  request()

  return Object.freeze({
    set_focus: (x: number, z: number) => {
      const next_x = Math.round(x / FOCUS_SNAP) * FOCUS_SNAP
      const next_z = Math.round(z / FOCUS_SNAP) * FOCUS_SNAP
      if (next_x !== focus_x || next_z !== focus_z) {
        focus_x = next_x
        focus_z = next_z
        request()
      }
      far.position.set(next_x, 0.03, next_z)
      far.updateMatrix()
    },
    set_quality: (next: EngineQuality) => {
      near.material = near_materials[next]
      far.material = far_materials[next]
    },
    dispose: () => {
      disposed = true
      worker.terminate()
      scene.remove(near, far)
      near_geometry.dispose()
      far_geometry.dispose()
      Object.values(near_materials).forEach((material) => material.dispose())
      Object.values(far_materials).forEach((material) => material.dispose())
    },
  })
}
