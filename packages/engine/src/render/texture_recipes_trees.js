// PROCEDURAL-TREE species art RECIPES (ENGINE_AAA_PLAN §3.4/§3.7, Lane A1) — the leaf/crown, bark and
// twig-card texture atoms for the procedural tree roster. AUTHORED AS DATA (the house baker style); each
// row maps to a §3.4 species need. ART ATOMS ONLY: these are new atlas layers consumed by NOTHING yet
// (no block registry, no placement, no material) — the frozen-MEDIUM law holds because an absent tree
// config never touches the default world (the recipes just add layers at the END of the atlas).
//
// APPEND-ONLY PARITY LAW: spread onto RECIPES at the very END (after FLORA_RECIPES) so every pre-existing
// atlas layer index stays byte-stable (guarded by texture_baker.test.js parity-hash pin). Recipes may use
// BOTH base ops (leaf/ramp/streaks/clumps/fbm/ao/speckle/cluster_speckle/border_darken/branch) and the new
// flora shape ops (needle_spray/frond/moss_drape) — all merge in the baker's OP_TABLE.
//
// Colours sit in the "Conquest" muted band (desaturated, value-rich) — birch/pine/swamp/dead barks and the
// per-species crown greens give a mixed treeline real species separation. PER-WORLD tinting is a B/C-phase
// wire-in (add these names to texture_palette.TEXTURE_FAMILIES then) — DELIBERATELY not done here so the
// absent-config bake stays byte-identical for the existing atlas.

/** @typedef {import('./texture_baker.js').Recipe} Recipe */
/** Tree ops read a superset of RecipeOp params (needle/frond/moss/branch knobs); a local intersection keeps
 *  them typed without touching the base typedef. TreeOp ⊆ RecipeOp so a TreeRecipe is assignable to Recipe.
 *  @typedef {import('./texture_baker.js').RecipeOp & { rgb_light?: number[], stem_rgb?: number[],
 *    needle_len?: number, forks?: number, thick?: number }} TreeOp */
/** @typedef {{ name: string, alpha_clip?: boolean, alpha?: number, variants?: number, ops: TreeOp[] }} TreeRecipe */

