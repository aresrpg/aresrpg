// GATHERABLE sprite RECIPES (ENGINE_AAA_PLAN §5 — rider 2 "all our 11 wheat types, the ores, and the
// plants for herbalist, proper texture color scales and glows"). Counts VERIFIED against the live seeds
// (seed/gathering/{farmer,herbalist,miner}/{base,rare}_resources.json): FARMER 11 base + 11 rare · HERBALIST
// 11 base + 21 rare (11 legendary gather-drops 1:1 with the base tiers + 10 crafted reagents) · MINER 11
// base + 11 "Infinity" rare = 33 BASE + 43 RARE = 76 recipes. Recipe/block NAME == the seed `id` (no engine
// collisions — grep-verified) so the icon bake (A4) + on-chain Display join on one key.
//
// DATA-FIRST: the identity of each family is a designed 11-STEP LEVEL RAMP (perceptually spaced — the ΔE
// test asserts every sibling stays tellable at 64px sprite AND 32px icon). The recipes are GENERATED from
// the ramps + a rare-meta table, so a colour lives in exactly one place. Every recipe uses ONLY the three
// gather ops (texture_ops_gather.js). Spread onto RECIPES at the END (append-only ⇒ pre-existing atlas layer
// indices byte-stable — the parity law); base names register foliage cross blocks (block_registry_gather.js),
// rares are atlas layers + an emission-value table (the frontend node-state glow reads it — B8/placement is
// out of this lane's fence).

/** @typedef {import('./texture_baker.js').Recipe} Recipe */
/** The gather ops read params the base RecipeOp doesn't declare (wheat/ore/herb knobs); a local intersection
 *  keeps them typed WITHOUT touching the base baker typedef. GatherOp ⊆ RecipeOp, so a GatherRecipe is
 *  assignable to Recipe at the RECIPES spread site (mirrors texture_recipes_flora.js FloraOp/FloraRecipe).
 *  @typedef {import('./texture_baker.js').RecipeOp & { shape?: string, glow_rgb?: number[],
 *    stalk_dark_rgb?: number[], head_rgb?: number[], head_hi_rgb?: number[], awn_rgb?: number[],
 *    droop?: number, ear_len?: number, grains?: number, rock_rgb?: number[], rock_dark_rgb?: number[],
 *    vein_dark_rgb?: number[], glint_rgb?: number[], facets?: number, rgb_dark?: number[],
 *    rgb_light?: number[], petal_rgb?: number[], stem_rgb?: number[], eye_rgb?: number[],
 *    wart_rgb?: number[], spot_rgb?: number[] }} GatherOp */
/** @typedef {{ name: string, alpha_clip?: boolean, variants?: number, blocks?: string[], ops: GatherOp[] }} GatherRecipe */
/** @typedef {[number, number, number]} RGB */
/** @typedef {{ id: string, level: number, rgb: RGB, p?: Record<string, any> }} RampEntry */

// ── colour helpers (pure; no trig) — return RGB tuples so op params stay well-typed ─────────────────────
const clamp255 = (/** @type {number} */ v) => Math.max(0, Math.min(255, Math.round(v)))
/** @param {number[]} c @param {number} f 0..1 toward black @returns {RGB} */
const darken = (c, f) => /** @type {RGB} */ (c.map((v) => clamp255(v * (1 - f))))
/** @param {number[]} c @param {number} f 0..1 toward white @returns {RGB} */
const lighten = (c, f) => /** @type {RGB} */ (c.map((v) => clamp255(v + (255 - v) * f)))
/** @param {number[]} a @param {number[]} b @param {number} t @returns {RGB} */
const mix = (a, b, t) => /** @type {RGB} */ (a.map((v, i) => clamp255(v + (b[i] - v) * t)))
/** Rec.709 relative luma of a 0-255 rgb, in 0..1. @param {number[]} c */
export const luma01 = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255

