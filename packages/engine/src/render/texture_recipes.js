// Block-texture recipe set (data) for texture_baker.js — the atlas layer order IS this array order
// (deterministic). Colours authored here, independent of the registry's flat map_color. Split out of
// the baker so the engine (noise/ops/bake) and the content (recipes) each stay a single responsibility.
//
// PALETTE — "Conquest" mood: REALISTIC OLD-SCHOOL DARK FADED. Desaturated earthy
// medieval tones, moody greens/browns, aged/gritty — nothing candy-bright. Chroma is humble but VALUE
// contrast + mottling stay rich (faded-sophisticated, not faded-washed). grass=mossy, dirt=dark loam,
// sand=muted tan, stone=cold weathered gray, wood=aged dark timber. Macro tint (terrain_tint.js) rides
// ON TOP of this base. `blocks` maps a recipe to the registry block(s) that sample it (default [name]).
//
// ANTI-STRIPE (fixes directional banding): ground TOP faces use ISOTROPIC fBm + clumps, NO vertical ramp
// (its per-tile Z-gradient tiled into horizontal bands). `variants`/`rotations` break per-cell repeat;
// all noise wraps mod freq ⇒ seamless under hardware Repeat. See texture_appeal bench + the autocorr probe.

import { FLORA_RECIPES } from './texture_recipes_flora.js'
import { TREE_RECIPES } from './texture_recipes_trees.js'
import { GATHER_RECIPES } from './texture_recipes_gather.js'

/** @typedef {import('./texture_baker.js').Recipe} Recipe */