/** @type {TreeRecipe[]} */
export const TREE_RECIPES = [
  // ── LEAF / CROWN sprites (crossed-billboard cluster textures; §3.7 variants:4 for the leaf families) ──
  {
    // BROADLEAF CLUMP — oak_broadleaf + jungle_giant. A dappled foliage puff (op_leaf lacework holes), cooler
    // + a touch denser than the base `leaves` so a mixed forest reads as distinct species.
    name: 'tree_leaf_broadleaf',
    alpha_clip: true,
    variants: 4,
    ops: [
      {
        op: 'leaf',
        freq: 6,
        octaves: 3,
        hole: 0.3,
        rgb: [74, 104, 52],
        rgb_dark: [46, 72, 36],
        rgb_light: [112, 140, 74],
        vein_rgb: [32, 50, 26],
      },
    ],
  },
  {
    // BIRCH CLUMP — birch_slim. Small, PALE bright-green airy crown (more holes) — the light foil to oak.
    name: 'tree_leaf_birch',
    alpha_clip: true,
    variants: 4,
    ops: [
      {
        op: 'leaf',
        freq: 7,
        octaves: 3,
        hole: 0.42,
        rgb: [120, 150, 78],
        rgb_dark: [86, 116, 58],
        rgb_light: [158, 182, 108],
        vein_rgb: [70, 96, 50],
      },
    ],
  },
  {
    // CONIFER NEEDLE BUNCH — pine_cathedral + spruce_mid. Spiky drooping needle fascicles (op_needle_spray),
    // cold dark blue-green — the awe-biome crown, unmistakably needled vs the broadleaf puff.
    name: 'tree_needle_bunch',
    alpha_clip: true,
    variants: 4,
    ops: [
      {
        op: 'needle_spray',
        rgb: [42, 74, 58],
        rgb_light: [80, 112, 88],
        stem_rgb: [52, 42, 32],
        count: 7,
        needle_len: 0.13,
      },
    ],
  },
  {
    // DRY SAVANNA CROWN — acacia_umbrella. Sparse straw-olive lacework (op_leaf, most holes) — an open, thin
    // arid canopy; matches the leaves_dry family so a savanna edge reads apart.
    name: 'tree_leaf_dry',
    alpha_clip: true,
    variants: 4,
    ops: [
      {
        op: 'leaf',
        freq: 6,
        octaves: 3,
        hole: 0.5,
        rgb: [140, 128, 64],
        rgb_dark: [104, 94, 50],
        rgb_light: [176, 160, 92],
        vein_rgb: [84, 76, 42],
      },
    ],
  },
  {
    // SWAMP MOSS DRAPE — swamp_buttress. Hanging murky grey-green moss strands (op_moss_drape) — the draped,
    // low-tunnel wetland read.
    name: 'tree_moss_drape',
    alpha_clip: true,
    variants: 4,
    ops: [{ op: 'moss_drape', rgb: [72, 86, 56], rgb_light: [104, 118, 84], count: 14 }],
  },
  {
    // PALM FROND ROSETTE — palm_curve. Long arcing pinnate fronds fanning from a crown base (op_frond),
    // yellow-green — the card-only palm crown.
    name: 'tree_palm_frond',
    alpha_clip: true,
    variants: 3,
    ops: [{ op: 'frond', rgb: [112, 124, 40], rgb_dark: [74, 84, 26], rgb_light: [150, 158, 64], count: 7 }],
  },
  {
    // GIANT MUSHROOM CAP — mushroom_giant crown (§3.4 "cap voxels"). An OPAQUE domed cap surface: radial
    // bright-core→dark-rim ramp + mottled flesh + pale warts + crevice AO. Non-emissive (a surface giant,
    // not the cave glow-mushrooms). Stem reuses the existing `mushroom_stem` recipe (no new stem art).
    name: 'tree_mushroom_cap',
    variants: 3,
    ops: [
      {
        op: 'ramp',
        axis: 'radial',
        stops: [
          { pos: 0, rgb: [178, 88, 66] },
          { pos: 1, rgb: [118, 54, 42] },
        ],
      }, // domed cap: lit crown → shaded rim
      { op: 'clumps', freq: 3, octaves: 2, rgb: [150, 70, 54], threshold: 0.5, soft: 0.3, strength: 0.4 }, // flesh mottle
      { op: 'fbm', freq: 4, octaves: 3, amp: 0.1 },
      { op: 'speckle', freq: 7, density: 0.14, rgb: [216, 198, 172] }, // pale warts
      { op: 'ao', freq: 6, octaves: 3, amp: 0.16, bias: 0.5 },
      { op: 'border_darken', width: 2, amount: 0.2 },
    ],
  },
  // ── BARK (opaque trunk/branch cube textures). NO vertical ramp (a flat base keeps a STACKED trunk column
  // seamless top-to-bottom, the `log` precedent) — vertical grain via streaks dir:'x'. oak/jungle reuse the
  // existing `log`; palm reuses `palm_log`; only the genuinely-distinct species barks are new. ──
  {
    // BIRCH BARK — the iconic near-WHITE papery bark with dark horizontal lenticel dashes + peeling patches.
    name: 'tree_bark_birch',
    variants: 4,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [206, 206, 198] },
          { pos: 1, rgb: [206, 206, 198] },
        ],
      }, // flat pale birch
      { op: 'streaks', dir: 'y', freq: 14, strength: 0.18 }, // thin HORIZONTAL lenticel banding
      { op: 'clumps', freq: 4, octaves: 2, rgb: [150, 146, 138], threshold: 0.6, soft: 0.3, strength: 0.3 }, // grey papery peel patches
      { op: 'cluster_speckle', cluster_freq: 6, density: 0.5, darken: 0.7, rgb: [40, 36, 32] }, // dark lenticel marks
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.07 },
      { op: 'ao', freq: 6, octaves: 3, amp: 0.12, bias: 0.48 },
    ],
  },
  {
    // PINE BARK — reddish-brown PLATED conifer bark (worley plate network + vertical seams). 5 variants for
    // per-trunk-column continuity (the material keys the log-variant on x,z).
    name: 'tree_bark_pine',
    variants: 5,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [112, 68, 44] },
          { pos: 1, rgb: [112, 68, 44] },
        ],
      }, // flat reddish pine
      { op: 'streaks', dir: 'x', freq: 6, strength: 0.26 }, // vertical plate seams
      { op: 'worley', freq: 4, strength: 0.3, threshold: 0.12 }, // bark-plate fracture network
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.12 },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [74, 44, 28], threshold: 0.5, soft: 0.3, strength: 0.5 }, // dark plate shadow
      { op: 'clumps', freq: 4, octaves: 2, rgb: [150, 102, 62], threshold: 0.6, soft: 0.26, strength: 0.3 }, // lit plate top
      { op: 'cluster_speckle', cluster_freq: 4, density: 0.3, darken: 0.34 }, // deep cracks
      { op: 'ao', freq: 7, octaves: 3, amp: 0.16, bias: 0.5 },
    ],
  },
  {
    // ACACIA BARK — pale warm smooth savanna trunk (light streaks, gentle mottle). The right base under a
    // straw dry crown (dark `log` reads wrong on a savanna acacia).
    name: 'tree_bark_acacia',
    variants: 4,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [150, 132, 98] },
          { pos: 1, rgb: [150, 132, 98] },
        ],
      }, // flat pale warm tan
      { op: 'streaks', dir: 'x', freq: 8, strength: 0.12 }, // faint vertical grain
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.1 },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [112, 96, 66], threshold: 0.5, soft: 0.32, strength: 0.36 }, // shade
      { op: 'clumps', freq: 4, octaves: 2, rgb: [182, 164, 124], threshold: 0.62, soft: 0.26, strength: 0.26 }, // sun highlight
      { op: 'ao', freq: 6, octaves: 3, amp: 0.12, bias: 0.5 },
    ],
  },
  {
    // SWAMP BARK — dark wet MOSSY buttress trunk (green moss crust crawling over damp bark + cracks).
    name: 'tree_bark_swamp',
    variants: 4,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [64, 58, 46] },
          { pos: 1, rgb: [64, 58, 46] },
        ],
      }, // flat dark damp wood
      { op: 'streaks', dir: 'x', freq: 7, strength: 0.24 }, // vertical grain
      { op: 'clumps', freq: 3, octaves: 3, rgb: [58, 74, 46], threshold: 0.5, soft: 0.3, strength: 0.5 }, // moss crust
      { op: 'clumps', freq: 4, octaves: 3, rgb: [86, 104, 66], threshold: 0.64, soft: 0.26, strength: 0.3 }, // lit moss
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.12 },
      { op: 'cluster_speckle', cluster_freq: 4, density: 0.3, darken: 0.4 }, // wet cracks
      { op: 'ao', freq: 7, octaves: 3, amp: 0.2, bias: 0.5 },
    ],
  },
  {
    // DEAD BARK — grey bleached leached deadwood (dead_snag): strong dry grain cracks + splits, no colour.
    name: 'tree_bark_dead',
    variants: 4,
    ops: [
      {
        op: 'ramp',
        axis: 'v',
        stops: [
          { pos: 0, rgb: [132, 124, 112] },
          { pos: 1, rgb: [132, 124, 112] },
        ],
      }, // flat weathered grey
      { op: 'streaks', dir: 'x', freq: 9, strength: 0.3 }, // coarse dry grain
      { op: 'streaks', dir: 'x', freq: 15, strength: 0.16 }, // fine split fibre
      { op: 'fbm', freq: 5, octaves: 3, amp: 0.12 },
      { op: 'clumps', freq: 3, octaves: 2, rgb: [92, 86, 78], threshold: 0.5, soft: 0.3, strength: 0.5 }, // grey shade
      { op: 'clumps', freq: 4, octaves: 2, rgb: [168, 160, 148], threshold: 0.62, soft: 0.26, strength: 0.3 }, // bleached highlight
      { op: 'cluster_speckle', cluster_freq: 4, density: 0.34, darken: 0.4 }, // splits / cracks
      { op: 'ao', freq: 7, octaves: 3, amp: 0.18, bias: 0.5 },
    ],
  },
  // ── TWIG / BRANCH CARDS (alpha-clip cross billboards; §3.7 "the biggest single 'not a lollipop' read") ──
  {
    // BARE TWIG — a woody branch card with several side-shoot forks (op_branch tuned twiggier). The generic
    // mid-crown branch structure between trunk and foliage (oak/birch/acacia/swamp/jungle/dead_snag).
    name: 'tree_twig_bare',
    alpha_clip: true,
    variants: 3,
    ops: [{ op: 'branch', rgb: [92, 68, 46], rgb_dark: [58, 42, 28], forks: 5, thick: 0.035 }],
  },
  {
    // NEEDLED TWIG — a conifer branch card: a woody stem (op_branch) with a needle spray layered over it
    // (op_needle_spray) so pine/spruce mid-crowns read as real needled branches, not bare sticks.
    name: 'tree_twig_conifer',
    alpha_clip: true,
    variants: 3,
    ops: [
      { op: 'branch', rgb: [74, 54, 38], rgb_dark: [48, 36, 26], forks: 4, thick: 0.03 },
      {
        op: 'needle_spray',
        rgb: [44, 76, 60],
        rgb_light: [80, 114, 90],
        stem_rgb: [60, 48, 36],
        count: 6,
        needle_len: 0.11,
      },
    ],
  },
]