// ── NO-WHITE-HALO ceiling (§5.1): rare self-glow emission luma capped so albedo+emission stays under the
// 2.05 bloom threshold at MEDIUM (a sunlit bright texel ≈1.3 + 0.5 = 1.8 < 2.05). The GOLDEN rare-gather
// sits AT the ceiling (the plan's named reference); every other glow scales down to keep luma ≤ ceiling. On
// HIGH bloom may catch the brightest faintly. Consumed by GATHER_RARE_EMISSION below + the ceiling test.
export const GATHER_EMISSION_LUMA_CEILING = 0.5
/** Rare glow → block emission_rgb: scale the glow hue down so its luma never exceeds the ceiling (bright
 *  glows clamp to the ceiling, dim ones pass through). @param {number[]} glow @returns {[number,number,number]} */
export function emission_from_glow(glow) {
  const l = luma01(glow)
  const k = l > GATHER_EMISSION_LUMA_CEILING ? GATHER_EMISSION_LUMA_CEILING / l : 1
  // FLOOR (not round): per-channel truncation only reduces luma, so the ceiling is a hard cap even after
  // integer quantisation (rounding up a channel could nudge luma a hair over — the no-white-halo law is strict).
  return /** @type {[number,number,number]} */ (glow.map((v) => Math.max(0, Math.min(255, Math.floor(v * k)))))
}

// glow accents by rare archetype (baked bright into the signal texels; also the emission hue).
export const GLOW = {
  gold: [255, 214, 120],
  ember: [255, 140, 54],
  spectral: [190, 232, 255], // crystal / ghost / ethereal — cool cyan-white
  arcane: [206, 150, 255],
  blood: [255, 74, 74],
  cursed: [150, 255, 120],
  verdant: [130, 255, 150],
}

// ── FARMER — the 11-step wheat ramp (straw-gold → charcoal → blood → arcane-violet → glacial-white). `rgb`
// is the identity (ear) colour the ΔE test spaces; Burnt + Ukranize are genuinely two-tone (explicit `p`).
/** @type {RampEntry[]} */
export const WHEAT_RAMP = [
  { id: 'wheat', level: 1, rgb: [220, 162, 54] }, // punchy ripe-gold (ΔE-safe vs tanjirize's lemon sun-gold)
  { id: 'wheat_barley', level: 10, rgb: [176, 192, 120] }, // pale sage-green
  { id: 'wheat_malt', level: 20, rgb: [178, 124, 64] }, // toasted amber-brown
  {
    id: 'wheat_burnt',
    level: 30,
    rgb: [80, 72, 66],
    p: {
      head_rgb: [80, 72, 66],
      head_hi_rgb: [150, 96, 60],
      awn_rgb: [210, 96, 40],
      stalk_dark_rgb: [44, 40, 38],
      rgb: [70, 66, 62],
    },
  }, // charcoal + ember
  { id: 'wheat_tanjirize', level: 40, rgb: [244, 198, 64] }, // vivid sun-gold
  { id: 'wheat_suize', level: 50, rgb: [108, 150, 118] }, // murky delta teal-green
  {
    id: 'wheat_ukraine',
    level: 60,
    rgb: [104, 150, 214],
    p: { rgb: [96, 140, 200], stalk_dark_rgb: [70, 104, 150], head_rgb: [232, 196, 92], head_hi_rgb: [246, 216, 130] },
  }, // sky-blue + steppe-gold
  { id: 'blood_wheat', level: 70, rgb: [182, 46, 46] }, // blood-crimson
  { id: 'wheat_purple', level: 80, rgb: [156, 96, 206] }, // arcane-violet
  { id: 'wheat_draconize', level: 90, rgb: [222, 98, 40] }, // molten orange-red
  { id: 'wheat_white', level: 100, rgb: [226, 226, 216] }, // glacial white
]

