// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Macro ground-tint SHADER — LOSSLESS PORT of the legacy NG-TINT node builder
// (deprecated/engine/src/render/terrain_tint.js): a world-XZ continuous two-octave field
// (moisture + detail) drives climate chroma/value on natural surfaces, authored-subsurface
// patches, role-based roughness, plus the dedicated long-period macro-gradient pair (the Veloren-style
// global gradient). Samples positionWorld — no chunk term, seamless across chunk borders, so
// the per-block tiles dissolve into dry-yellow ↔ lush ↔ humid-dark regions.

import { Vector3 } from 'three'
import { float, floor, hash, int, mix, smoothstep, uniformArray, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'

import { SURFACE_GRADIENT_LEVELS, material_tint_tables, NG_TINT, TERRAIN_PBR, TINT_SALT } from './terrain_tint_data.ts'
import type { CompiledMaterials } from './world_materials.ts'

/** Hashed lattice value in [0,1) via three's PCG `hash` node (a hand-rolled uint avalanche
 * emitted invalid WGSL on the WebGPU backend — legacy bisect). */
/** Lattice indices WRAP at 4096 cells before the fold — the raw legacy fold left f32's exact
 * integer range ~100 blocks from origin, freezing the field constant over most of the world
 * (perf audit catch). 4096-cell periods (≥53k blocks at the smallest octave) never repeat
 * inside a 100k world's visible span. Small primes keep every product f32-exact. */
const lattice_hash = (ix: Node<'int'>, iz: Node<'int'>, salt: number) => {
  const wrap = (v: Node<'int'>) => float(v).sub(float(v).div(4096).floor().mul(4096))
  return hash(
    wrap(ix)
      .mul(587)
      .add(wrap(iz).mul(1409))
      .add(float(TINT_SALT[salt]! % 65536))
  )
}

/** Per-octave lattice rotation (radians) — value noise on an axis-aligned grid reads as hard
 * rectangular LANES on flat single-color ground (the old sampled surface masked it; this engine
 * shows it naked). Rotating each octave's frame breaks the shared grid into organic patches. */
const OCTAVE_ROTATION = [0.6435, 2.2143, 1.1071, 2.8198] as const

/** 2-D value noise in [0,1) on a per-octave ROTATED lattice, smootherstep-interpolated
 * (quintic — cell borders vanish), seam-free. */
const tint_noise = (raw_px: Node<'float'>, raw_pz: Node<'float'>, salt: number) => {
  const angle = OCTAVE_ROTATION[salt]!
  const cos_a = Math.cos(angle)
  const sin_a = Math.sin(angle)
  const px = raw_px.mul(cos_a).sub(raw_pz.mul(sin_a))
  const pz = raw_px.mul(sin_a).add(raw_pz.mul(cos_a))
  const x0 = floor(px)
  const z0 = floor(pz)
  const smoother = (t: Node<'float'>) =>
    t
      .mul(t)
      .mul(t)
      .mul(t.mul(t.mul(6).sub(15)).add(10))
  const ux = smoother(px.sub(x0))
  const uz = smoother(pz.sub(z0))
  const h = (x: Node<'float'>, z: Node<'float'>) => lattice_hash(int(x), int(z), salt)
  return mix(mix(h(x0, z0), h(x0.add(1), z0), ux), mix(h(x0, z0.add(1)), h(x0.add(1), z0.add(1)), ux), uz)
}

/** Macro MOISTURE at a world XZ [0,1] — the tint's low-frequency octave, exposed as the ONE
 * moisture home (water, future foliage, and gameplay dressing read the same field). */
export const macro_moisture_node = (px: Node<'float'>, pz: Node<'float'>) =>
  tint_noise(px.div(float(NG_TINT.P_BIG)), pz.div(float(NG_TINT.P_BIG)), 0)

export type TintNodes = Readonly<{
  tint_albedo: (albedo: Node<'vec3'>) => Node<'vec3'>
  roughness_node: Node<'float'>
}>

/** One GPU lookup for authored material colors. Near terrain, horizon terrain, and water beds
 * all consume this exact table; workers transport ids, never a second interpretation of color. */
export const material_color_node = (materials: CompiledMaterials, material_id: Node<'uint'>): Node<'vec3'> =>
  uniformArray(
    materials.colors.map((color) => new Vector3(...color)),
    'vec3' as const
  ).element(int(material_id)) as unknown as Node<'vec3'>

/** Builds the macro-tint + roughness nodes for one fragment. Samples the octaves ONCE, feeding
 * albedo tint and roughness together (zero extra noise fetches). Adapted to the color-only
 * architecture: classes/roughness come from compiled structural roles via id-indexed uniform
 * arrays (the legacy O(1) ladder — a select chain per id blew naga's 127-nesting limit). */
export const macro_tint_nodes = ({
  material_id,
  position_world,
  materials,
}: Readonly<{
  material_id: Node<'uint'>
  position_world: Readonly<{ x: Node<'float'>; z: Node<'float'> }>
  materials: CompiledMaterials
}>): TintNodes => {
  const tables = material_tint_tables(materials)
  const tint_class = uniformArray([...tables.classes]).element(int(material_id)) as unknown as Node<'float'>
  const base_rough = uniformArray([...tables.roughness]).element(int(material_id)) as unknown as Node<'float'>
  const paired_color = uniformArray(
    tables.paired_colors.map((color) => new Vector3(...color)),
    'vec3' as const
  ).element(int(material_id)) as unknown as Node<'vec3'>
  const is_surface = tint_class.greaterThanEqual(float(2))
  const surface_amount = is_surface.select(float(1), float(0))
  const grad = SURFACE_GRADIENT_LEVELS.c

  const moisture = macro_moisture_node(position_world.x, position_world.z)
  const detail = tint_noise(
    position_world.x.div(float(NG_TINT.P_SMALL)),
    position_world.z.div(float(NG_TINT.P_SMALL)),
    1
  )
  const m = moisture.mul(float(2)).sub(float(1)) // [-1,1]: +humid / -dry
  const d = detail.mul(float(2)).sub(float(1))

  // (b) VALUE: natural surfaces vary more than subsurface/filler materials.
  const vfield = m
    .mul(float(-0.6))
    .add(d.mul(float(0.4)))
    .clamp(float(-1), float(1))
  const val_amp = is_surface.select(
    float(NG_TINT.VAL_SURFACE),
    tint_class.equal(float(1)).select(float(NG_TINT.VAL_MINERAL), float(0))
  )
  const value_mul = float(1).add(val_amp.mul(vfield))
  // (a) Climate chroma multiplies the authored color; it never replaces it with a fixed palette.
  const climate = vec3(1, 1, 1).add(vec3(NG_TINT.K[0], NG_TINT.K[1], NG_TINT.K[2]).mul(m).mul(surface_amount))
  // (e) DEDICATED MACRO-GRADIENT pair — undiluted, applied outside the vfield mix.
  const macro_a = tint_noise(
    position_world.x.div(float(NG_TINT.P_MACRO_A)),
    position_world.z.div(float(NG_TINT.P_MACRO_A)),
    2
  )
  const macro_b = tint_noise(
    position_world.x.div(float(NG_TINT.P_MACRO_B)),
    position_world.z.div(float(NG_TINT.P_MACRO_B)),
    3
  )
  const gfield = macro_a.add(macro_b).sub(float(1))
  const macro_value_mul = float(1).add(
    float(NG_TINT.MACRO_VAL * grad.val)
      .mul(gfield)
      .mul(surface_amount)
  )
  const macro_mul = vec3(1, 1, 1)
    .add(
      vec3(NG_TINT.MACRO_K[0], NG_TINT.MACRO_K[1], NG_TINT.MACRO_K[2])
        .mul(float(grad.hue))
        .mul(gfield)
        .mul(surface_amount)
    )
    .mul(macro_value_mul)
  // (d) Humidity is a color-relative multiplier, so an arbitrary authored surface never gets
  // replaced by a hardcoded palette color.
  const surface_mask = tint_class.equal(float(3)).select(float(1), float(0))
  const humid = smoothstep(float(NG_TINT.HUMID_LO), float(NG_TINT.HUMID_HI), moisture).mul(surface_mask)
  const humid_mul = mix(vec3(1, 1, 1), vec3(NG_TINT.HUMID_RGB[0], NG_TINT.HUMID_RGB[1], NG_TINT.HUMID_RGB[2]), humid)
  // (c) Sparse exposed-underlayer patches use the recipe's paired subsurface color.
  const patch_blend = smoothstep(float(NG_TINT.PATCH_LO), float(NG_TINT.PATCH_HI), detail)
    .mul(float(NG_TINT.PATCH_MAX))
    .mul(surface_mask)
    .mul(float(1).sub(humid))
  // PBR roughness: humid dew dip on natural surfaces; every base response comes from its
  // structural role, never an authored material name.
  const surface_roughness = base_rough.sub(m.mul(float(TERRAIN_PBR.humid_dip)))
  const roughness_node = is_surface.select(surface_roughness, base_rough).clamp(float(TERRAIN_PBR.min), float(1))

  return Object.freeze({
    tint_albedo: (albedo: Node<'vec3'>) =>
      mix(albedo.mul(value_mul).mul(climate).mul(macro_mul).mul(humid_mul), paired_color, patch_blend),
    roughness_node,
  })
}
