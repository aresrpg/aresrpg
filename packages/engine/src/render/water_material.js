// NG2-C water shading — the "drastically better water" material for the liquid render class.
// Ported (SHADING ONLY) from Braffolk/fable5-world-demo (MIT, © 2026 Remi Sebastian Kits) —
// specifically render/WaterMaterial.ts's Fresnel-flatten + depth-tint + two-phase flow normals +
// two-phase foam. Their heightfield-clipmap GEOMETRY is SKIPPED (playbook §4/DO-NOT): our water is
// blocky top/side/bottom faces meshed watertight by the mesher (mesher.js liquid boundary pass), so
// this module returns a set of shader NODES that terrain_material.js's `liquid` variant swaps in for
// the old flat-blue wash — the mesher-decoded geometry, per-face table, AO, sun-leak gate and voxel
// light are ALL untouched (minimal diff at the swap point). Every API re-verified against our pinned
// three@0.185.1 (their three@0.184): `viewportSharedTexture` / `viewportDepthTexture` / `refract` /
// `reflect` / `linearDepth` / `perspectiveDepthToViewZ` / `time` all present and used below.
//
// SELF-CONTAINED (ownership rule): this material reads NO renderer passes. Reflection is the ALWAYS-
// CORRECT sky fallback (`sample_sky` in the reflected view dir — the demo's SSR-miss mechanism, which
// is the whole reflection here); refraction + depth-tint read the shared scene color/depth textures
// that already exist because liquid renders at renderOrder=1 AFTER the opaque solids (pool_renderer).
// No prior-frame SSR march (their march needs a heightfield/canopy horizon map = renderer/gen state
// we don't own material-side) — that ships as a renderer-wave handoff, see the SSR DEFER note below.
//
// DETERMINISM: visual-only (render class), so `time`-driven animation is legal (no p2p surface).
//
// ── DEFERRED (honest, not faked) ─────────────────────────────────────────────────────────────────
// • SSR (screen-space reflections): needs a resolved prior-frame color+depth reflection march with a
//   crowned-horizon occlusion test against a heightfield/canopy map — renderer-owned state. HANDOFF:
//   a renderer wave adds a reflection color/depth tap (or an SSRNode pass) and calls
//   `set_reflection(node)` on the handle below; until then reflection = sky (correct at glancing angle,
//   the dominant term). No fake screen-grab.
// • Caustics (Caustics.ts): needs a per-frame 512² compute bake AND a water-depth (waterY−bed) render
//   field to back-project the refracted sun ray — a renderer-side pass we don't own here. Speccing it
//   rather than half-shipping a stub (per the wave brief's judgment clause). See caustics handoff in
//   the exit report.