// ── MINER — the 11-step ore ramp (clear-white → jade → amber → moon-silver → blood → dusk → obsidian →
// arcane-cyan → draconic-orange → cursed-green). `rgb` is the crystalline vein colour (the identity).
/** @type {RampEntry[]} */
export const ORE_RAMP = [
  { id: 'diamond', level: 1, rgb: [216, 234, 244] }, // icy clear-white
  { id: 'quartz', level: 10, rgb: [224, 206, 202] }, // warm cloudy grey
  { id: 'jade', level: 20, rgb: [72, 166, 120] }, // jade green
  { id: 'amber', level: 30, rgb: [216, 150, 50] }, // amber gold
  { id: 'moonstone', level: 40, rgb: [160, 182, 210] }, // moon-silver blue
  { id: 'bloodstone', level: 50, rgb: [166, 42, 46] }, // blood-red
  { id: 'duskite', level: 60, rgb: [80, 62, 108] }, // dusk-purple
  { id: 'obsidianite', level: 70, rgb: [46, 46, 58] }, // obsidian near-black
  { id: 'arcanite', level: 80, rgb: [56, 198, 208] }, // arcane-cyan
  { id: 'draconite', level: 90, rgb: [236, 116, 36] }, // draconic-orange
  { id: 'cursed_gem', level: 100, rgb: [124, 202, 58] }, // cursed toxic-green
]

// ── HERBALIST — the 11-step herb ramp. Diverse identities (mushroom/orchid/aloe/truffle/spore) rather than a
// monotonic sweep; `rgb` is the dominant read. Shape per herb (mostly existing atoms with new palettes).
/** @type {RampEntry[]} */
export const HERB_RAMP = [
  { id: 'green_mushroom', level: 1, rgb: [134, 178, 98] }, // sickly pale green
  { id: 'red_orchid', level: 10, rgb: [200, 58, 78] }, // crimson orchid
  { id: 'ivory_shrooms', level: 20, rgb: [230, 222, 196] }, // cream ivory
  { id: 'aloe_vera', level: 30, rgb: [92, 168, 150] }, // teal succulent
  { id: 'nightcap', level: 40, rgb: [82, 138, 222] }, // azure bioluminescent
  { id: 'crimson_truffle', level: 50, rgb: [126, 40, 54] }, // dark burgundy
  { id: 'phantom_spore', level: 60, rgb: [180, 210, 214] }, // pale ghost-cyan
  { id: 'witherbloom', level: 70, rgb: [154, 120, 134] }, // dusty decaying mauve
  { id: 'arcaneshroom', level: 80, rgb: [154, 86, 204] }, // arcane violet
  { id: 'dragonlily', level: 90, rgb: [214, 104, 72] }, // coral-red lily
  { id: 'cursed_fungus', level: 100, rgb: [74, 84, 68] }, // dark sickly grey-green
]

/** herb id → herb_cluster shape. @type {Record<string, string>} */
const HERB_SHAPE = {
  green_mushroom: 'shroom',
  red_orchid: 'orchid',
  ivory_shrooms: 'shroom',
  aloe_vera: 'aloe',
  nightcap: 'shroom',
  crimson_truffle: 'truffle',
  phantom_spore: 'spore',
  witherbloom: 'orchid',
  arcaneshroom: 'shroom',
  dragonlily: 'orchid',
  cursed_fungus: 'shroom',
}

// ── base recipe builders (identity colour → op params). One home per colour; overrides via entry.p. ───────
/** @param {RampEntry} e @returns {GatherRecipe} */
function wheat_recipe(e) {
  // Design ruling 2026-07-12 (punchy, not washed-out): WARM the stalk base + carry more of the ear identity (golden
  // stalks, not olive), and TAME the head/awn highlights (0.3/0.42 → 0.22/0.26) so the bright ticks stop
  // washing the sheaf pale-white at gather distance. ΔE-neutral (only WHEAT_RAMP[i].rgb feeds that guard).
  const stalk = mix([132, 120, 66], e.rgb, 0.42)
  return {
    name: e.id,
    alpha_clip: true,
    variants: 1,
    ops: [
      {
        op: 'wheat_sheaf',
        rgb: stalk,
        stalk_dark_rgb: darken(stalk, 0.3),
        head_rgb: e.rgb,
        head_hi_rgb: lighten(e.rgb, 0.22),
        awn_rgb: lighten(e.rgb, 0.26),
        ...(e.p ?? {}),
      },
    ],
  }
}
/** @param {RampEntry} e @returns {GatherRecipe} */
function ore_recipe(e) {
  return {
    name: e.id,
    alpha_clip: true,
    variants: 1,
    ops: [
      {
        op: 'ore_vein',
        rock_rgb: [96, 92, 88],
        rock_dark_rgb: [56, 53, 50],
        rgb: e.rgb,
        vein_dark_rgb: darken(e.rgb, 0.42),
        glint_rgb: lighten(e.rgb, 0.42),
        facets: 5,
        ...(e.p ?? {}),
      },
    ],
  } // glint tamed 0.55→0.42 (punchier crystal identity, less white cap)
}
/** @param {RampEntry} e @returns {GatherRecipe} */
function herb_recipe(e) {
  const shape = HERB_SHAPE[e.id] ?? 'shroom'
  return {
    name: e.id,
    alpha_clip: true,
    variants: 1,
    ops: [
      {
        op: 'herb_cluster',
        shape,
        rgb: e.rgb,
        rgb_dark: darken(e.rgb, 0.42),
        rgb_light: lighten(e.rgb, 0.3),
        petal_rgb: e.rgb,
        stem_rgb: [72, 116, 56],
        ...(e.p ?? {}),
      },
    ],
  } // highlight tamed 0.4→0.3 (punchier herb identity)
}

