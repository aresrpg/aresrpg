// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Terrain per-face brightness table + BFS sun-leak gate (§3.6) — module-level DATA + the pure JS mirror
// of the sun-leak smoothstep, extracted VERBATIM from terrain_material.js (2026-07-03, ≤600-LoC law split
// — same discipline as registry_nodes.js / terrain_flora.js / terrain_ao.js / terrain_winding.js). No
// behavior change: these are the same exports, now with one home. terrain_material.js RE-EXPORTS them (so
// terrain_material.test.js's `from './terrain_material.js'` import is unchanged) and builds its TSL
// select-ladder / receivedShadowNode gate from FACE_BRIGHTNESS / SUN_LEAK_GATE. See that file for the
// consuming shading chain. Also home to FoliageLightingModel (the flora zero-specular lighting model).

import { BRDF_Lambert, diffuseColor, normalView } from 'three/tsl'
import { PhysicalLightingModel } from 'three/webgpu'

/**
 * FIXED per-face brightness multipliers — the Minecraft-style directional face-shading table, the
 * canonical voxel-engine cure for the "sun-shaded face reads as sky/fog" disease. Keyed by face id
 * (0=+x 1=−x 2=+y 3=−y 4=+z 5=−z; the two cross-billboard ids 6/7 are absent → full 1.0 in shader).
 * Multiplied straight into the block's own sampled albedo, so a face's chroma is 100% earth texture
 * and NEVER the atmosphere — a −z riser can no longer track the sky at ANY palette. Values follow
 * Minecraft's `getShade` (top +Y=1.0, bottom −Y=0.5, N/S ±Z=0.8, E/W ±X=0.6): top=1.0 keeps the ±y
 * grass TOPS byte-identical (the "tops blessed" budget) and lets the sun shadow map's cast shadows
 * land on them at full contrast; sides sit clearly BELOW fog luminance (kills the luminance-match
 * notch) while staying earth-hued. Single source of truth: create_terrain_material builds its TSL
 * select-ladder from THIS map, and terrain_material.test.js pins the values, so shader and constant
 * can't drift.
 * REF: Minecraft RenderBlocks.renderStandardBlockWithColorMultiplier (decompiled 1.8) — top=1.0,
 * bottom=0.5, N/S(±Z)=0.8, E/W(±X)=0.6: http://greyminecraftcoder.blogspot.com/2013/08/lighting.html
 * NOTE (linear pipeline): classic MC multiplies in gamma space; we multiply the LINEAR albedo pre-
 * light, so these read a touch darker — which is desired here (sides sit below fog luminance).
 *
 * RELAX A/B — NO-SHIP (2026-07-03, NG2-C). Hypothesis: relaxing these constants toward 1.0 (the real
 * sun now carries directionality, so the classic getShade darkening double-darkens risers) would kill
 * the terrace "stripes". FALSIFIED by measurement (A/B/C at relax 0/0.4/0.6, headed Metal,
 * 2560×1440, three scenes — captures in /tmp/aresrpg-engine-artifacts/face_relax_*): relax 0.4/0.6
 * dropped scene-1 stripe row-variance only 0.9%/1.4% (bar: ≥30%) and the frames were visually
 * identical, because at low sun angle the stripe is dominated by +y TREAD AO notches + cast
 * shadows + the riser AO FLOOR (0.58) — NONE of which this table touches (a riser pixel lifted just 3%
 * even as its ±z constant went 0.8→0.92). Kept at the frozen getShade values; the stripes wait for the
 * froxel near-haze + grading-hierarchy landing to re-judge (re-add the one-knob `?relax` lerp then).
 * @type {Readonly<Record<0|1|2|3|4|5, number>>}
 */
export const FACE_BRIGHTNESS = { 0: 0.6, 1: 0.6, 2: 1.0, 3: 0.5, 4: 0.8, 5: 0.8 }