import { DepthTexture, Vector3 } from 'three'
import {
  cameraFar,
  cameraNear,
  cameraPosition,
  clamp,
  float,
  fract,
  mix,
  normalWorld,
  perspectiveDepthToViewZ,
  positionView,
  positionWorld,
  reflect,
  screenUV,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from 'three/tsl'

// ── EXPLICIT scene-depth grab texture (NG2-ATMO post-stack integration, 2026-07-03) ────────────────
// Under the atmosphere RenderPipeline the water renders INSIDE a PassNode whose depth attachment is
// FORCED to FloatType/depth32float by three's reversed-Z branch (PassNode.js:770) — but three's
// shared `viewportDepthTexture()` singleton is a default DepthTexture (depth24plus), so the per-frame
// framebuffer→texture depth copy failed WebGPU format validation ("depth32float depth24plus"). Fix:
// grab depth into OUR OWN DepthTexture whose type renderer.js aligns to the real render path via
// `set_water_depth_texture_type` (FloatType on the WebGPU/reversed-Z path; the UnsignedInt default
// stays for the WebGL2 fallback, whose framebuffer depth remains 24-bit).
const water_scene_depth = new DepthTexture(1, 1) // ViewportTextureNode auto-resizes per frame

/**
 * Align the water depth-grab texture's type with the active render path's depth format. Called once
 * from renderer.js after backend detection (before the first frame builds the water material).
 * @param {number} type a three texture type constant (e.g. FloatType for WebGPU reversed-Z)
 */
export function set_water_depth_texture_type(type) {
  // `type` is a three texture-type enum value; `.type` is typed TextureDataType (the enum). `*` cast is
  // the file's standing idiom for three enum/.d.ts friction (see the vec2 `*` casts below).
  water_scene_depth.type = /** @type {*} */ (type)
}

/**
 * @typedef {[number, number, number]} Rgb
 */

// --- tuning constants (shared by the JS reference helpers AND the TSL nodes) ----------------------
//
// ── OWNER FINE-TASTE KNOBS (2026-07-03 directive: "I should not be able to see deep water depth,
//    only shallow water should be see-through, it should fade off darker") ─────────────────────────
// The transmission (looking-THROUGH-the-water) term is governed by four knobs tuned by eye:
//   • WATER_SIGMA — Beer-Lambert extinction per block. STEEPENED so the bed's transmitted colour is
//     gone by ~6-8 blocks (see the exp() budget in the doc on WATER_SIGMA). Bigger ⇒ murkier/shallower
//     see-through depth.
//   • WATER_FADE_START / WATER_TINT_DEPTH — the see-through→opaque ramp window (blocks). Water shallower
//     than FADE_START stays readably transparent (shoreline charm); past TINT_DEPTH it is full opaque
//     body colour. The ramp is a smoothstep across this window (readable, then a fast dive to opaque).
//   • WATER_DEEP_FLOOR — the residual body-colour glow that REMAINS once the bed is fully extinguished
//     (the "opaque deep surface" colour = WATER_BODY_COLOR × this). Lower ⇒ darker deep body.
// Fresnel/sky-reflection knobs (WATER_F0, roughness, foam, ripples) are UNCHANGED by this directive —
// this pass only re-tunes the transmission term.

/** Body colour the deep water tends toward (linear) — a DARK desaturated teal-blue lake tone (2026-07-03:
 *  darkened from [0.06,0.19,0.26] so deep water reads as a dark surface, not a bright teal). @type {Rgb} */
export const WATER_BODY_COLOR = [0.03, 0.105, 0.15]
/** Shallow tint mixed at the surface before depth takes over (linear) — brighter, greener. @type {Rgb} */
export const WATER_SHALLOW_COLOR = [0.13, 0.34, 0.42]
/** Beer-Lambert per-block extinction (r,g,b) applied to the through-water bed colour — red dies fastest
 *  so deep water goes blue-green, but ALL channels are crushed by ~6-8 blocks so the bed is invisible in
 *  deep water (steepened from the ported {r:0.42,g:0.135,b:0.095}). Budget:
 *  slowest channel (blue) exp(-0.48·d) is 0.30 at 2.5 blk (shallow still see-through), 0.056 at 6 blk,
 *  0.021 at 8 blk (opaque). Red exp(-0.90·d) is 0.10 at 2.5 blk. R>G>B ordering preserved (red first).
 *  @type {Rgb} */
export const WATER_SIGMA = [0.9, 0.62, 0.48]
/** Through-water depth (blocks) below which water stays readably transparent — the shoreline gradient
 *  charm zone. The see-through→opaque ramp is smoothstep(FADE_START, TINT_DEPTH, depth). */
export const WATER_FADE_START = 2.5
/** Through-water depth (blocks) at which the tint is fully body-colour / the water is opaque (ramp end). */
export const WATER_TINT_DEPTH = 6.0
/** Residual body-colour glow that remains once the bed is fully extinguished (opaque deep surface =
 *  WATER_BODY_COLOR × this). Lower ⇒ darker deep body (2026-07-03: was a hard-coded 0.25). */
export const WATER_DEEP_FLOOR = 0.16
// ── WORLD-CONTINUOUS WATER LIGHT (2026-07-03) — water lit as one continuous surface, not per-block ─────
// The per-quad voxel `brightness` (open water = 1.0; deep cave ≈ 0.22) is used ONLY as a broad cave
// switch via smoothstep(LOW, HIGH, brightness): lit water collapses to a CONSTANT 1.0 (so greedy-merged
// quad rectangles vanish), dark cave water dims to CAVE_MIN. Open water sits at brightness 1.0 ≥ HIGH ⇒
// exactly 1.0 (byte-flat), so a wide vista is one continuous surface with zero brightness rectangles.
/** Brightness below which water is treated as fully lit-collapsed → 1.0 (start of the cave ramp). */
export const WATER_LIT_LOW = 0.42
/** Brightness at/above which water is FULLY lit (constant 1.0). Open water (1.0) is well past this. */
export const WATER_LIT_HIGH = 0.78
/** Darkest the cave/overhang water dims to (the low end of the broad switch). Keeps deep cave water
 *  readably dark without ever letting a per-quad light STEP show on lit open water. */
export const WATER_CAVE_MIN = 0.28
// ── SURFACE ALPHA (2026-07-03 NOTE #4: shallow water read too opaque/murky-solid — shallows must be glassy-clear
//    with colour; DEEP stays opaque per the frozen earlier ruling) ──────────────────────────────────
/** Minimum surface alpha (the shallow floor). LOW so a near-perpendicular view over 0-4-block water is
 *  GLASSY (bed reads through the blue tinge), not milk. Was 0.42; lowered for note #4. */
export const WATER_ALPHA_FLOOR = 0.2
/** Constant alpha baseline added before the floor clamp. LOW so shallow water leans transparent. */
export const WATER_ALPHA_BASE = 0.1
/** Depth-driven alpha weight (× the shallow→opaque ramp `tint_t`). RAISED so DEEP water still reaches a
 *  fully-occluding alpha 1.0 at the lowered floor/base (the frozen "no visible deep depth" ruling). */
export const WATER_ALPHA_DEEP = 0.95
// ── ENG-18 (2026-07-04) — the water camera frustum showed a visible transparency defect: a beach
//    shot where shallow water shows a transparent band that switches to OPAQUE BLUE along a boundary
//    that SWEEPS with camera rotation ─────────────────────────────────────────────────────────────
// ROOT CAUSE: the surface ALPHA (the transparent→opaque transition) was driven by TWO rotation-VARIANT
// terms — (1) the raw Fresnel (`fresnel` = (1−cosθ)^FRESNEL_POWER, cosθ = view·flattened-normal), whose
// steep ramp puts a hard opacity iso-line on the plane that moves as the incidence shifts with yaw/pitch;
// and (2) the SLANT through-water depth (`water_depth` = bed−surface along the VIEW RAY), which lengthens at
// grazing so the depth-alpha term hit opaque at a moving iso-line. Both made the transparency boundary sweep
// with rotation — violating the frozen law (transparency is a DEPTH property + a mild FIXED view term, never
// a sharp Fresnel-keyed alpha). FIX: key the alpha on VERTICAL water depth (rotation-INVARIANT: the true
// plumb-line bed depth, `slant · |view.y|`, which is identical at every yaw/pitch for the same water column)
// over a SOFT ramp that spans metres, plus a MILD fixed view-lean. The COLOR fade-off (tint_base on slant
// `water_depth`) is UNCHANGED — it was tuned by eye and it isn't the boundary defect; at the now-low
// shallow alpha it can't read as "opaque blue" anyway (the framebuffer bed bleeds through).
/** VERTICAL through-water depth (blocks) below which the surface stays GLASSY-transparent at EVERY camera
 *  angle — the rotation-invariant shoreline charm zone. Vertical depth = slant·|view.y|, so a 1-block-deep
 *  beach reads glassy whether viewed straight-down or grazing. */
export const WATER_ALPHA_VDEPTH_START = 1.5
/** VERTICAL through-water depth (blocks) by which the surface is fully OPAQUE (deep stays dark at every
 *  angle — the frozen "no visible deep depth" law). The [START, END] window is WIDE (3.5 blocks) so the
 *  transparent→blue transition is a SOFT gradient over metres, never the hard line that swept with rotation. */
export const WATER_ALPHA_VDEPTH_END = 5.0
/** MILD FIXED view-angle lean added to alpha (× (1−|view.y|), so grazing water is marginally more opaque —
 *  a little more surface sheen at glancing angles, physically real). SMALL + LINEAR (not pow'd) so it is a
 *  gentle wash, never a sharp Fresnel-keyed boundary. This is the "mild fixed view term" the law permits. */
export const WATER_ALPHA_VIEW_LEAN = 0.15
// ── SHALLOW-WATER PRESENCE (2026-07-07) — 1-2 block deep water was nearly invisible: the shader was
//    too transparent, so a shallow lagoon shelf read as DRY SAND with a faint blue haze ─────────────
// ROOT CAUSE: the alpha depth term is smoothstep(1.5, 5.0, vdepth)·0.95 ⇒ ≈0 at 1-2 blocks, so the
// surface alpha sat at ~0.2-0.24 — and the anti-chrome Fresnel ((1−cosθ)^7 capped) is only ~0.02-0.04 at
// non-grazing angles, so the surface caught no sky either: the shelf rendered ≈ the raw bright bed.
// REAL shallow water keeps a MINIMUM VISIBLE PRESENCE independent of depth: a slight body tint (alpha
// floor) + the surface catching sky colour. Two ROTATION-INVARIANT floors (both keyed on the ENG-18
// vertical depth, so nothing can sweep with camera rotation), both feathered in over the first block so
// the exact waterline still meets the shore softly, and both FADED OUT by the existing deep ramp so
// deep-water optics stay byte-identical (the approved turquoise gradient is untouched).
/** Minimum surface alpha of open shallow water once vdepth ≳ 1 block (the presence floor). Exposed as a
 *  per-world config uniform (`water.shallow_presence`) — the DEFAULT applies to ALL worlds. 2026-07-12 owner
 *  REOPEN ("our water is really barely visible on shallow depth" — a 1-2 block beach pool STILL read as dry
 *  sand): 0.34 was too low to beat a bright sand bed at a top-down angle (the surface was 66% bed). RAISED to
 *  0.44 (the top of the readable band that still keeps the shore ramp SOFT — the surface_alpha soft-gradient
 *  test caps the per-step rise = no hard opacity rim). Still < 0.5 ⇒ glassy-translucent; deep water untouched. */
export const WATER_SHALLOW_PRESENCE = 0.44
/** Vertical depth (blocks) at which the presence floor STARTS feathering in (≈ the true waterline edge). */
export const WATER_PRESENCE_FEATHER = 0.05
/** Vertical depth (blocks) by which the presence floor is FULLY in. Wide enough (≈1.2 blocks) that the
 *  waterline→shelf ramp is a soft gradient, never a hard opacity rim along the shore. */
export const WATER_PRESENCE_FULL = 1.25
/** Minimum Fresnel (sky-mix fraction) over SHALLOW water at non-grazing angles — the surface catches sky
 *  colour even over a bright sand bed. Fades out with the deep alpha ramp (deep optics untouched). 2026-07-12:
 *  RAISED 0.2 → 0.3 so shallow water reads more clearly as a reflective sheet over sand, and the animated
 *  ripple wobbling this sky sheen contributes to the visible motion. */
export const WATER_SHALLOW_SKY_MIN = 0.3
/** SHALLOW SHIMMER gain (2026-07-12 owner: shallow pools read as STATIC dry sand). The sun glint is gated OFF
 *  at the top-down angle a shallow pool is viewed from, so shallow water had ZERO animated highlight. A gentle
 *  moving glimmer driven by the already-animated base ripple slope, gated to the shallow presence zone (faded
 *  out by the deep ramp ⇒ deep water byte-identical), makes even a 1-block pool visibly move. Peak ~0.12. */
export const WATER_SHALLOW_SHIMMER = 1.2
// ── DISTANCE DETAIL ROLL-OFF (2026-07-03 NOTE #5: the wave pattern stayed visible from a distance) —
//    the high-freq wave noise + sparkle threshold ALIAS into a visible grid/waffle when perspective
//    compresses them far away. Fade the high-freq detail (glint chop) and the sparkle with camera
//    distance so distant water reads as a smooth broad gradient; close-up detail is untouched. ─────────
// ── VARIANCE→ROUGHNESS (2026-07-04 owner REOPEN: "water should not be a strict mirror… dilution and
//    variation… ondulations… from the distance still looks repetitive"): the roll-off above DELETED the
//    normal detail without converting it to roughness, so beyond the fade the surface was optically FLAT
//    = a sky mirror with a clean sun ellipse. The physically-correct fix (the LEAN / normal-filtering
//    principle) is to RAISE the effective roughness by the REMOVED variance: as `detail_fade`→0 the
//    reflection DILUTES toward a smooth mean sky (blurred, hazy — no mirror), the sun road BROADENS + DIMS
//    (a wide soft glare, aggregate statistics of a thousand glints — never a clean ellipse), while the
//    BROADEST swell octave PERSISTS to the horizon so distant water visibly undulates. The band was also
//    WIDENED (start later, end farther) + the transition is squared so no hard waffle edge survives.
// ── 2026-07-04 REGRESSION FIX: the FIRST cut of that reflection dilution was a per-pixel hash JITTER of
//    the reflected direction that GREW with distance — but jittering ONE sky sample adds VARIANCE, it does
//    NOT blur: each distant pixel diced bright-sky-vs-dark → a violent white-on-navy boiling static field.
//    Corrected to an AVERAGE: LERP the sharp sample toward a SMOOTH mean-sky reflection (see the reflection
//    block below). A mix of two colours has ZERO added per-pixel variance ⇒ soft haze, no static. The
//    swell, road broaden/dim, band widening + off-axis rotation were CORRECT and are untouched. ──────────
/** Camera distance (blocks) at which the HIGH-FREQUENCY glint chop is at FULL strength (near end). Pushed
 *  OUT (was 22) so the chop survives deeper into the mid-distance — the roughness conversion, not an
 *  early fade, is what kills the far mirror, so we don't need to flatten the mid band (that made the waffle). */
export const WATER_DETAIL_FADE_NEAR = 34
/** Camera distance (blocks) by which the high-freq glint chop has faded OUT (far end — broad swell only).
 *  WIDENED (was 72) so the roll-off is a long gentle ramp, not a narrow band where two octaves beat into a
 *  visible waffle lattice. The wider the transition, the lower the per-metre gradient of the fade. */
export const WATER_DETAIL_FADE_FAR = 150
/** Camera distance (blocks) at which SPARKLES are at full strength (near). Sparkles are a close-range
 *  read; they alias into grid dots at distance, so they fade earlier than the normal detail. */
export const WATER_SPARKLE_FADE_NEAR = 30
/** Camera distance (blocks) by which sparkles are gone (the sun-road envelope carries distant glitter).
 *  WIDENED (was 62) in step with the detail band so the sparkle handoff to the broad road is also gradual. */
export const WATER_SPARKLE_FADE_FAR = 100
/** Fraction of the HIGH-FREQ ripple slope that remains on distant water. LOW (near-zero high-freq chop far
 *  away → no reflection waffle); the broad SWELL below carries the distant undulation instead, so this can
 *  be small without the surface going dead-flat. */
export const WATER_DISTANT_RIPPLE = 0.12
// ── PERSISTENT BROAD SWELL (undulation never dies) ──────────────────────────────────────────────────
/** Broad-swell spatial period (blocks) — a LOW-frequency (~5× RIPPLE_PERIOD) octave that persists at full
 *  amplitude to the horizon. This is the km-scale rocking wanted on distant water: slow, broad
 *  normal tilt that drives the Fresnel/reflection/road so the far surface shimmers instead of sitting as a
 *  frozen mirror. Only the HIGH-freq chop fades with distance — this octave does NOT. */
export const WATER_SWELL_PERIOD = 31.0
/** Broad-swell slope amplitude (normal tilt). Modest — enough to visibly rock the reflection/sun-road at
 *  range without turning near water choppy (near water is dominated by the high-freq ripple, this rides under it). */
export const WATER_SWELL_AMP = 0.06
/** Broad-swell scroll speed (blocks/s) — SLOW so distant water undulates gently (a long ocean swell), not a fast chop. */
export const WATER_SWELL_SPEED = 0.35
// ── DISTANCE DILUTION (the removed high-freq variance, re-expressed as a BLEND toward a smooth mean sky) ─
// 2026-07-04 REGRESSION FIX: these two knobs no longer drive a reflected-direction hash JITTER (that added
// per-pixel variance = the boiling white-on-navy static). They now parameterise an AVERAGE: a distance LERP
// of the sharp sky sample toward a SMOOTH mean-sky reflection (mix of two colours ⇒ zero added variance).
/** Mean-sky UPWARD ELEVATION BIAS (world units, added to the horizontal view heading before `sky()` is
 *  sampled for the diluted mean). Bigger ⇒ the mean samples a higher, softer patch of sky (more haze-like);
 *  smaller ⇒ nearer the horizon. A STABLE per-pixel direction (view-driven, NO hash) so the mean can't
 *  flicker — that stability is the whole point of the fix. Must be > 0 (a flat 0 bias would sample the
 *  grazing horizon and re-introduce a near-mirror). */
export const WATER_DISTANT_ROUGHEN = 0.35
/** Distant reflection DILUTION fraction toward the smooth mean sky at FULL distance (0..1): the blend is
 *  mix(sharp_sky, mean_sky, distance_rough·this). A real rough water surface integrates a whole sky
 *  hemisphere per pixel, washing the crisp sun/gradient into a soft mean — but as an AVERAGE, never a dice
 *  roll. 0 = keep the mirror-sharp colour (the reverted bug's-worth of static comes from the OTHER path,
 *  not this); ~0.6 = a soft diluted distant sky. <1 so the far water keeps a hint of the real sky gradient. */
export const WATER_DISTANT_DESAT = 0.6
/** Sun-road BROADENING at distance: the road/core specular exponents are DIVIDED by (1 + this·(1−fade)) so
 *  the lobe widens into a broad soft glare far away (a diluted sun road, the aggregate of countless
 *  unresolved glints) instead of the clean tight ellipse a flat far normal would give. */
export const WATER_DISTANT_ROAD_BROADEN = 6.0
/** Sun-road PEAK DROP at distance: the road/core/tail brightness is scaled by (1 − this·(1−fade)) so the
 *  distant sun glare is soft and dim (spread over many pixels), never a blinding clean spot. */
export const WATER_DISTANT_ROAD_DIM = 0.6
/** Schlick F0 for a water surface (2% reflect at normal incidence). */
export const WATER_F0 = 0.02
/** ANTI-CHROME (2026-07-03) — reduces the water's overly metallic/mirror-like reflectance. Fresnel ramp exponent. Schlick uses
 *  5; raising it (→~7) keeps mid-angle reflectance LOW so the water's blue-green BODY colour wins except
 *  at true grazing — the single biggest dial against the mirror/chrome read. */
export const FRESNEL_POWER = 7.0
/** ANTI-CHROME — cap on the PEAK reflectance (Schlick's grazing limit, normally 1.0). Below 1 so even
 *  grazing water keeps a little of its own colour rather than becoming a pure chrome sky-mirror. */
export const REFLECT_MAX = 0.7
/** ANTI-CHROME — roughen the sky reflection: jitter the reflected direction by this × the wave slope (a
 *  cheap roughness cone) so the reflected sky is slightly soft/broken — water, not polished steel. 0 =
 *  the old razor-sharp mirror; ~2–3 gives a soft, living reflection. */
export const REFLECT_ROUGHEN = 2.6
// ── ENG-19 (2026-07-05) — the sun reflection in the water read as a too-perfect mirror image; it needed
//    distortion and reduced brightness. The mirror sun-road is the REFLECTED SKY HALO
//    (sky_node glare+Mie spike toward the sun); Fresnel-weighted, it paints a clean bright ribbon that the
//    existing refl_jit under-breaks (its chop FADES with distance; the 31 m swell is too broad). Two surgical
//    reflection-path dials (shape normal / alpha / foam / close-up sparkle all frozen): (1) REFLECT
//    UNDULATION — a slow low-freq (3-8 m) 2-octave value-noise slope, distance-PERSISTENT, that wanders the
//    reflected normal so the ribbon breaks into wavy segments; (2) SPECULAR SOFT-SHOULDER — a Reinhard
//    white-point `s/(1+s/CAP)` on the specular terms (reflected halo + glint) so the road can't blow white
//    and sits below the sun disc (CAP ≪ SUN_DISC_INTENSITY 40); dim reflection/glint pass ~unchanged, foam +
//    through-water stay outside it, and the shoulder is FADED OUT by distance (the far road is already
//    ENG-15-diluted, so compressing it there would flatten the frozen distant-undulation motion). ──────────
/** REFLECT UNDULATION slope amplitude (reflection-only normal tilt) — wanders/breaks the sun-road ribbon. */
export const REFLECT_UNDU_AMP = 0.5
/** REFLECT UNDULATION coarse octave freq (1/m) ~6 m wavelength — a broad road-warp, not the ~0.5 m glint. */
export const REFLECT_UNDU_FREQ_A = 0.16
/** REFLECT UNDULATION fine octave freq (1/m) ~3 m — a 2nd wander scale (¼-weighted under the coarse). */
export const REFLECT_UNDU_FREQ_B = 0.34
/** REFLECT UNDULATION scroll speed (m/s) — SLOW (swell-class): the road wanders gently, no per-pixel boil. */
export const REFLECT_UNDU_SPEED = 0.5
/** SPECULAR SOFT-SHOULDER white-point CAP (linear radiance) — asymptotes the reflected halo (~12) + glint
 *  core (~9.5) to this; ≪ the sun disc (40) so the road reads dimmer than the sun, high enough to stay a
 *  bright specular (not a smear). NEAR/MID cap; eased→pass-through at distance (see the reflection block).
 *  [2026-07-05] THE BLOOM INTERACTION — a bright ellipse halo (the "spotlight" defect) appeared over the lake. 2.2 sat ABOVE the bloom
 *  threshold (post_stack cfg.bloom.threshold = 2.05), so the capped road ALWAYS cleared the bloom
 *  high-pass and bloom painted a giant soft ellipse halo over the lake — the "spotlight" (the road
 *  texture itself read fine; the blob was bloom's halo of it). 1.7 sits safely BELOW the threshold:
 *  the water specular can never trigger bloom; only the true sun disc (40) blooms. */
export const SPEC_SHOULDER_CAP = 2.2
// [2026-07-05 post-mortem] Three bloom-cap theories (1.7 blanket, sky-mirror split, 2.0 glint) all
// failed to move the spotlight because it was NEVER bloom — it was the fallback sky's own sun glow in
// the mirror (see default_sky above). 2.2 restored: the glint road keeps its full approved punch.
/** [2026-07-05] The reflection itself read fine; only the mirrored-sky halo caused the spotlight. SPLIT CAP for the MIRRORED-SKY
 *  term only. The blob was never the glint road: sample_sky carries the sky's broad sun-GLARE halo (peak
 *  ~12), and the mirror paints it as a SMOOTH bright ellipse at the sun's reflection point — capped at 2.2
 *  it still cleared the bloom threshold (2.05) and bloom haloed it into the spotlight. A first fix capped
 *  EVERYTHING to 1.7, which killed the road's punch ("what you removed is the nice shader"). The split:
 *  the SMOOTH mirrored-sky halo caps at 1.5 (can never bloom — the spotlight is impossible), while the
 *  STRUCTURED glint road keeps 2.2 (its sparkle peaks micro-bloom = the live glitter effect). */
export const SKY_MIRROR_SHOULDER_CAP = 1.5
/** Roughness of the water sheet (mirror-ish) vs foam (matte). */
export const WATER_ROUGHNESS = 0.06
export const FOAM_ROUGHNESS = 0.55
/** Foam colour (near-white, faintly cool). @type {Rgb} */
export const FOAM_COLOR = [0.9, 0.94, 0.96]
/** Two-phase flow cycle period scale (ported: FLOW_CYC 0.45) — how fast the two advection phases wrap. */
export const FLOW_CYC = 0.45
/** Wave normal ripple amplitude (calm lakes stay near-flat; scaled up on flow). */
export const RIPPLE_AMP = 0.05
/** Ripple spatial period, metres (world-XZ scrolling noise). */
export const RIPPLE_PERIOD = 6.0
/** Shore-foam onset: through-water depth (blocks) below which foam fades in. THIN (2026-07-03 owner: a
 *  ~0.3-block waterline lick, not a flat shelf painted white) — only the very waterline foams. */
export const SHORE_FOAM_DEPTH = 0.3
/** Peak shore-foam amount (< 1 so even the foamiest waterline keeps a hint of blue water beneath). */
export const SHORE_FOAM_MAX = 0.8
/** Shore-foam noise field: spatial frequency (1/m), animation speed, and sharpness (pow) that BREAK the
 *  waterline foam into an organic lick instead of a solid white band. Higher sharp ⇒ more broken/sparse. */
export const FOAM_NOISE_FREQ = 1.6
/** Shore-foam noise SCROLL speed (noise-domain units/s). ENG-17 (2026-07-04): SLOWED 0.9 → 0.14 (swell-class).
 *  ROOT of the close-steep BOIL: on a genuinely SHALLOW water body (the spawn valley — through-water depth
 *  < SHORE_FOAM_DEPTH across the whole sheet, so the shore-foam legitimately fires over the surface, unlike
 *  the DEEP ocean where it never fires) the foam mottle covered the near field, and at 0.9 u/s it SCROLLED a
 *  full noise cell between 450 ms frames ⇒ a boiling temporal field under a PINNED static camera (QA rig:
 *  water frame-to-frame Δ mean 14.18/255, 27 % of px Δ>18 — firsthand-confirmed the movers are near-WHITE
 *  foam [226,223,219], not glint/reflection). Part (c) of the fix brief: a static camera must yield a STATIC
 *  surface apart from SLOW swell — so the foam evolves at swell-class now (a real waterline churns slowly),
 *  collapsing the per-frame diff to terrain-class while the thin waterline lick still gently lives.
 *  Tuned to 0.09 (from a 0.14 first cut that left the CENTER-band diff at 2.61/255, just over QA's 2.0
 *  terrain-class gate) — a foam cell now refreshes over ~11 s of domain travel: still visibly (if slowly)
 *  churning at a real shoreline, but the pinned-camera per-frame diff clears the gate with margin. */
export const FOAM_NOISE_SPEED = 0.09
export const FOAM_NOISE_SHARP = 1.6
/** How much shore foam contributes to the surface ALPHA (opacity). LOW so a thin foam lick stays
 *  translucent — the bed reads blue through it (item #6, no frosted slab) rather than opaque white. */
export const FOAM_ALPHA_WEIGHT = 0.45
/** Refraction UV distortion strength (screen-space, scaled by ripple slope). */
export const REFRACT_STRENGTH = 0.045

// ── CASCADE (waterfall) ART KNOBS v3 — 2026-07-07 — the waterfall streams looked visually wrong: falls
//    read as GLASS SLABS crossed by a repeating diagonal zigzag/chevron band pattern. The v2 octaves
//    were sin(world_y)-phase HORIZONTAL BANDS bent by a wobble — at a glance that IS a chevron lattice,
//    and the sheet kept the flat-surface glass optics (low alpha + fresnel mirror). v3: falling water is
//    VERTICAL STREAKS — value noise stretched ALONG the fall (FREQ_H ≫ FREQ_V), scrolling DOWNWARD fast —
//    over an AERATED (whiter, more opaque) sheet. See the cascade block + fall foam/alpha below. ────────
/** Across-face streak frequency (1/m) — rivulets ~1 m apart horizontally. */
export const CASCADE_STREAK_FREQ_H = 0.9
/** Along-fall streak frequency (1/m) — features stretch ~9 m vertically (the Y-elongation that makes the
 *  pattern read as FALLING STREAKS, never horizontal chevron waves). */
export const CASCADE_STREAK_FREQ_V = 0.11
/** Downward scroll speeds (m/s) of the two streak octaves — REAL falling-water pace (fast), DIFFERENT so
 *  the pattern never marches in lockstep (the lockstep read as TV scanlines). Fine rivulets fall faster
 *  than the coarse sheets. */
export const CASCADE_SPEED_A = 8.0
export const CASCADE_SPEED_B = 12.5
/** Streak bend: a slow sine wobble of the streaks' horizontal sample position ALONG THE FALL — keyed on
 *  each octave's own SCROLLED y so the bends travel down with the water (and the exact "content comes
 *  from above" downward-scroll invariant holds per octave). No dead-straight verticals. */
export const CASCADE_WOBBLE_FREQ = 0.13
export const CASCADE_WOBBLE_AMP = 0.55
/** AERATION — base whitewater whiteness of a falling sheet (a fall entrains air: it is foam-like and
 *  mostly occluding, never a glass slab). Foam = AERATION + crest·GAIN where crest is the SHARPENED
 *  streak (smoothstep window below) — DISCRETE bright rivulets over a translucent aerated base, capped
 *  at FOAM_MAX (< 1) so the sheet never whites out into a milk slab. On fall faces this REPLACES the
 *  shore foam (a thin sheet against rock reads a tiny water_depth, so `shore` would double-fire white
 *  across the whole fall — the v3 first-cut milk-slab defect). */
// Design ruling 2026-07-07: the fall shouldn't read super white or much different in appearance/colors
// than the still water, just animated more. v3 whited the fall out; v4 drops the aeration/foam WAY down so the fall keeps the
// still-surface water colour (translucent, tinted) and only faint moving rivulet highlights read — the
// motion carries it (streaks scroll faster, above), NOT whiteness.
export const CASCADE_AERATION = 0.05
export const CASCADE_FOAM_GAIN = 0.35
export const CASCADE_FOAM_MAX = 0.38
/** Crest window: streak values below CREST_LO carry no rivulet foam; full by CREST_HI. A HIGH window ⇒
 *  sparse, distinct falling rivulets (the streak read), not a uniform white wash. */
export const CASCADE_CREST_LO = 0.5
export const CASCADE_CREST_HI = 0.8
/** Minimum surface alpha of a falling sheet — design ruling 2026-07-07: keep it translucent like the still surface
 *  (the bed/cliff reads THROUGH the fall), not an opaque milk sheet. */
export const CASCADE_ALPHA_MIN = 0.3

// ── SUN GLINT KNOBS — design REOPEN 2026-07-03: v1's "elongated + sparkle" glint shipped but was
//    IMPERCEPTIBLE at that framing (low sun over water = still a clean airbrushed white ellipse). The
//    v1 failure was twofold: (a) the specular ENVELOPE was carved off the CALM-LAKE normal (RIPPLE_AMP
//    0.05) — far too smooth to break up, so the lobe stayed a clean ellipse; (b) the glint strength
//    (~4) was drowned by the near-WHITE sky reflection the glancing Fresnel already paints (the sky by
//    a low sun is blown out, so a +4 additive fleck barely moved a ~0.9 white pixel). REWORK (v2):
//    1. RAGGED EDGES: the glint reflects off an AMPLIFIED, higher-frequency, animated copy of the wave
//       normal (GLINT_NORMAL_AMP ≫ RIPPLE_AMP) — the calm normal stays small for the water SHAPE while
//       the glint samples a jagged copy, so wave-normal noise visibly carves chunks in/out each frame.
//    2. DISCRETE SATURATED SPARKLES: pow(noise, big) thresholded to a few dozen HOT points, strength
//       cranked FAR past the white sky so a fleck is a saturated pixel, not a soft field.
//    3. ROAD ≥4× ELONGATION: the anisotropic lobe's along/across half-widths scale as 1/√POWER, so
//       √(ACROSS/ALONG) is the elongation ratio — tuned ≥4× (a long road toward the viewer, thin across).
//    4. SMALLER HOT CORE: ACROSS raised so the white core shrinks; energy redistributed to road+sparkles.
//    Still cheap: no extra texture samples (two more analytic sine lattices for the glint normal). ─────
/** Specular exponent for the per-facet sparkle CARRIER (pow of the anisotropically-stretched NdotH).
 *  Higher ⇒ crisper fleck cores with smaller soft halos (low values let the halos merge into a milky wash
 *  in the near field where perspective magnifies each fleck). Tuned for distinct, tight sparkles. */
export const GLINT_POWER_ACROSS = 160
/** Specular exponent for the HOT CORE (pow of the plain NdotH). HIGH ⇒ a SMALL blinding centre near
 *  perfect specular, with the rest of the energy redistributed into the road + sparkles. */
export const GLINT_POWER_ALONG = 220
/** How much the along-sun-azimuth misalignment is discounted when forming the road half-vector (0..1):
 *  higher ⇒ the specular stays high along the sun for longer ⇒ a LONGER road (thin across). ~0.9 ⇒ a road
 *  that reads several× longer along the sun than it is wide. */
export const GLINT_ROAD_ELONGATE = 0.92
/** SUN-ROAD shaping exponent on the CALM base-normal↔half-vector alignment: the sparkles/tail are gated
 *  by pow(dot(base_normal, H), this). LOW (broad) ⇒ a wide, soft sun road that reaches the viewer; higher
 *  ⇒ a tighter road. Shapes the choppy full-surface sparkle into a directional road (dark to the sides). */
export const GLINT_ROAD_FALLOFF = 3.5
/** Peak brightness of a HOT sparkle — cranked FAR past the near-white glancing sky so a fleck reads as a
 *  saturated pixel over the bright sheet (v1's 4.2 was invisible against the blown-out low-sun sky). */
export const GLINT_STRENGTH = 34.0
/** Brightness of the broad DIM tail under the sparkles. Kept VERY LOW (anti-chrome: the broad specular
 *  ENVELOPE is what reads as metal — "sparkles carry the life, the envelope carries the
 *  metal"). A faint sheen only, never a milky wash over the lake. */
export const GLINT_TAIL_STRENGTH = 0.05
/** AMPLIFIED wave-normal amplitude used ONLY in the specular path (the ragged-edge carver). ≫ RIPPLE_AMP
 *  (0.05): a big, animated normal jitter scatters the reflected ray so the lobe edge breaks into chunks
 *  that flicker frame to frame. The water SHAPE normal stays calm — this copy is glint-only. */
export const GLINT_NORMAL_AMP = 0.9
/** Spatial frequency (1/m) of the glint-only HASH value-noise wave field — the coarse tap. Sets the wave
 *  cell size (~1/this). Non-periodic noise, so this is ripple SCALE, not a tiling period. */
export const GLINT_NORMAL_FREQ = 1.7
/** Amplifies each animated value-noise tap (±0.5) into the ragged glint-normal slope. Higher ⇒ a more
 *  chopped normal / wider sun road / finer sparkle-carrying facets. */
export const GLINT_NORMAL_SLOPE = 1.5
/** Animation speed (rad/s scale) of the glint-only normal — the chunks/flecks travel with the waves. */
export const GLINT_NORMAL_SPEED = 1.15
/** ANTI-TILING (fixes "too repetitive") — how far the glint wave slope displaces the sparkle field's
 *  sample position, so the flecks ride the ripple motion + decorrelate from the wave normal. Larger ⇒
 *  more swirl / less periodicity (too large smears the flecks). */
export const GLINT_WARP = 0.6
/** ANTI-TILING — LOW-FREQUENCY amplitude-modulation spatial frequency (1/m). ~0.014 ⇒ ~70-block calm/
 *  rough zones so wide water gets character patches instead of reading as uniform wallpaper. */
export const GLINT_AMPMOD_FREQ = 0.014
/** ANTI-TILING — MACRO domain-warp spatial frequency (1/m) & amplitude (blocks). A very-low-freq
 *  (~90-block period) large offset applied to the base position of ALL wave octaves + the sparkle field;
 *  because its period ≫ the wave lattice, it smears the lattice's periodicity across a huge area so the
 *  diagonal corduroy never repeats at the wide-vista scale (the strongest anti-repetition dial). */
export const GLINT_MACROWARP_FREQ = 0.011
export const GLINT_MACROWARP_AMP = 9.5
/** Glitter field spatial frequency (1/m). ~2.2/m ⇒ flecks ~0.45 m apart in WORLD space, which still
 *  project to a visible on-screen size at the far, near-horizon distances a low-sun glint occupies
 *  (finer than this and the flecks blur sub-pixel into one smooth road). */
export const GLINT_SPARKLE_FREQ = 2.2
/** Glitter animation speed — the flecks shimmer/travel with the waves at this rate. */
export const GLINT_SPARKLE_SPEED = 2.6
/** Sparsity exponent for the sparkle mask — higher ⇒ fewer, hotter, more separated glints (not a mass). */
export const GLINT_SPARKLE_SHARP = 7
/** Renormalizes the hash value-noise sparkle (value noise peaks below 1, so pow(SHARP) over-crushes it).
 *  Restores the sparse hot flecks to full strength after the pow. */
export const GLINT_SPARKLE_GAIN = 3.2
// ── STEEP-DOWN GLINT GATE (2026-07-04 ENG-16: kill the persistent white static on steep-DOWN views) ──
// Root cause (probe-confirmed, /tmp/…/water_repro/steepdown_60m): the sun-glitter road is a GRAZING-view
// phenomenon (the reflected view ray only sweeps a low sun near the horizon). On a steep-DOWN view the
// specular geometry collapses — the reflected ray points at high sky, nowhere near the low sun — yet the
// glint terms (core/tail, and sparkle at closer range) stayed alive because their only view-gate is
// `road_region` (base_normal·half), which at a LOW sun is high at EVERY view elevation (0.76 straight-down
// → 1.0 grazing). Riding the per-pixel HASH glint-normal, that residual glint flickered pixel-to-pixel = a
// boiling white field. Fix: gate the whole glint by the VIEW ELEVATION — `smoothstep(HI, LO, view.y)` where
// view.y is the surface→camera up-component (sin of the view-elevation angle): 1 at grazing (glint intact),
// 0 at steep-down (glint gone, where its geometry is meaningless anyway). This is inert for every grazing
// framing (the approved sun-road, all eng15 poses at pitch ≥ -0.14 ⇒ view.y ≲ 0.15 ⇒ gate = 1).
//
// ── ENG-17 (2026-07-04): CLOSE + STEEP boil — the ENG-16 gate was too SOFT + the wrong terms leaked ──
// QA rig red (pinned static cam [70,150,120] pitch −0.80 tod 0.42, ~30 m above spawn-valley water; water
// frame-to-frame diff mean 14.18 / 27.3 % of pixels Δ>18/255 every 450 ms, terrain 0.15/0.1 % — isolates
// the water shader). TWO gaps the ENG-16 gate missed at this CLOSE-STEEP regime (its verification was
// 60–110 m at pitch −1.4, where view.y≈0.98 ⇒ the old 0.85-STEEP gate happened to be shut):
//   (1) At pitch −0.80, view.y ≈ sin(0.80) ≈ 0.717 sits INSIDE the old smoothstep(0.85,0.35) transition
//       band ⇒ the gate was only ~0.83 CLOSED = ~17 % of the glint LEAKED.
//   (2) The per-pixel HASH terms (`sparkle`, and the glint-normal jitter that carves `core`/`road`) are
//       time-seeded (they scroll every frame) AND fade only by DISTANCE (SPARKLE_FADE_NEAR 30 / _FAR 100,
//       DETAIL_FADE_NEAR 34) — so at ~30 m they were at FULL strength. A partially-open gate × full-strength
//       per-pixel time-varying hash = the boil (a static camera must produce a STATIC surface apart from
//       the slow swell; the hash scroll is the only thing that moves here, so it IS the temporal defect).
// ROOT FIX (two dials, both view-elevation — no time-freeze, so the APPROVED grazing sun-road keeps its
// live shimmer where the glint survives):
//   (a) TIGHTEN the master gate band: STEEP 0.85 → 0.55 so the whole glint is HARD-ZERO by ~33° down. At
//       pitch −0.80 (view.y 0.717 > 0.55) the glint is fully OFF ⇒ zero time-varying term ⇒ water diff
//       collapses to the smooth base-ripple-steered reflection/refraction (terrain-class). LOW stays 0.35 so
//       every grazing pose (pitch ≥ −0.14 ⇒ view.y ≲ 0.15) is byte-untouched.
//   (b) A SEPARATE, STEEPER elevation gate `HASH_GRAZE_*` on ONLY the per-pixel HASH-riding terms (the
//       sparkle field + the glint-normal jitter amplitude) so the FLICKERING components die FIRST — fully
//       gone by view.y 0.30, right as the view lifts off true grazing — while the SMOOTH road envelope fades
//       over the wider master band. So even inside the master transition band there is no per-pixel boil,
//       only a smooth road dimming. This is what makes it a ROOT fix and not just a narrower boil band.
/** View up-component (sin of view elevation) AT/ABOVE which the WHOLE sun glint is fully OFF — steep-down,
 *  where the specular road is meaningless and the noisy glint normal only produces static. ENG-17: 0.85 →
 *  0.55 (≈33° down) so the close-steep regime (pitch −0.80 ⇒ view.y 0.717) is HARD-shut, not 17 %-leaking. */
export const GLINT_GRAZE_STEEP = 0.55
/** View up-component AT/BELOW which the glint is fully ON — grazing views (the real sun-road). ~0.35 ⇒
 *  ≲20° down, so the entire glancing sun road (and every eng15 acceptance pose) keeps its glint untouched. */
export const GLINT_GRAZE_LOW = 0.35
// ── ENG-17 HASH-TERM ELEVATION GATE — the per-pixel, TIME-SEEDED flicker sources (sparkle field + glint-
//    normal jitter) get a SEPARATE, STEEPER gate than the master glint so they vanish the instant the view
//    lifts off grazing (before the master band even starts closing). The smooth road envelope (road_region
//    off the calm normal) is left to the master gate — it doesn't flicker, so it can fade gently. Below LOW
//    (grazing) = 1 (approved live shimmer intact); at/above STEEP = 0 (no per-pixel boil anywhere steeper). ─
/** View up-component AT/BELOW which the per-pixel HASH glint terms are fully ON (grazing shimmer intact).
 *  0.20 sits safely above every eng15 grazing pose (pitch ≥ −0.14 ⇒ view.y ≲ 0.14) so their live sparkle is
 *  byte-untouched, yet below the mid-steep band where the flicker must already be dead. */
export const HASH_GRAZE_LOW = 0.2
/** View up-component AT/ABOVE which the per-pixel HASH glint terms are fully OFF — steeper/earlier than the
 *  master gate (0.55) so the FLICKER dies FIRST (by ~22° down), leaving only the smooth (non-boiling) road
 *  envelope to fade over the wider master band. No per-pixel boil survives anywhere past grazing. */
export const HASH_GRAZE_STEEP = 0.38
// ── ANTI-WAFFLE (2026-07-04 ENG-16: the mid/far cross-hatch) — the fix lives in the SHORE FOAM, not here ─
// The diagonal cross-hatch waffle was NOT the base ripple (proven on the real engine: zeroing `slope`
// entirely left the waffle untouched; forcing `foam_amt`=0 removed it completely). It was the SHORE FOAM:
// `foam_noise` was a separable crossed sine `sin(x)·cos(y)` = a 2D checkerboard LATTICE, and `shore` fires
// wherever the through-water depth is shallow — including over wide shallow water bodies whose whole surface
// then reads as that grid at grazing/steep-down range. The cure is in the foam block below: `foam_noise` is
// rebuilt from NON-PERIODIC hash value noise (no grating direction at any scale) so the waterline foam is an
// organic lick, never a grid. No base-ripple change — the approved close-up ripple stays byte-for-byte.

// ── PER-CONFIG WATER OPTICS (FIVE-WORLDS §P3 shared stage 6) ──────────────────────────────────────
// The biome worlds drive the water body colour / extinction / see-through window from world_gen_config
// `water` (Everglades = murky brown-green, Paradise = turquoise high-clarity). These uniforms DEFAULT to
// the constants above, so a world without a `water` block — and the DEFAULT recipe, whose values equal the
// constants — renders BYTE-IDENTICALLY (water is render-only, never in the gen golden). configure_water_
// optics() updates them live (the node graph built below reads the uniforms), called by engine.js on world
// selection. Only the transmission knobs are exposed (the tuned Fresnel/foam/glint stay fixed).
const water_body_u = uniform(new Vector3(...WATER_BODY_COLOR))
const water_shallow_u = uniform(new Vector3(...WATER_SHALLOW_COLOR))
const water_sigma_u = uniform(new Vector3(...WATER_SIGMA))
const water_fade_u = uniform(WATER_FADE_START)
const water_tint_u = uniform(WATER_TINT_DEPTH)
const water_deep_floor_u = uniform(WATER_DEEP_FLOOR)
const water_presence_u = uniform(WATER_SHALLOW_PRESENCE)

/**
 * Applies a world's `water` optics config to the live water-material uniforms. Null/omitted ⇒ keeps the
 * defaults (= the live constants) so the DEFAULT world's water is byte-identical. Visual-only.
 * @param {import('../config/world_gen_config.js').WaterOpticsConfig} [cfg]
 * @returns {void}
 */
export function configure_water_optics(cfg) {
  if (!cfg) return
  if (Array.isArray(cfg.body_color)) water_body_u.value.set(cfg.body_color[0], cfg.body_color[1], cfg.body_color[2])
  if (Array.isArray(cfg.shallow_color))
    water_shallow_u.value.set(cfg.shallow_color[0], cfg.shallow_color[1], cfg.shallow_color[2])
  if (Array.isArray(cfg.sigma)) water_sigma_u.value.set(cfg.sigma[0], cfg.sigma[1], cfg.sigma[2])
  if (typeof cfg.fade_start === 'number') water_fade_u.value = cfg.fade_start
  if (typeof cfg.tint_depth === 'number') water_tint_u.value = cfg.tint_depth
  if (typeof cfg.deep_floor === 'number') water_deep_floor_u.value = cfg.deep_floor
  if (typeof cfg.shallow_presence === 'number') water_presence_u.value = cfg.shallow_presence
}

/**
 * The current configured water optics (reads the live uniform values) — for tests / introspection.
 * @returns {{ body_color:number[], shallow_color:number[], sigma:number[], fade_start:number, tint_depth:number, deep_floor:number, shallow_presence:number }}
 */
export function current_water_optics() {
  const v = (/** @type {*} */ u) => [u.value.x, u.value.y, u.value.z]
  return {
    body_color: v(water_body_u),
    shallow_color: v(water_shallow_u),
    sigma: v(water_sigma_u),
    fade_start: water_fade_u.value,
    tint_depth: water_tint_u.value,
    deep_floor: water_deep_floor_u.value,
    shallow_presence: water_presence_u.value,
  }
}

// --- pure-JS reference helpers (unit-tested; the TSL nodes mirror these op-for-op) ----------------

/** @param {number} x @param {number} lo @param {number} hi @returns {number} */
const clampf = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
/** @param {number} x @returns {number} */
const saturate = (x) => clampf(x, 0, 1)
/**
 * Hermite smoothstep matching TSL `smoothstep(e0,e1,x)` (and its reversed-edge form when e0>e1).
 * @param {number} e0 @param {number} e1 @param {number} x @returns {number}
 */
const smooth = (e0, e1, x) => {
  const t = saturate((x - e0) / (e1 - e0))
  return t * t * (3 - 2 * t)
}
/**
 * SKY-REFLECTION DAY FACTOR (2026-07-12 owner, watching the live cycle: "at night it's the water that emits
 * light, it's weird, water should be even darker than the terrain"). ROOT: the shipped water reflects a FIXED
 * analytic sky (`default_sky` — apply_water_to_material never passes the real sky node) and writes the result
 * to EMISSIVE, so scene-light dimming never reached it. As the coupled terrain darkened at dusk/night the
 * reflected sky stayed daytime-bright, and the water read as self-luminous against the dark ground. This
 * factor scales the self-luminous water terms (sky reflection + shallow shimmer + foam) by the sky's own
 * day/night level so the surface mirrors the ACTUAL sky: 1 across all daylight → 0 below the horizon.
 *
 * SIGNAL: keyed on sun elevation over the SAME terminator band couple_lighting (sky_light_coupling.js) uses
 * for its own night blend — `night = smooth(0.04, -0.12, y)`, so this = 1 − night. Measured `amb_lum_mul`
 * (the terrain-ambient sky-irradiance ratio) varies 0.68–1.0 ACROSS full daylight, so consuming it raw would
 * dim the tuned DAY water; the terminator band pins day to exactly 1 (byte-identical) and collapses
 * only as the sun crosses the horizon (a smooth dusk ramp, no pop). Self-contained (this material's ownership
 * rule): keyed on the sun uniform the material already tracks, no cross-module read.
 *
 * Residual moon reflection is deferred: `default_sky` carries no moon, so a moon glint on water needs the real
 * sky node wired here (ENG-9). This factor is forward-compatible with that: day ×1 is identity, and on a real
 * sky that already darkens at night the extra ×0 is harmless.
 * @param {number} sun_y sun elevation cosine (sun_direction.y), [-1,1]
 * @returns {number} 1 in daylight (y ≥ 0.04) → 0 below the horizon (y ≤ -0.12)
 */
export function sky_day_factor(sun_y) {
  return smooth(-0.12, 0.04, sun_y)
}

// ── WATER NIGHT FLOOR ("Night Look A" — matrix-lane cell A: 0.17) ─────────────────
// sky_day_factor bottoms at an EXACT 0 below the terminator (the reflection-killer above) — taken bare, that
// sinks night water to pure black, losing the surface entirely. This floors the SAME factor at a configurable
// minimum so night water stays visibly a surface, never crushes to black. Config-first, same idiom as
// sky_light_coupling's moon_mul/ambient_night_floor (DEFAULT const + module `let` + configure_*/current_*
// pair; engine.js threads the SAME world_config.night object into both — ONE config home for the night look).
/** Shipped default water night-dim floor (pick "Night Look A", cell A). 0 would be byte-identical to the
 *  pre-ship bare sky_day_factor; this IS the picked value, so an unconfigured world ships the new look. */
const WATER_NIGHT_FLOOR_DEFAULT = 0.17
let water_night_floor = WATER_NIGHT_FLOOR_DEFAULT

/**
 * Live-retune the water night-dim floor (a taste pick). Null/omitted ⇒ keeps the current value (the
 * DEFAULT is the shipped 0.17 pick). Visual-only; water_sky_dim_factor reads this on its next call.
 * @param {{ water_night_floor?: number }} [cfg]
 * @returns {void}
 */
export function configure_water_night_floor(cfg) {
  if (!cfg) return
  const { water_night_floor: floor } = cfg
  if (typeof floor === 'number') water_night_floor = floor
}

/** The live water night-dim floor (for tests / introspection). @returns {number} */
export function current_water_night_floor() {
  return water_night_floor
}

/**
 * The water's ACTUAL night-dim factor written to sky_dim_u by set_sun_direction (below) — sky_day_factor
 * floored at the configured `water_night_floor` so moonlit water keeps a visible surface instead of crushing
 * to black. Day is untouched (sky_day_factor is already 1 ≥ any sane floor); only the deep-night 0 is lifted.
 * Pure; mirrors couple_lighting's role for sky_light_coupling's dials — the one home for "what actually gets
 * applied", vs the raw curve.
 * @param {number} sun_y sun elevation cosine (sun_direction.y), [-1,1]
 * @returns {number} sky_day_factor(sun_y), floored at water_night_floor
 */
export function water_sky_dim_factor(sun_y) {
  return Math.max(sky_day_factor(sun_y), water_night_floor)
}

/** @param {number} x @returns {number} */
const js_fract = (x) => x - Math.floor(x)
/**
 * JS twin of the TSL `hash2` (cheap Dave Hoskins-style arithmetic hash — see the shader helper in
 * create_water_material_nodes), so the cascade streak twin mirrors the shader op-for-op.
 * @param {number} x @param {number} y @returns {number} hash in [0,1]
 */
const js_hash2 = (x, y) => {
  const px = js_fract(x * 0.3183099 + 0.71) * 17
  const py = js_fract(y * 0.3183099 + 0.113) * 17
  return js_fract(px * py * (px + py))
}
/**
 * JS twin of the TSL `vnoise` (2D value noise over js_hash2, smoothstep fade). Output in [0,1].
 * @param {number} x @param {number} y @returns {number}
 */
const js_vnoise = (x, y) => {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = js_hash2(ix, iy)
  const b = js_hash2(ix + 1, iy)
  const c = js_hash2(ix, iy + 1)
  const d = js_hash2(ix + 1, iy + 1)
  const top = a + (b - a) * ux
  const bot = c + (d - c) * ux
  return top + (bot - top) * uy
}

/**
 * Schlick Fresnel reflectance for a view/normal cosine — the JS twin of the TSL `fresnel` node.
 * The cosine is taken against the FLATTENED normal (ripples steer the reflection direction but must not
 * spike reflectance to a white sheet at grazing angles), so callers pass the flattened cosθ.
 * ANTI-CHROME (2026-07-03) — reduces the overly metallic/mirror-like reflectance: the exponent is FRESNEL_POWER (>5, steeper so
 * mid-angles stay low-reflectance = the water's blue-green body wins) and the grazing peak is capped at
 * REFLECT_MAX (<1, so even grazing water isn't a pure chrome mirror). Mirrors the shader op-for-op.
 * @param {number} cos_theta clamped dot(view, flattened_normal) in [0,1]
 * @returns {number} reflectance in [F0, REFLECT_MAX]
 */
export function fresnel_schlick(cos_theta) {
  const c = saturate(cos_theta)
  return WATER_F0 + (REFLECT_MAX - WATER_F0) * Math.pow(1 - c, FRESNEL_POWER)
}

/**
 * SPECULAR SOFT-SHOULDER (2026-07-05 ENG-19) — JS twin of the TSL `s/(1+s/CAP)` white-point shoulder on the
 * water's specular terms (reflected-sky halo + additive glint) so the mirror sun-road can't blow to
 * white. Reinhard compressor: dim radiance ~unchanged, bright asymptotes to CAP; monotone, output STRICTLY <
 * CAP (< the sun disc). Mirrors the shader op-for-op so the anti-blowout contract is unit-testable.
 * @param {number} s a single linear radiance channel (>=0)
 * @param {number} [cap] the white-point cap (defaults to SPEC_SHOULDER_CAP)
 * @returns {number} compressed radiance in [0, cap)
 */
export function spec_soft_shoulder(s, cap = SPEC_SHOULDER_CAP) {
  const x = Math.max(0, s)
  return x / (1 + x / cap)
}

/**
 * Beer-Lambert depth tint: linear RGB the water body reads as, given the through-water distance (blocks)
 * a view ray travels before hitting the bed. This mirrors the TSL `tint_base` × `absorb` term — the
 * base colour lerps shallow→body over the smoothstep(FADE_START, TINT_DEPTH) ramp (shallow stays
 * see-through, then a fast dive to the DARK body colour), and each channel is additionally extinguished
 * by `exp(-sigma·depth)` so red vanishes first (blue-green deep) and the whole bed contribution is gone
 * by ~6-8 blocks. Steepened sigma + darker body ⇒ no visible deep bed.
 * @param {number} depth_m through-water distance in blocks (>=0)
 * @returns {Rgb} linear tint colour
 */
export function depth_tint(depth_m) {
  const d = Math.max(0, depth_m)
  const t = smooth(WATER_FADE_START, WATER_TINT_DEPTH, d)
  /** @type {Rgb} */
  const base = [
    WATER_SHALLOW_COLOR[0] + (WATER_BODY_COLOR[0] - WATER_SHALLOW_COLOR[0]) * t,
    WATER_SHALLOW_COLOR[1] + (WATER_BODY_COLOR[1] - WATER_SHALLOW_COLOR[1]) * t,
    WATER_SHALLOW_COLOR[2] + (WATER_BODY_COLOR[2] - WATER_SHALLOW_COLOR[2]) * t,
  ]
  return [
    base[0] * Math.exp(-WATER_SIGMA[0] * d),
    base[1] * Math.exp(-WATER_SIGMA[1] * d),
    base[2] * Math.exp(-WATER_SIGMA[2] * d),
  ]
}

/**
 * Shore-foam DEPTH RAMP: 1 at the waterline (depth→0), fading to 0 by SHORE_FOAM_DEPTH. This is the
 * tested reference for the foam's depth falloff. NOTE (2026-07-03, item #5): the TSL shore
 * foam additionally BREAKS this ramp with an animated world-space noise (a thin organic lick, not a
 * solid fill) and caps it at SHORE_FOAM_MAX — those are visual-only modulations the pure-math twin
 * doesn't model; this fn pins the depth SHAPE (thin band, monotone fade), which is what's unit-testable.
 * @param {number} depth_m through-water depth in blocks @returns {number} foam ramp in [0,1]
 */
export function shore_foam(depth_m) {
  return smooth(SHORE_FOAM_DEPTH, 0.03, Math.max(0, depth_m))
}

/**
 * Waterfall cascade gate — mirrors the TSL `is_vertical` predicate op-for-op so the "flat water must
 * never cascade" invariant is unit-testable. A liquid quad gets the downward cascade streak + agitation
 * foam ONLY when it is BOTH a decoded SIDE face (id 0/1/4/5 = ±x/±z) AND geometrically near-vertical
 * (|normal.y| < 0.5). Top/bottom sheets (id 2/3, |normal.y|≈1) return 0 — no cascade, ever. This is the
 * belt-and-suspenders that kills the 2026-07-03 "flat chunks animate like waterfalls" symptom: even a
 * mis-decoded top quad is caught by the geometric-normal half of the AND.
 * @param {number} face_id decoded per-quad face id (0..7)
 * @param {number} normal_y y-component of the GEOMETRIC (pre-perturbation) face normal
 * @returns {0|1} 1 if this quad cascades (waterfall), 0 if it is a flat sheet
 */
export function cascade_factor(face_id, normal_y) {
  const is_side = face_id === 0 || face_id === 1 || face_id === 4 || face_id === 5
  const is_geo_vertical = Math.abs(normal_y) < 0.5
  return is_side && is_geo_vertical ? 1 : 0
}

/**
 * STEEP-DOWN GLINT GATE (2026-07-04 ENG-16) — the JS twin of the TSL `graze_gate` so the anti-static
 * contract is unit-testable without a GPU. The sun-glitter road is a GRAZING-view phenomenon; on a steep-
 * DOWN view the specular geometry collapses, yet the glint terms rode the per-pixel hash glint-normal and
 * produced a boiling WHITE STATIC. Fix: multiply the whole glint by `smoothstep(GLINT_GRAZE_STEEP,
 * GLINT_GRAZE_LOW, view_up)` where `view_up` is the surface→camera up-component (sin of the view-elevation
 * angle): 0 at steep-down (view_up→1 ⇒ glint gone) → 1 at grazing (view_up ≤ LOW ⇒ glint intact). This must
 * be exactly 1 for every grazing framing (the approved sun road, all eng15 poses at pitch ≥ -0.14 ⇒
 * view_up ≲ 0.15) so it never dims the real glitter, and 0 at true straight-down where the static lived.
 * @param {number} view_up surface→camera up-component in [0,1] (1 = looking straight down, 0 = grazing)
 * @returns {number} glint multiplier in [0,1]
 */
export function glint_graze_gate(view_up) {
  return smooth(GLINT_GRAZE_STEEP, GLINT_GRAZE_LOW, view_up)
}

/**
 * HASH-TERM ELEVATION GATE (2026-07-04 ENG-17) — the JS twin of the TSL `hash_gate` so the close-steep
 * anti-boil contract is unit-testable without a GPU. The per-pixel, TIME-SEEDED hash glint sources (the
 * sparkle field + the glint-normal jitter) get this SEPARATE, STEEPER gate so the FLICKER (the boil) dies
 * the instant the view lifts off grazing — by ~22° down (view_up ≥ HASH_GRAZE_STEEP) — before the master
 * `glint_graze_gate` even starts closing (STEEP 0.55). The smooth road envelope is left to the master gate
 * (it doesn't flicker, so it fades gently). Contract: 1 below HASH_GRAZE_LOW (grazing — the approved live
 * sparkle is untouched, covers every eng15 pose at view_up ≲ 0.14), 0 at/above HASH_GRAZE_STEEP, monotone.
 * @param {number} view_up surface→camera up-component in [0,1] (1 = looking straight down, 0 = grazing)
 * @returns {number} hash-glint multiplier in [0,1]
 */
export function hash_graze_gate(view_up) {
  return smooth(HASH_GRAZE_STEEP, HASH_GRAZE_LOW, view_up)
}

/**
 * Distance roll-off RESPONSE — the JS twin of the TSL variance→roughness pipeline (2026-07-04 owner
 * REOPEN: "water should not be a strict mirror… ondulations… distant water still looks repetitive").
 * Mirrors the shader op-for-op so the anti-mirror contract is unit-testable without a GPU:
 *   • `detail_fade` = smoothstep(FAR, NEAR, dist) — 1 near (full chop) → 0 far (chop gone). WIDENED band.
 *   • `chop_amp`    = RIPPLE_AMP × (detail_fade·(1−DISTANT_RIPPLE) + DISTANT_RIPPLE) — the fading high-freq
 *                     ripple slope amplitude (→ RIPPLE_AMP·DISTANT_RIPPLE floor far away).
 *   • `swell_amp`   = WATER_SWELL_AMP × distance_rough — the broad-swell slope amplitude, RAMPED IN by
 *                     distance: ≈0 near (close-up untouched — the fix is inert there) → full far, where it
 *                     is the undulation that must NEVER die as the chop fades out.
 *   • `distance_rough` = 1 − detail_fade — the removed variance that ramps the swell AND widens the
 *                     reflection cone + broadens/dims the sun road (→ the roughen and road scalars).
 * The KEY invariant the shader must satisfy: near water is chop-only (swell≈0 ⇒ byte-untouched close-up),
 * yet the FAR effective normal-tilt amplitude (chop floor + full swell) stays well above zero, so distant
 * water undulates instead of freezing into a mirror. The chop-fade and swell-ramp cross over the SAME wide
 * band, so there is no dead flat zone between them.
 * @param {number} dist camera→fragment distance in blocks (>=0)
 * @returns {{ detail_fade:number, chop_amp:number, swell_amp:number, effective_amp:number, distance_rough:number }}
 */
export function distance_lake_response(dist) {
  const detail_fade = smooth(WATER_DETAIL_FADE_FAR, WATER_DETAIL_FADE_NEAR, Math.max(0, dist))
  const distance_rough = 1 - detail_fade
  const lake_fade = detail_fade * (1 - WATER_DISTANT_RIPPLE) + WATER_DISTANT_RIPPLE
  const chop_amp = RIPPLE_AMP * lake_fade
  const swell_amp = WATER_SWELL_AMP * distance_rough // ramped in with distance (byte-untouched near)
  return {
    detail_fade,
    chop_amp,
    swell_amp,
    effective_amp: chop_amp + swell_amp, // total normal-tilt amplitude driving Fresnel/reflection/road
    distance_rough,
  }
}

/**
 * Distance reflection DILUTION — the JS twin of the TSL `mix(sharp_sky, mean_sky, distance_rough·DESAT)`
 * reflection blend (2026-07-04 REGRESSION FIX). Pins the ANTI-STATIC contract that the reverted per-pixel
 * hash JITTER violated: dilution must be an AVERAGE (a lerp between two colours), NOT a per-pixel dice roll.
 * The load-bearing property is that a lerp of two FIXED inputs produces ZERO added per-pixel variance — so
 * two adjacent distant pixels (same sharp+mean, same distance) get the SAME diluted colour ⇒ no boiling
 * white-on-navy static. Mirrors the shader op-for-op: fraction = distance_rough(dist)·WATER_DISTANT_DESAT,
 * per channel `sharp + (mean − sharp)·fraction`. `mean` in the shader is the SMOOTH low-frequency mean-sky
 * sample (a stable view-driven direction, no hash) — here the caller passes it as a plain colour.
 * @param {Rgb} sharp the sharp per-pixel sky sample (linear RGB)
 * @param {Rgb} mean the SMOOTH mean-sky colour to dilute toward (linear RGB)
 * @param {number} dist camera→fragment distance in blocks (>=0)
 * @returns {Rgb} the diluted reflection colour
 */
export function distant_reflection_blend(sharp, mean, dist) {
  const { distance_rough } = distance_lake_response(dist)
  const frac = distance_rough * WATER_DISTANT_DESAT // blend fraction toward the mean (0 near → DESAT far)
  return [
    sharp[0] + (mean[0] - sharp[0]) * frac,
    sharp[1] + (mean[1] - sharp[1]) * frac,
    sharp[2] + (mean[2] - sharp[2]) * frac,
  ]
}

/**
 * Cascade streak value (0..1) at a point on a waterfall face — mirrors the TSL cascade op-for-op so the
 * v3 "vertical streaks, not chevron bands" rework is unit-testable. TWO downward-scrolling octaves of
 * Y-STRETCHED value noise (FREQ_H ≫ FREQ_V ⇒ tall thin rivulets) at DIFFERENT speeds (no lockstep march),
 * each bent by a slow wobble keyed on its own SCROLLED y (bends fall with the water — the exact
 * downward-scroll invariant octA(y, t+dt) === octA(y + SPEED_A·dt, t) holds per octave). Blended 0.6
 * coarse sheets / 0.4 fine rivulets. Returns [streak, octA, octB] (streak² feeds the aeration foam).
 * @param {number} world_y vertical world position on the face (the fall axis)
 * @param {number} horiz face-horizontal coordinate proxy (world x+z)
 * @param {number} t seconds (the `time` uniform)
 * @returns {[number, number, number]} [streak, octA, octB] each in [0,1]
 */
export function cascade_streak_at(world_y, horiz, t) {
  const ya = world_y + t * CASCADE_SPEED_A
  const wob_a = Math.sin(ya * CASCADE_WOBBLE_FREQ + horiz * 0.7) * CASCADE_WOBBLE_AMP
  const octA = js_vnoise(horiz * CASCADE_STREAK_FREQ_H + wob_a, ya * CASCADE_STREAK_FREQ_V)
  const yb = world_y + t * CASCADE_SPEED_B
  const wob_b = Math.sin(yb * (CASCADE_WOBBLE_FREQ * 1.7) + horiz * 0.9 + 2.1) * CASCADE_WOBBLE_AMP
  const octB = js_vnoise(horiz * (CASCADE_STREAK_FREQ_H * 2.3) + wob_b + 7.31, yb * (CASCADE_STREAK_FREQ_V * 1.9))
  return [octA * 0.6 + octB * 0.4, octA, octB]
}

/**
 * SURFACE ALPHA (2026-07-04 ENG-18) — the JS twin of the TSL `alpha` node, so the ROTATION-INVARIANCE
 * contract that fixes the beach-shot defect ("transparency near me but opaque blue right after,
 * boundary sweeps with rotation") is unit-testable without a GPU. Mirrors the shader op-for-op:
 *   • VERTICAL depth = slant · |view.y| — the rotation-invariant plumb-line bed depth. For a water column of
 *     true depth D, a view ray at ANY angle hits the bed after slant = D/|view.y|, so slant·|view.y| = D.
 *   • depth term = smoothstep(VDEPTH_START, VDEPTH_END, vertical_depth) · WATER_ALPHA_DEEP — a SOFT ramp over
 *     metres, keyed on that rotation-invariant depth (so the transparent→opaque boundary can't sweep).
 *   • view lean = (1 − |view.y|) · WATER_ALPHA_VIEW_LEAN — the MILD FIXED grazing wash (no sharp band; NO
 *     Fresnel — opacity is transmission, not reflection).
 *   • + foam·FOAM_ALPHA_WEIGHT + WATER_ALPHA_BASE, clamped to [WATER_ALPHA_FLOOR, 1].
 * The load-bearing property: for a FIXED water column (fixed vertical depth D) the alpha depends on the view
 * angle ONLY through the gentle bounded `view_lean` (≤ WATER_ALPHA_VIEW_LEAN) — never through a steep
 * Fresnel/slant term — so shallow water stays glassy and deep water stays opaque at EVERY yaw/pitch.
 * @param {number} vertical_depth rotation-invariant plumb-line through-water depth (blocks, ≥0)
 * @param {number} view_up surface→camera up-component |view.y| in [0,1] (1 = straight down, 0 = grazing)
 * @param {number} [foam] foam amount in [0,1] (0 for open water)
 * @returns {number} surface alpha in [WATER_ALPHA_FLOOR, 1]
 */
export function surface_alpha(vertical_depth, view_up, foam = 0, presence = WATER_SHALLOW_PRESENCE) {
  const depth_term =
    smooth(WATER_ALPHA_VDEPTH_START, WATER_ALPHA_VDEPTH_END, Math.max(0, vertical_depth)) * WATER_ALPHA_DEEP
  const view_lean = (1 - saturate(Math.abs(view_up))) * WATER_ALPHA_VIEW_LEAN
  const raw = view_lean + saturate(foam) * FOAM_ALPHA_WEIGHT + depth_term + WATER_ALPHA_BASE
  return Math.max(clampf(raw, WATER_ALPHA_FLOOR, 1), shallow_presence_floor(vertical_depth, presence))
}

/**
 * SHALLOW PRESENCE FLOOR (2026-07-07) — water at 1-2 block depth was nearly invisible —
 * the JS twin of the TSL presence floor: a ROTATION-INVARIANT minimum alpha that feathers in over the
 * first ~block of vertical depth so 1-2 block water always shows a visible surface tint, while the exact
 * waterline still meets the shore softly (no hard opacity rim) and depth-0 stays at the old behavior.
 * Deep water is untouched — the depth alpha ramp is far above this floor by VDEPTH_END.
 * @param {number} vertical_depth rotation-invariant plumb-line through-water depth (blocks, ≥0)
 * @param {number} [presence] the configured floor (defaults to the universal WATER_SHALLOW_PRESENCE)
 * @returns {number} minimum alpha in [0, presence]
 */
export function shallow_presence_floor(vertical_depth, presence = WATER_SHALLOW_PRESENCE) {
  return smooth(WATER_PRESENCE_FEATHER, WATER_PRESENCE_FULL, Math.max(0, vertical_depth)) * presence
}

/**
 * SHALLOW SKY FLOOR (2026-07-07, same directive) — the JS twin of the TSL `fresnel_eff`: over SHALLOW
 * water the Fresnel sky-mix fraction gets a minimum (WATER_SHALLOW_SKY_MIN) so the surface catches sky
 * colour even at non-grazing angles over a bright bed — the surface-presence half of the fix. The floor
 * feathers in with the presence ramp and FADES OUT with the deep alpha ramp, so deep-water colour (the
 * approved turquoise gradient) and every grazing framing (fresnel already ≥ the floor) are
 * byte-untouched. Rotation-invariant gate (vertical depth); the fresnel itself stays view-driven.
 * @param {number} fresnel_value the raw Schlick fresnel (fresnel_schlick output)
 * @param {number} vertical_depth rotation-invariant plumb-line through-water depth (blocks, ≥0)
 * @returns {number} the effective sky-mix fraction
 */
export function shallow_fresnel_floor(fresnel_value, vertical_depth) {
  const d = Math.max(0, vertical_depth)
  const zone =
    smooth(WATER_PRESENCE_FEATHER, WATER_PRESENCE_FULL, d) *
    (1 - smooth(WATER_ALPHA_VDEPTH_START, WATER_ALPHA_VDEPTH_END, d))
  return Math.max(fresnel_value, zone * WATER_SHALLOW_SKY_MIN)
}

// --- TSL node factory -----------------------------------------------------------------------------

/**
 * The handle the water material exposes so the wiring wave can drive time-of-day + accept the future
 * SSR reflection tap without this module reaching into the renderer.
 * @typedef {object} WaterMaterialNodes
 * @property {*} sun_direction `uniform(vec3)` world-space unit sun direction — set from the sky node's
 *   tod-driven sun so the sky reflection tracks day/night. Defaults to a noon-ish direction.
 * @property {(sun: import('three').Vector3) => void} set_sun_direction points the reflection sky at a sun.
 * @property {(dir: *) => *} sample_sky the keystone sky function, injected so reflection/ambient stay
 *   the single source of truth (defaults to a cheap analytic gradient if unset — see build note).
 * @property {*} color_node vec3 node = the final water RGB (reflection/refraction/foam composite).
 * @property {*} alpha_node float node = the water surface alpha (fresnel + foam + depth driven).
 * @property {*} roughness_node float node for `material.roughnessNode` (water vs foam).
 */

/**
 * Builds the water shading nodes for the liquid render class. Pure node construction — no renderer,
 * no side effects. The caller (terrain_material.js liquid branch) assigns `color_node` / `roughness_node`
 * onto its MeshStandardNodeMaterial and drives `set_sun_direction` each tod tick.
 *
 * @param {object} [opts]
 * @param {(dir: *) => *} [opts.sample_sky] the keystone sky node's `sample_sky(dir)` (sky_node.js) — the
 *   reflection + horizon-miss colour. If omitted a compact built-in analytic gradient is used so the
 *   material is standalone-testable; production wiring passes the real sky node for one source of truth.
 * @param {*} [opts.face_node] float node = the decoded quad face id (0..5). Vertical faces (0,1,4,5) are
 *   waterfall spans → they get the downward-scrolling cascade normals + agitation foam. When omitted,
 *   all water is treated as a flat lake surface (face 2). Supplied by terrain_material.js.
 * @param {*} [opts.flow_dir_node] optional vec2 node = world-XZ flow direction (river gradient, gen-side).
 *   Scrolls the ripples/foam downstream. Omitted ⇒ a gentle default drift (calm lake).
 * @param {import('three').Vector3} [opts.initial_sun] initial sun direction.
 * @returns {WaterMaterialNodes}
 */
export function create_water_material_nodes({
  sample_sky,
  face_node = null,
  flow_dir_node = null,
  initial_sun = new Vector3(0.3, 0.85, 0.4).normalize(),
} = {}) {
  const sun_direction = uniform(initial_sun.clone())

  // Fallback sky — DOME ONLY. [2026-07-05 THE SPOTLIGHT ROOT] The sun-mirror halo's actual source was
  // unclear until traced here. This fallback carried its own warm sun glow (pow(dir·sun,8)·0.4 — a ~30°
  // lobe), and because apply_water_to_material never passes the real sample_sky, THE SHIPPED WATER
  // USED THIS FALLBACK — its glow, mirrored by calm water, was the smooth bright ellipse
  // chased through three bloom-cap theories (it survived every cap because it was never bloom: a ~0.9
  // radiance smooth lobe on 0.05 water is a spotlight at ANY cap). The mirror is now HALOLESS: the
  // sun's presence on water is the STRUCTURED glint road (the "nice shader"), never a smooth mirror
  // glow. When the real-sky wiring lands (ENG-9), pass sky_node's sample_sky_dome — same principle.
  const default_sky = /** @param {*} dir */ (dir) => {
    const up = clamp(dir.y.mul(0.5).add(0.5), 0, 1)
    return mix(vec3(0.42, 0.48, 0.55), vec3(0.18, 0.42, 0.82), up)
  }
  const sky = sample_sky ?? default_sky

  // NIGHT DIM (2026-07-12) — at night, water was emitting light and needed to read darker than
  // the terrain; see sky_day_factor. The reflected sky above is a FIXED gradient written to EMISSIVE, so it
  // never dimmed with the coupled scene. This uniform (1 day → water_night_floor below the horizon, driven by
  // set_sun_direction off the live sun) scales the self-luminous sky terms (reflection + shallow shimmer +
  // foam) so the water mirrors the sky's real day/night level. Day ×1 = byte-identical to the tuned
  // look; night floors at water_sky_dim_factor's configured minimum (shipped 0.17) —
  // the reflection mostly collapses and the water falls toward its dark through-water body ⇒ darker than the
  // terrain, but never fully black (a bare ×0 lost the surface entirely).
  const sky_dim_u = uniform(1)

  // ── SHARED NOISE HELPERS (anti-tiling) — a 2D rotation + a hash VALUE NOISE, used by BOTH the base
  //    wave normal AND the glint/sparkle so the whole surface is world-continuous and NON-PERIODIC. A
  //    sine lattice tiles no matter how it's warped; hash value noise does not. Defined once up here so
  //    the base `slope_at` (below) can macro-warp its sample position with the same aperiodic field. ────
  const rot = /** @param {*} p @param {number} a @returns {*} */ (p, a) =>
    vec2(p.x.mul(Math.cos(a)).sub(p.y.mul(Math.sin(a))), p.x.mul(Math.sin(a)).add(p.y.mul(Math.cos(a))))
  // CHEAP arithmetic hash (NO transcendental — a `sin`-based hash × ~11 calls was ~4ms at 1440p dsf2).
  // fract/mul only: scramble the cell index, then fold. Dave Hoskins-style. @param {*} c @returns {*} [0,1]
  const hash2 = (/** @type {*} */ c) => {
    const p = c.mul(0.3183099).add(vec2(0.71, 0.113)).fract().mul(17)
    return p.x.mul(p.y).mul(p.x.add(p.y)).fract()
  }
  const vnoise = /** @param {*} p vec2 @returns {*} float [0,1] */ (p) => {
    const i = p.floor()
    const f = p.fract()
    const u = f.mul(f).mul(f.mul(-2).add(3)) // smootherstep-ish fade
    const a = hash2(i)
    const b = hash2(i.add(vec2(1, 0)))
    const cc = hash2(i.add(vec2(0, 1)))
    const d = hash2(i.add(vec2(1, 1)))
    return mix(mix(a, b, u.x), mix(cc, d, u.x), u.y)
  }
  // MACRO WARP — a very-low-freq (~90-block), large-amplitude hash-noise offset (world m). Applied to the
  // base position of EVERY wave field (calm shape + glint + sparkle) so the sine/lattice periodicity is
  // smeared aperiodically across a huge area — the diagonal corduroy dissolves even at a 100 m vista.
  // Two decorrelated vnoise taps → a large aperiodic 2D offset. Shared by the base wave slope AND the
  // glint, so the base sine ripples (reflection/refraction) are smeared aperiodically too — no off-road
  // corduroy. Worth the extra tap (the cheap arithmetic hash keeps it affordable).
  const mwp = positionWorld.xz.mul(GLINT_MACROWARP_FREQ)
  const macro_warp = vec2(vnoise(mwp).sub(0.5), vnoise(mwp.add(vec2(37.2, 11.5))).sub(0.5)).mul(GLINT_MACROWARP_AMP)

  // ── DISTANCE DETAIL ROLL-OFF (2026-07-03 NOTE #5: the wave pattern stayed visible from a distance)
  // — the high-frequency wave noise ALIASES into a visible grid/waffle when perspective compresses it far
  // away. The standard cure is a detail fade with camera distance: `detail_fade` 1 (near, full ripple
  // detail) → 0 (far, broad swell + sun-road only) over [FADE_NEAR, FADE_FAR]; `sparkle_fade` kills the
  // sparkle term (a close phenomenon that aliases into grid dots at distance) over a nearer window. Both
  // the BASE wave ripples AND the glint chop fade, so distant water reads as a smooth broad gradient.
  const cam_dist = cameraPosition.sub(positionWorld).length()
  const detail_fade = smoothstep(float(WATER_DETAIL_FADE_FAR), float(WATER_DETAIL_FADE_NEAR), cam_dist) // 1 near→0 far
  const sparkle_fade = smoothstep(float(WATER_SPARKLE_FADE_FAR), float(WATER_SPARKLE_FADE_NEAR), cam_dist)
  // `distance_rough` = (1 − detail_fade): 0 near → 1 far. It IS the high-freq variance the distance fade
  // removes, re-expressed as the amount of roughness to inject downstream — reused to (a) blend the base
  // octaves toward their anti-waffle ROTATED frame ONLY at distance (so close-up stays byte-identical to
  // the pre-fix ripple), (b) ramp in the broad swell, (c) widen the reflection cone, (d) broaden+dim the
  // sun road. 2026-07-04 owner REOPEN: the old single-term fade left the far surface optically flat (a
  // mirror); splitting chop (fades) from swell (rises) + this roughness conversion is the mirror cure.
  const distance_rough = detail_fade.oneMinus()

  // ── ANIMATED WAVE NORMALS — 2-octave scrolling perturbation in world-XZ (visual only) ────────────
  // Ported/adapted from WaterMaterial.ts two-phase flow: two phase-offset noise samples cross-faded by
  // a triangle weight so the scroll never pops at wrap. We have no baked FBM-gradient texture (their
  // `noiseA`), so we synthesize a cheap analytic gradient from two sine lattices — enough for calm-lake
  // shimmer + waterfall streaks without a texture fetch. Flat lakes: low amplitude (flatness IS the
  // optimization — no vertex displacement, per architecture). Vertical waterfall faces: the scroll
  // is forced DOWNWARD (world -y projected into the face plane) for the cascade look.
  // Directional drift (item #4b "water should flow in movement"). Ocean default = a MULTI-DIRECTIONAL
  // pair: the two wave octaves travel in DIFFERENT world-XZ headings (`flow` vs `flow_cross`), so the
  // surface reads as crossing open-ocean swell that is visibly moving, not a static sheet. When gen
  // supplies a river gradient (`flow_dir_node`) both align to it (downstream). FOLLOW-UP (deferred,
  // noted in the exit report): plumb the per-quad river flow DIRECTION from hydrology gen-side so
  // rivers drift downstream per-column instead of sharing this global default — out of scope this wave.
  const flow = flow_dir_node ?? vec2(0.6, 0.35) // primary drift heading (world XZ)
  const flow_cross = flow_dir_node ?? vec2(-0.3, 0.62) // secondary swell heading (crossing) for oceans
  const ph1 = fract(time.mul(FLOW_CYC))
  const ph2 = fract(time.mul(FLOW_CYC).add(0.5))
  const w2 = ph1.sub(0.5).abs().mul(2) // triangle cross-fade weight (0..1)

  // ── ANTI-WAFFLE (2026-07-04) — the water surface read as visibly repetitive/tiled — the crossed sines on the RAW axis-aligned
  //    frame lay an AXIS-ALIGNED lattice; at grazing distance where several periods fall in one pixel that
  //    lattice beats into the visible dot/waffle. Cure: progressively ROTATE the sample frame off-axis WITH
  //    DISTANCE by a RUNTIME angle `WAFFLE_ROT·distance_rough` (a single cos/sin per fragment, shared by
  //    both octaves). At `distance_rough=0` (close-up) the angle is 0 ⇒ cos=1,sin=0 ⇒ the frame is the
  //    ORIGINAL axis-aligned `positionWorld.xz+macro_warp` UNCHANGED — so the approved 5 m look
  //    is BYTE-IDENTICAL to the pre-fix ripple. Only distant water rotates (where the waffle lived), so the
  //    lattice can never align to the world/screen axes there. Cost: +1 cos +1 sin vs the pre-fix path
  //    (NOT a second octave evaluation) — cheap. macro_warp (the vnoise) is shared, evaluated once above.
  const waffle_ca = distance_rough.mul(0.6).cos()
  const waffle_sa = distance_rough.mul(0.6).sin()
  const base_xz = positionWorld.xz.add(macro_warp)
  // rotate the base frame by the runtime (distance-driven) angle; identity at close range.
  const rot_base = vec2(
    base_xz.x.mul(waffle_ca).sub(base_xz.y.mul(waffle_sa)),
    base_xz.x.mul(waffle_sa).add(base_xz.y.mul(waffle_ca))
  )
  /** @param {*} off vec2 scroll offset @returns {*} vec2 slope */
  const slope_at = (off) => {
    // macro-warp + distance-rotate the base position so the calm-lake ripple grid is aperiodic AND
    // waffle-free at range, yet byte-identical close up (rot_base = base_xz when distance_rough=0).
    const p = rot_base.add(off).div(RIPPLE_PERIOD)
    // octave 1
    const s1x = p.x.mul(6.28318).sin().mul(p.y.mul(3.14159).add(0.7).cos())
    const s1z = p.y.mul(6.28318).sin().mul(p.x.mul(3.14159).add(1.3).cos())
    // octave 2 (finer, quarter amplitude, offset lattice)
    const q = p.mul(2.3).add(vec2(3.71, 1.13))
    const s2x = q.x.mul(6.28318).sin().mul(0.25)
    const s2z = q.y.mul(6.28318).sin().mul(0.25)
    return vec2(s1x.add(s2x), s1z.add(s2z))
  }
  // ── PERSISTENT BROAD SWELL (2026-07-04) — distant water needed a slow undulating motion — a single
  //    LOW-frequency octave, rotated off-axis. RAMPED IN by `distance_rough` (×swell): ≈0 on close-up
  //    water (so the approved 5 m look is byte-untouched — the fix is inert near) and full on
  //    distant water, where it becomes the DOMINANT normal-tilt as the chop fades. So distant water rocks
  //    slowly to the horizon (drives the Fresnel/reflection/road) instead of freezing into a mirror.
  //    Handoff is seamless: over the wide band the chop fades exactly as this rises. Two decorrelated
  //    headings so it's a gentle crossing swell.
  const swell_p = positionWorld.xz.add(macro_warp).div(WATER_SWELL_PERIOD)
  const swell_t = time.mul(WATER_SWELL_SPEED / WATER_SWELL_PERIOD)
  const sw1 = rot(swell_p, 0.9)
  const sw2 = rot(swell_p, 2.7).add(vec2(5.3, 1.7))
  const swell_slope = /** @type {*} */ (
    vec2(
      sw1.x.mul(6.28318).add(swell_t).sin().mul(sw1.y.mul(3.14159).cos()),
      sw2.y.mul(6.28318).sub(swell_t.mul(0.8)).sin().mul(sw2.x.mul(3.14159).cos())
    )
      .mul(float(WATER_SWELL_AMP))
      .mul(distance_rough)
  )
  const off_a = flow.mul(ph1.div(FLOW_CYC))
  const off_b = flow_cross.mul(ph2.div(FLOW_CYC)).add(vec2(17.3, 9.1)) // crossing swell (multi-dir drift)
  // `*` cast: mix() over two vec2 nodes returns the general Node type, which loses the fluent vec2
  // `.x/.y` surface in the .d.ts (same reason terrain_material's ladders are `*`). Kept a vec2 in fact.
  // × distance fade of the HIGH-FREQ chop toward a small floor (no waffle at range), then ADD the
  // distance-ramped broad SWELL so distant water still undulates while close-up stays chop-only.
  const lake_fade = detail_fade.mul(1 - WATER_DISTANT_RIPPLE).add(float(WATER_DISTANT_RIPPLE))
  const chop_slope = mix(slope_at(off_a), slope_at(off_b), w2).mul(float(RIPPLE_AMP)).mul(lake_fade)
  const slope_lake = /** @type {*} */ (chop_slope.add(swell_slope))

  // Waterfall detection: vertical faces (0,1,4,5) are cascade spans. Their scroll is dominated by a
  // downward streak (fast vertical fract) + higher amplitude agitation. face 2 (top) & 3 (bottom) =
  // flat sheet. When face_node is absent, everything is the lake sheet.
  //
  // BELT-AND-SUSPENDERS (2026-07-03) — fixes flat chunks intermittently animating like waterfalls: key the
  // cascade on BOTH the decoded per-quad FACE ID *and* the GEOMETRIC (pre-perturbation) mesher normal.
  // `normalWorld` here is the raw face normal (material.normalNode input), NOT the wave-perturbed one —
  // so a top/bottom sheet (|n.y|≈1) can NEVER flip into cascade mode even if a merged quad's face-id
  // decode is ever ambiguous. Only faces that are BOTH side-id AND geometrically near-vertical cascade;
  // this makes the "flat water raking with white bands" symptom impossible from this material's side.
  const geo_vertical = normalWorld.y.abs().lessThan(float(0.5)) // horizontal sheet ⇒ |n.y|≈1 ⇒ false
  const is_vertical = face_node
    ? face_node
        .equal(float(0))
        .or(face_node.equal(float(1)))
        .or(face_node.equal(float(4)))
        .or(face_node.equal(float(5)))
        .and(geo_vertical)
    : null
  // ── CASCADE v3 — VERTICAL STREAKS (2026-07-07 owner: falls read as glass slabs crossed by a repeating
  // zigzag/chevron band lattice — the v2 sin(world_y) octaves WERE horizontal bands bent by a wobble). ──
  // Falling water is tall thin rivulets: TWO downward-scrolling octaves of Y-STRETCHED hash value noise
  // (FREQ_H ≫ FREQ_V ⇒ features ~1 m wide, ~9 m tall — a streak, never a band), at DIFFERENT fast speeds
  // (no lockstep march), each bent by a slow wobble keyed on its own SCROLLED y so the bends travel down
  // with the water. Face-agnostic horizontal coordinate: x+z varies along whichever world axis a ±x / ±z
  // face spans. Reuses the shared aperiodic vnoise (no sine lattice ⇒ no chevron at any scale).
  // TRAVELLING-WAVE SIGN (2026-07-03) — fixes inverted flow direction: the sample y is (world_y + SPEED·t), so
  // a constant-noise feature satisfies y = const − SPEED·t ⇒ it DESCENDS as t grows. The JS twin
  // cascade_streak_at mirrors this op-for-op (downward-scroll invariant pinned in the unit tests).
  const horiz = positionWorld.x.add(positionWorld.z) // varies across the face's horizontal extent
  const ya = positionWorld.y.add(time.mul(CASCADE_SPEED_A))
  const wob_a = ya.mul(CASCADE_WOBBLE_FREQ).add(horiz.mul(0.7)).sin().mul(CASCADE_WOBBLE_AMP)
  const octA = vnoise(vec2(horiz.mul(CASCADE_STREAK_FREQ_H).add(wob_a), ya.mul(CASCADE_STREAK_FREQ_V)))
  const yb = positionWorld.y.add(time.mul(CASCADE_SPEED_B))
  const wob_b = yb
    .mul(CASCADE_WOBBLE_FREQ * 1.7)
    .add(horiz.mul(0.9).add(2.1))
    .sin()
    .mul(CASCADE_WOBBLE_AMP)
  const octB = vnoise(
    vec2(
      horiz
        .mul(CASCADE_STREAK_FREQ_H * 2.3)
        .add(wob_b)
        .add(7.31),
      yb.mul(CASCADE_STREAK_FREQ_V * 1.9)
    )
  )
  const cascade_streak = octA.mul(0.6).add(octB.mul(0.4)) // 0..1 falling rivulet pattern
  const slope_fall = vec2(cascade_streak.sub(0.5).mul(float(RIPPLE_AMP * 3)), slope_lake.y)
  const slope = /** @type {*} */ (is_vertical ? is_vertical.select(slope_fall, slope_lake) : slope_lake)

  // Perturbed world normal. Lake surface base normal = up (blocky water tops are flat); the slope
  // tilts it. For vertical faces the mesher-decoded normal already points sideways — we keep the
  // material's own normalWorld as the base there and only add the streak as a small ripple, so we
  // don't fight the face orientation. Flatten factor 0.3 on XZ is the Fresnel-flatten input below.
  const lake_normal = vec3(slope.x.negate(), float(1), slope.y.negate()).normalize()
  const perturbed_normal = is_vertical
    ? is_vertical.select(normalWorld.add(vec3(slope.x, 0, slope.y).mul(0.4)).normalize(), lake_normal)
    : lake_normal

  // WORLD-SPACE view ray. NOTE: `positionWorldDirection` is WRONG here — it is
  // `positionLocal.transformDirection(modelWorldMatrix)` (correct only for a camera-centered background
  // box, e.g. sky_node), not the camera→fragment ray for a world-placed water surface. The real ray is
  // camera − fragment (both world-space). `cameraPosition` is a render-group uniform (Camera.js).
  const view_dir = cameraPosition.sub(positionWorld).normalize() // surface → camera
  const incident = view_dir.negate() // camera → surface
  // ENG-17 HASH-TERM ELEVATION GATE (2026-07-04): a STEEPER-than-master gate on ONLY the per-pixel, time-
  // seeded HASH glint sources (the sparkle field + the glint-normal jitter). It reaches 0 by ~22° down
  // (view.y ≥ HASH_GRAZE_STEEP 0.38), well before the master `graze_gate` starts closing, so the FLICKER
  // (the boil) dies the instant the view lifts off grazing — while the smooth road envelope fades gently
  // over the wider master band. = 1 below HASH_GRAZE_LOW (0.20), covering every eng15 grazing pose untouched.
  // WGSL-SAFE EDGES (per the ENG-16 shore-foam lesson: WGSL `smoothstep` is UNDEFINED for edge0 ≥ edge1,
  // and this Metal backend misbehaved on the reversed form): write the "1 at grazing → 0 at steep" gate as
  // FORWARD edges `smoothstep(LOW, STEEP, x).oneMinus()` — mathematically identical, WGSL-defined.
  const hash_gate = smoothstep(float(HASH_GRAZE_LOW), float(HASH_GRAZE_STEEP), view_dir.y).oneMinus()

  // ── FRESNEL on the FLATTENED normal (white-sheet cure, ported verbatim in spirit) ────────────────
  // ANTI-CHROME (2026-07-03) — reduces overly metallic reflectance: the reflection must dominate
  // ONLY at true grazing; at moderate view angles the water's own BODY COLOUR wins (deep blue-green, not
  // a mirror). Two dials: (a) FRESNEL_POWER > 5 steepens the ramp so mid-angles stay low-reflectance;
  // (b) REFLECT_MAX caps the peak reflectance below 1 so even grazing water isn't a pure chrome mirror.
  const n_flat = vec3(perturbed_normal.x.mul(0.3), perturbed_normal.y, perturbed_normal.z.mul(0.3)).normalize()
  const cos_t = clamp(view_dir.dot(n_flat), 0, 1)
  const one_minus = cos_t.oneMinus()
  const fresnel = float(WATER_F0).add(float(REFLECT_MAX - WATER_F0).mul(one_minus.pow(FRESNEL_POWER)))

  // ── SKY REFLECTION (the always-correct fallback; SSR deferred) ───────────────────────────────────
  // Reflect the incident ray about the perturbed normal and sample the keystone sky. At glancing angles
  // (high fresnel) this dominates → the lake reads as a mirror of the sky/sun. Overhead (low fresnel)
  // it's nearly absent → transparency + depth tint win. This is exactly the demo's SSR-miss path,
  // promoted to the whole reflection term.
  // ANTI-CHROME dial (c) ROUGHEN: a sharp sky sample reads as polished steel. Jitter the reflected dir
  // by a fraction of the base wave slope (a cheap roughness cone) so the reflected sky is slightly
  // soft/broken — water, not a mirror. `slope` is the base ripple slope (already computed above).
  // ENG-19 (1) REFLECT UNDULATION (see the ENG-19 knob header): a slow low-freq (3-8 m), distance-PERSISTENT
  // 2-octave value-noise slope folded into the reflection-driving normal ONLY — wanders the sun-road so the
  // ribbon breaks into wavy segments. Two decorrelated aperiodic vnoise taps (coarse + fine ×0.25), off-axis
  // rotated + slowly scrolled, centered ±; macro_warp keeps it non-tiling. Shape normal/alpha/foam untouched.
  // GATED by the SAME steep-down view-elevation gate as the glint: 1 at grazing (the sun-road →
  // ribbon breaks) → 0 at steep-DOWN, where there is no road to break AND its slow scroll would otherwise add
  // frame-to-frame motion on a pinned static camera (the frozen ENG-17 "static camera ⇒ static surface" law,
  // the eng15 close_steep pin). Reuses the frozen GLINT_GRAZE thresholds so it is byte-inert at every grazing
  // pose (view.y ≲ LOW ⇒ gate = 1). WGSL-safe forward edges (oneMinus of the reversed form).
  const graze_undu = smoothstep(float(GLINT_GRAZE_LOW), float(GLINT_GRAZE_STEEP), view_dir.y).oneMinus()
  const rut = time.mul(REFLECT_UNDU_SPEED)
  const ru_wp = positionWorld.xz.add(macro_warp)
  const ru_ax = vnoise(
    rot(ru_wp, 0.7)
      .mul(REFLECT_UNDU_FREQ_A)
      .add(vec2(rut, rut.mul(0.6)))
  ).sub(0.5)
  const ru_az = vnoise(
    rot(ru_wp, 2.1)
      .mul(REFLECT_UNDU_FREQ_A)
      .sub(vec2(rut.mul(0.8), rut))
  ).sub(0.5)
  const ru_bx = vnoise(
    rot(ru_wp, 1.3)
      .mul(REFLECT_UNDU_FREQ_B)
      .add(vec2(rut.mul(1.1), rut.mul(0.4)))
  )
    .sub(0.5)
    .mul(0.25)
  const ru_bz = vnoise(
    rot(ru_wp, 3.4)
      .mul(REFLECT_UNDU_FREQ_B)
      .sub(vec2(rut.mul(0.5), rut.mul(1.2)))
  )
    .sub(0.5)
    .mul(0.25)
  const refl_undu = vec2(ru_ax.add(ru_bx), ru_az.add(ru_bz)).mul(float(REFLECT_UNDU_AMP)).mul(graze_undu)
  const refl_jit = vec3(slope.x.add(refl_undu.x), float(0), slope.y.add(refl_undu.y)).mul(REFLECT_ROUGHEN)
  const refl_dir = reflect(incident, perturbed_normal.add(refl_jit).normalize())
  const sky_raw = sky(refl_dir).max(0) // the SHARP per-pixel sky sample (close-range reflection)
  // ── DISTANCE DILUTION = BLEND toward a SMOOTH MEAN SKY (2026-07-04 owner REGRESSION FIX) ──────────────
  //    PRIOR BUG (reverted this pass): dilution was a per-pixel hash JITTER of the reflected direction that
  //    GREW with distance (`rough_jit`, WATER_DISTANT_ROUGHEN). Jittering a SINGLE sky sample does NOT blur
  //    — it adds VARIANCE: each distant pixel randomly landed on bright sky vs dark, producing a violent
  //    white-on-navy boiling static field (measured). A jittered dice-roll is not an average.
  //    CORRECT: dilution must be an AVERAGE. LERP the sharp sample toward a SMOOTH mean-sky reflection —
  //    a mix of two colours has ZERO added per-pixel variance, so distant water reads as a soft haze
  //    gradient with no static. The mean-sky is `sky()` sampled at a STABLE, low-frequency, mildly-elevated
  //    direction: the horizontal VIEW heading tilted up by WATER_DISTANT_ROUGHEN (a fixed elevation bias) —
  //    per-pixel stable (view_dir varies smoothly across the surface, NO hash), so it can't flicker. This
  //    approximates the soft hemisphere a truly-rough water pixel integrates. The blend fraction ramps in
  //    with `distance_rough` × WATER_DISTANT_DESAT: 0 at the close-up (sharp sample kept byte-for-byte) →
  //    the diluted haze at the horizon. The broadened/dimmed sun ROAD is a SEPARATE additive term applied
  //    downstream (glint_color, post-mix), so it still shows through this smooth base.
  const mean_dir = vec3(view_dir.x, view_dir.y.max(0).add(WATER_DISTANT_ROUGHEN), view_dir.z).normalize()
  const mean_sky = sky(mean_dir).max(0) // SMOOTH low-frequency mean — no per-pixel noise ⇒ no static
  const sky_reflection_raw = mix(sky_raw, mean_sky, distance_rough.mul(WATER_DISTANT_DESAT))
  // ENG-19 (2) SPECULAR SOFT-SHOULDER on the MIRRORED SKY (see the ENG-19 header): the per-channel Reinhard
  // white-point `s/(1+s/CAP)` caps the reflected sun HALO (the mirror-road blowout) below SPEC_SHOULDER_CAP ≪
  // the sun disc — the "reflection dulling also applies to the mirrored sky" the brief asks. Dim sky (≪ CAP)
  // passes ~unchanged; FADED OUT by distance (mix→raw far) so the ENG-15-diluted far road keeps its swell
  // dynamics (frozen distant-undulation motion). The additive glint gets the SAME shoulder below.
  const sky_shouldered = sky_reflection_raw.div(sky_reflection_raw.div(float(SKY_MIRROR_SHOULDER_CAP)).add(1))
  const sky_reflection = mix(sky_shouldered, sky_reflection_raw, distance_rough)

  // ── DISPERSED SUN GLINT v2 (REOPENED: v1 was imperceptible — a clean white ellipse) ───────────
  // Root cause of v1's failure (debug-confirmed): v1 tested "does the REFLECTED ray hit the sun". For a
  // flat lake viewed from above, the reflected ray points at the HIGH sky, so it only aligned with a LOW
  // sun in a 1-pixel strip at the far horizon — the whole foreground had glint_lobe≈0 (no road reaching
  // the viewer). The fix is the classic ocean sun-glitter model: test the WAVE NORMAL against the
  // HALF-VECTOR H = normalize(view + sun). A facet glints when its normal ≈ H; with the amplified
  // glint-only normal MANY foreground facets tilt enough to qualify, so the road reaches the near field.
  //
  // (1) RAGGED, ANIMATED WAVE NORMAL — an AMPLIFIED (≫ RIPPLE_AMP), higher-frequency, animated copy of
  //     the wave normal, glint-only (the water SHAPE normal stays calm). Wave-normal noise carves the
  //     highlight into chunks that flicker in/out each frame. Base is the surface normal so side faces
  //     keep their orientation.
  //
  // ── ANTI-TILING (2026-07-03) — the shader read as repetitive, tiling as a diagonal corduroy pattern
  //    across wide water rather than lighting globally. The
  //    cure: build the glint wave normal from HASH VALUE NOISE taps (non-periodic), macro-warp every
  //    field's base position (`wpos`), hash the sparkle field, and low-freq amplitude-modulate it
  //    (`amp_mod`) — so the whole surface is world-continuous and reads as one aperiodic body, no grid.
  //    Helpers (rot/hash2/vnoise/macro_warp) are shared from the top of this fn (base normal uses them too).
  const gspt = time.mul(GLINT_NORMAL_SPEED)
  const wpos = positionWorld.xz.add(macro_warp) // macro-warped world XZ — feeds ALL wave octaves + sparkle
  // low-freq amplitude modulation: a slow, large-period HASH-noise field in [~0.44, 1.0] → calmer/rougher
  // zones (aperiodic — no tiling in the modulation itself).
  const amp_mod = vnoise(wpos.mul(GLINT_AMPMOD_FREQ)).mul(0.56).add(0.44)
  // GLINT WAVE NORMAL from HASH VALUE NOISE (the anti-corduroy — value noise is NON-PERIODIC, so unlike
  // the base crossed sines it never reads as a diagonal grid, even at a 100 m vista). The slope's two
  // components are two decorrelated animated vnoise taps (centered ±), off-axis rotated with different
  // scroll headings. (The cheap arithmetic hash keeps this affordable; see hash2.)
  const g_sx = vnoise(
    rot(wpos, 0.5)
      .mul(GLINT_NORMAL_FREQ)
      .add(vec2(gspt, gspt.mul(0.6)))
  )
    .sub(0.5)
    .mul(GLINT_NORMAL_SLOPE)
  const g_sz = vnoise(
    rot(wpos, 2.3)
      .mul(GLINT_NORMAL_FREQ)
      .sub(vec2(gspt.mul(0.9), gspt.mul(1.2)))
  )
    .sub(0.5)
    .mul(GLINT_NORMAL_SLOPE)
  const warp = vec2(g_sx, g_sz).mul(GLINT_WARP) // domain-warp for the sparkle field (below)
  // × detail_fade (NOTE #5): distant water loses the high-freq chop → the glint normal flattens toward
  // the broad surface, so the far waffle grid disappears while the near ripple detail is untouched.
  // × hash_gate (ENG-17): off grazing this jitter → 0 so the glint normal collapses to the smooth
  // perturbed_normal — no per-pixel time-varying carve into core/road ⇒ no boil at close-steep views.
  const glint_slope = vec2(g_sx, g_sz).mul(float(GLINT_NORMAL_AMP)).mul(amp_mod).mul(detail_fade).mul(hash_gate)
  const glint_normal = perturbed_normal.add(vec3(glint_slope.x, float(0), glint_slope.y)).normalize()
  //
  // (3) ROAD ENVELOPE — a proper anisotropic Blinn specular (NORMALIZED, so its scale is well-behaved,
  //     unlike v1's raw normal-space exp() which the debug showed collapsed to a horizon strip). The
  //     facet's alignment with the half-vector H = normalize(view + sun) is `ndoth`; `pow(ndoth, P)` is
  //     the highlight. ANISOTROPY (the road): stretch H's along-azimuth tolerance by squashing the
  //     along-axis component of the (H − N) miss BEFORE the dot, so the lobe is wide along the sun and
  //     thin across — a road pointing at the sun. Because H (down-forward view + low-forward sun) points
  //     up-and-forward, near-flat foreground facets align → the road REACHES the viewer (not just the
  //     horizon). This is a SOFT, broad weight now — it MODULATES the sparkle density, never hard-gates
  //     it to zero (v1 killed all the sparkles by multiplying a near-zero tight lobe).
  const half_vec = view_dir.add(sun_direction).normalize() // Blinn half-vector (view + sun)
  const sun_azimuth = vec2(sun_direction.x, sun_direction.z).normalize() // horizontal sun heading
  const ndoth = clamp(glint_normal.dot(half_vec), 0, 1) // facet↔sun specular alignment
  // Anisotropic alignment: re-form a stretched half-vector by pulling the along-azimuth miss toward 0
  // (the road tolerates along-sun misalignment far more than across). `across_only` keeps the across
  // component full; the along component is scaled down (ROAD_ELONGATE) so the specular stays high along
  // the sun for longer → a long road, thin sides.
  const miss = glint_normal.sub(half_vec)
  const along = miss.x.mul(sun_azimuth.x).add(miss.z.mul(sun_azimuth.y)) // signed misalignment along azimuth
  const road_h = half_vec
    .add(vec3(sun_azimuth.x, float(0), sun_azimuth.y).mul(along.mul(GLINT_ROAD_ELONGATE)))
    .normalize()
  const ndoth_road = clamp(glint_normal.dot(road_h), 0, 1)
  // ── DISTANCE BROADEN (2026-07-04 owner: the far sun must be "a wide, soft, diluted sun road… never a
  //    clean ellipse"). On distant water the glint normal flattens (chop faded) → a tight specular pow
  //    would paint a razor-sharp ellipse = a mirror-sun. Instead DIVIDE every specular exponent by
  //    (1 + BROADEN·distance_rough): far away the lobe widens into a broad soft glare (the aggregate
  //    statistics of a thousand unresolved glints), near it stays the crisp close-up read.
  const road_broaden = distance_rough.mul(WATER_DISTANT_ROAD_BROADEN).add(1).reciprocal()
  const road = ndoth_road.pow(float(GLINT_POWER_ACROSS).mul(road_broaden)) // per-facet sparkle carrier
  const core = ndoth.pow(float(GLINT_POWER_ALONG).mul(road_broaden)) // hot core → broadens far
  // ROAD REGION — the amplified normal makes SOME facet align with the sun on nearly every pixel, so
  // `road` above sparkles across the WHOLE surface (choppy-water look). To shape it into a sun ROAD that
  // fades to the sides, gate by a BROAD alignment of the CALM (un-jittered) base normal with the sun
  // half-vector: high where the base water faces between eye and sun (the road region — reaches the
  // viewer because H points up-forward), tapering off to the sides. A LOW exponent keeps it wide/soft,
  // never the tight horizon collapse of v1. Off-road water then keeps its dark body colour (flecks pop).
  // × road_broaden too (2026-07-04): the road WIDENS across at distance (the diluted glare spreads sideways).
  const road_region = clamp(perturbed_normal.dot(half_vec), 0, 1).pow(float(GLINT_ROAD_FALLOFF).mul(road_broaden))
  //
  // (2) DISCRETE SATURATED SPARKLES — a high-frequency ANIMATED field crushed by pow(SHARP) to a few
  //     dozen HOT points that flicker and travel with the waves. THRESHOLDED (not a soft field): the pow
  //     makes most of the field ≈0 and a few points ≈1. Gated by FRESNEL (sparkles live on reflective,
  //     sky-facing water — the debug's blue zones) and by the road weight (denser toward the sun).
  // ANTI-TILING: the sparkle is a HASH VALUE-NOISE field (non-periodic). Two decorrelated animated taps
  // (coarse + fine ×2.13), off-axis rotated + scrolled so flecks travel/twinkle; the product crushed by
  // pow(SHARP) leaves sparse HOT points that never tile. `amp_mod` thins calmer zones; the fine wave
  // slope `warp` makes flecks ride the ripple motion. `× sparkle_fade` (NOTE #5) kills the flecks beyond
  // ~mid range — sparkles are a close phenomenon that alias into grid dots at distance; far glitter is
  // then carried by the sun-road envelope (glint_tail/core) alone.
  const spt = time.mul(GLINT_SPARKLE_SPEED)
  const tw = vnoise(
    rot(wpos, 0.33)
      .mul(GLINT_SPARKLE_FREQ)
      .add(vec2(spt, spt.mul(0.6)))
      .add(warp.mul(0.5))
  )
  const tw2 = vnoise(
    rot(wpos, 1.379)
      .mul(GLINT_SPARKLE_FREQ * 2.13)
      .sub(vec2(spt.mul(1.3), spt))
      .add(warp.mul(0.8))
  )
  const sparkle = tw
    .pow(GLINT_SPARKLE_SHARP) // coarse sparse flecks (non-periodic)
    .mul(tw2.pow(GLINT_SPARKLE_SHARP - 3)) // × fine tap (breaks blobs, adds twinkle)
    .mul(float(GLINT_SPARKLE_GAIN)) // renormalize (value-noise peaks below 1 vs the old sine field)
    .mul(amp_mod) // low-freq amplitude zones (anti-tiling): calmer patches sparkle less
    .mul(sparkle_fade) // distance roll-off (NOTE #5): no aliased sparkle grid at range
    .mul(hash_gate) // ENG-17 elevation gate: kill the time-seeded flecks off grazing (the close-steep boil)
  // Only where the sun is up (sun.y>0). Composite (all gated by road_region → a SUN ROAD, dark to sides):
  //   • HOT SPARKLES = sparkle × road × road_region × STRENGTH — saturated flecks along the sun road.
  //     NO fresnel gate: specular sun light is bright regardless of view angle, so flecks fire on the
  //     DARK low-fresnel near water too (where they POP — v1's fresnel gate hid them on the white water).
  //   • HOT CORE = core × STRENGTH — a small blinding centre near perfect specular (smaller than v1).
  //   • DIM TAIL = road × road_region × TAIL — a faint sun-road sheen; kept LOW so it never washes the
  //     surface white (v1's tail painted the whole lake milky).
  const sun_up = clamp(sun_direction.y.mul(4), 0, 1)
  // DISTANCE DIM (2026-07-04 owner: the far sun road is "soft… its peak DROPS with distance"): the
  // broadened lobe spreads the same glints over more pixels, so per-pixel brightness must fall — else the
  // wide far road would read as a big bright smear. Scale by (1 − DIM·distance_rough). Near = full.
  const road_dim = distance_rough.mul(WATER_DISTANT_ROAD_DIM).oneMinus()
  const glint_hot = sparkle.mul(road).mul(road_region).mul(GLINT_STRENGTH) // sparkle_fade already dims these far
  const glint_core = core.mul(float(GLINT_STRENGTH * 0.28).mul(road_dim)) // softened + distance-dimmed core
  const glint_tail = road.mul(road_region).mul(float(GLINT_TAIL_STRENGTH).mul(road_dim))
  // STEEP-DOWN GATE (2026-07-04 ENG-16, tightened ENG-17): kill the whole glint on steep-DOWN views, where
  // the specular sun-road geometry collapses and the noisy glint normal only paints a boiling white static.
  // ENG-17 tightened STEEP 0.85 → 0.55 so the CLOSE-STEEP regime (pitch −0.80 ⇒ view.y 0.717) is HARD-shut,
  // not 17 %-leaking; 1 at grazing (view.y ≲ LOW 0.35) so the real sun road + every eng15 pose keep their
  // glint byte-for-byte. (The per-pixel HASH terms are ALSO killed earlier by hash_gate, above.)
  // WGSL-SAFE EDGES (ENG-17, per the ENG-16 shore-foam lesson — WGSL `smoothstep` is UNDEFINED for edge0 ≥
  // edge1): written as FORWARD edges `smoothstep(LOW, STEEP, x).oneMinus()`, identical to the reversed form.
  const graze_gate = smoothstep(float(GLINT_GRAZE_LOW), float(GLINT_GRAZE_STEEP), view_dir.y).oneMinus()
  const glint_sum = glint_hot.add(glint_core).add(glint_tail).mul(sun_up).mul(graze_gate) // additive specular (post-mix)
  // ENG-19 (2) SPECULAR SOFT-SHOULDER on the GLINT — the SAME white-point compressor + distance-fade as the
  // mirrored sky: caps the additive sun-road core (~9.5 peak) below CAP so it can't blow white, while dim
  // sparkle (≪ CAP) is untouched (the frozen close-up glitter keeps its live pop) and far glint passes through.
  const glint_shouldered = glint_sum.div(glint_sum.div(float(SPEC_SHOULDER_CAP)).add(1))
  const glint = mix(glint_shouldered, glint_sum, distance_rough)
  const glint_color = vec3(1.0, 0.95, 0.85).mul(glint) // warm sun-white sparkle contribution
  // NIGHT DIM: the reflected sky is a FIXED gradient (never darkens on its own) → scale it by the sky's
  // day/night level so the water mirrors the real sky (0 below the horizon ⇒ no night glow; day ×1 identity).
  const reflection = sky_reflection.mul(sky_dim_u) // (the glint is no longer folded into the sky term)

  // ── DEPTH TINT via the shared scene depth texture (through-water distance) ────────────────────────
  // The opaque solids already wrote depth (liquid renderOrder=1). Read the scene depth under this
  // fragment, convert both it and the water-surface depth to view-Z, and the gap is the metres of
  // water the view ray crosses. Refraction perturbs the sample UV by the ripple slope so the bed
  // wobbles. Beer-Lambert absorption + shallow→body mix gives the depth tint. Guarded so a bed AHEAD
  // of the surface (negative gap, e.g. thin edges) reads as shallow, never as garbage.
  // explicit grab texture (module top) — type-aligned to the render path so the depth copy validates.
  // `*` cast: our pinned three's `viewportDepthTexture` .d.ts declares 0-2 params, but the runtime
  // accepts the explicit grab-texture as the 3rd arg (used here for the type-aligned depth copy).
  const scene_depth_raw = /** @type {*} */ (viewportDepthTexture)(screenUV, null, water_scene_depth).r // non-linear device depth of the opaque bed
  const bed_view_z = perspectiveDepthToViewZ(scene_depth_raw, cameraNear, cameraFar)
  const surf_view_z = positionView.z // this fragment's view-space Z (negative, forward)
  // through-water distance ≈ |bed_view_z − surf_view_z|, clamped ≥0 (both are negative view-Z). This is
  // the SLANT path length along the VIEW RAY — it lengthens with grazing incidence (rotation-VARIANT).
  const water_depth = surf_view_z.sub(bed_view_z).max(0)
  // ── ENG-18 (2026-07-04): VERTICAL through-water depth — the ROTATION-INVARIANT bed depth. The vertical
  // component of the ray's water segment is `slant · |view.y|`; for a water column of true plumb-line depth
  // D, a ray at any angle hits the bed after slant = D/|view.y|, so slant·|view.y| = D exactly — identical
  // at every yaw/pitch. This is what drives the surface ALPHA below, so the transparent→opaque boundary is
  // pinned to the real water depth and CANNOT sweep with camera rotation (the beach-shot defect).
  const vertical_depth = water_depth.mul(view_dir.y.abs())
  // Deep alpha ramp (ENG-18, rotation-invariant) — computed here because the SHALLOW PRESENCE fix below
  // also fades its sky floor out by it (deep-water colour stays byte-identical past VDEPTH_END).
  const alpha_depth_t = smoothstep(float(WATER_ALPHA_VDEPTH_START), float(WATER_ALPHA_VDEPTH_END), vertical_depth)
  // ── SHALLOW-WATER PRESENCE (2026-07-07) — water at 1-2 block depth was nearly invisible (shader
  // too transparent) — see the knob block. Two rotation-invariant floors keyed on
  // vertical depth, feathered in over the first ~block (soft waterline, no opacity rim):
  //   • presence_floor — a minimum surface ALPHA (config `water.shallow_presence`, universal default)
  //     so a 1-2 block shelf always blends a visible body tint over the bed instead of vanishing.
  //   • fresnel floor (fresnel_eff below) — a minimum SKY-MIX fraction over shallow water, faded out by
  //     the deep ramp, so the surface catches sky colour even over bright sand at non-grazing angles
  //     (the raw anti-chrome fresnel is only ~0.02-0.04 there). Grazing views (fresnel already higher)
  //     and deep water (zone → 0) are byte-untouched. JS twins: shallow_presence_floor / shallow_fresnel_floor.
  const presence_ramp = smoothstep(float(WATER_PRESENCE_FEATHER), float(WATER_PRESENCE_FULL), vertical_depth)
  const presence_floor = presence_ramp.mul(water_presence_u)
  const fresnel_eff = fresnel.max(presence_ramp.mul(alpha_depth_t.oneMinus()).mul(WATER_SHALLOW_SKY_MIN))
  // SHALLOW SHIMMER (2026-07-12 owner: shallow water reads as STATIC dry sand — see WATER_SHALLOW_SHIMMER).
  // The sun glint is gated OFF at the top-down angle a shallow pool is viewed from, so shallow water had no
  // animated highlight at all. Drive a gentle moving glimmer from the ALREADY-animated base ripple `slope`
  // (calm-lake scroll — slow/atmospheric), gated to the SAME shallow zone as the sky floor (presence_ramp ×
  // (1−alpha_depth_t)) so it fades out before deep water ⇒ the endorsed deep optics stay byte-identical.
  const shimmer_zone = presence_ramp.mul(alpha_depth_t.oneMinus())
  const shimmer = slope.x
    .add(slope.y.mul(float(0.7)))
    .abs()
    .mul(float(WATER_SHALLOW_SHIMMER))
    .mul(shimmer_zone)

  // See-through→opaque ramp: smoothstep so water shallower than FADE_START stays readably transparent
  // (shoreline charm), then a fast dive to fully body-colour by TINT_DEPTH (by design).
  // NOTE (ENG-18): this COLOR tint stays on the SLANT `water_depth` — the colour fade-off was tuned
  // by eye and it is NOT the boundary defect (at the low shallow alpha the through-water colour can't read
  // as opaque blue). Only the ALPHA moved to vertical depth (see the `alpha` block below).
  // FIVE-WORLDS: the transmission window + body/shallow tint + extinction come from config-driven uniforms
  // (default = the constants ⇒ byte-identical DEFAULT water). configure_water_optics() updates them live.
  const tint_t = smoothstep(water_fade_u, water_tint_u, water_depth)
  const tint_base = mix(water_shallow_u, water_body_u, tint_t)
  const absorb = water_depth.mul(water_sigma_u).mul(float(-1)).exp() // vec3 exp(-sigma·depth) per channel
  // Refracted scene colour: sample the shared scene colour offset by the ripple slope, tinted by the
  // water body colour + Beer-Lambert absorption (the "looking THROUGH the water" term). With the
  // steepened sigma the `scene_color·absorb` bed contribution is gone by ~6-8 blocks; what remains is
  // the DARK residual body glow (tint_base × WATER_DEEP_FLOOR) — the opaque deep-water surface colour.
  const refract_uv = screenUV.add(vec2(slope.x, slope.y).mul(REFRACT_STRENGTH))
  const scene_color = viewportSharedTexture(refract_uv).rgb
  // NIGHT DIM (fixes near water reading PALE MILKY against dark night terrain — "not realistic"). The
  // transmitted bed term (scene_color·tint_base·absorb) already tracks the scene (dark at night), but the RESIDUAL
  // body glow (tint_base·water_deep_floor — the "opaque deep surface colour" that remains once the bed is fully
  // extinguished) is SELF-LUMINOUS scattered skylight inside the water volume: it was the ONE self-luminous water
  // term the 2026-07-12 pass missed (it dimmed reflection + shimmer + foam, not this), so at night the near/deep
  // water kept a bright teal glow the auto-exposure lifted into the "milky lake". Scale it by sky_dim_u (the SAME
  // sky_day_factor home terrain/water/falls already share — derive, don't copy): day ×1 = byte-identical, night ×0
  // ⇒ the water body falls to just the dark, scene-tracking transmitted bed — DARKER than the moonlit terrain, the
  // design law ("water should be even darker than the terrain"). The transmitted term is untouched.
  const through_water = scene_color.mul(tint_base).mul(absorb).add(tint_base.mul(water_deep_floor_u).mul(sky_dim_u))

  // ── TWO-PHASE FOAM: shoreline (shallow) + waterfall agitation ────────────────────────────────────
  // Shore foam: shallow through-water depth ⇒ near-white foam ring at the waterline.
  // SHORE FOAM v2 (2026-07-03 owner: at fully-shallow cells foam must NOT paint the whole surface white;
  // want a THIN organic waterline lick ~0.3 block with a noise-broken edge + soft alpha). The old
  // smoothstep(0.6, …) filled every shallow shelf solid white. Fixes: (a) a THIN depth band [0, ~0.3
  // block] so only the very waterline gets foam, not a flat 1-block shelf; (b) BREAK the band with an
  // animated world-space noise so it's a lick, not a fill; (c) cap the peak so it never fully whites out.
  // ANTI-WAFFLE (2026-07-04 ENG-16): foam_noise WAS a separable crossed-sine `sin(x)·cos(y)` — a 2D
  // LATTICE. Wherever `shore` fires over a wide surface (here: a large water body whose through-water depth
  // reads shallow), that lattice paints the mid/far cross-hatch WAFFLE (proven: forcing foam off removed the
  // waffle entirely; a forward-edge/clamp depth ramp did NOT, so foam is firing legitimately here and the
  // lattice IS the foam field). Cure = the SAME one that made the glint corduroy-free: build the foam noise
  // from HASH VALUE NOISE (non-periodic — no grating at any scale), two decorrelated animated taps, so the
  // waterline foam is an organic lick that never reads as a grid. Uses the shared vnoise/rot helpers.
  const foam_wp = positionWorld.xz.mul(FOAM_NOISE_FREQ)
  const foam_nt = time.mul(FOAM_NOISE_SPEED)
  const foam_noise = clamp(
    vnoise(rot(foam_wp, 0.6).add(vec2(foam_nt, foam_nt.mul(0.6)))).mul(
      vnoise(
        rot(foam_wp, 2.2)
          .mul(1.7)
          .sub(vec2(foam_nt.mul(0.8), foam_nt))
      )
        .mul(0.6)
        .add(0.7)
    ),
    0,
    1
  )
  // Thin waterline band + noise break, peaked at SHORE_FOAM_MAX (< 1 so shallow water keeps a blue read).
  // WGSL-SAFE EDGES (2026-07-04 ENG-16): the depth ramp was a REVERSED-edge smoothstep(SHORE_FOAM_DEPTH,
  // 0.02, depth) (edge0 > edge1). WGSL's `smoothstep` intrinsic is UNDEFINED for edge0 ≥ edge1 (this Metal
  // backend returned a nonzero value even far past edge0). Rewritten to FORWARD edges `smoothstep(0.02,
  // DEPTH, depth).oneMinus()` — mathematically the intended "1 at waterline → 0 by SHORE_FOAM_DEPTH" but
  // WGSL-defined. (The JS twin `shore_foam` already used the forward-safe form.) This is a correctness
  // hardening; the WAFFLE itself was the `foam_noise` lattice above, not the edge direction — see that block.
  const shore = smoothstep(float(0.02), float(SHORE_FOAM_DEPTH), water_depth)
    .oneMinus()
    .mul(foam_noise.pow(FOAM_NOISE_SHARP))
    .mul(SHORE_FOAM_MAX)
  // Waterfall foam v3 (2026-07-07): an AERATED whitewater sheet — a falling stream entrains air, so it
  // is foam-like and mostly occluding, never a glass slab. Base AERATION whiteness + SHARPENED streak
  // crests (smoothstep window ⇒ discrete bright falling rivulets, not a wash), capped below 1 so streak
  // contrast stays readable. On fall faces this REPLACES the shore foam: a thin fall sheet against rock
  // reads a tiny water_depth, so `shore` fires across the WHOLE fall — added on top of the aeration it
  // saturated foam to ~1 and the fall read as a uniform MILK SLAB (first-cut defect, pixel-confirmed).
  // (A per-face top-lip/base Y-gradient would need the quad's vertical extent — no such varying exists;
  // the crest rivulets + the flat-sheet shore foam at the plunge line carry the accents.)
  const crest = smoothstep(float(CASCADE_CREST_LO), float(CASCADE_CREST_HI), cascade_streak)
  const aer = clamp(crest.mul(CASCADE_FOAM_GAIN).add(CASCADE_AERATION), 0, CASCADE_FOAM_MAX)
  const foam_amt = is_vertical ? is_vertical.select(aer, clamp(shore, 0, 1)) : clamp(shore, 0, 1)

  // ── COMPOSITE ────────────────────────────────────────────────────────────────────────────────────
  // body = mix(refracted-through-water, sky-reflection) by Fresnel. The sun glint is ADDED on top of
  // the body (NOT inside the Fresnel mix): a specular sun highlight is additive light reaching the eye,
  // independent of the sky-vs-refraction blend — so the sparkle survives on the dark, low-Fresnel near
  // water where it reads best (folding it into `reflection` scaled it by mix(...,fresnel≈0.05) → gone).
  // Foam paints over the top last (whitewater occludes the specular).
  // fresnel_eff = the raw fresnel with the SHALLOW sky floor (see the presence block above) — deep and
  // grazing water get exactly the raw fresnel, shallow non-grazing water catches a minimum of sky.
  // NIGHT DIM on the two remaining self-luminous terms: the shallow sky-sheen `shimmer` and the white `foam`
  // are both sky-lit surface features (not scene-lit), so they scale with the sky's day/night level too — else
  // a bright blue shimmer / white foam-lick would keep glowing on dark night water. The sun `glint_color` is
  // already gated by `sun_up` (dies with the sun), and `through_water` tracks the scene, so neither is dimmed
  // here. Day ×1 = byte-identical; night ×0 ⇒ shimmer + foam go dark with the surface.
  const body = mix(through_water, reflection, fresnel_eff)
    .add(glint_color)
    .add(vec3(0.55, 0.78, 1.0).mul(shimmer).mul(sky_dim_u))
  const with_foam = mix(body, vec3(...FOAM_COLOR).mul(sky_dim_u), foam_amt)
  // Alpha: opaque where the bed is DEEP; GLASSY-CLEAR over shallow water. The bed is drawn BEFORE water
  // (renderOrder=1), so it lives in the framebuffer — alpha<1 bleeds it through the blend regardless of the
  // `through_water` tint. Deep water is driven to alpha 1.0 to fully occlude the bed (no visible deep
  // depth); shallow water reads see-through.
  // 2026-07-03 NOTE #4 (shallow water read too opaque/murky-solid — shallows must be glassy-clear with colour):
  // the base constant + floor were LOWERED (WATER_ALPHA_BASE 0.28→, WATER_ALPHA_FLOOR 0.42→) so a
  // near-perpendicular view over 0-4-block water reads glassy (the blue tinge + bed, not milk). Foam alpha
  // stays SOFTENED (×FOAM_ALPHA_WEIGHT) so a waterline lick is translucent, not a frosted slab.
  //
  // ── ENG-18 (2026-07-04 owner: transparent band → opaque blue along a boundary that SWEEPS with rotation) ─
  // The depth term now keys on the ROTATION-INVARIANT `vertical_depth` over a WIDE, SOFT ramp
  // [VDEPTH_START, VDEPTH_END] — so the transparent→opaque transition is pinned to the real plumb-line bed
  // depth and is identical at every yaw/pitch (the boundary can no longer sweep). The raw `fresnel` (a steep
  // (1−cosθ)^7 whose iso-line moved with incidence) is REMOVED from alpha and replaced by a MILD FIXED
  // view-lean (`(1−|view.y|)·VIEW_LEAN`, a gentle linear grazing wash — not a sharp Fresnel band). Opacity is
  // a transmission/depth property, not a reflection one, so Fresnel no longer belongs here (it still drives
  // the COLOUR mix `mix(through_water, reflection, fresnel)`, where a grazing sky sheen is correct). Deep
  // water still reaches alpha 1.0 (VDEPTH_END → alpha_depth_t 1 × WATER_ALPHA_DEEP) at every angle; shallow
  // stays at the glassy floor at every angle. Both frozen laws (near-shore glassy, deep dark) hold, now
  // rotation-invariant.
  // (alpha_depth_t is computed up at the vertical-depth block — the shallow sky floor reuses it.)
  const view_lean = view_dir.y.abs().oneMinus().mul(WATER_ALPHA_VIEW_LEAN) // mild, soft grazing wash (no band)
  // SHALLOW PRESENCE floor (2026-07-07) + CASCADE alpha floor (v3: an aerated falling sheet occludes —
  // never a glass slab). Both are max() floors: they only ever RAISE the shallow/fall end; deep water
  // (alpha → 1) and every already-opaque regime are byte-untouched. JS twin: surface_alpha.
  const fall_alpha_floor = is_vertical ? is_vertical.select(float(CASCADE_ALPHA_MIN), float(0)) : float(0)
  const alpha = clamp(
    view_lean.add(foam_amt.mul(FOAM_ALPHA_WEIGHT)).add(alpha_depth_t.mul(WATER_ALPHA_DEEP)).add(WATER_ALPHA_BASE),
    WATER_ALPHA_FLOOR,
    1
  )
    .max(presence_floor)
    .max(fall_alpha_floor)

  // roughness: mirror-smooth water, matte foam.
  const roughness_node = mix(float(WATER_ROUGHNESS), float(FOAM_ROUGHNESS), foam_amt)

  return {
    sun_direction,
    set_sun_direction(sun) {
      sun_direction.value.copy(sun)
      // NIGHT DIM: collapse the fixed-sky reflection (+ shimmer + foam) below the horizon so the water stops
      // reading as self-luminous at night. 1 across daylight (day byte-identical) → floored at water_night_floor
      // below the horizon (a bare 0 sank night water to pure black — see water_sky_dim_factor).
      sky_dim_u.value = water_sky_dim_factor(sun.y)
    },
    sample_sky: sky,
    color_node: vec3(with_foam).toVar('water_color'),
    alpha_node: alpha,
    roughness_node,
  }
}

/**
 * Applies the NG2-C water shading onto a liquid-class MeshStandardNodeMaterial — the single home for
 * how water plugs into the terrain material (terrain_material.js's liquid branch is just one call).
 * Water is NOT earth: the view-dependent composite goes to EMISSIVE (a diffuse-albedo N·L multiply
 * would wrongly darken the reflection); colorNode albedo → black (no double-count); alpha carries the
 * surface alpha; roughness → the water/foam field. The per-face table, vertex AO and sun-leak gate the
 * caller builds for earth are all bypassed for water. Stashes `set_water_sun` on userData for tod wiring.
 *
 * WORLD-CONTINUOUS LIGHT (2026-07-03) — fixes the water shader rendering per-block instead of globally:
 * the raw voxel `brightness` scalar carries PER-QUAD / per-corner light steps, so adjacent greedy-merged
 * water rectangles (each with its own corner light nibble) read as visible brightness rectangles across a
 * wide surface. Fix: the water surface is lit WORLD-CONTINUOUSLY — open/lit water takes a CONSTANT
 * illumination (the sun/sky already light it via Fresnel + body colour + the sun-road glint, all
 * world/view-driven; the voxel light nibble adds nothing on open water). `brightness` is kept ONLY as a
 * BROAD cave/surface SWITCH: a smoothstep maps anything reasonably lit → 1.0 (so all the merged-quad
 * differences in the lit range collapse to one flat value = no rectangles), and only genuinely dark
 * cave/overhang water (brightness ≈ the ambient floor) dims toward WATER_CAVE_MIN. The switch is a
 * smoothstep, so even the cave transition is gradual — no hard per-quad step survives anywhere.
 * @param {import('three/webgpu').MeshStandardNodeMaterial} material the liquid material (mutated)
 * @param {object} ctx
 * @param {*} ctx.face_node float node = decoded quad face id (0..5) — vertical faces get the cascade.
 * @param {*} ctx.brightness float node = the voxel sun/block-light scalar (used only as a broad cave switch).
 * @param {*} ctx.emission_node vec3 node = registry block emission (added through, usually 0 for water).
 */
export function apply_water_to_material(material, { face_node, brightness, emission_node, simple = false }) {
  // [MOBILE SHADER DIET D5] LOW builds the FLAT far-shell-style near-water — one body/shallow tint + a
  // plain up-normal fresnel sky lift + a soft alpha, with ZERO screen/depth taps and none of the
  // caustics/foam/refraction/glint/detail chain (the ~56 KB water fragment's bulk). Near-water then reads
  // as one continuous flat sheet with the flat translucent far-shell water it abuts. MEDIUM/HIGH unchanged.
  if (simple) return apply_simple_water_to_material(material, { brightness, emission_node })
  const water = create_water_material_nodes({ face_node })
  material.userData.set_water_sun = water.set_sun_direction
  material.colorNode = vec4(vec3(0, 0, 0), water.alpha_node)
  // Broad cave switch: lit water (brightness ≳ WATER_LIT_HIGH) → 1.0 constant (kills merged-quad
  // rectangles); dark cave water (≲ WATER_LIT_LOW) → WATER_CAVE_MIN. Gradual smoothstep between.
  const water_light = mix(
    float(WATER_CAVE_MIN),
    float(1),
    smoothstep(float(WATER_LIT_LOW), float(WATER_LIT_HIGH), brightness)
  )
  material.emissiveNode = water.color_node.mul(water_light).add(emission_node)
  material.roughnessNode = water.roughness_node
}

/**
 * [MOBILE SHADER DIET D5] Flat far-shell-style near-water for the LOW tier — a single body/shallow tint,
 * a plain flat-up-normal Schlick fresnel sky lift, and a soft alpha. No animated ripple, no glint/foam/
 * caustics/refraction, no screen-color or scene-depth taps — so the ~56 KB water fragment collapses to a
 * handful of nodes. The look matches the flat translucent far-shell water it borders (one continuous
 * sheet). Albedo stays black + the look lives in emissive, exactly like the full path, so the liquid
 * class's WaterLightingModel (zero stock lighting) is unchanged. Visual-only. @param {import('three/webgpu').MeshStandardNodeMaterial} material
 * @param {{ brightness: *, emission_node: * }} p
 */
function apply_simple_water_to_material(material, { brightness, emission_node }) {
  material.userData.set_water_sun = () => {} // no sun-road at LOW; keep the pool_renderer hook a safe no-op
  const up = vec3(0, 1, 0)
  const view_dir = /** @type {*} */ (cameraPosition.sub(positionWorld)).normalize()
  const ndotv = /** @type {*} */ (up.dot(view_dir)).max(float(0)) // 1 looking straight down, 0 grazing
  const fresnel = float(1).sub(ndotv).pow(float(FRESNEL_POWER)).mul(float(REFLECT_MAX))
  const body = vec3(WATER_BODY_COLOR[0], WATER_BODY_COLOR[1], WATER_BODY_COLOR[2])
  const shallow = vec3(WATER_SHALLOW_COLOR[0], WATER_SHALLOW_COLOR[1], WATER_SHALLOW_COLOR[2])
  const sky_tint = vec3(0.5, 0.62, 0.8) // a flat sky-blue the surface leans toward at grazing incidence
  const surf = /** @type {*} */ (mix(/** @type {*} */ (mix(body, shallow, ndotv)), sky_tint, fresnel))
  // Broad cave switch (same shape as the full path): lit open water → ~1.0, deep cave water → CAVE_MIN.
  const water_light = mix(
    float(WATER_CAVE_MIN),
    float(1),
    smoothstep(float(WATER_LIT_LOW), float(WATER_LIT_HIGH), brightness)
  )
  const alpha = clamp(
    float(WATER_ALPHA_BASE)
      .add(float(0.55))
      .add(fresnel.mul(float(0.4))),
    float(WATER_ALPHA_FLOOR),
    float(1)
  )
  material.colorNode = vec4(vec3(0, 0, 0), alpha)
  material.emissiveNode = surf.mul(water_light).add(emission_node)
  // No roughnessNode: WaterLightingModel runs no specular, so roughness has no consumer at LOW.
}
