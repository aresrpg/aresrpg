// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Far-shell TSL material graph. Kept separate from the CPU residency/mesh handle so each module
// stays below the 600-LoC ceiling; all graph inputs and numeric values remain owned by the caller.

import { Color, DoubleSide } from 'three'
import {
  attribute,
  cameraPosition,
  Discard,
  float,
  Fn,
  hash,
  If,
  max,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  texture,
  transformNormalToView,
  vec3,
  vec4,
} from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'

import { CHUNK_SIZE } from '../config/world_config.js'

/** Ambient floor of the far sun-diffuse — faces away from the sun keep this fraction of albedo (shaded
 *  far faces read as shade, not black). Lit range [SUN_AMBIENT, 1]. */
// [BUG-2 2026-07-11 — too much colour difference against the LOD, addressed via AO/darker contrast]
// The far shell read FLATTER + LIGHTER than the near detailed mesh (which carries per-corner AO
// + the warm sun/hemisphere): a 0.55 floor left shaded far facets barely darker than lit ones, so the LOD
// band looked pale + washed next to the contrasty near terrain. Dropped 0.55→0.42 to WIDEN the lit range
// (shaded facets sink, tops stay lit) — the per-facet flat normal now reads as real block-face contrast
// (reported "darker contrasts"), so near↔far contrast is continuous. Night stays legible (floor > 0.4). */
const SUN_AMBIENT = 0.42
/** [FAR-SEAM CONTINUITY — ?farcont=1] VOXEL AO floor: a vertical block face (riser/skirt) keeps this
 *  fraction of a top face's brightness (before ndl), the block-face contact-shadow cue the near ring gets
 *  from per-corner AO but the flat far shell lacked — so far terrace risers read as real shaded block
 *  walls (near-matching contrast) instead of one pale flat sheet. Veloren's lod-terrain-frag applies the
 *  SAME `emitted_light *= ao` as its near chunks. World-anchored per-face ⇒ static (never the rejected
 *  camera-radial dark rings). 0.62 ⇒ side/top ≈ 0.45 (matches the near voxel read); higher = flatter,
 *  lower = muddier risers. Tunable — the single lever for how hard the far block-face contrast reads.
 *  S-27-SAFE: darkens ONLY risers/sides (n.y→0), never the tops — so far terrain stays as CLEAR/bright as
 *  the reported "far view is super blue decayed" directive demands; the contrast is added, not overall darkness. */
const SIDE_AO = 0.62

/** Distance (m) where distance-desaturation/haze BEGINS ramping, and where it saturates. The far shell
 *  begins at the near-ring seam (~160 m at r5) and reaches the horizon (km). The ramp starts a little
 *  PAST the seam so the first far ring stays crisp enough to hand off to the near terrain (the
 *  transition band + dither-fade hide the seam), then softens hard toward the horizon so distant terrain
 *  sits in immersive haze (target: "immersive haze etc will make it look good"). Tunable. */
// [S-27, 2026-07-08 — the far view read as super blue and decayed; distant terrain must stay MUCH
// clearer/further (reference: crisp peaks, light haze only in the deep valley).] The far-shell
// aerial veil starts further out and tops out far gentler than the old 260→2600 m / 0.55 pull, so
// mid-distance far terrain reads with its real colour instead of dissolving to blue-grey.
const HAZE_START_M = 520
const HAZE_FULL_M = 3800
/** Max fraction the far color is pulled toward grey (desaturation) at full distance — the "field of
 *  view" physiology. [S-27] cut from 0.7 so distant terrain keeps its chroma (target: less decay).
 *  [BUG-2 2026-07-11] cut again 0.32→0.16: the desat toward luma was a big part of the far LOD reading
 *  LIGHTER/greyer than the near mesh — the far terrain now keeps most of its chroma so its colour matches
 *  the near surface, and only the true horizon (HAZE_MAX toward the sky tint, KEPT) carries the cinematic
 *  aerial veil. Near↔far is now one continuous surface, not a saturated→washed band. */
const DESAT_MAX = 0.16
/** [FAR-SEAM CONTINUITY — ?farcont=1] Desat cap when continuity is on: HALVED from DESAT_MAX so the far
 *  terrain holds most of its chroma out to the horizon (probed: far ground sat ~0.20 vs near ~0.43 — the
 *  desaturation toward luma was a chunk of why far read as a washed grey material family, not the near
 *  ring's saturated surface). The true-horizon sky-tint haze (HAZE_MAX, kept) still carries the aerial veil. */