/**
 * SUN-LEAK GATE — forest and cave leak less light. The per-quad BFS `sun` byte (4 bits, 0..15)
 * is the GROUND TRUTH for "can the sky actually reach this cell" — it flood-fills DOWN through opacity,
 * so a leaf canopy (opacity 2, a semi-occluder) or a thick crown or a cave roof drives the floor's sun byte toward 0. But the DIRECT sun
 * (the shadow-mapped directional) paints at full strength wherever the shadow map MISSES: leaf/grass foliage casts shadows only at HIGH tier
 * (pool_renderer gates cutout+foliage on tiers.foliage_shadows), so at LOW/MEDIUM forest floors get
 * lit as if open sky; caves at glancing angles leak likewise. This gate multiplies the direct sun's
 * received-shadow term by `smoothstep(0, SUN_FULL/15, sun/15)` so where BFS says sun≈0 the direct term
 * dies (canopy floors dappled-dark, caves genuinely dark) while OPEN terrain (sun=15) stays 1.0 (open
 * ground untouched). Indirect/hemisphere + the warm non-shadow back-fill are NOT gated (they keep shaded
 * faces readable, not black). Exported + tested: the JS `sun_direct_factor` mirrors the TSL smoothstep.
 * @type {Readonly<{SUN_FULL:number}>}
 */
export const SUN_LEAK_GATE = { SUN_FULL: 10 }

/**
 * Direct-sun attenuation factor for a raw BFS sun byte (0..15) — smoothstep(0, SUN_FULL/15, sun/15).
 * 0 at sun=0 (no sky reaches: canopy floor / deep cave), 1 at sun≥SUN_FULL (open). The material's
 * receivedShadowNode multiplies this into the sun's shadow term; this pure fn is the tested mirror.
 * @param {number} sun_byte BFS sun nibble 0..15 @returns {number} factor in [0,1]
 */
export function sun_direct_factor(sun_byte) {
  const x = Math.min(1, Math.max(0, sun_byte / 15))
  const edge = SUN_LEAK_GATE.SUN_FULL / 15
  const t = Math.min(1, Math.max(0, x / edge)) // smoothstep(0, edge, x): lower edge 0 ⇒ x/edge
  return t * t * (3 - 2 * t)
}

/**
 * FLORA ZERO-SPECULAR lighting model (2026-07-03 — herbs and grass must not read as metallic). The
 * cross-flora is thousands of DoubleSide billboards; toward a low sun their
 * MeshStandard specular lobes SUMMED into a field-wide metallic sheet the bloom pass (threshold 1.5) then
 * amplified. Sprites are not microfacet surfaces → ZERO specular. On a MeshStandardNodeMaterial
 * `specularIntensityNode` is a no-op (MeshPhysical-only) and PhysicalLightingModel.direct HARDCODES the
 * direct-lobe f90=1 (verified in three@0.185.1 — no material scalar zeroes the grazing Fresnel rim), so
 * the only clean, total cure is this diffuse-only lighting model: drop directSpecular entirely and no-op
 * indirectSpecular. directDiffuse (Lambert on diffuseColor == diffuseContribution at the locked metalness
 * 0), the hemisphere indirectDiffuse, and AO all remain via the base class → flora stays fully, softly LIT;
 * only its microfacet HIGHLIGHT is gone. Its per-plane yaw sun-dispersion is baked into the flora ALBEDO
 * (terrain_flora/terrain_material), NOT the specular, so it is untouched. GROUND/liquid keep the stock
 * PhysicalLightingModel (the ground can reflect a bit). No RectAreaLights here ⇒ directRectArea
 * inherits (unreachable). create_terrain_material swaps this onto the foliage material's setupLightingModel.
 */
export class FoliageLightingModel extends PhysicalLightingModel {
  /** @param {*} input @param {*} [builder] */
  direct({ lightDirection, lightColor, reflectedLight }, builder) {
    const dotNL = normalView.dot(lightDirection).clamp()
    const irradiance = dotNL.mul(lightColor)
    // `*` casts: three's BRDF_Lambert/.mul .d.ts overloads mis-resolve here (the loose Node return makes
    // `.mul` pick the mat4 overload) — the file's standing idiom for TSL typing friction (cf. the ladders).
    const lambert = /** @type {*} */ (BRDF_Lambert({ diffuseColor: diffuseColor.rgb }))
    reflectedLight.directDiffuse.addAssign(/** @type {*} */ (irradiance).mul(lambert))
    // NO reflectedLight.directSpecular — the whole point: no specular highlight on grass billboards.
  }
  /** No indirect (hemisphere / IBL) specular for flora either — same reason. @param {*} [builder] */
  indirectSpecular(builder) {}
}

