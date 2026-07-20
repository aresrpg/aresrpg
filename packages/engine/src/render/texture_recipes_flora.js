// VIVID-WORLD flora sprite RECIPES (2026-07-07 — target: way more sprites for a vivid world, covering
// grass, bush, corals, branches, and similar clutter). The new clutter-sprite roster, authored as PROCEDURAL
// recipes (the house style — per-world palette tint rides for free on the ones registered in a
// texture_palette family). Every recipe uses ONLY the self-contained flora ops (texture_ops_flora.js), so
// the set is fully decoupled from the base baker recipe ops. Spread onto RECIPES at the END (one wire-in
// line) — APPEND-ONLY so every pre-existing atlas layer index stays byte-stable (parity law).
//
// PLACEMENT is deferred: these blocks are registered but NOT emitted by surface_flora() yet (that seam is
// the eng-stages-owned surface_decorator.js). New KINDS are opt-in per world via config.decoration.sprites,
// absent-by-default ⇒ the DEFAULT world stays byte-identical. See the flora-placement handoff notes
// for the exact surface_flora() branch diffs + per-world sprite config + suggested densities.

/** @typedef {import('./texture_baker.js').Recipe} Recipe */
/** The flora sprite ops read extra params the base RecipeOp doesn't declare (bush/branch/shell/etc. knobs);
 *  a local intersection keeps them typed WITHOUT touching the base baker typedef. FloraOp ⊆ RecipeOp, so a
 *  FloraRecipe is assignable to Recipe at the RECIPES spread site.
 *  @typedef {import('./texture_baker.js').RecipeOp & { rx?: number, ry?: number, cy?: number, hole?: number,
 *    leaf_freq?: number, tone_freq?: number, forks?: number, thick?: number, lean?: number,
 *    frost_rgb?: number[], rgb_dark?: number[], rgb_light?: number[], stem_rgb?: number[], cap_rgb?: number[],
 *    spot_rgb?: number[], ridge_rgb?: number[], petal_rgb?: number[], eye_rgb?: number[], petals?: number,
 *    head_y?: number, stalk_rgb?: number[], spike_rgb?: number[], spike_hi_rgb?: number[], vein_rgb?: number[] }} FloraOp */
/** @typedef {{ name: string, alpha_clip?: boolean, variants?: number, ops: FloraOp[] }} FloraRecipe */