// ── RARE meta: 1:1 with the seed rare ids. `src` names the base whose SHAPE + colour it inherits; the rare
// reads as "that gatherable, glowing" (bright signal accent + a soft emission). MINER rare glow derives from
// the ore's own hue (Infinity {X} glows in {X}'s colour); FARMER/HERBALIST carry an archetype glow.
/** @typedef {{ id: string, src: string, glow?: number[] }} RareMeta */
/** @type {RareMeta[]} */
const FARMER_RARES = [
  { id: 'golden_wheat', src: 'wheat', glow: GLOW.gold },
  { id: 'shiny_barley', src: 'wheat_barley', glow: GLOW.gold },
  { id: 'pristine_malt', src: 'wheat_malt', glow: GLOW.gold },
  { id: 'smoldering_wheat', src: 'wheat_burnt', glow: GLOW.ember },
  { id: 'crystallized_tanjirize', src: 'wheat_tanjirize', glow: GLOW.spectral },
  { id: 'genesis_suize', src: 'wheat_suize', glow: GLOW.verdant },
  { id: 'ethereal_ukranize', src: 'wheat_ukraine', glow: GLOW.spectral },
  { id: 'abyssal_blood_wheat', src: 'blood_wheat', glow: GLOW.blood },
  { id: 'spectral_arcanize', src: 'wheat_purple', glow: GLOW.arcane },
  { id: 'primordial_draconize', src: 'wheat_draconize', glow: GLOW.ember },
  { id: 'cursed_wheat', src: 'wheat_white', glow: GLOW.cursed },
]
/** MINER: Infinity {X} — one per base ore, glow derived from the ore hue in the builder. */
const MINER_RARES = ORE_RAMP.map((e) => ({ id: `infinity_${e.id}`, src: e.id }))
/** HERBALIST: 11 legendary gather-drops (1:1 with base tiers) + 10 crafted reagents (src = primary base). */
const HERBALIST_RARES = [
  { id: 'golden_mushroom', src: 'green_mushroom', glow: GLOW.gold },
  { id: 'bloodveil_orchid', src: 'red_orchid', glow: GLOW.blood },
  { id: 'ghost_cap', src: 'ivory_shrooms', glow: GLOW.spectral },
  { id: 'verdant_aloe', src: 'aloe_vera', glow: GLOW.verdant },
  { id: 'golden_nightcap', src: 'nightcap', glow: GLOW.gold },
  { id: 'crimson_truffle_heart', src: 'crimson_truffle', glow: GLOW.blood },
  { id: 'phantom_essence', src: 'phantom_spore', glow: GLOW.spectral },
  { id: 'wither_petal', src: 'witherbloom', glow: GLOW.spectral },
  { id: 'arcane_spore', src: 'arcaneshroom', glow: GLOW.arcane },
  { id: 'dragon_pollen', src: 'dragonlily', glow: GLOW.gold },
  { id: 'cursed_root', src: 'cursed_fungus', glow: GLOW.cursed },
  { id: 'aloe_crystal_salve', src: 'aloe_vera', glow: GLOW.spectral },
  { id: 'arcane_reagent', src: 'arcaneshroom', glow: GLOW.arcane },
  { id: 'cursed_amalgam', src: 'cursed_fungus', glow: GLOW.cursed },
  { id: 'dragon_petal_extract', src: 'dragonlily', glow: GLOW.ember },
  { id: 'ivory_orchid_paste', src: 'ivory_shrooms', glow: GLOW.gold },
  { id: 'nightcap_elixir_base', src: 'nightcap', glow: GLOW.spectral },
  { id: 'orchid_spore_blend', src: 'red_orchid', glow: GLOW.arcane },
  { id: 'phantom_distillate', src: 'phantom_spore', glow: GLOW.spectral },
  { id: 'truffle_essence_compound', src: 'crimson_truffle', glow: GLOW.ember },
  { id: 'wither_concentrate', src: 'witherbloom', glow: GLOW.cursed },
]