/**
 * [2026-07-05 THE SUN-MIRROR ROOT — an unexplained sun mirror traced to its true source]
 * WaterLightingModel: ZERO stock lighting on the liquid class. The water's entire look is the custom
 * emissive composite (water_material.js: sky-mirror + glint road + foam + through-water), and its
 * colorNode albedo is BLACK — yet the stock PhysicalLightingModel still ran the SUN'S GGX SPECULAR on
 * the roughness-0.06 surface (specular needs no albedo), painting a huge smooth elongated highlight at
 * the sun's mirror point: THE "spotlight" that survived every water-shader edit and every bloom cap,
 * because it lives in three's lighting model, not our nodes. Same disease + same cure as the grass
 * metallic-sheet bug (FoliageLightingModel above) — the deliberate "liquid keeps stock lighting" call
 * from that wave is hereby reversed with the evidence. direct() adds NOTHING (black albedo ⇒ stock
 * diffuse was already ~0; the custom composite owns everything); no indirect specular either.
 */
export class WaterLightingModel extends PhysicalLightingModel {
  /** @param {*} _input @param {*} [_builder] */
  direct(_input, _builder) {}
  /** @param {*} [_builder] */
  indirectSpecular(_builder) {}
}

/**
 * [MOBILE SHADER DIET D4/D8] the ONE lean lighting model every terrain class shares at LOW (solid,
 * foliage, cutout, canopy). It is FoliageLightingModel's diffuse-only body (zero microfacet specular —
 * the flat "very low end" look, and no GGX chain in the WGSL) PLUS the relocated BFS sun-leak gate: the
 * direct sun's irradiance is multiplied by a per-fragment `direct_factor` node here, INSTEAD of via
 * `material.receivedShadowNode`. receivedShadowNode only fires when the object receives a shadow-casting
 * light, but D8 drops the shadow map at LOW — so the canopy-floor / cave darkening (smoothstep over the
 * BFS sun byte) had to move into the direct term to survive the shadow-map removal (the ~2-line
 * relocation). Open terrain (BFS sun=15 ⇒ direct_factor 1.0) is unchanged; caves (sun≈0 ⇒ 0) go dark via
 * this gate + the material's ambient floor. The hemisphere indirectDiffuse (sky fill) is inherited and
 * UNGATED so caves never crush to pure black. ONLY built at LOW (build_terrain_material's simple path);
 * MEDIUM/HIGH keep their stock/Foliage/Water models + receivedShadowNode, byte-identical.
 */
export class SimpleTerrainLightingModel extends PhysicalLightingModel {
  /** @param {*} direct_factor per-fragment [0,1] BFS sun-leak gate node (smoothstep(0, SUN_FULL/15, v_sun)) */
  constructor(direct_factor) {
    super()
    this._direct_factor = direct_factor
  }
  /** @param {*} input @param {*} [builder] */
  direct({ lightDirection, lightColor, reflectedLight }, builder) {
    const dotNL = normalView.dot(lightDirection).clamp()
    // The relocated sun-leak gate: the direct sun dies where the sky can't reach (canopy floors, caves).
    const irradiance = /** @type {*} */ (dotNL.mul(lightColor)).mul(this._direct_factor)
    const lambert = /** @type {*} */ (BRDF_Lambert({ diffuseColor: diffuseColor.rgb }))
    reflectedLight.directDiffuse.addAssign(/** @type {*} */ (irradiance).mul(lambert))
    // NO directSpecular — flat terrain at LOW (no metal sheen, and the GGX chain leaves the WGSL).
  }
  /** No indirect specular at LOW either — flat. @param {*} [builder] */
  indirectSpecular(builder) {}
}