const CONT_DESAT_MAX = 0.08
/** Max fraction the far color is pulled toward the sky tint at full distance (extra aerial haze ON TOP
 *  of the scene fog). [S-27] cut from 0.55 → far terrain no longer washes to blue at mid distance. */
const HAZE_MAX = 0.26
/** The sky/haze tint distant terrain dissolves toward (matches renderer.js fog hue). */
const HAZE_TINT = new Color(0.53, 0.62, 0.72)

/** Per-cell SURFACE GRAIN amplitude (peak-to-peak fraction). The flat far sheet — especially WATER at
 *  sea level, a normal-up plane with zero sun-shading variation — reads as dead PAINT without it; a
 *  stable per-patch hash darkens/lightens each patch by ±FAR_GRAIN/2 so distant ocean/plains read as a
 *  mottled SURFACE. Cheap: one hash + one mul (constraint: "one mix, no marching"). */
const FAR_GRAIN = 0.1
/** Grain patch size (m): coarse enough to read as gentle depth/tone variation, not per-pixel noise. */
const FAR_GRAIN_CELL_M = 10
/** GRAIN NEAR-FADE (2026-07-04 — checkered far-WATER grain read as broken static near the camera).
 *  The ±FAR_GRAIN per-cell hash earns its keep at km range (mottles the flat far sheet so it isn't dead
 *  paint) but WITHIN a few hundred metres the 10 m cells are huge in screen space → a hard checkerboard on
 *  the flat far-WATER band just past the near ring. Ramp the grain amplitude 0→full across
 *  GRAIN_FADE_NEAR_M→GRAIN_FADE_FAR_M so near far-water is the smooth dark WATER_BODY colour and only
 *  distant terrain/ocean carries the mottle. (Near far-water is also the least in need of grain — it's a
 *  narrow overlap band the near water covers over as it streams in.) Same lever the near water uses for
 *  its own distance detail roll-off (water_material.js WATER_DETAIL_FADE_*). */
const GRAIN_FADE_NEAR_M = 120
const GRAIN_FADE_FAR_M = 340

/**
 * Builds a far-shell material: per-vertex color × self-contained sun-diffuse, then desaturated + hazed
 * toward the sky tint with distance, with a screen-door reveal dither. Matte, no shadows; scene fog on top.
 * Two variants share everything but the reveal DIRECTION (keyed by `fade_out`): the BIRTH material fades a
 * young section IN (reveal 0→1 over fade_seconds from its spawn time); the DYING material fades a retired
 * section OUT (reveal 1→0 from its retire time) so a coverage-triggered swap CROSS-FADES — the replacing
 * section dithers in while the old one dithers out over the same ~fade_seconds, never a bare flash frame
 * (2026-07-04 architect spec FIX 3 — the LOD was visibly appearing then disappearing). Both read the SAME
 * `spawn_seconds` attribute (the handle rebakes it to the retire clock when it moves a mesh to the dying
 * material) and the SAME `clock` uniform, so the dying mesh needs no per-mesh uniform on the shared material.
 * @param {*} sun_direction `uniform(Vector3)` world-space unit sun direction (mutated by the handle)
 * @param {*} clock `uniform(float)` fade clock in seconds (advanced by tick)
 * @param {import('three').DataTexture} mask_texture encoded residency: 128=drawn boundary, 255=interior
 * @param {*} mask_origin `uniform(Vector2)` the mask window's min chunk (x,z)
 * @param {boolean} fade_out true ⇒ DYING variant (reveal 1→0); false ⇒ BIRTH variant (reveal 0→1)
 * @param {number} mask_chunks width and height of the square residency texture
 * @param {number} fade_seconds birth/retire screen-door duration
 * @returns {MeshStandardNodeMaterial}
 */