// base recipes, indexed so rares can inherit their source's op params.
const BASE_ENTRIES = [
  ...WHEAT_RAMP.map((e) => ({ e, recipe: wheat_recipe(e) })),
  ...ORE_RAMP.map((e) => ({ e, recipe: ore_recipe(e) })),
  ...HERB_RAMP.map((e) => ({ e, recipe: herb_recipe(e) })),
]
/** base id → its single op params (the shape + colours a rare inherits). @type {Record<string, any>} */
const BASE_OP_BY_ID = Object.fromEntries(BASE_ENTRIES.map(({ recipe }) => [recipe.name, recipe.ops[0]]))
/** base id → identity rgb (ore rares derive their glow from it). @type {Record<string, number[]>} */
const BASE_RGB_BY_ID = Object.fromEntries([...WHEAT_RAMP, ...ORE_RAMP, ...HERB_RAMP].map((e) => [e.id, e.rgb]))

const ALL_RARES = [...FARMER_RARES, ...MINER_RARES, ...HERBALIST_RARES]
/** rare id → the glow used for both the baked accent and the emission (ore = brightened ore hue). @param {RareMeta} r */
const rare_glow = (r) => r.glow ?? lighten(BASE_RGB_BY_ID[r.src], 0.5)

/** @param {RareMeta} r @returns {GatherRecipe} */
function rare_recipe(r) {
  const base_op = BASE_OP_BY_ID[r.src]
  if (!base_op) throw new Error(`gather rare ${r.id}: unknown source base ${r.src}`)
  return { name: r.id, alpha_clip: true, variants: 1, blocks: [], ops: [{ ...base_op, glow_rgb: rare_glow(r) }] }
}

/** All 76 gather recipes (33 base + 43 rare), append-only. @type {GatherRecipe[]} */
export const GATHER_RECIPES = [...BASE_ENTRIES.map(({ recipe }) => recipe), ...ALL_RARES.map(rare_recipe)]

/** Rare id → soft self-glow emission_rgb (0-255), ceiling-capped (no-white-halo law). The single home for
 *  rare glow values; the frontend node-state presentation (B8) reads it. @type {Record<string, [number,number,number]>} */
export const GATHER_RARE_EMISSION = Object.fromEntries(ALL_RARES.map((r) => [r.id, emission_from_glow(rare_glow(r))]))

/** The three family base ramps, for the ΔE perceptual-spacing test. */
export const GATHER_RAMPS = { wheat: WHEAT_RAMP, ore: ORE_RAMP, herb: HERB_RAMP }

/** Base gatherable ids (register foliage cross blocks). @type {string[]} */
export const GATHER_BASE_IDS = BASE_ENTRIES.map(({ recipe }) => recipe.name)

/** Family groupings (base + rare ids) — the icon bake (A4) + gather-node presentation (B8) + contact-sheet
 *  proof read this to walk a family's full range. @type {Record<string, {base: string[], rare: string[]}>} */
export const GATHER_FAMILIES = {
  wheat: { base: WHEAT_RAMP.map((e) => e.id), rare: FARMER_RARES.map((r) => r.id) },
  ore: { base: ORE_RAMP.map((e) => e.id), rare: MINER_RARES.map((r) => r.id) },
  herb: { base: HERB_RAMP.map((e) => e.id), rare: HERBALIST_RARES.map((r) => r.id) },
}
