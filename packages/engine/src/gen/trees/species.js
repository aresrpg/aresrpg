// PROCEDURAL TREE SPECIES ROSTER (ENGINE AAA PLAN §3.4 — the scale-identity home). Pure DATA: seed +
// these params → a deterministic voxel skeleton + canopy (tree_gen.js). No render/ imports, no engine
// state — a species is a plain record the generator reads. Block references are NAMES (resolved through
// block_registry at generate time so the roster tracks the registry, never a hard-coded id); every name
// here EXISTS in the live registry today (log/leaves/leaves_conifer/leaves_dry/palm_log/palm_leaves/
// mushroom_stem/mushroom_cap_azure bark+canopy, dead_branch twig cards) — this lane has NO dependency on
// the A1 texture lane. When A1 ships dedicated per-species bark/twig blocks, a species swaps one name.
//
// DETERMINISM (§3.2/§3.7): every field is an integer or a small integer band [min,max]. The generator
// consumes them with integer/fixed-point math only — same seed ⇒ byte-identical tree on worker AND main.

/**
 * A tree form — selects which builder in tree_gen.js draws the skeleton. Distinct silhouettes come from
 * params, not per-species code:
 *  - `conifer`   : one tall central trunk + whorls of short lateral branches, conical (pine, spruce).
 *  - `broadleaf` : trunk forks into recursively-splitting limbs, spreading dome (oak/birch); flags fold
 *                  in acacia (flat crown), swamp (lean+root flare), jungle (mid tiers), dead snag (no leaf).
 *  - `palm`      : curved single stem + a card-only frond rosette at the crown.
 *  - `mushroom`  : stem + a domed cap shell.
 * @typedef {'conifer'|'broadleaf'|'palm'|'mushroom'} TreeForm
 */

/**
 * @typedef {object} SpeciesParams
 * @property {string} key stable species id (also the schematic name prefix)
 * @property {TreeForm} form builder selector
 * @property {string} bark trunk/branch block name (registry)
 * @property {string|null} leaf canopy block name, or null for a leafless snag
 * @property {string|null} twig branch-card block name (cross foliage), or null
 * @property {number} h_min pre-age trunk height band, blocks
 * @property {number} h_max pre-age trunk height band, blocks
 * @property {number} trunk_r base trunk radius, blocks (tapers to 1 at the crown)
 * @property {number} lean_max max trunk lean magnitude (fixed-point ×16 slope; 0 = ramrod)
 * @property {number} crown_start fraction ×256 of height where the crown begins (bare bole below)
 * @property {number} crown_r outer canopy radius, blocks (governs `reach`/halo — keep giants ≤12)
 * @property {number} blob_r_min leaf-cluster ellipsoid radius band, blocks
 * @property {number} blob_r_max leaf-cluster ellipsoid radius band, blocks
 * @property {number} leaf_hole lacework: /256 chance a candidate cluster is SKIPPED (sky gaps 15-30%)
 * @property {number} sway_scale render sway multiplier (metadata for the vertex; gen geometry ignores it)
 * @property {number} colossal_chance /256 region-gated ×colossal height (metadata for B2; core reads age)
 * @property {number} voxel_cap budget ceiling — the budget test asserts every (seed,age) stays under it
 * @property {number} voxel_floor budget floor — asserts a tree is never bald/holey (occupancy-miss guard)
 * @property {number} reach_cap horizontal-reach ceiling (halo governance §3.5; pine ≤12, jungle ≤14)
 * conifer-only:
 * @property {number} [whorl_gap_min] blocks between whorls
 * @property {number} [whorl_gap_max] blocks between whorls
 * @property {number} [whorl_branches] lateral branches per whorl
 * @property {number} [whorl_droop] pitch band (0-4) of whorl branches (low = drooping out)
 * broadleaf-only:
 * @property {number} [split_depth] recursion depth of limb forks
 * @property {number} [split_min] children per fork
 * @property {number} [split_max] children per fork
 * @property {number} [split_spread] yaw spread of children (YAW16 index units)
 * @property {number} [fork_frac] fraction ×256 up the trunk where forking starts
 * @property {boolean} [crown_flat] acacia: flatten the crown into a wide thin pancake
 * @property {boolean} [mid_crowns] jungle: add an emergent mid-height tier of clusters
 * @property {number} [root_flare] swamp: widen the trunk base by this many blocks (buttress roots)
 */