/** @type {FloraRecipe[]} */
export const FLORA_RECIPES = [
  // ── UNIVERSAL clutter (any vegetated world) ─────────────────────────────────────────────────────
  {
    // LEAFY BUSH — a rounded dappled shrub mass over a short stem. Grass-family tint (biome-coherent green).
    name: 'bush',
    alpha_clip: true,
    variants: 4,
    ops: [
      {
        op: 'bush',
        rgb: [70, 104, 52],
        rgb_dark: [42, 68, 34],
        rgb_light: [112, 146, 80],
        hole: 0.22,
        rx: 0.42,
        ry: 0.4,
      },
    ],
  },
  {
    // SMALL DEAD BRANCH / fallen twigs — bare woody stick with a couple of forks. Fixed brown (no tint).
    name: 'dead_branch',
    alpha_clip: true,
    variants: 3,
    ops: [{ op: 'branch', rgb: [96, 70, 46], rgb_dark: [60, 44, 28], forks: 3, thick: 0.045 }],
  },
  {
    // PEBBLE CLUSTER — low rounded stones. Fixed weathered grey.
    name: 'pebbles',
    alpha_clip: true,
    variants: 3,
    ops: [{ op: 'pebbles', rgb: [130, 128, 122], count: 5 }],
  },
  {
    // SMALL MUSHROOMS (toadstools) — pale stems + red spotted caps. Fixed colour.
    name: 'toadstool',
    alpha_clip: true,
    variants: 3,
    ops: [{ op: 'mushroom', cap_rgb: [178, 66, 56], stem_rgb: [224, 212, 188], spot_rgb: [240, 234, 214], count: 3 }],
  },
  // ── RAINFOREST ──────────────────────────────────────────────────────────────────────────────────
  {
    // BROADLEAF JUNGLE PLANT — a bigger, warmer bush mass (lush tropical undergrowth). Grass-family tint.
    name: 'jungle_plant',
    alpha_clip: true,
    variants: 4,
    ops: [
      {
        op: 'bush',
        rgb: [64, 116, 54],
        rgb_dark: [38, 78, 40],
        rgb_light: [116, 168, 82],
        hole: 0.16,
        rx: 0.46,
        ry: 0.46,
        leaf_freq: 5,
        tone_freq: 4,
      },
    ],
  },
  {
    // ORCHID BLOOM — an exotic magenta-and-cream flower with petal lobes. Flower-family tint.
    name: 'orchid',
    alpha_clip: true,
    variants: 2,
    ops: [
      {
        op: 'bloom',
        head_rgb: [196, 96, 168],
        petal_rgb: [214, 138, 196],
        stem_rgb: [72, 116, 56],
        eye_rgb: [244, 232, 176],
        radius: 9,
        petals: 5,
        head_y: 0.32,
      },
    ],
  },
  {
    // YOUNG SHOOT — a small bright-green sprout (fresh growth). Grass-family tint.
    name: 'young_shoot',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'stalks',
        count: 5,
        rgb: [96, 158, 74],
        tip_rgb: [150, 196, 108],
        min_h: 0.3,
        span_h: 0.22,
        spread: 0.9,
        tip_start: 0.5,
      },
    ],
  },
  // ── PARADISE (dry sand columns — reachable by the existing land pass) ────────────────────────────
  {
    // BEACH DUNE GRASS — pale, tall, wispy tussock. Grass-family tint (paradise palette pulls it sandy).
    name: 'dune_grass',
    alpha_clip: true,
    variants: 4,
    ops: [
      {
        op: 'stalks',
        count: 9,
        rgb: [150, 158, 104],
        tip_rgb: [214, 206, 150],
        tip_rgb2: [186, 172, 116],
        min_h: 0.62,
        span_h: 0.34,
        spread: 0.7,
        lean: 0.22,
        tip_start: 0.4,
      },
    ],
  },
  {
    // SEASHELL — a pale scallop fan on the sand. Fixed cream/pink.
    name: 'seashell',
    alpha_clip: true,
    variants: 3,
    ops: [{ op: 'shell', rgb: [234, 208, 196], ridge_rgb: [198, 158, 148] }],
  },
  {
    // STARFISH — a tan five-armed star. Fixed colour.
    name: 'starfish',
    alpha_clip: true,
    variants: 2,
    ops: [{ op: 'starfish', rgb: [222, 148, 82], rgb_light: [244, 196, 140] }],
  },
  {
    // DRIFTWOOD BRANCH — a sun-bleached grey branch. Fixed pale grey-brown.
    name: 'driftwood',
    alpha_clip: true,
    variants: 2,
    ops: [{ op: 'branch', rgb: [168, 158, 142], rgb_dark: [126, 116, 102], forks: 2, thick: 0.05 }],
  },
  // ── EVERGLADES (swamp/wetland) ──────────────────────────────────────────────────────────────────
  {
    // CATTAIL — tall marsh reeds topped by a brown seed-spike. Grass-family tint (murky green in-biome).
    name: 'cattail',
    alpha_clip: true,
    variants: 3,
    ops: [{ op: 'cattail', stalk_rgb: [92, 128, 66], spike_rgb: [102, 68, 38], spike_hi_rgb: [138, 98, 60], count: 4 }],
  },
  {
    // SWAMP WEED — a low murky broad-leaf clump. Grass-family tint.
    name: 'swamp_weed',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'bush',
        rgb: [76, 100, 52],
        rgb_dark: [46, 66, 36],
        rgb_light: [104, 128, 70],
        hole: 0.28,
        rx: 0.44,
        ry: 0.32,
        cy: 0.66,
      },
    ],
  },
  {
    // MOSS TUFT — a very short dense dark-green fuzz. Grass-family tint.
    name: 'moss_tuft',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'stalks',
        count: 16,
        rgb: [58, 92, 50],
        tip_rgb: [92, 128, 74],
        min_h: 0.22,
        span_h: 0.16,
        spread: 1.6,
        tip_start: 0.4,
      },
    ],
  },
  // ── EVEREST (alpine/arctic) ─────────────────────────────────────────────────────────────────────
  {
    // FROZEN SHRUB — a bare twiggy shrub dusted with frost. Fixed dark wood + baked frost highlight.
    name: 'frozen_shrub',
    alpha_clip: true,
    variants: 3,
    ops: [
      { op: 'branch', rgb: [74, 62, 54], rgb_dark: [50, 42, 38], forks: 4, thick: 0.038, frost_rgb: [226, 234, 240] },
    ],
  },
  {
    // ALPINE FLOWER — a small hardy blue-white bloom. Flower-family tint.
    name: 'alpine_flower',
    alpha_clip: true,
    variants: 2,
    ops: [
      {
        op: 'bloom',
        head_rgb: [126, 152, 210],
        petal_rgb: [170, 190, 228],
        stem_rgb: [78, 104, 62],
        eye_rgb: [240, 236, 210],
        radius: 7,
        petals: 5,
        head_y: 0.4,
      },
    ],
  },
  {
    // LICHEN PATCH — a very low crusty grey-green mat on rock. Grass-family tint (subtle).
    name: 'lichen',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'stalks',
        count: 18,
        rgb: [120, 138, 96],
        tip_rgb: [156, 166, 128],
        min_h: 0.14,
        span_h: 0.12,
        spread: 1.8,
        tip_start: 0.3,
      },
    ],
  },
  // ── RIVIERA (mediterranean garrigue — config may not exist yet; art ships regardless) ────────────
  {
    // DRY THISTLE — spiky grey-green with a purple crown. Grass-family tint.
    name: 'thistle',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'stalks',
        count: 7,
        rgb: [104, 122, 82],
        tip_rgb: [150, 96, 170],
        tip_rgb2: [176, 120, 190],
        min_h: 0.5,
        span_h: 0.3,
        spread: 0.8,
        lean: 0.1,
        tip_start: 0.68,
      },
    ],
  },
  {
    // LAVENDER — narrow silver-green stalks with purple flower spikes. Grass-family tint.
    name: 'lavender',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'stalks',
        count: 10,
        rgb: [128, 146, 110],
        tip_rgb: [132, 104, 186],
        tip_rgb2: [158, 128, 202],
        min_h: 0.5,
        span_h: 0.26,
        spread: 0.5,
        tip_start: 0.62,
      },
    ],
  },
  {
    // GARRIGUE SHRUB — a dry, silvery grey-green mediterranean scrub bush. Grass-family tint.
    name: 'garrigue',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'bush',
        rgb: [110, 124, 88],
        rgb_dark: [78, 92, 62],
        rgb_light: [148, 158, 116],
        hole: 0.3,
        rx: 0.42,
        ry: 0.38,
      },
    ],
  },
  // ── UNDERWATER / FLOATING — ART ATOMS ONLY (placement deferred to the eng-stages underwater rewrite) ──
  {
    // SEAWEED — long wavy murky-green fronds (submerged accent). Grass-family tint. ART-ONLY: needs the
    // underwater emission path (surface_flora() hard-skips submerged columns today).
    name: 'seaweed',
    alpha_clip: true,
    variants: 3,
    ops: [
      {
        op: 'stalks',
        count: 8,
        rgb: [52, 104, 78],
        tip_rgb: [96, 150, 116],
        tip_rgb2: [72, 128, 96],
        min_h: 0.66,
        span_h: 0.3,
        spread: 0.7,
        lean: 0.4,
        tip_start: 0.4,
      },
    ],
  },
  {
    // LILY PAD — a flat notched round pad. Fixed green. ART-ONLY: needs a floating-at-water-surface emission
    // path (a vertical cross-billboard reads wrong for a flat pad — the eng-stages rewrite renders it flat).
    name: 'lily_pad',
    alpha_clip: true,
    variants: 2,
    ops: [{ op: 'lilypad', rgb: [86, 138, 66], rgb_dark: [56, 100, 46], vein_rgb: [44, 82, 40] }],
  },
]
