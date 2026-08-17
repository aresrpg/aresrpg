// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Macro ground-tint DATA + classification — LOSSLESS PORT of the legacy NG-TINT pure half
// (deprecated/engine/src/render/terrain_tint_data.js), adapted to the color + appearance-preset
// architecture. three-FREE on purpose — compiled tables remain testable without a renderer.

import type { CompiledMaterial, CompiledMaterials } from './world_materials.ts'

/** Macro-tint amplitudes (periods in blocks) — the legacy calibrated field, made
 * material-agnostic. Two value-noise octaves drive: (a) a chromatic climate tint on natural
 * surfaces, (b) value variation, (c) sparse patches toward the authored subsurface color,
 * (d) a cool humid multiplier, and (e) the dedicated
 * long-period macro-gradient pair (P_MACRO_A/B — the veloren-style global gradient; two
 * periods, ratio ~1.64, so the pattern never reads as one repeating blob size). */
export const NG_TINT = Object.freeze({
  P_BIG: 40,
  P_SMALL: 13,
  VAL_SURFACE: 0.08,
  VAL_MINERAL: 0.04,
  K: Object.freeze([-0.08, -0.02, 0.03] as const),
  PATCH_LO: 0.6,
  PATCH_HI: 0.85,
  PATCH_MAX: 0.35,
  HUMID_LO: 0.5,
  HUMID_HI: 0.78,
  HUMID_RGB: Object.freeze([0.9, 0.96, 1.04] as const),
  P_MACRO_A: 96,
  P_MACRO_B: 157,
  MACRO_VAL: 0.6,
  MACRO_K: Object.freeze([-0.15, -0.04, 0.06] as const),
})

/** The macro-gradient ladder (legacy calibration: auto-exposure eats pure luminance, so hue
 * rides with value). `c` is the visible shipped surface gradient. */
export const SURFACE_GRADIENT_LEVELS = Object.freeze({
  a: Object.freeze({ val: 0, hue: 0 }),
  b: Object.freeze({ val: 0.35, hue: 0.35 }),
  c: Object.freeze({ val: 0.65, hue: 0.65 }),
  d: Object.freeze({ val: 1.0, hue: 1.0 }),
})

/** PBR bounds — preset roughness is compiled with the material; humidity only adds the wet response. */
export const TERRAIN_PBR = Object.freeze({
  humid_dip: 0.15,
  min: 0.35,
})

/** Per-octave u32 salts (decorrelate moisture / detail / the two macro octaves) — verbatim. */
export const TINT_SALT = Object.freeze([0x9e3779b1, 0x85ebca77, 0xc2b2ae3d, 0x27d4eb2f] as const)

/** NG-TINT class for a structural role and preset: 0 none (liquids) · 1 mineral (value-only) ·
 * 3 natural surface (hue + value + authored-subsurface patches). */
export const tint_class_of = ({ role, climate_tint }: CompiledMaterial): number =>
  role === 'liquid' ? 0 : role === 'surface' && climate_tint ? 3 : 1

/** Id-indexed lookup tables for a recipe's material record (id 0 is the reserved empty slot —
 * compile_materials assigns ids in entry order starting at 1). One home for the id mapping. */
export const material_tint_tables = (
  materials: CompiledMaterials
): Readonly<{
  classes: readonly number[]
  roughness: readonly number[]
  paired_colors: readonly (readonly [number, number, number])[]
}> =>
  Object.freeze({
    classes: Object.freeze(materials.entries.map((material, index) => (index === 0 ? 0 : tint_class_of(material)))),
    roughness: Object.freeze(materials.entries.map(({ roughness }) => roughness)),
    paired_colors: Object.freeze(materials.entries.map(({ paired_color }) => paired_color)),
  })