/** Age-morph bands (§3.3) — the per-instance SHAPE variety axis. Applied to height + crown density; the
 *  ancient band adds a broken-top / deadwood chance. `scale` multiplies height (×256 fixed-point), `crown`
 *  scales cluster count, `broken` /256 = chance the top is snapped (dead spike). @typedef {object} AgeBand
 *  @property {string} name @property {number} scale @property {number} crown @property {number} broken */
/** @type {Record<'young'|'mature'|'ancient', AgeBand>} */
export const AGE_BANDS = {
  young: { name: 'young', scale: 154 /* 0.60 */, crown: 176 /* 0.69 */, broken: 0 },
  mature: { name: 'mature', scale: 256 /* 1.00 */, crown: 256 /* 1.00 */, broken: 0 },
  ancient: { name: 'ancient', scale: 294 /* 1.15 */, crown: 269 /* 1.05 */, broken: 90 /* .35 */ },
}
/** Age roll weights (/256): young 96, mature 128, ancient 32 — most trees mature, ancients are the rare
 *  landmark read. Order matters (cumulative). @type {Array<['young'|'mature'|'ancient', number]>} */
export const AGE_WEIGHTS = [
  ['young', 96],
  ['mature', 128],
  ['ancient', 32],
]

/**
 * The baseline roster (ENGINE AAA PLAN §3.4). Ten silhouettes; pine_cathedral is the 30-62-block awe
 * biome (HARD requirement). Params tuned so each species' voxel count sits in its §3.3 band and giant
 * reach stays ≤12 (no halo regression). Keyed by species key.
 * @type {Record<string, SpeciesParams>}
 */