/** @type {Recipe[]} */
export const RECIPES = [
  {
    // GRASS TOP: flat MOSSY-green base + low-freq MACRO value clumps (big shaded/lit forms), isotropic
    // fBm, mid dark/light clumps, CLUSTERED blade-speckle. Rich value contrast, humble chroma. 6 variants.
    // [2026-07-05 owner] GROUND↔SPRITE BLEND ("grass blocks don't blend correctly with the grass sprites…
    // ground should be better for seamless effect"): the sprites' blade BODY is [70,102,52] (grass_tuft)
    // and their bases are darkened toward turf shadow by the material blade_grad — but the top face was a
    // brighter [86,116,62] mossy, so where thinning grass exposes bare top there was a MATERIAL STEP. The
    // base + macro clumps are re-anchored onto the sprite-body green family so bare top reads as the same
    // sward the blades grow from (thinning grass, not a switch), and a straw blade-tip speckle echoes the
    // sprites' dry tips so the texture stays continuous sprite→bare.
    // [D159/ENG-22 2026-07-05 REALISM PASS] Re-cut to the Conquest MUTED-OLIVE band (brief §PER-MATERIAL
    // GRASS top #6b7245→#828a55) + the COMPOSITION LAW: the baked albedo is DESATURATED olive (chroma
    // pulled ~0.19→~0.12, base lifted toward khaki so R≈G) so ENG-1's macro tint (climate K + TURF_RGB)
    // owns the biome GREEN — no more double-colour mud where the tint multiplies a saturated green base.
    // BALANCE vs the 2026-07-05 sprite-blend law (bare top must read as the sward the blades grow from):
    // NOT pushed to neutral grey (that would re-open the top↔blade material step), but to a desaturated
    // OLIVE that stays in the blade-body family while the tint carries the green. Multi-scale: MACRO
    // weathered blotches (brown dry-patch #6b5a3e per brief) widened across variants (the atlas-layer
    // hash fold makes each of the 6 read as different weathering, not a re-tint) UNDER the fine fbm grain,
    // + the new `ao` crevice-darkening for depth (value spreads wide, hue stays put).
    // [2026-07-12, verified against a top-down screenshot: the grass texture read too repetitive and not
    // uniform enough for a global terrain gradient, compared to Veloren] TILE-CALM PASS: every contrast op below was
    // authored loud enough that a tiled meadow reads as "the same mottled tile repeated" — the per-tile
    // pattern out-shouts ENG-1's macro gradient (terrain_tint.js) riding on top. `strength`/`amp`/
    // `density`/`darken` cut to ~45-60% of their prior value on every op (threshold/soft/freq/bias left
    // alone — those are SHAPE/coverage, not loudness) so the tile calms toward Veloren's near-uniform
    // per-block read without going flat-plastic; the macro gradient (now also strengthened, see
    // terrain_tint_data.js GRASS_GRADIENT_LEVELS) is what should carry large-scale variety from here.
    // [2026-07-12 owner clarified: "lack of connected textures to form ground gradients instead of
    // repeating the same block everywhere"] CONNECTED-PATCH PASS: added 4 baked `rotations` (the SAME
    // free bake-time remap dirt/sand/stone already use — texture_baker.js `rotate_buffer_90`), so
    // terrain_material.js can pick a LOW-FREQ world-XZ PATCH (terrain_texture_variant.js — same "coarse
    // bucket hash" as terrain_leaf.js's CANOPY_VARIETY) for the phase-variant, giving blocks connected
    // patches that drift into their neighbours, while an INDEPENDENT per-block rotation hash still
    // decorrelates individual tiles WITHIN one patch (a shared variant with zero rotation variety would
    // read as one stamped tile repeated — was byte-identical no-rotation reasoning below this comment
    // block, now superseded: coherence needs the per-block breakup rotation supplies). 6 phase × 4
    // rotation = 24 layers (was 6); texture_baker.test.js re-baselined for the new atlas layer count.
    name: 'grass',
    variants: 6,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [86, 112, 62] },
          { pos: 1, rgb: [86, 112, 62] },
        ],
      }, // [D177] Fixes a sprite/floor green-yellow colour mismatch — BLADE-FAMILY green: the ground anchors to the blade-body colour so tufts root in same-coloured sward; the tint multiplies BOTH so they stay agreed
      { op: 'clumps', freq: 2, octaves: 2, rgb: [58, 82, 46], threshold: 0.42, soft: 0.4, strength: 0.3 }, // MACRO shade (rooty green-dark) — calmed 0.56→0.3
      { op: 'clumps', freq: 2, octaves: 2, rgb: [118, 138, 88], threshold: 0.58, soft: 0.4, strength: 0.24 }, // MACRO faded-lit (green family) — calmed 0.42→0.24
      { op: 'clumps', freq: 3, octaves: 3, rgb: [116, 96, 62], threshold: 0.66, soft: 0.3, strength: 0.2 }, // WEATHERED dry-earth patches (brown), widen-per-variant — calmed 0.34→0.2
      { op: 'fbm', freq: 3, octaves: 4, amp: 0.08 }, // multi-scale isotropic mottle — calmed 0.14→0.08
      { op: 'clumps', freq: 4, octaves: 3, rgb: [70, 74, 52], threshold: 0.55, soft: 0.24, strength: 0.26 }, // mid dark moss — calmed 0.48→0.26
      { op: 'clumps', freq: 5, octaves: 3, rgb: [150, 152, 110], threshold: 0.6, soft: 0.22, strength: 0.18 }, // mid dry-grass — calmed 0.3→0.18
      { op: 'cluster_speckle', cluster_freq: 5, density: 0.28, darken: 0.18, rgb: [66, 70, 48] }, // grouped dark blade-roots — calmed density 0.42→0.28, darken 0.32→0.18
      { op: 'cluster_speckle', cluster_freq: 6, density: 0.2, darken: 0.14, rgb: [168, 162, 112] }, // grouped straw blade-tips (echo sprite dry tips) — calmed density 0.3→0.2, darken 0.24→0.14
      { op: 'ao', freq: 5, octaves: 3, amp: 0.11, bias: 0.46 }, // crevice depth (contact grime in the low grain) — calmed 0.16→0.11 (kept higher-relative than the rest: depth cue, not a pattern tell)
      // [D177 — order fix: was FIRST in ops, every later op painted over it] blade-green tip stipple LAST
      { op: 'speckle', freq: 9, density: 0.2, rgb: [88, 118, 64] }, // calmed density 0.34→0.2
    ],
  },
  {
    // GRASS SIDE (faces 0,1,4,5): dark-loam body + irregular grass lip on top. Rim stays on the TOP edge
    // ⇒ NO rotation (rotating moves the lip to a side). Rim is feather-softened + noise-broken (was a
    // hard 1px line = grid); body gets the same organic mottle + clustered gravel as dirt. 4 rim variants.
    // [D159/ENG-22 REALISM] Side reads "cut/exposed" (brief §TOP-vs-SIDE): dirt body in the muted warm-
    // brown band (#63523c→#52422f) + stronger VERTICAL edge-darkening (border_darken) so the riser looks
    // recessed, weathered grit specks, AO crevices, and an IRREGULAR (noise-broken) rooty grass drip on
    // the top edge. Rim stays olive-desaturated (tint greens it, same law as the top).
    name: 'grass_side',
    variants: 4,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [96, 82, 60] },
          { pos: 1, rgb: [80, 66, 47] },
        ],
      }, // muted warm loam, gentle up-cue
      { op: 'clumps', freq: 2, octaves: 2, rgb: [66, 54, 38], threshold: 0.46, soft: 0.4, strength: 0.5 }, // MACRO strata shade
      { op: 'fbm', freq: 4, octaves: 4, amp: 0.13 },
      { op: 'clumps', freq: 3, octaves: 3, rgb: [72, 58, 40], threshold: 0.54, soft: 0.28, strength: 0.42 },
      { op: 'cluster_speckle', cluster_freq: 4, density: 0.32, darken: 0.3 }, // grit specks
      { op: 'ao', freq: 6, octaves: 3, amp: 0.2, bias: 0.5 }, // crevice depth
      { op: 'border_darken', width: 3, amount: 0.22 }, // exposed-cut vertical edge recess
      // Owner meadow-ref pass: rim deepened toward dark rooty moss so a terrace riser under dense flora
      // reads as the sward's shadow-edge, not a bright green lip over bare dirt (secondary to the humid
      // TURF term in terrain_tint.js). D159: desaturated olive-rooty so the tint greens it, not the bake.
      { op: 'grass_rim', rim_rgb: [88, 96, 66], base_h: 5, jitter: 5, feather: 3, freq: 9 }, // muted rooty rim, wider jitter = irregular drip
    ],
  },
  {
    // DIRT = DARK LOAM: near-flat base + low-freq MACRO value clumps (light/dark earth, shift per variant),
    // strong isotropic fBm, wide mid clumps, CLUSTERED gravel. Wide value range from the clumps, not raw
    // count ⇒ 2 phase × 4 rotations = 8 tiles a tiled floor never repeats ("flat brown squares" fix).
    // [D159/ENG-22 REALISM] Muted warm-brown band (brief #6e5a41→#574636): base lifted to a warmer muted
    // loam, MACRO clod blotches widened per-variant (different weathering per tile, not a re-tint), fine
    // fbm + clumps for VALUE spread, grouped grit/stone flecks, + AO crevices between clods. 2 phase × 4
    // rot = 8 tiles a floor never repeats.
    name: 'dirt',
    variants: 2,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [104, 84, 61] },
          { pos: 1, rgb: [94, 74, 52] },
        ],
      }, // muted loam, gentle up-cue
      { op: 'clumps', freq: 2, octaves: 2, rgb: [69, 55, 40], threshold: 0.44, soft: 0.4, strength: 0.62 }, // MACRO dark clod
      { op: 'clumps', freq: 2, octaves: 2, rgb: [138, 117, 84], threshold: 0.56, soft: 0.4, strength: 0.46 }, // MACRO pale dry earth
      { op: 'fbm', freq: 4, octaves: 4, amp: 0.14 }, // strong multi-scale mottle
      { op: 'clumps', freq: 4, octaves: 3, rgb: [63, 50, 36], threshold: 0.55, soft: 0.24, strength: 0.5 }, // mid dark
      { op: 'clumps', freq: 5, octaves: 3, rgb: [146, 122, 88], threshold: 0.6, soft: 0.22, strength: 0.3 }, // mid pale grit
      { op: 'cluster_speckle', cluster_freq: 4, density: 0.38, darken: 0.34 }, // grouped grit/stone flecks
      { op: 'cluster_speckle', cluster_freq: 5, density: 0.14, darken: 0.3, rgb: [150, 138, 116] }, // sparse pale stone specks
      { op: 'ao', freq: 5, octaves: 3, amp: 0.2, bias: 0.5 }, // crevice depth between clods
    ],
  },
  {
    // STONE = COLD WEATHERED GRAY (slight blue): cellular (worley) cracks + low-freq MACRO value clumps
    // (light/dark rock, per variant) + isotropic fBm for WIDE value variance across the 8 tiles (2×4 rot).
    // Faint border_darken reads as block-edge cracks, not a grid.
    // [D159/ENG-22 REALISM] Cool desaturated grey (brief #7a7c7e→#5f6163). LARGE fracture blotches widened
    // (per-variant weathering) + a subtle WARM/COOL mottle (a warm clump beside the cool base — the brief's
    // "subtle warm/cool mottle") + HAIRLINE cracks (2-scale worley: broad fractures + fine capillaries) +
    // AO into the cracks for depth + fine tooth. Faint border_darken reads as block-edge, not a grid.
    name: 'stone',
    variants: 2,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [120, 122, 126] },
          { pos: 1, rgb: [96, 98, 104] },
        ],
      }, // cool grey, gentle up-cue
      { op: 'clumps', freq: 2, octaves: 2, rgb: [70, 72, 78], threshold: 0.42, soft: 0.4, strength: 0.56 }, // MACRO dark fracture zone (widened)
      { op: 'clumps', freq: 2, octaves: 2, rgb: [146, 148, 152], threshold: 0.58, soft: 0.4, strength: 0.42 }, // MACRO lit facet
      { op: 'clumps', freq: 3, octaves: 2, rgb: [104, 96, 84], threshold: 0.62, soft: 0.32, strength: 0.22 }, // subtle WARM mottle (iron stain)
      { op: 'fbm', freq: 3, octaves: 3, amp: 0.1 },
      { op: 'worley', freq: 4, strength: 0.4, threshold: 0.11 }, // broad fractures
      { op: 'worley', freq: 9, strength: 0.22, threshold: 0.07 }, // fine hairline capillaries
      { op: 'ao', freq: 6, octaves: 3, amp: 0.16, bias: 0.48 }, // crevice depth into the fractures
      { op: 'grain', freq: 11, amp: 0.06 }, // fine tooth
      { op: 'border_darken', width: 1, amount: 0.12 },
    ],
  },
  {
    // SAND = MUTED TAN: desaturated base + low-freq MACRO tone clumps (dune shade, per variant) +
    // NON-DIRECTIONAL ripple-mottle (fBm, not streaks ⇒ no corduroy) + fine grain + sparse grouped grains.
    // 2×4 rot = 8 tiles. Softer contrast than earth (sand is pale) but real within/between-tile variance.
    // [D159/ENG-22 REALISM] Muted warm tan, LOW-sat (brief #cdbb90→#b6a377): base desaturated from the old
    // vivid tan, MACRO dune shade/crest widened, a faint isotropic ripple (fbm, not streaks ⇒ no corduroy),
    // fine even grain, sparse darker PEBBLE specks (brief), + a very light AO so ripple troughs read. Softer
    // value contrast than earth (sand is pale) but real within/between-tile variance. 2×4 rot = 8 tiles.
    name: 'sand',
    variants: 2,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [190, 174, 138] },
          { pos: 1, rgb: [176, 159, 123] },
        ],
      }, // muted warm tan (desaturated)
      { op: 'clumps', freq: 2, octaves: 2, rgb: [152, 137, 104], threshold: 0.46, soft: 0.4, strength: 0.48 }, // MACRO shaded dune
      { op: 'clumps', freq: 2, octaves: 2, rgb: [208, 194, 158], threshold: 0.56, soft: 0.4, strength: 0.3 }, // MACRO lit crest
      { op: 'fbm', freq: 6, octaves: 3, amp: 0.09 }, // isotropic ripple
      { op: 'grain', freq: 14, amp: 0.07 }, // fine even grain
      { op: 'cluster_speckle', cluster_freq: 5, density: 0.22, darken: 0.18 }, // sparse grouped grains
      { op: 'cluster_speckle', cluster_freq: 6, density: 0.07, darken: 0.36, rgb: [132, 116, 86] }, // occasional darker pebble speck
      { op: 'ao', freq: 6, octaves: 3, amp: 0.14, bias: 0.48 }, // ripple-trough shading
    ],
  },
  {
    name: 'water',
    alpha: 200,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [48, 92, 140] },
          { pos: 1, rgb: [40, 78, 126] },
        ],
      }, // muted deep water
      { op: 'grain', freq: 4, amp: 0.05 },
    ],
  },
  {
    // LOG = AGED DARK TIMBER, full bark pass. NO vertical ramp (broke vertical seamlessness on a stacked
    // trunk): FLAT base + VERTICAL bark grooves (value varies along x = vertical ridges) + toroidal fBm
    // mottle (wraps in y too ⇒ stacked blocks read as continuous bark) + clustered dark cracks. 5 variants.
    // The material keys the per-cell variant on (x,z) ONLY for log SIDE faces so a whole trunk column
    // shares one variant top-to-bottom = continuous bark; neighbours differ. No border_darken (no per-block frame).
    // [D159/ENG-22 REALISM] Aged dark timber, deeper VALUE contrast: flat muted base + coarse+fine VERTICAL
    // bark ridges (streaks along x) + toroidal fbm mottle (seamless x AND y ⇒ continuous stacked-trunk bark)
    // + dark/lit bark blotches widened + grouped deep cracks + AO into the bark grooves for real relief. No
    // vertical ramp (broke stacked-trunk seamlessness), no border_darken (no per-block frame). 5 variants.
    name: 'log',
    variants: 5,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [82, 60, 41] },
          { pos: 1, rgb: [82, 60, 41] },
        ],
      }, // aged-timber flat base
      { op: 'streaks', dir: 'x', freq: 7, strength: 0.3 }, // coarse vertical ridges
      { op: 'streaks', dir: 'x', freq: 13, strength: 0.17 }, // finer vertical fibre
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.13 }, // toroidal bark mottle (seamless x AND y)
      { op: 'clumps', freq: 3, octaves: 2, rgb: [54, 38, 26], threshold: 0.5, soft: 0.3, strength: 0.54 }, // dark bark
      { op: 'clumps', freq: 4, octaves: 2, rgb: [120, 94, 62], threshold: 0.6, soft: 0.26, strength: 0.3 }, // lit ridge tops
      { op: 'cluster_speckle', cluster_freq: 4, density: 0.32, darken: 0.38 }, // grouped deep cracks
      { op: 'ao', freq: 7, octaves: 3, amp: 0.18, bias: 0.5 }, // groove-shadow relief
    ],
  },
  {
    // BROADLEAF LEAVES (block id 7) — D164 ALPHA-CUTOUT CANOPY. Was an OPAQUE cube face; now an alpha-clip
    // LACEWORK (op_leaf): a two-octave foliage mask punches ~42% holes so sky/depth shows THROUGH the canopy
    // (the single biggest realism lever per the D164 brief), multi-tone dark↔light dappled leaves + dark
    // hole-rim veins. Rendered by the new CUTOUT render class (pool_renderer CUTOUT_BLOCK_IDS + alphaTest
    // material) — greedy-meshed exactly like a solid cube, so ZERO extra geometry vs the opaque leaves it
    // replaces; the holes are pure alpha. Takes ENG-1 canopy hue on top (tint class 2). 3 weathering variants.
    name: 'leaves',
    alpha_clip: true,
    variants: 3,
    // [D164-B]: widen the species separation — broadleaf/conifer/dry read clearly apart.
    // BROADLEAF = the WARM bright yellow-green (pushed warmer + lighter vs conifer's cold dark blue-green and
    // apart from dry's straw-olive), so a mixed treeline reads three distinct species. Per-tree hue rides on top.
    ops: [
      {
        op: 'leaf',
        freq: 6,
        octaves: 3,
        hole: 0.42,
        rgb: [86, 118, 50],
        rgb_dark: [54, 82, 36],
        rgb_light: [128, 158, 78],
        vein_rgb: [36, 54, 26],
      },
    ],
  },
  {
    // GRASS TUFT = the DENSE carpet. Design correction (2026-07-03): the old min_h 0.35 read SQUAT + sparse
    // and needed to be taller and denser. Raised to fill 0.60-1.00 of the tile (nearly the full block, a real
    // knee-/shin-high carpet, still sub-block-ish vs the waist-high tall_grass accent) and count 16→22 for
    // a denser fill. WIDE + CLUMPY (spread 2). 6 variants (was 3) so neighbouring cells never read as
    // clones (fewer repeated patterns); the material's per-cell hash also rotates/scale-jitters.
    name: 'grass_tuft',
    alpha_clip: true,
    variants: 6,
    // tip_rgb = sun-bleached straw; graduated across the 6 variants (0-1 green → 4-5 yellow-topped) so
    // the material picks green on humid macro patches, dry on arid ones (yellow tips unless humid).
    // Owner meadow-ref pass: body green deepened (was [88,122,64] pale sage) — at grazing vista angles the
    // visible surface is the blade UPPER halves, so the body art dominates the field read; the ref meadow
    // is mid-DARK green with sparse bright tips. The shader gradient + ±28% per-plane jitter ride on top.
    // tip_start 0.62 (was default 0.45): the dry fade is confined to the top ~38% — actual TIPS, per the
    // design rule ("yellow on the top") — so at grazing vista angles the deep green BODY carries the field
    // and dry zones read as green-with-straw-tips, not straw-upper-halves.
    // tip_rgb/tip_rgb2 = the straw-hue RANGE (round-3: "2-3 tip hues pale-cream→ochre") — each blade
    // in a dry variant lerps between them, so a dry stand mixes cream + straw + ochre instead of one flat pale.
    ops: [
      {
        op: 'blades',
        count: 22,
        rgb: [70, 102, 52],
        tip_rgb: [206, 192, 138],
        tip_rgb2: [168, 138, 74],
        min_h: 0.6,
        span_h: 0.4,
        spread: 2.0,
        tip_start: 0.62,
      },
    ],
  },
  {
    name: 'flower_red',
    alpha_clip: true,
    ops: [{ op: 'flower', head_rgb: [176, 62, 54], stem_rgb: [64, 96, 48], radius: 8 }],
  },
  {
    name: 'flower_yellow',
    alpha_clip: true,
    // Owner meadow-ref pass: lighter flowering-yellow (the ref's yellowish patches) — pops against turf.
    ops: [{ op: 'flower', head_rgb: [228, 208, 112], stem_rgb: [64, 96, 48], radius: 8 }],
  },
  // ── DIVERGENCE WAVE cross-flora sprites (2026-07-03). Muted Conquest greens, dry tips via per-blade
  // tint variety; `variants` decorrelate per cell so the OCEAN never reads as one repeated sprite.
  // APPENDED (never inserted) — the atlas layer order IS this array order, so existing indices are
  // stable. tall_grass/reed sprites are authored bottom-anchored (op_blades grows up from the last row);
  // the material's cross UV samples row-0=tip at the quad top, so a 2-3 block-tall cross reads upright.
  {
    // TALL GRASS = the TALL ACCENT (cross_height 2 = waist-high) — grown taller and denser. Blades now
    // fill 0.7-1.0 of the 2-block sprite (chest-high) + count 13→20 so a stand reads as a dense wall, not
    // stray reeds. Mossy with hashed dry-tip tint. 6 variants (was 3) + per-cell rotate/scale kill clones.
    name: 'tall_grass',
    alpha_clip: true,
    variants: 6,
    // Graduated dry tips (green → straw across variants) — humidity-biased in the material, same as tuft.
    // Owner meadow-ref pass: tips lifted toward whitish-straw so the tall accents poking above the carpet
    // read as pale SEED HEADS (the ref's whitish accents), amplified by the shader's tip gradient.
    // Straw-hue RANGE (round-3): pale seed-head cream ↔ warmer ochre, per-blade lerp for variety.
    ops: [
      {
        op: 'blades',
        count: 20,
        rgb: [62, 96, 46],
        tip_rgb: [212, 200, 140],
        tip_rgb2: [182, 158, 96],
        min_h: 0.7,
        span_h: 0.3,
        tip_start: 0.62,
      },
    ],
  },
  {
    // REED: fewer, taller, narrower olive stalks (spread<1) for the water margin. 2 variants.
    name: 'reed',
    alpha_clip: true,
    variants: 2,
    ops: [{ op: 'blades', count: 6, rgb: [120, 130, 74], min_h: 0.64, span_h: 0.32, spread: 0.75 }],
  },
  {
    name: 'flower_white',
    alpha_clip: true,
    // Owner meadow-ref pass: the ref's "white sprinkle" — cream-WHITE heads that pop against the dark
    // turf (was a grayish 216 that vanished into the pale sward). The shader's blade gradient (+12% at
    // the sprite top) lifts them further.
    ops: [{ op: 'flower', head_rgb: [242, 238, 220], stem_rgb: [64, 96, 48], radius: 7 }],
  },
  {
    name: 'flower_purple',
    alpha_clip: true,
    ops: [{ op: 'flower', head_rgb: [138, 96, 176], stem_rgb: [64, 96, 48], radius: 7 }],
  },
  {
    // FERN: forest-floor undergrowth — BROAD (spread 2.4) fronds, distinct from the sunny meadow grass.
    // Owner "taller + dense": fills 0.5-0.85 + count 14 for a leafy shade carpet; lower + broader than
    // meadow grass so it reads as undergrowth. 5 variants + per-cell rotate/scale so the floor never tiles.
    // 2026-07-04 SHADE-VARIETY FIX (forest-floor grass read "redundant/cloned, no color shades" under
    // dense canopy — measured before: canopy fern mean-luma ~19, per-col stdev ~2, i.e. a flat dark mass):
    // the old [46,78,40] mono-green baked FLAT DARK, and the shader's ±28% variance is MULTIPLICATIVE, so
    // under low canopy brightness it compressed to near-black and every frond read identical. Config levers,
    // no new mechanics: (1) BASE lifted to a mid green [60,96,52] so the sprite carries real luminance to
    // vary (a dark base × tiny brightness has no headroom to spread); (2) tip_rgb/tip_rgb2 = a PALE FROND-TIP
    // hue RANGE (cool sage → warm lime), lerped per-blade AND graduated across the 5 variants (dryness ramp)
    // — a stand mixes light-tipped and deep-green fronds, an in-sprite light↔dark gradient that SURVIVES
    // shade (a lighter texel stays relatively lighter at any brightness multiply, unlike a multiplicative
    // delta on a near-black base). tip_start 0.5: broad+low fronds, fade the upper half. Real ferns DO
    // lighten toward growing frond tips / backlit translucency — thematically true undergrowth.
    name: 'fern',
    alpha_clip: true,
    variants: 5,
    ops: [
      {
        op: 'blades',
        count: 14,
        rgb: [60, 96, 52],
        tip_rgb: [150, 186, 118],
        tip_rgb2: [116, 158, 88],
        min_h: 0.5,
        span_h: 0.35,
        spread: 2.4,
        tip_start: 0.5,
      },
    ],
  },
  // ── D159/ENG-22 REALISM PASS new material families (2026-07-05). APPENDED (never inserted) so every
  // pre-existing atlas layer index stays byte-stable (the golden world hash + material layer resolution
  // are position/id-keyed). Each maps 1:1 to an existing registry block (snow id 8, cave_stone 18,
  // mossy_stone 19) that previously fell back to flat map_color — now it samples a baked layer, auto-wired
  // via the baker's `blocks ?? [name]` → layer_of.set(block.id). No material plumbing change.
  {
    // SNOW = off-white with a FAINT blue-grey (brief #e4eaed→#d2dae0 — NOT pure white). Snow takes NO
    // biome hue tint (tint_class_of → 1 mineral, value-only) so its baked colour IS final: it carries its
    // own near-white hue. Very fine, LOW-contrast + soft drift blotch + rare bright sparkle + a faint blue
    // AO in the shadowed drifts (the cool-shadow tell). Kept below pure #fff (brief §1: nothing pure white).
    name: 'snow',
    variants: 2,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [227, 232, 236] },
          { pos: 1, rgb: [214, 221, 228] },
        ],
      }, // off-white, faint cool
      { op: 'clumps', freq: 2, octaves: 2, rgb: [196, 205, 214], threshold: 0.48, soft: 0.42, strength: 0.34 }, // soft drift shadow (bluer)
      { op: 'clumps', freq: 3, octaves: 2, rgb: [240, 244, 247], threshold: 0.6, soft: 0.34, strength: 0.28 }, // lit drift crest
      { op: 'fbm', freq: 6, octaves: 3, amp: 0.05 }, // very fine low-contrast grain
      { op: 'ao', freq: 6, octaves: 3, amp: 0.09, bias: 0.46 }, // faint cool AO in the drifts
      { op: 'cluster_speckle', cluster_freq: 6, density: 0.05, darken: 0.16, rgb: [252, 253, 255] }, // rare sparkle
    ],
  },
  {
    // CAVE STONE = dark damp cavern rock (registry map_color #3a383e). Cool near-black grey, coarse fracture
    // blotches + hairline cracks + AO for the wet-shadow depth + fine tooth. Takes mineral value-only tint.
    name: 'cave_stone',
    variants: 2,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [64, 62, 68] },
          { pos: 1, rgb: [54, 52, 58] },
        ],
      }, // dark damp rock
      { op: 'clumps', freq: 2, octaves: 2, rgb: [42, 41, 46], threshold: 0.44, soft: 0.4, strength: 0.56 }, // MACRO dark fracture
      { op: 'clumps', freq: 2, octaves: 2, rgb: [84, 82, 90], threshold: 0.58, soft: 0.4, strength: 0.36 }, // MACRO lit facet
      { op: 'fbm', freq: 3, octaves: 3, amp: 0.1 },
      { op: 'worley', freq: 5, strength: 0.42, threshold: 0.1 }, // damp cracks
      { op: 'ao', freq: 6, octaves: 3, amp: 0.22, bias: 0.5 }, // wet-shadow crevice depth
      { op: 'grain', freq: 11, amp: 0.06 },
      { op: 'border_darken', width: 1, amount: 0.14 },
    ],
  },
  {
    // MOSSY STONE = moss-crusted cavern rock (registry map_color #414d3a). Damp grey base with GREEN moss
    // CLUMPS crawling over it (weathered patches), cracks, AO. Mineral value-only tint (its green is baked,
    // not from the biome hue) — moss reads in cave interiors regardless of surface climate.
    name: 'mossy_stone',
    variants: 2,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [78, 82, 74] },
          { pos: 1, rgb: [66, 70, 62] },
        ],
      }, // damp grey stone
      { op: 'clumps', freq: 2, octaves: 2, rgb: [52, 56, 48], threshold: 0.44, soft: 0.4, strength: 0.52 }, // MACRO dark rock
      { op: 'clumps', freq: 3, octaves: 3, rgb: [64, 82, 52], threshold: 0.5, soft: 0.3, strength: 0.6 }, // MOSS crust patches (green)
      { op: 'clumps', freq: 4, octaves: 3, rgb: [92, 112, 74], threshold: 0.64, soft: 0.26, strength: 0.34 }, // lit moss highlight
      { op: 'fbm', freq: 4, octaves: 3, amp: 0.11 },
      { op: 'worley', freq: 5, strength: 0.3, threshold: 0.09 }, // rock cracks under the moss
      { op: 'cluster_speckle', cluster_freq: 5, density: 0.3, darken: 0.3, rgb: [48, 62, 40] }, // grouped dark moss specks
      { op: 'ao', freq: 6, octaves: 3, amp: 0.2, bias: 0.5 }, // crevice depth
    ],
  },
  // ── [D213] THE CAVE GLOW-MUSHROOM SET —
  // stem + three cap colours previously fell back to FLAT map_color (no recipe at all). Caps bake a
  // radial-reading dome: bright saturated core clumps → darker rim, with pale spots; the registry's
  // emission_rgb then lifts the BRIGHT texels hardest, so the glow reads as a gradient, not a tint.
  {
    name: 'mushroom_stem',
    variants: 2,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [226, 216, 192] },
          { pos: 1, rgb: [196, 184, 158] },
        ],
      }, // pale fibrous stalk
      { op: 'streaks', freq: 7, amp: 0.16, rgb: [172, 158, 132] }, // vertical fiber striations
      { op: 'fbm', freq: 4, octaves: 2, amp: 0.07 },
      { op: 'ao', freq: 5, octaves: 2, amp: 0.14, bias: 0.5 },
      { op: 'border_darken', width: 1, amount: 0.12 },
    ],
  },
  {
    name: 'mushroom_cap_azure',
    variants: 2,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [56, 120, 210] },
          { pos: 1, rgb: [30, 70, 150] },
        ],
      }, // deep azure dome
      { op: 'clumps', freq: 3, octaves: 2, rgb: [110, 190, 255], threshold: 0.52, soft: 0.34, strength: 0.7 }, // BRIGHT bioluminal veins
      { op: 'speckle', freq: 7, density: 0.16, rgb: [210, 236, 255] }, // pale glow spots
      { op: 'fbm', freq: 4, octaves: 2, amp: 0.08 },
      { op: 'border_darken', width: 1, amount: 0.2 },
    ],
  },
  {
    name: 'mushroom_cap_teal',
    variants: 2,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [40, 150, 140] },
          { pos: 1, rgb: [20, 92, 88] },
        ],
      },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [96, 220, 200], threshold: 0.52, soft: 0.34, strength: 0.7 },
      { op: 'speckle', freq: 7, density: 0.16, rgb: [200, 250, 240] },
      { op: 'fbm', freq: 4, octaves: 2, amp: 0.08 },
      { op: 'border_darken', width: 1, amount: 0.2 },
    ],
  },
  {
    name: 'mushroom_cap_amber',
    variants: 2,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [225, 160, 60] },
          { pos: 1, rgb: [160, 96, 28] },
        ],
      },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [255, 208, 110], threshold: 0.52, soft: 0.34, strength: 0.7 },
      { op: 'speckle', freq: 7, density: 0.16, rgb: [255, 240, 200] },
      { op: 'fbm', freq: 4, octaves: 2, amp: 0.08 },
      { op: 'border_darken', width: 1, amount: 0.2 },
    ],
  },
  // ── D164 SPECIES-AWARE CUTOUT CANOPY (2026-07-05). Two leaf VARIANTS beside broadleaf, mapped from the
  // schematic palettes (registry_map.js): conifer = spruce/pine (+ taiga/arctic set fallback), dry =
  // acacia/desert. APPENDED (never inserted) so every pre-existing atlas layer index stays byte-stable.
  // Each `blocks` its registry id (28/29) → auto-wired via the baker's layer_of.set. Same op_leaf cutout;
  // per-species the HOLE fraction + green tones differ so a distant treeline reads broadleaf/conifer/dry.
  {
    // CONIFER = dark needled evergreen (spruce sapins). DENSER canopy (fewer holes ~0.34) + colder dark
    // greens — reads as a tight coniferous crown vs the airy broadleaf. 3 weathering variants.
    name: 'leaves_conifer',
    alpha_clip: true,
    variants: 3,
    // [D164-B species separation] CONIFER = COLD dark BLUE-green + DENSER crown (hole 0.34→0.30) — clearly
    // apart from broadleaf's warm yellow-green at distance (bluer + darker + tighter).
    // [D164-B]: remove the snow blocks directly, have their texture be white on top. The
    // taiga species bakes a snow-dusted WHITE TOP straight into the cutout (top_white over the upper top_frac,
    // noise-ragged edge) so every conifer plane reads snow-capped for FREE — no deposit sprite, no snow cube.
    // [BUG-1 2026-07-11] White translucent blocks appeared below trees, reading as a rendering artifact. The
    // pure near-white [236,242,250] over the top 0.3 of EVERY plane (incl. the vertical leaf FINS) read as
    // blocky white patches floating in the crown, not snow: a full-white lerp on holey alpha-clip planes at all
    // orientations. SOFTENED to a light frost — a MUTED cool-white ([176,190,196], well below the AgX/bloom
    // blowout the pure white hit) over a THIN top band (0.12) so only the very needle tips dust, and the crown
    // still reads coniferous-green (taiga keeps a snow HINT, no white blocks). Not removed — spec called for
    // snow tops; this makes the execution read as frost, not a render bug.
    ops: [
      {
        op: 'leaf',
        freq: 7,
        octaves: 3,
        hole: 0.3,
        rgb: [40, 74, 58],
        rgb_dark: [22, 50, 42],
        rgb_light: [66, 102, 82],
        vein_rgb: [18, 42, 34],
        top_white: [176, 190, 196],
        top_frac: 0.12,
      },
    ],
  },
  {
    // DRY = savanna/acacia straw canopy. SPARSER (more holes ~0.5) + sun-bleached olive-straw greens — an
    // open, thin arid crown. 3 weathering variants.
    name: 'leaves_dry',
    alpha_clip: true,
    variants: 3,
    // [D164-B species separation] DRY = warm YELLOW-straw olive, the sparsest airy crown (hole 0.5→0.52) —
    // clearly yellower/paler than both greens so a savanna edge reads apart.
    ops: [
      {
        op: 'leaf',
        freq: 6,
        octaves: 3,
        hole: 0.52,
        rgb: [142, 128, 58],
        rgb_dark: [106, 96, 48],
        rgb_light: [178, 162, 90],
        vein_rgb: [84, 76, 40],
      },
    ],
  },
  // ── FIVE-WORLDS shared-stage material families (2026-07-06). APPENDED (never inserted) so every
  // pre-existing atlas layer index stays byte-stable (the golden world hash + material layer resolution
  // are position/id-keyed). Each `blocks` its registry id (30-33) → auto-wired via the baker's layer_of.set.
  {
    // ICE = pale blue-white glacier (registry map_color #c8e0f0). Bright cold base + broad worley crack
    // network + fine capillary cracks + a faint blue AO in the fractures + sparse bright sparkle. Mineral
    // value-only tint so its own near-white blue hue is final. 2×4 rot so an iceberg mass never tiles.
    name: 'ice',
    variants: 2,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [204, 228, 244] },
          { pos: 1, rgb: [188, 214, 234] },
        ],
      }, // pale blue-white
      { op: 'clumps', freq: 2, octaves: 2, rgb: [166, 196, 220], threshold: 0.46, soft: 0.42, strength: 0.4 }, // MACRO shaded floe (bluer)
      { op: 'clumps', freq: 3, octaves: 2, rgb: [230, 242, 250], threshold: 0.6, soft: 0.34, strength: 0.3 }, // lit crest
      { op: 'worley', freq: 4, strength: 0.3, threshold: 0.09 }, // broad ice fractures
      { op: 'worley', freq: 9, strength: 0.18, threshold: 0.06 }, // fine capillary cracks
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.05 }, // very fine low-contrast grain
      { op: 'ao', freq: 6, octaves: 3, amp: 0.1, bias: 0.46 }, // faint cool AO in the cracks
      { op: 'cluster_speckle', cluster_freq: 6, density: 0.05, darken: 0.14, rgb: [250, 253, 255] }, // rare glint
    ],
  },
  {
    // PACKED ICE = denser glacier core (registry map_color #b0cee6). Bluer, tighter, harder-cracked than
    // surface ice — the iceberg draft/keel. 2×4 rot.
    name: 'packed_ice',
    variants: 2,
    rotations: [0, 90, 180, 270],
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [182, 212, 234] },
          { pos: 1, rgb: [166, 198, 224] },
        ],
      }, // deep glacier blue
      { op: 'clumps', freq: 2, octaves: 2, rgb: [146, 180, 210], threshold: 0.46, soft: 0.42, strength: 0.44 },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [210, 228, 242], threshold: 0.6, soft: 0.34, strength: 0.28 },
      { op: 'worley', freq: 5, strength: 0.34, threshold: 0.1 }, // tight compressed fractures
      { op: 'fbm', freq: 4, octaves: 3, amp: 0.05 },
      { op: 'ao', freq: 6, octaves: 3, amp: 0.12, bias: 0.48 },
    ],
  },
  {
    // PALM LOG = warm fibrous tan-brown (registry map_color #926636; reference-corpus Wood_Trunk_Palm_Side palette).
    // Aged-timber flat base + coarse+fine VERTICAL fibre ridges (streaks along x, seamless stacked trunk) +
    // toroidal fbm bark mottle + warm/dark bark blotches + AO into the grooves. No vertical ramp / no
    // border_darken (stacked-trunk seamlessness). 5 variants (per-trunk-column continuity via the material).
    name: 'palm_log',
    variants: 5,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [148, 104, 56] },
          { pos: 1, rgb: [148, 104, 56] },
        ],
      }, // warm palm-tan flat base
      { op: 'streaks', dir: 'x', freq: 6, strength: 0.28 }, // coarse vertical fibre
      { op: 'streaks', dir: 'x', freq: 12, strength: 0.16 }, // fine palm-fibre grain
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.12 }, // toroidal bark mottle (seamless x AND y)
      { op: 'clumps', freq: 3, octaves: 2, rgb: [112, 76, 40], threshold: 0.5, soft: 0.3, strength: 0.5 }, // dark fibre bands
      { op: 'clumps', freq: 4, octaves: 2, rgb: [186, 148, 82], threshold: 0.6, soft: 0.26, strength: 0.3 }, // lit ridge tops (Palm_Full highlight)
      { op: 'cluster_speckle', cluster_freq: 4, density: 0.3, darken: 0.34 }, // grouped fibre cracks
      { op: 'ao', freq: 7, octaves: 3, amp: 0.16, bias: 0.5 }, // groove-shadow relief
    ],
  },
  {
    // PALM LEAVES = saturated yellow-green fronds (registry map_color #70781f; reference-corpus Palm_Texture palette
    // (96,96,0)→(144,144,24)). Opaque canopy cube (not the D164 cutout class — kept simple; a dense frond
    // mass reads well in the tint pipeline). MACRO frond shade/lit clumps + fbm + grouped dark-frond specks.
    name: 'palm_leaves',
    variants: 3,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [116, 124, 34] },
          { pos: 1, rgb: [102, 110, 28] },
        ],
      }, // yellow-green frond
      { op: 'clumps', freq: 2, octaves: 2, rgb: [80, 86, 16], threshold: 0.46, soft: 0.4, strength: 0.5 }, // MACRO shaded frond
      { op: 'clumps', freq: 3, octaves: 2, rgb: [150, 156, 48], threshold: 0.6, soft: 0.32, strength: 0.34 }, // sun-lit frond crest
      { op: 'fbm', freq: 4, octaves: 3, amp: 0.14 }, // multi-scale frond mottle
      { op: 'cluster_speckle', cluster_freq: 5, density: 0.3, darken: 0.3, rgb: [72, 78, 12] }, // grouped dark frond gaps
      { op: 'ao', freq: 6, octaves: 3, amp: 0.16, bias: 0.5 }, // frond-shadow depth
    ],
  },
  // ── FIVE-WORLDS Paradise CORAL cross-flora sprites — branching reef fans (op 'blades' = upward strokes),
  // vivid pink / purple / teal with brighter tips so the reef pops through clear turquoise water. Bottom-
  // anchored like the grass sprites; `variants` decorrelate per cell so a reef patch isn't one clone.
  {
    name: 'coral_pink',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'blades',
        count: 12,
        rgb: [196, 70, 108],
        tip_rgb: [244, 150, 176],
        tip_rgb2: [220, 108, 150],
        min_h: 0.5,
        span_h: 0.4,
        spread: 0.95,
        tip_start: 0.55,
      },
    ],
  },
  {
    name: 'coral_purple',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'blades',
        count: 11,
        rgb: [132, 74, 190],
        tip_rgb: [188, 138, 226],
        tip_rgb2: [160, 108, 214],
        min_h: 0.5,
        span_h: 0.42,
        spread: 0.9,
        tip_start: 0.55,
      },
    ],
  },
  {
    name: 'coral_teal',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'blades',
        count: 14,
        rgb: [40, 162, 150],
        tip_rgb: [126, 226, 204],
        tip_rgb2: [88, 200, 186],
        min_h: 0.45,
        span_h: 0.4,
        spread: 1.0,
        tip_start: 0.5,
      },
    ],
  },
  // ── CORAL REEF CUBES — the pool_coral SCHEMATIC reef, MATTE mottled reef-stone (proper texture,
  // not emissive nothingness"). Vivid base + lit/shaded reef pockets (clumps) + porous speckle + fbm grain.
  // Full opaque cubes; 3 variants decorrelate the reef mass so it never reads as one tiled block.
  {
    name: 'coral_rock_rose',
    variants: 3,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [172, 58, 92] },
          { pos: 1, rgb: [206, 92, 126] },
        ],
      },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [232, 132, 158], threshold: 0.58, soft: 0.34, strength: 0.4 }, // lit polyp knobs
      { op: 'clumps', freq: 4, octaves: 2, rgb: [138, 40, 72], threshold: 0.5, soft: 0.36, strength: 0.42 }, // shaded pores
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.14 },
      { op: 'speckle', density: 0.16, darken: 0.22 },
    ],
  },
  {
    name: 'coral_rock_cyan',
    variants: 3,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [34, 140, 132] },
          { pos: 1, rgb: [64, 182, 170] },
        ],
      },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [120, 220, 204], threshold: 0.58, soft: 0.34, strength: 0.4 },
      { op: 'clumps', freq: 4, octaves: 2, rgb: [22, 104, 100], threshold: 0.5, soft: 0.36, strength: 0.42 },
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.14 },
      { op: 'speckle', density: 0.16, darken: 0.22 },
    ],
  },
  {
    name: 'coral_rock_gold',
    variants: 3,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [196, 142, 46] },
          { pos: 1, rgb: [226, 176, 78] },
        ],
      },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [242, 208, 128], threshold: 0.58, soft: 0.34, strength: 0.4 },
      { op: 'clumps', freq: 4, octaves: 2, rgb: [156, 106, 30], threshold: 0.5, soft: 0.36, strength: 0.42 },
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.14 },
      { op: 'speckle', density: 0.16, darken: 0.22 },
    ],
  },
  ...FLORA_RECIPES, // VIVID-WORLD flora sprites (append-only ⇒ existing atlas layer indices byte-stable)
  ...TREE_RECIPES, // A1 procedural-tree species leaf/bark/twig art atoms (append-only ⇒ parity preserved)
  ...GATHER_RECIPES, // A3 gatherable sprites (33 base + 43 rare wheats/ores/herbs) — append-only, parity preserved
]