export function build_far_material(
  sun_direction,
  clock,
  mask_texture,
  mask_origin,
  fade_out,
  mask_chunks,
  fade_seconds
) {
  const material = new MeshStandardNodeMaterial()
  // [#1869] name the variant so its pipeline label identifies it (see terrain_material.js).
  material.name = fade_out ? 'far_section_dying' : 'far_section_birth'
  material.roughness = 1
  material.metalness = 0
  material.side = DoubleSide
  material.vertexColors = true

  // [FAR-SEAM CONTINUITY — the near→far handoff was a visible, unpleasant switch; reference: Veloren terraces]
  // `?farcont=1` brings the far shell's SHADING GRAMMAR toward the near ring's so the near→far handoff stops
  // reading as a paler/flatter/greyer material family (the visible "switch"). Two graph-time-gated moves —
  // gated by a JS bool so OFF adds ZERO nodes (no-flag byte-identical): (1) VOXEL AO on `shade` (darken
  // risers vs tops — below), (2) keep more chroma at distance (CONT_DESAT_MAX — below). Veloren's
  // lod-terrain-frag stays continuous with near chunks by running the SAME lighting incl. `emitted_light
  // *= ao` (gitlab.com/veloren lod-terrain-frag.glsl); this mirrors that. Terrace GEOMETRY (?farterrace=1)
  // is orthogonal — compose `?farterrace=1&farcont=1` for the full look.
  const continuity = typeof location !== 'undefined' && new URLSearchParams(location.search).get('farcont') === '1'

  // [2026-07-04 — the LOD must curve down where it meets real chunks] VERTEX SINK at the
  // near-ring seam. The per-fragment mask discard (below) hides the shell OVER drawn columns, but the
  // shell's coarse surface floats at a different height than the true voxel edge — the boundary showed
  // a bright gap line. Fix in the VERTEX stage: a shell vertex standing on a DRAWN column sinks
  // SEAM_SINK_M meters; boundary triangles interpolate between sunk/unsunk vertices, so the visible
  // strip slopes DOWN and tucks UNDER the real terrain (the sunk part is z-buried or discarded).
  // Mask sampled with explicit level 0 (vertex stage requires explicit LOD); outside the moving
  // window the sink is 0. Far meshes sit at identity, so positionLocal IS world space.
  // 8 m: covers the typical shell-vs-voxel height mismatch at the seam without carving visible cliff
  // walls at the rim (24 m over one 4 m vertex span read as striped curtains from altitude).
  const SEAM_SINK_M = 8
  const v_chunk = positionLocal.xz.div(float(CHUNK_SIZE)).floor()
  const v_texel = v_chunk.sub(mask_origin)
  const v_in_window = v_texel.x
    .greaterThanEqual(float(0))
    .and(v_texel.x.lessThan(float(mask_chunks)))
    .and(v_texel.y.greaterThanEqual(float(0)))
    .and(v_texel.y.lessThan(float(mask_chunks)))
  const v_uv = v_texel.add(float(0.5)).div(float(mask_chunks))
  const v_drawn = texture(mask_texture, v_uv).level(float(0)).r.greaterThan(float(0.5))
  const sink = v_in_window.and(v_drawn).select(float(1), float(0)).mul(float(SEAM_SINK_M))
  // [S-27 D1 — THE RING FIX] The far shell now ships REAL progressive-voxel geometry (far_voxel_mesher,
  // L1/L2/L3) whose blockiness is baked WORLD-ANCHORED, so the old camera-distance vertex Y-quantize
  // ILLUSION is deleted: it re-rounded each vertex's height by a step keyed on its RADIAL distance to the
  // camera, so the terrace boundaries sat on iso-distance shells (concentric dark arcs) and slid every time
  // the camera moved (reported: "the black circles on the mountains are moving too"). Proven by an A/B bisect
  // (2026-07-08): exaggerating the step exploded the arcs, disabling it left a clean sheet. positionNode
  // now only applies the near-ring SEAM SINK; the real voxel heights carry the blocks.
  material.positionNode = vec3(positionLocal.x, positionLocal.y.sub(sink), positionLocal.z)

  // FLAT PER-FACE NORMAL — the voxel-FACET shading cue: a hard per-triangle normal from the screen-space
  // derivative of the world position, so every facet shades flat like a block face (real voxel tops bright,
  // risers dark; the coarse smooth L4 horizon gets clean triangle facets under the haze). Oriented up-ish so
  // the sun-diffuse hemisphere is stable (far terrain is overwhelmingly up-facing; DoubleSide covers the rest).
  const face_n = positionWorld.dFdx().cross(positionWorld.dFdy()).normalize()
  const n = face_n.mul(face_n.y.greaterThanEqual(float(0)).select(float(1), float(-1)))
  // Drive the PBR model's OWN lighting off the flat facet normal too — the scene sun/back-fill lights
  // (renderer.js) otherwise re-light the surface with the SMOOTH geometry normal, washing the facets back
  // to a smooth read (pixel-verified). The far mesh sits at identity ⇒ world normal = object normal, so
  // transformNormalToView is the correct object→view mapping the standard model expects.
  material.normalNode = transformNormalToView(n)
  const ndl = max(float(0), n.dot(sun_direction))
  const base_shade = float(SUN_AMBIENT).add(ndl.mul(float(1 - SUN_AMBIENT)))
  // VOXEL AO (?farcont=1): darken vertical block faces vs tops by the flat normal's up-ness (`n.y` after
  // the up-force ∈ [0,1]: 0 = riser/skirt, 1 = top) — the near ring's block-face/contact-shadow contrast
  // the flat far shell lacked. OFF ⇒ `base_shade` unchanged (byte-identical).
  const shade = continuity ? base_shade.mul(float(SIDE_AO).add(max(float(0), n.y).mul(float(1 - SIDE_AO)))) : base_shade
  const albedo = vec3(/** @type {*} */ (attribute('color', 'vec3'))).mul(shade)

  // DISTANCE HAZE + DESATURATION (target: "field of view" + "fog/blurriness above"). A distance factor
  // ramps HAZE_START→HAZE_FULL m; the color is pulled toward its own luminance (desaturate) then toward
  // the sky tint (extra aerial haze on top of the scene fog) so distant terrain sits soft in atmosphere.
  const dist = positionWorld.sub(cameraPosition).length()
  const t = smoothstep(float(HAZE_START_M), float(HAZE_FULL_M), dist)
  const luma = albedo.dot(vec3(0.2126, 0.7152, 0.0722))
  const desat = mix(albedo, vec3(luma, luma, luma), t.mul(float(continuity ? CONT_DESAT_MAX : DESAT_MAX)))
  // [S-27-DEPTH residual #1, 2026-07-11] DAY-GATED DEEP-BLUE TILT on HAZE_TINT — matches the scene
  // fogNode's darkening-blue character (renderer.js) at THIS shoulder band. The fogNode's own comment
  // flags it: "the mid-distance shoulder is far_field.js's own sky-tint fade (HAZE_TINT, out of fence),
  // where fog_amt is thin — the fogNode cannot fully deepen it." Same R/G-cut, B-unboosted principle as
  // the fogNode's day_tilt (a DARKENING multiply, never a brightening one — the "bright tilt WAS the
  // bug" lesson applies here too): pulls HAZE_TINT itself toward a deeper, darker blue instead of the
  // old pale (0.53,0.62,0.72) blue-grey. Gated to IDENTITY at night via sun_direction.y — same night
  // threshold already proven correct in this codebase (renderer.js refresh_fog: y≥0.02 day, y≤-0.12
  // full night) — reused here instead of wiring a new cross-file uniform (far_field.js already tracks
  // sun_direction every tod change; no new uniform needed).
  const day_f_far = smoothstep(float(-0.12), float(0.02), sun_direction.y)
  const haze_tilt = mix(vec3(1, 1, 1), vec3(0.75, 0.84, 1.0), day_f_far)
  const haze_tint_tilted = vec3(HAZE_TINT.r, HAZE_TINT.g, HAZE_TINT.b).mul(haze_tilt)
  const hazed = mix(desat, haze_tint_tilted, t.mul(float(HAZE_MAX)))

  // PER-CELL SURFACE GRAIN — a stable hash over a coarse world-XZ patch offsets each patch's brightness
  // by ±FAR_GRAIN/2 (zero-mean), so a flat far sheet (distant water/plains) reads as a mottled surface
  // rather than a single sheet of paint. Quantized to FAR_GRAIN_CELL_M so it's gentle patches, not noise.
  const grain_cell = positionWorld.xz.mul(float(1 / FAR_GRAIN_CELL_M)).floor()
  const grain = hash(grain_cell.x.mul(0.317).add(grain_cell.y.mul(0.713)))
  // NEAR-FADE the grain amplitude so the flat far-WATER band just past the near ring is smooth (no
  // checkerboard static — 2026-07-04) while distant terrain keeps its mottle. `dist` computed above.
  const grain_fade = smoothstep(float(GRAIN_FADE_NEAR_M), float(GRAIN_FADE_FAR_M), dist)
  // [S-27 D2] The voxel-CELL GRID + per-cell brightness JITTER shader illusion is DELETED: the far shell now
  // ships REAL blocky voxel geometry (far_voxel_mesher) whose vertical block faces + baked per-cell colour
  // jitter give the discrete-block read for real, so the fake dark grid lines are redundant — and were the
  // reported "the lod nearby is just a grid" reject. Only the flat-sheet grain survives (for the coarse L4
  // horizon + distant water).
  const dressed = hazed.mul(float(1).add(grain.sub(float(0.5)).mul(float(FAR_GRAIN)).mul(grain_fade)))

  // colorNode is assigned at the END of this function — inside an Fn() that also carries the discard
  // statements, because [2026-07-04 THE PHANTOM-DISCARD ROOT CAUSE] a
  // BARE `node.discard()` at material-build scope is DEAD CODE in TSL: the node builder only compiles
  // what is reachable from the material's output slots, and a discard node nobody consumes never
  // reaches the WGSL. Both the residency-mask discard AND the birth/dying screen-door dither were bare
  // ⇒ the shell NEVER hid over drawn chunks during streaming (the reported entire "LOD covers the real
  // terrain" saga) and the cross-fades were phantoms (sections hard-popped). Proven by the ?fardebug=1
  // lens: the SAME resident/in_window nodes, consumed via colorNode, showed GREEN (mask data correct,
  // discard-should-fire) exactly where normal mode rendered the plane. Effects must ride the graph:
  // If(...) + Discard() INSIDE the Fn() assigned to colorNode.

  // FADE-IN DITHER (screen-door, design directive; survey S23 dithered transparency). age = clock −
  // spawn_seconds; while age < fade_seconds the fragment's reveal < 1 and a POSITION-hashed screen-door
  // discards a shrinking fraction of fragments, so a section refinement/replacement cross-fades in
  // rather than popping — NO alpha sorting. Implemented WITHOUT three's material `alphaHash` (which
  // taxes EVERY fragment forever with a hash+discard): we discard only while a section is young, so
  // fully-faded-in sections (the steady state) pay a single cheap compare that the compiler folds to a
  // no-op branch. The hash is a stable per-fragment value from the world position (positionWorld),
  // fine-grained and view-stable.
  const spawn = float(/** @type {*} */ (attribute('spawn_seconds', 'float')))
  const age = smoothstep(float(0), float(fade_seconds), clock.sub(spawn)) // 0→1 over the fade window
  // BIRTH: reveal = age (0→1). DYING: reveal = 1−age (1→0), so a retired mesh screen-doors OUT.
  const reveal = fade_out ? float(1).sub(age) : age
  // Cheap ordered-ish hash in [0,1) from the world position (three's `hash` helper is a good dither).
  const dither = hash(positionWorld.x.mul(3.11).add(positionWorld.z.mul(7.53)).add(positionWorld.y.mul(1.7)))
  // (the reveal/dither discard is applied inside the colorNode Fn below — bare discards are dead code)

  // The CPU texture stores the old five-sample erosion verdict, while 128 keeps raw drawn semantics for trees.
  const frag_chunk = positionWorld.xz.div(float(CHUNK_SIZE)).floor()
  const texel = frag_chunk.sub(mask_origin)
  const in_window = texel.x
    .greaterThanEqual(float(0))
    .and(texel.x.lessThan(float(mask_chunks)))
    .and(texel.y.greaterThanEqual(float(0)))
    .and(texel.y.lessThan(float(mask_chunks)))
  const mask_uv = texel.add(float(0.5)).div(float(mask_chunks))
  const resident = texture(mask_texture, mask_uv).r.greaterThan(float(0.75))

  // [2026-07-04 JOINT-DEBUG LENS] ?fardebug=1 turns the shell into a
  // diagnostic overlay INSTEAD of discarding: GREEN = the mask says "drawn column — I should be
  // invisible here" (if you SEE green over terrain, the mask data is right and the DISCARD path is
  // broken); RED = "not drawn — I legitimately cover this" (red over visible voxels = the mask DATA is
  // wrong); outside the 41×41 window = normal shell color. Remove after the hunt.
  const far_debug = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fardebug') === '1'

  // THE ONE OUTPUT GRAPH — colorNode carries the discards so they actually compile (see the
  // phantom-discard note above). Fn() gives the statements a stack; If/Discard land in the WGSL.
  material.colorNode = Fn(() => {
    // birth/dying screen-door: steady sections (reveal=1) never discard; young fade in; retired fade out
    If(reveal.lessThan(dither), () => Discard())
    if (!far_debug) {
      // residency-mask hide: this fragment's world column is DRAWN by the near renderer → invisible
      If(in_window.and(resident), () => Discard())
      return vec4(dressed, 1)
    }
    // ?fardebug=1 diagnostic lens: GREEN = mask says drawn/should-hide, RED = legit cover, BLUE = outside window
    const diag = in_window.select(resident.select(vec3(0.1, 1.0, 0.1), vec3(1.0, 0.1, 0.1)), vec3(0.3, 0.3, 1.0))
    return vec4(diag, 1)
  })()

  return material
}