export const SPECIES = {
  oak_broadleaf: {
    key: 'oak_broadleaf',
    form: 'broadleaf',
    bark: 'log',
    leaf: 'leaves',
    twig: 'dead_branch',
    h_min: 8,
    h_max: 16,
    trunk_r: 2,
    lean_max: 6,
    crown_start: 128,
    crown_r: 8,
    blob_r_min: 2,
    blob_r_max: 3,
    leaf_hole: 56,
    sway_scale: 90,
    colossal_chance: 6,
    voxel_cap: 1800,
    voxel_floor: 250,
    reach_cap: 12,
    split_depth: 3,
    split_min: 2,
    split_max: 3,
    split_spread: 3,
    fork_frac: 150,
  },
  birch_slim: {
    key: 'birch_slim',
    form: 'broadleaf',
    bark: 'log',
    leaf: 'leaves',
    twig: 'dead_branch',
    h_min: 10,
    h_max: 18,
    trunk_r: 1,
    lean_max: 4,
    crown_start: 150,
    crown_r: 5,
    blob_r_min: 1,
    blob_r_max: 2,
    leaf_hole: 64,
    sway_scale: 110,
    colossal_chance: 4,
    voxel_cap: 520,
    voxel_floor: 78,
    reach_cap: 8,
    split_depth: 2,
    split_min: 2,
    split_max: 3,
    split_spread: 2,
    fork_frac: 176,
  },
  pine_cathedral: {
    key: 'pine_cathedral',
    form: 'conifer',
    bark: 'log',
    leaf: 'leaves_conifer',
    twig: 'dead_branch',
    h_min: 30,
    h_max: 62,
    trunk_r: 4,
    lean_max: 3,
    crown_start: 115,
    crown_r: 9,
    blob_r_min: 1,
    blob_r_max: 2,
    leaf_hole: 40,
    sway_scale: 40,
    colossal_chance: 20,
    voxel_cap: 6500,
    voxel_floor: 760,
    reach_cap: 12,
    whorl_gap_min: 2,
    whorl_gap_max: 3,
    whorl_branches: 6,
    whorl_droop: 1,
  },
  spruce_mid: {
    key: 'spruce_mid',
    form: 'conifer',
    bark: 'log',
    leaf: 'leaves_conifer',
    twig: 'dead_branch',
    h_min: 14,
    h_max: 26,
    trunk_r: 2,
    lean_max: 3,
    crown_start: 90,
    crown_r: 5,
    blob_r_min: 1,
    blob_r_max: 2,
    leaf_hole: 44,
    sway_scale: 60,
    colossal_chance: 8,
    voxel_cap: 1700,
    voxel_floor: 150,
    reach_cap: 8,
    whorl_gap_min: 2,
    whorl_gap_max: 3,
    whorl_branches: 5,
    whorl_droop: 1,
  },
  acacia_umbrella: {
    key: 'acacia_umbrella',
    form: 'broadleaf',
    bark: 'log',
    leaf: 'leaves_dry',
    twig: 'dead_branch',
    h_min: 7,
    h_max: 12,
    trunk_r: 2,
    lean_max: 5,
    crown_start: 160,
    crown_r: 9,
    blob_r_min: 2,
    blob_r_max: 3,
    leaf_hole: 60,
    sway_scale: 80,
    colossal_chance: 5,
    voxel_cap: 1800,
    voxel_floor: 250,
    reach_cap: 14,
    split_depth: 2,
    split_min: 3,
    split_max: 4,
    split_spread: 4,
    fork_frac: 180,
    crown_flat: true,
  },
  swamp_buttress: {
    key: 'swamp_buttress',
    form: 'broadleaf',
    bark: 'log',
    leaf: 'leaves',
    twig: 'dead_branch',
    h_min: 10,
    h_max: 20,
    trunk_r: 3,
    lean_max: 16,
    crown_start: 140,
    crown_r: 8,
    blob_r_min: 2,
    blob_r_max: 3,
    leaf_hole: 52,
    sway_scale: 70,
    colossal_chance: 6,
    voxel_cap: 1950,
    voxel_floor: 350,
    reach_cap: 12,
    split_depth: 2,
    split_min: 2,
    split_max: 3,
    split_spread: 3,
    fork_frac: 150,
    root_flare: 2,
  },
  jungle_giant: {
    key: 'jungle_giant',
    form: 'broadleaf',
    bark: 'log',
    leaf: 'leaves',
    twig: 'dead_branch',
    h_min: 20,
    h_max: 34,
    trunk_r: 3,
    lean_max: 4,
    crown_start: 150,
    crown_r: 11,
    blob_r_min: 2,
    blob_r_max: 3,
    leaf_hole: 48,
    sway_scale: 55,
    colossal_chance: 10,
    voxel_cap: 3400,
    voxel_floor: 620,
    reach_cap: 15,
    split_depth: 3,
    split_min: 2,
    split_max: 3,
    split_spread: 3,
    fork_frac: 168,
    mid_crowns: true,
  },
  palm_curve: {
    key: 'palm_curve',
    form: 'palm',
    bark: 'palm_log',
    leaf: 'palm_leaves',
    twig: 'dead_branch',
    h_min: 8,
    h_max: 14,
    trunk_r: 1,
    lean_max: 40,
    crown_start: 220,
    crown_r: 6,
    blob_r_min: 1,
    blob_r_max: 2,
    leaf_hole: 30,
    sway_scale: 120,
    colossal_chance: 4,
    voxel_cap: 520,
    voxel_floor: 88,
    reach_cap: 11,
  },
  dead_snag: {
    key: 'dead_snag',
    form: 'broadleaf',
    bark: 'log',
    leaf: null,
    twig: 'dead_branch',
    h_min: 6,
    h_max: 14,
    trunk_r: 2,
    lean_max: 8,
    crown_start: 120,
    crown_r: 5,
    blob_r_min: 1,
    blob_r_max: 1,
    leaf_hole: 0,
    sway_scale: 30,
    colossal_chance: 4,
    voxel_cap: 420,
    voxel_floor: 52,
    reach_cap: 7,
    split_depth: 3,
    split_min: 2,
    split_max: 3,
    split_spread: 4,
    fork_frac: 130,
  },
  mushroom_giant: {
    key: 'mushroom_giant',
    form: 'mushroom',
    bark: 'mushroom_stem',
    leaf: 'mushroom_cap_azure',
    twig: null,
    h_min: 6,
    h_max: 12,
    trunk_r: 2,
    lean_max: 6,
    crown_start: 210,
    crown_r: 6,
    blob_r_min: 3,
    blob_r_max: 5,
    leaf_hole: 0,
    sway_scale: 20,
    colossal_chance: 6,
    voxel_cap: 820,
    voxel_floor: 175,
    reach_cap: 8,
  },
}

/** Every species key (stable order for contact sheets / tests). @type {string[]} */
export const SPECIES_KEYS = Object.keys(SPECIES)

/**
 * Resolve a species argument (key string or params object) to its params. Throws on an unknown key so a
 * typo fails loud at gen time, never silently places the wrong tree.
 * @param {string|SpeciesParams} species
 * @returns {SpeciesParams}
 */
export function resolve_species(species) {
  if (typeof species !== 'string') return species
  const p = SPECIES[species]
  if (p === undefined) throw new Error(`unknown tree species "${species}"`)
  return p
}
