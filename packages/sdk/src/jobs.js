// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Jobs / gathering SSOT — ported faithfully (1:1) from the reference corpus:
//   - Job definitions
//   - Job XP table          (retro 1.29 curve, 100 lvls)
//   - Gathering formulas    (xp / amount / time / respawn)
//
// Consumed by the client JobsDrawer (job cards + progression bars) and the bottom-center job-xp bar
// (resolved from the equipped tool via job_from_tool). Pure data + integer math — no I/O, no floats
// leaking into game state (gather_time is display-only seconds). Gathering itself is
// server-authoritative; this is the shared definition + display math.

import ITEMS_DATA from './items.json' with { type: 'json' }
import RECIPES_DATA from './recipes.json' with { type: 'json' }
import JOB_CRAFTS from './job_crafts.json' with { type: 'json' }
import { to_chain_category } from './items.js'

export const JOB_CATEGORY = /** @type {const} */ ({
  GATHERING: 'gathering',
  WEAPON: 'weapon',
  EQUIPMENT: 'equipment',
  CONSUMABLE: 'consumable',
})

/**
 * The full job roster (Job.java). Gathering jobs carry a tool prefix (Job.matchesTool) so the
 * equipped weapon-slot tool resolves to its job. Craft jobs list the item categories they cover.
 * @typedef {{
 *   id: string,
 *   label: string,
 *   category: string,
 *   tool: string | null,
 *   tool_prefix: string | null,
 *   tool_category?: string,
 *   covers: string[],
 * }} JobDef
 */
/** @type {readonly JobDef[]} */
export const JOBS = /** @type {const} */ ([
  // Gathering (each has its own bench)
  {
    id: 'farmer',
    label: 'Farmer',
    category: JOB_CATEGORY.GATHERING,
    tool: 'Hoe',
    tool_prefix: 'Tool_Hoe_',
    // The items.json content category of this job's tool (e.g. old_hoe.category). The read-model keys an
    // equipped tool by its on-chain item_category, which to_chain_category COLLAPSES (all 3 -> 'pickaxe'),
    // so this content category is what recovers the true job from a read-model item (via its item_type).
    tool_category: 'tool_paysan',
    covers: [],
  },
  {
    id: 'herbalist',
    label: 'Herbalist',
    category: JOB_CATEGORY.GATHERING,
    tool: 'Sickle',
    tool_prefix: 'Tool_Sickle_',
    tool_category: 'tool_herbalist',
    covers: [],
  },
  {
    id: 'miner',
    label: 'Miner',
    category: JOB_CATEGORY.GATHERING,
    tool: 'Pickaxe',
    tool_prefix: 'Tool_Pickaxe_',
    tool_category: 'tool_miner',
    covers: [],
  },
  // Weapon craft — `covers` = Job.runeCategories() (the ItemCategory list each craft job covers),
  // verbatim from Job.java + the companion JOB_CRAFT_LABEL.
  {
    id: 'sword_smith',
    label: 'Sword Smith',
    category: JOB_CATEGORY.WEAPON,
    tool: null,
    tool_prefix: null,
    covers: ['longsword', 'sword', 'daggers'],
  },
  {
    id: 'axe_smith',
    label: 'Axe Smith',
    category: JOB_CATEGORY.WEAPON,
    tool: null,
    tool_prefix: null,
    covers: ['axe', 'battleaxe'],
  },
  {
    id: 'blunt_smith',
    label: 'Blunt Smith',
    category: JOB_CATEGORY.WEAPON,
    tool: null,
    tool_prefix: null,
    covers: ['mace', 'club'],
  },
  {
    id: 'staff_carver',
    label: 'Staff Carver',
    category: JOB_CATEGORY.WEAPON,
    tool: null,
    tool_prefix: null,
    covers: ['staff', 'spellbook'],
  },
  {
    id: 'bowyer',
    label: 'Bowyer',
    category: JOB_CATEGORY.WEAPON,
    tool: null,
    tool_prefix: null,
    covers: ['bow', 'spear'],
  },
  // Equipment craft
  {
    id: 'armorsmith',
    label: 'Armorsmith',
    category: JOB_CATEGORY.EQUIPMENT,
    tool: null,
    tool_prefix: null,
    covers: ['helmet', 'chestplate'],
  },
  {
    id: 'tailor',
    label: 'Tailor',
    category: JOB_CATEGORY.EQUIPMENT,
    tool: null,
    tool_prefix: null,
    covers: ['pants', 'boots'],
  },
  {
    id: 'tanner',
    label: 'Tanner',
    category: JOB_CATEGORY.EQUIPMENT,
    tool: null,
    tool_prefix: null,
    covers: ['belt', 'gauntlets'],
  },
  {
    id: 'jeweler',
    label: 'Jeweler',
    category: JOB_CATEGORY.EQUIPMENT,
    tool: null,
    tool_prefix: null,
    covers: ['amulet', 'ring'],
  },
  // Consumable & utility
  {
    id: 'alchemist',
    label: 'Alchemist',
    category: JOB_CATEGORY.CONSUMABLE,
    tool: null,
    tool_prefix: null,
    covers: [],
  },
  {
    id: 'baker',
    label: 'Baker',
    category: JOB_CATEGORY.CONSUMABLE,
    tool: null,
    tool_prefix: null,
    covers: [],
  },
  {
    id: 'handyman',
    label: 'Handyman',
    category: JOB_CATEGORY.CONSUMABLE,
    tool: null,
    tool_prefix: null,
    // Job.java HANDYMAN.runeCategories() = TOOL_HERBALIST, TOOL_PAYSAN, TOOL_MINER (the gathering tools it
    // forges). Its CONSUMABLE dungeon-key recipes are resolved via the explicit JOB_CRAFTS map (category alone
    // can't tell a handyman key from a baker bread).
    covers: ['tool_herbalist', 'tool_paysan', 'tool_miner'],
  },
])

/** @param {string} id @returns {JobDef | null} */
export function get_job(id) {
  return JOBS.find(job => job.id === id) ?? null
}

/**
 * @typedef {{ id: string, name: string, level: number, category: string, quality: string, icon: string }} CraftRecipe
 */

/** @typedef {{ id: string, name: string, qty: number, level: number, icon: string, quality: string }} RecipeIngredient */

/**
 * All craftable recipes for a craft job, derived 1:1 from the real reference-corpus content seed. A recipe belongs to
 * a job by EITHER its covered ItemCategory list (`JobDef.covers` = Job.runeCategories() — weapon/equipment
 * jobs + handyman's tools) OR the explicit recipe->job map (`job_crafts.json` — alchemist potions, baker
 * breads, handyman dungeon keys + their resource intermediaries, whose CONSUMABLE/RESOURCE category a
 * category match can't disambiguate). This mirrors the aresrpg companion (jobs_tab.tsx) which lists `items
 * where recipe.jobType === job` sorted by level. The recipe's UNLOCK LEVEL is the item's own level (the
 * companion gates the same way). Returns [] for gathering jobs.
 *
 * Real reference-corpus item names + levels + categories — no fabricated recipe names.
 * @param {string} job_id @returns {CraftRecipe[]}
 */
export function craft_recipes(job_id) {
  const job = get_job(job_id)
  if (!job || job.category === JOB_CATEGORY.GATHERING) return []
  const covered = new Set(job.covers)
  const explicit = /** @type {Record<string, string>} */ (JOB_CRAFTS)
  return Object.values(/** @type {Record<string, any>} */ (ITEMS_DATA))
    .filter(item => covered.has(item.category) || explicit[item.id] === job_id)
    .map(item => ({
      id: item.id,
      name: item.name,
      level: item.level ?? 1,
      category: item.category,
      quality: item.quality ?? 'common',
      icon: item.icon || item.id,
    }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}

/**
 * The crafting ingredients for a recipe item, resolved 1:1 from the real aresrpg content seed
 * (`recipes.json`, projected from every `recipeJson` across `../../aresrpg/seed/**`). Each ingredient
 * resolves its display name + icon + quality from `items.json` (the same SSOT). Returns [] when the
 * item carries no craft recipe in the seed (e.g. drop-only or not-yet-seeded items) — the UI then
 * shows a "not yet in the content seed" note rather than a fake bill of materials.
 * @param {string} item_id @returns {RecipeIngredient[]}
 */
export function recipe_ingredients(item_id) {
  const recipe =
    /** @type {Record<string, { ingredients: { id: string, qty: number }[] }>} */ (
      RECIPES_DATA
    )[item_id]
  if (!recipe) return []
  const items = /** @type {Record<string, any>} */ (ITEMS_DATA)
  return recipe.ingredients.map(({ id, qty }) => {
    const item = items[id]
    return {
      id,
      qty,
      level: item?.level ?? 1,
      name: item?.name ?? id,
      icon: item?.icon || id,
      quality: item?.quality ?? 'common',
    }
  })
}

// ── Asset resolution (MinIO — issue #650: full pivot off Walrus for SERVING; quilts are gone) ──
// Every rendered asset class (items, spells, mobs, cosmetics, characters, music, shop renders) AND every
// runtime content blob (mob_catalog, pet_catalog, spell_corpus, world_corpus, icon_slug_map) resolves
// through walrus_asset_url below, seeded once at boot from the published manifest
// (packages/frontend/public/asset_manifest.json). The name is historical (this resolver predates the
// MinIO pivot); every caller and class is unchanged — only the URL SHAPE is.
//
// THE MAPPING LAW (content house census, adopted verbatim, #650): the resolver alone owns the host+path
// table — one fixed rule, never duplicated per manifest row.
//   flat art  → {host}/{family}/{key}[_hd].{ext}   e.g. https://assets.aresrpg.world/items/longsword.png
//   geometry  → {host}/{geometry folder}/{key}.glb e.g. https://assets.aresrpg.world/models/mobs/crab.glb
//   data blob → {host}/data/{class}.json           e.g. https://assets.aresrpg.world/data/spell_corpus.json
// Dispatched purely by the filename's own extension — `.json` is a data blob (keyed by CLASS, not the
// filename, since every data-blob caller already passes `${class}.json`), `.glb` is geometry, everything
// else (png/webp/mp3/…) is flat art — the ext is the CALLER's per-family fact (items .png, spells .webp
// per #884), never this dispatcher's. Chain mints keep BARE slugs (item.move's Display is items/{item_type}.png,
// already live) — item_icon_url below MUST keep resolving that identical shape for the same key.
const ASSETS_HOST_DEFAULT = 'https://assets.aresrpg.world'

/** @type {{ aggregator: string, classes: Record<string, { published?: boolean } | undefined> }} */
const walrus_assets = { aggregator: ASSETS_HOST_DEFAULT, classes: {} }

// Strip one trailing run of '/' in O(n). The obvious regex (/\/+$/) backtracks quadratically on
// adversarial slash runs (js/polynomial-redos) — and the aggregator string is caller/manifest input.
/** @param {string} s @returns {string} */
function strip_trailing_slashes(s) {
  let end = s.length
  while (end > 0 && s[end - 1] === '/') end--
  return s.slice(0, end)
}

// The MinIO family (top-level folder) each url_class serves flat art / geometry under. `item` and
// `cosmetic_icon` share `items` — a cosmetic's 2D icon IS an item icon (item.move's shared Display
// already resolves every Item there; a cosmetic just needs its AUTHORED slug instead of the generic
// item_type slot word — see cosmetic_icons.js / item_display_census.mjs). `mob` and `mob_icon` share
// `mobs` (creature geometry + bestiary icon; distinct namespaces — `/models/mobs/` vs `/mobs/` — so no
// collision). A class absent here falls back to its own name as the family (identity — a class the
// manifest publishes tomorrow needs no code change here to resolve correctly).
/** @type {Record<string, string>} */
const ASSET_FAMILY = {
  item: 'items',
  cosmetic_icon: 'items',
  spell: 'spells',
  mob: 'mobs',
  mob_icon: 'mobs',
  cosmetic: 'cosmetics',
  character: 'characters',
  music: 'music',
  shop_render: 'shop',
}

// Where each class's .glb corpus actually LIVES on the asset host. `models/{family}` is the rule (mobs,
// cosmetics); `character` is the one class whose rigs were uploaded mirroring the frontend's own public/
// tree and never re-homed — so its bytes sit under `sprites/characters/`, not `models/characters/`.
// This table records the host's truth; it is not a preference. Probed 2026-07-25 (P0: every world
// character rendered as a floating nameplate over nothing): all 13 published rigs answer 206 under
// `sprites/characters/` and 404 under `models/characters/` — see the frontend's character_glb_url.test.js
// for the captured per-key provenance. Delete this row the day the corpus is re-uploaded under models/.
/** @type {Record<string, string>} */
const GEOMETRY_FOLDER = {
  character: 'sprites/characters',
}

/**
 * Seed the app-wide asset resolver once at client boot from the published manifest
 * (packages/frontend/public/asset_manifest.json). `classes[url_class].published` gates whether that class
 * resolves through the asset host at all — an absent/unpublished class (today: `vanilla`, and any class
 * not yet migrated) returns null from walrus_asset_url so the caller falls back to its own host-free
 * ASSET_BASE copy. Merge-only (Object.assign onto `classes`) — see reset_walrus_assets_for_test.
 * @param {{ aggregator?: string | null, classes?: Record<string, { published?: boolean } | undefined> | null }} [manifest]
 * @returns {void}
 */
export function configure_walrus_assets({ aggregator, classes } = {}) {
  if (aggregator)
    walrus_assets.aggregator = strip_trailing_slashes(String(aggregator))
  if (classes) Object.assign(walrus_assets.classes, classes)
}

/**
 * Test isolation seam for the resolver `configure_walrus_assets` seeds: it only ever MERGES
 * (Object.assign onto `classes`) and can never clear a class or the aggregator once set. bun test runs
 * every file in ONE process sharing this module, sorted by path, not by directory-argument order — a
 * test file that configures a real class (or the whole published manifest, e.g. item_hover_tooltip.test.tsx)
 * otherwise leaks it forward to every file that happens to load later in the run. Test-only: production
 * boots once and never resets mid-session.
 * @returns {void}
 */
export function reset_walrus_assets_for_test() {
  walrus_assets.aggregator = ASSETS_HOST_DEFAULT
  walrus_assets.classes = {}
}

/**
 * Resolve the asset-host URL for (url_class, filename) from the configured manifest, or null if the class
 * isn't published yet (caller falls back to the CDN/local copy — progressive migration). See the
 * mapping-law comment above for the three URL shapes; dispatch is purely by the filename's extension.
 * @param {string} url_class  e.g. 'item' | 'spell' | 'vanilla' | 'mob' | 'cosmetic' | 'music'
 * @param {string} filename   the file key, e.g. 'longsword.png' | 'arctic.mp3' | 'spell_corpus.json'
 * @returns {string | null}
 */
export function walrus_asset_url(url_class, filename) {
  if (!walrus_assets.classes[url_class]?.published || !filename) return null
  if (filename.endsWith('.json'))
    return `${walrus_assets.aggregator}/data/${url_class}.json`
  const family = ASSET_FAMILY[url_class] ?? url_class
  return filename.endsWith('.glb')
    ? `${walrus_assets.aggregator}/${GEOMETRY_FOLDER[url_class] ?? `models/${family}`}/${filename}`
    : `${walrus_assets.aggregator}/${family}/${filename}`
}

/**
 * Re-home an asset URL supplied by untrusted/runtime data (for example a Sui Display field) onto the
 * app-configured asset host. ANY absolute URL re-homes — only its path (+ query) survives — so a Display
 * baked with a stale/foreign/malicious origin can never make the browser fetch from anywhere but our own
 * canonical host (#650: this used to only recognize a Walrus-shaped `/v1/blobs/` path; a Display now
 * serving straight off assets.aresrpg.world needs the SAME guard, not a narrower one — keeping the
 * host-confinement property is the point, not the exact old shape). A non-absolute string (already
 * host-free, or plain garbage) returns null — callers already special-case `/`- and `data:`-prefixed
 * values before reaching here (see components/item_image.tsx).
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function canonical_walrus_asset_url(url) {
  if (!url) return null
  try {
    const { pathname, search } = new URL(String(url))
    return `${walrus_assets.aggregator}${pathname}${search}`
  } catch {
    return null
  }
}

// ── The ONE asset-fallback home (the external asset CDN host is DELETED) ──
// The asset host (walrus_asset_url) is the origin for every class published in the manifest (item / spell /
// mob / character / cosmetic …). A class with NO manifest entry (today: `vanilla`) resolves to this host-free,
// origin-relative public path — `/assets/items/<id>.png` served from the frontend's public/ dir. Absent files
// degrade honestly to a category glyph rather than resurrecting a dead host. To bring a
// class onto the asset host, publish its files and add it to public/asset_manifest.json — the builder then
// prefers the asset host automatically. NEVER hardcode an absolute asset host here again. Frontend twin
// home: env.ts ASSETS_URL.
export const ASSET_BASE = '/assets'

/**
 * The URL for an item icon. The key is an authored TEMPLATE/ICON SLUG, never a Sui object id. A whole item
 * object may carry that identity as `slug`, `icon`, or a legacy slug-valued `id`; address-valued
 * ids throw so a lost template join cannot silently become `/assets/items/0x….png`. Returns null for an empty key.
 *
 * Resolves through the manifest-backed item class, else to the host-free relative /assets public path
 * (ASSET_BASE; the external CDN host was deleted). Both keep the `<id>` / `<id>_hd` naming; `{ hd: true }`
 * returns the high-res detail render. The client renders an `<img>` with `referrerPolicy="no-referrer"`,
 * falling back to a category glyph on error — so a genuinely missing icon shows the glyph until its art is
 * uploaded (an item added to the asset manifest, or a file dropped in public/assets/items/).
 *   asset host: ${aggregator}/items/${icon ?? id}[_hd].png  — chain mints resolve here identically (#650)
 *   relative:   /assets/items/${icon ?? id}[_hd].png
 * @param {string | { slug?: string | null, icon?: string | null, id?: string | null } | null | undefined} item
 * @param {{ hd?: boolean, asset_class?: 'item' | 'cosmetic_icon' }} [opts]
 * @returns {string | null}
 */
export function item_icon_url(item, { hd = false, asset_class = 'item' } = {}) {
  const key =
    typeof item === 'string'
      ? item
      : (item?.slug ?? item?.icon ?? item?.id ?? null)
  if (!key) return null
  if (/^0x[0-9a-f]+$/i.test(key))
    throw new TypeError(
      'item_icon_url requires a template slug, not a Sui object id',
    )
  const name = `${key}${hd ? '_hd' : ''}.png`
  // Asset host (manifest) first — else the host-free relative /assets public path.
  return walrus_asset_url(asset_class, name) ?? `${ASSET_BASE}/items/${name}`
}

/**
 * The URL for a spell icon — same resolver family as item_icon_url, just the `spells/` path. Accepts the spell's
 * `icon` key (e.g. 'ikari_haki'). Returns null for an empty key.
 *   asset host: ${aggregator}/spells/${icon}.webp
 *   relative:   /assets/spells/${icon}.webp
 * SPELLS ARE .webp AND SINGLE-SIZE (#884) — the family diverges from items on both axes, by the content
 * house's serving contract: 240 icons live as `<corpus_id>.webp` at 128px, with NO `_hd` render. Probed
 * 2026-07-26 against the live host: `spells/senshi_warcleave.webp` → 200 while the `.png` the client used
 * to ask for (`spells/tomoda_lashline.png`) → 404. So this resolver takes no size option at all: there is
 * no second variant to select, and an option that can only mint a 404 is worse than no option. Items keep
 * `.png` + `_hd` — see item_icon_url; the two families share the path machinery, never the file shape.
 * @param {string | { icon?: string | null } | null | undefined} spell
 * @returns {string | null}
 */
export function spell_icon_url(spell) {
  const key = typeof spell === 'string' ? spell : (spell?.icon ?? null)
  if (!key) return null
  const name = `${key}.webp`
  return walrus_asset_url('spell', name) ?? `${ASSET_BASE}/spells/${name}`
}

/**
 * A `developer`/cheat item (e.g. "Cheated Relic of Stamina", "Admin sword of doom") — admin-only items
 * that must NEVER surface in inventory, encyclopedia, or market.
 * In the seeded items.json these are flagged by `quality: 'developer'` (62 of them), not a `developer`
 * category — so we match BOTH the quality flag (the real data) and a `developer` category (the
 * documented intent / any future seed). The runtime guard so a stray dev item can never leak into a
 * player-facing list.
 * @param {{ quality?: string | null, category?: string | null, item_category?: string | null } | null | undefined} item
 * @returns {boolean}
 */
export function is_developer_item(item) {
  return (
    item?.quality === 'developer' ||
    (item?.category ?? item?.item_category) === 'developer'
  )
}

/**
 * Gatherable resources per gathering job — the 11-tier resource table per gathering job, sourced 1:1
 * from the REAL aresrpg companion content seed (the SSOT both `items.json` and these names are
 * projected from): `../../aresrpg/seed/gathering/{farmer,herbalist,miner}/base_resources.json`. Each
 * companion resource carries a `gatheringJson` ({ jobType, tier, blockIds }) — we key by that
 * `jobType` + `tier`. The names below are the companion `name` field verbatim (e.g. tier-1 farmer =
 * "Wheat" from gatheringJson `Plant_Wheat_Mature`, tier-1 miner = "Diamond", tier-1 herbalist =
 * "Green Mushroom"). The `icon` is the companion `s3Url` stripped to its key (= the `items.json`
 * icon field), resolved to art by the client via the assets CDN with a glyph fallback.
 *
 * NO placeholders remain — every tier across all 3 gathering jobs is a real companion-seed name
 * (real names throughout, never '?' placeholders). The `tier`
 * (1-11) maps to the required job level via `tier_to_level`. Gathering itself is server-authoritative.
 * @type {Record<string, readonly { id: string, name: string, tier: number, icon: string }[]>}
 */
export const GATHER_RESOURCES = {
  farmer: [
    { id: 'wheat', name: 'Wheat', tier: 1, icon: 'wheat' },
    { id: 'wheat_barley', name: 'Barley', tier: 2, icon: 'wheat_barley' },
    { id: 'wheat_malt', name: 'Malt', tier: 3, icon: 'wheat_malt' },
    { id: 'wheat_burnt', name: 'Burnt Wheat', tier: 4, icon: 'wheat_burnt' },
    {
      id: 'wheat_tanjirize',
      name: 'Tanjirize',
      tier: 5,
      icon: 'wheat_tanjirize',
    },
    { id: 'wheat_suize', name: 'Suize', tier: 6, icon: 'wheat_suize' },
    { id: 'wheat_ukraine', name: 'Ukranize', tier: 7, icon: 'wheat_ukraine' },
    { id: 'blood_wheat', name: 'Blood Wheat', tier: 8, icon: 'blood_wheat' },
    { id: 'wheat_purple', name: 'Arcanize', tier: 9, icon: 'wheat_purple' },
    {
      id: 'wheat_draconize',
      name: 'Draconize',
      tier: 10,
      icon: 'wheat_draconize',
    },
    {
      id: 'wheat_white',
      name: 'Himalayan Wheat',
      tier: 11,
      icon: 'wheat_white',
    },
  ],
  herbalist: [
    {
      id: 'green_mushroom',
      name: 'Green Mushroom',
      tier: 1,
      icon: 'green_mushroom',
    },
    {
      id: 'red_orchid',
      name: 'Sanguine Orchid',
      tier: 2,
      icon: 'red_orchid',
    },
    {
      id: 'ivory_shrooms',
      name: 'Ivory Shrooms',
      tier: 3,
      icon: 'ivory_shrooms',
    },
    { id: 'aloe_vera', name: 'Aloe Vera', tier: 4, icon: 'aloe_vera' },
    { id: 'nightcap', name: 'Nightcap', tier: 5, icon: 'nightcap' },
    {
      id: 'crimson_truffle',
      name: 'Crimson Truffle',
      tier: 6,
      icon: 'crimson_truffle',
    },
    {
      id: 'phantom_spore',
      name: 'Phantom Spore',
      tier: 7,
      icon: 'phantom_spore',
    },
    { id: 'witherbloom', name: 'Witherbloom', tier: 8, icon: 'witherbloom' },
    {
      id: 'arcaneshroom',
      name: 'Arcaneshroom',
      tier: 9,
      icon: 'arcaneshroom',
    },
    { id: 'dragonlily', name: 'Dragonlily', tier: 10, icon: 'dragonlily' },
    {
      id: 'cursed_fungus',
      name: 'Cursed Fungus',
      tier: 11,
      icon: 'cursed_fungus',
    },
  ],
  miner: [
    { id: 'diamond', name: 'Diamond', tier: 1, icon: 'diamond' },
    { id: 'quartz', name: 'Quartz', tier: 2, icon: 'quartz' },
    { id: 'jade', name: 'Jade', tier: 3, icon: 'jade' },
    { id: 'amber', name: 'Amber', tier: 4, icon: 'amber' },
    { id: 'moonstone', name: 'Moonstone', tier: 5, icon: 'moonstone' },
    { id: 'bloodstone', name: 'Bloodstone', tier: 6, icon: 'bloodstone' },
    { id: 'duskite', name: 'Duskite', tier: 7, icon: 'duskite' },
    { id: 'obsidianite', name: 'Obsidianite', tier: 8, icon: 'obsidianite' },
    { id: 'arcanite', name: 'Arcanite', tier: 9, icon: 'arcanite' },
    { id: 'draconite', name: 'Draconite', tier: 10, icon: 'draconite' },
    { id: 'cursed_gem', name: 'Cursed Gem', tier: 11, icon: 'cursed_gem' },
  ],
}

// Job index → GATHER_RESOURCES key (SPEC §6 order: 0 FARMER · 1 HERBALIST · 2 MINER) — the ONE home for the
// (job, tier) → gatherable roster-entry lookup shared by every consumer (the 3-D node prop's resource_visual,
// the spawn-marker projection's resource_marker_name, the compass).
export const GATHER_JOB_KEYS = /** @type {const} */ (['farmer', 'herbalist', 'miner'])

/**
 * Resolve a gathering (job, tier) pair to its GATHER_RESOURCES roster entry. Clamps job to [0,2] and tier to
 * [1,11] — both arrive as raw chain numbers, never pre-validated — then falls back to the roster's first entry
 * if the exact tier is missing.
 * @param {number} job 0 farmer · 1 herbalist · 2 miner
 * @param {number} tier 1-11 (the resource's level band)
 * @returns {{ id: string, name: string, tier: number, icon: string } | undefined}
 */
export function gather_resource_for(job, tier) {
  const job_key = GATHER_JOB_KEYS[Math.max(0, Math.min(2, Number(job) | 0))]
  const t = Math.max(1, Math.min(11, Number(tier) | 0))
  const roster = GATHER_RESOURCES[job_key] ?? []
  return roster.find((r) => r.tier === t) ?? roster[0]
}

/**
 * A tool-like item the job resolver accepts: either a READ-MODEL equipped item (`id` = the Sui object id,
 * `item_type` = the items.json id, `item_category` = the on-chain/COLLAPSED category) or a raw items.json
 * item (`id` = the items.json id, `category` = the fine content category, `appearance` = the Tool_* model).
 * @typedef {{ id?: string, name?: string, item_type?: string, item_category?: string, category?: string, appearance?: string }} ToolLike
 */

/**
 * Resolve the gathering job from an equipped tool (Job.fromTool). Robust to BOTH shapes: a READ-MODEL
 * equipped item — whose `item_category` is COLLAPSED to one on-chain category by to_chain_category (all 3
 * gathering tools -> 'pickaxe'), so it cannot tell a hoe from a pickaxe; we recover the TRUE content
 * category + the Tool_* appearance from items.json via its `item_type` — and a raw items.json item (its
 * own category/appearance/id). Match precedence: the content category against the JobDef `tool_category`
 * (the SSOT), then the reference-corpus Tool_* appearance/id prefix, then the display name as a last resort.
 * @param {ToolLike | null | undefined} tool
 * @returns {JobDef | null}
 */
export function job_from_tool(tool) {
  if (!tool) return null
  const template = /** @type {Record<string, ToolLike | undefined>} */ (
    ITEMS_DATA
  )[tool.item_type ?? tool.id ?? '']
  const category =
    template?.category ?? tool.category ?? tool.item_category ?? ''
  const appearance = template?.appearance ?? tool.appearance ?? tool.id ?? ''
  const name = (template?.name ?? tool.name ?? '').toLowerCase()
  for (const job of JOBS) {
    if (!job.tool_prefix) continue
    if (job.tool_category && category === job.tool_category) return job
    if (appearance.startsWith(job.tool_prefix)) return job
    // last resort: our item ids are not reference-corpus-prefixed — match the tool display name
    if (job.tool && name.includes(job.tool.toLowerCase())) return job
  }
  return null
}

/**
 * The read-model item_category SLOT(S) an equipped gathering tool lands under. The read-model keys equipped
 * items by their ON-CHAIN item_category (read_user.js builds `acc[item_category] = item`), and
 * to_chain_category COLLAPSES all three gathering tool categories onto a single chain category ('pickaxe'
 * on the current package). Deduped so the lookup is correct whatever the collapse target becomes.
 * @type {readonly string[]}
 */
const GATHER_TOOL_SLOTS = [
  ...new Set(
    JOBS.flatMap(job =>
      job.tool_category ? [to_chain_category(job.tool_category)] : [],
    ),
  ),
]

/**
 * Resolve the equipped GATHERING tool from a read-model character. The read-model keys equipped items by
 * their on-chain item_category (read_user.js), and every gathering tool collapses onto the gather slot
 * (GATHER_TOOL_SLOTS — `character.pickaxe` today), NEVER `character.weapon`. Returns the equipped tool
 * object for the first non-empty gather slot, or null when no gathering tool is equipped. The caller
 * resolves its job via job_from_tool and cross-checks it matches the targeted node.
 * @param {Record<string, any> | null | undefined} character
 * @returns {ToolLike | null}
 */
export function equipped_gather_tool(character) {
  if (!character) return null
  for (const slot of GATHER_TOOL_SLOTS) {
    const tool = character[slot]
    if (tool) return tool
  }
  return null
}

// ── Job XP curve (JobExperience.java — retro 1.29, 100 levels) ─────────────────────────────
export const JOB_MAX_LEVEL = 100

/** Total XP required to reach each level (index 0 = level 1 = 0 XP). */
export const JOB_XP_TABLE = [
  0, 50, 140, 271, 441, 653, 905, 1199, 1534, 1911, 2330, 2792, 3297, 3846,
  4439, 5078, 5762, 6493, 7271, 8097, 8973, 9898, 10875, 11903, 12985, 14122,
  15315, 16564, 17873, 19242, 20672, 22166, 23726, 25353, 27048, 28815, 30656,
  32572, 34566, 36641, 38800, 41044, 43378, 45804, 48325, 50946, 53669, 56498,
  59437, 62491, 65664, 68960, 72385, 75943, 79640, 83482, 87475, 91624, 95937,
  100421, 105082, 109930, 114971, 120215, 125671, 131348, 137256, 143407,
  149811, 156481, 163429, 170669, 178214, 186080, 194283, 202839, 211765,
  221082, 230808, 240964, 251574, 262660, 274248, 286364, 299037, 312297,
  326175, 340705, 355924, 371870, 388582, 406106, 424486, 443772, 464016,
  485274, 507604, 531071, 555541, 581687,
]

/** Job level from total XP (JobExperience.getLevel — floors at 1). @param {number} xp */
export function job_level(xp) {
  for (let i = JOB_XP_TABLE.length - 1; i >= 0; i--) {
    if (xp >= JOB_XP_TABLE[i]) return i + 1
  }
  return 1
}

/** Total XP to reach a level (JobExperience.getXpForLevel). @param {number} level */
export function job_xp_for_level(level) {
  if (level < 1) return 0
  if (level > JOB_MAX_LEVEL) return JOB_XP_TABLE[JOB_XP_TABLE.length - 1]
  return JOB_XP_TABLE[level - 1]
}

/**
 * Current/needed XP within the current level, for a HUD bar (JobExperience.getLevelProgress).
 * `needed` is -1 at max level (no next level).
 * @param {number} total_xp @returns {{ current: number, needed: number, level: number }}
 */
export function job_level_progress(total_xp) {
  const level = job_level(total_xp)
  if (level >= JOB_MAX_LEVEL) return { current: 0, needed: -1, level }
  const cur = JOB_XP_TABLE[level - 1]
  const nxt = JOB_XP_TABLE[level]
  return { current: total_xp - cur, needed: nxt - cur, level }
}

// ── Crafting: per-craft duration + affordability (server-enforced; shared with the client UI) ─────
/** Slowest per-craft time (ms) at job level 1: 1.0s/craft at lvl 1. */
export const CRAFT_MS_AT_MIN_LEVEL = 1000
/** Fastest per-craft time (ms) at job MAX level: 0.1s/craft at lvl 100. */
export const CRAFT_MS_AT_MAX_LEVEL = 100

/**
 * Per-craft duration in integer milliseconds, lerped by JOB LEVEL only: 1000ms at level
 * 1 down to 100ms at JOB_MAX_LEVEL, linear. N crafts take N x this (the queue is N x per-craft,
 * server-timed). Pure integer math so the client's toast estimate matches the server's wall-clock
 * enforcement byte-for-byte. Clamped to [1, JOB_MAX_LEVEL].
 * @param {number} level @returns {number}
 */
export function craft_duration_ms(level) {
  const clamped = Math.max(1, Math.min(JOB_MAX_LEVEL, level))
  const t = (clamped - 1) / (JOB_MAX_LEVEL - 1)
  return Math.round(
    CRAFT_MS_AT_MIN_LEVEL + (CRAFT_MS_AT_MAX_LEVEL - CRAFT_MS_AT_MIN_LEVEL) * t,
  )
}

/**
 * The craft job that COVERS a recipe item (by its ItemCategory), or null when no craft job covers it
 * (gathering-only / drop-only items are never craftable). Single source of truth for resolving the
 * job a recipe belongs to, so both the UI level-gate and the server validation agree.
 * @param {string} item_category @returns {JobDef | null}
 */
export function craft_job_for_category(item_category) {
  return JOBS.find(job => job.covers.includes(item_category)) ?? null
}

/**
 * The craft job that OWNS a recipe item — the SSOT both the client level-gate and the SERVER craft-XP award
 * should resolve a recipe's job through. Checks the explicit recipe->job map first (alchemist/baker products
 * + handyman dungeon keys, whose CONSUMABLE/RESOURCE category can't disambiguate the job), then falls back
 * to ItemCategory coverage (weapon/equipment jobs + handyman tools). Returns null for an un-owned item
 * (gathering-only / drop-only). NOTE (server wiring): the server currently resolves the craft job via
 * `craft_job_for_category(item_category)` (write_user.js / player_craft.js), which returns null for
 * CONSUMABLE recipes -> alchemist/baker/handyman crafts award NO job XP today. Switch those call sites to
 * `job_for_recipe(item_id, item_category)` so consumable crafts credit the right job.
 * @param {string} item_id @param {string} [item_category] @returns {JobDef | null}
 */
export function job_for_recipe(item_id, item_category) {
  const explicit = /** @type {Record<string, string>} */ (JOB_CRAFTS)[item_id]
  if (explicit) return get_job(explicit)
  return item_category ? craft_job_for_category(item_category) : null
}

// ── Crafting: per-craft XP reward (CraftingFormulas.java — retro 1.29, exact 1:1) ───────────
// Job XP is on-chain (Character VecMap dynamic field). The server awards it on a confirmed craft mint
// (bundled into the same client-signed PTB) and the indexer projects it back as `character.jobs`.
// Pure integer math (the on-chain VecMap is u32) so the client estimate matches the server award.

/** Min ingredient slots a recipe can have (CraftingFormulas.MIN_INGREDIENTS). */
const MIN_INGREDIENTS = 2
/** Retro 1.29 craft XP table for CRAFT jobs (smiths/jewelers/tailors/alchemist/baker/handyman). */
const CRAFT_XP_TABLE = [0, 0, 10, 25, 50, 100, 250, 500, 1000, 1000, 1000]
/** Compressed XP table for GATHERING jobs (farmer/herbalist/miner) — indices 2-10 valid. */
const GATHERING_CRAFT_XP_TABLE = [
  0, 0, 10, 25, 50, 100, 175, 275, 400, 550, 725,
]
/** Linear XP-decay range above a recipe tier (CraftingFormulas.RECIPE_XP_DECAY_RANGE). */
const RECIPE_XP_DECAY_RANGE = 30

/**
 * Minimum job level to unlock a recipe with this many ingredient slots
 * (CraftingFormulas.minLevelForIngredients). @param {number} ingredient_count @returns {number}
 */
export function min_level_for_ingredients(ingredient_count) {
  if (ingredient_count <= 2) return 1
  return Math.min(
    JOB_MAX_LEVEL,
    Math.ceil(((ingredient_count - 2) * 99.0) / 8.0) + 1,
  )
}

/**
 * Base craft XP from the ingredient-slot count, gathering jobs use the compressed table
 * (CraftingFormulas.craftXpFromIngredients). @param {number} ingredient_count
 * @param {boolean} is_gathering @returns {number}
 */
export function craft_xp_from_ingredients(ingredient_count, is_gathering) {
  const table = is_gathering ? GATHERING_CRAFT_XP_TABLE : CRAFT_XP_TABLE
  const index = Math.max(
    MIN_INGREDIENTS,
    Math.min(ingredient_count, table.length - 1),
  )
  return table[index] ?? 0
}

/**
 * XP multiplier by the gap between job level and recipe tier: full XP until the next tier unlocks,
 * then linear decay to 0 at recipeMinLevel + 30 (CraftingFormulas.recipeLevelMultiplier).
 * @param {number} ingredient_count @param {number} job_level @returns {number}
 */
export function recipe_level_multiplier(ingredient_count, job_level) {
  const recipe_level = min_level_for_ingredients(ingredient_count)
  const zero_at = recipe_level + RECIPE_XP_DECAY_RANGE
  const decay_start = min_level_for_ingredients(ingredient_count + 1)
  if (decay_start >= zero_at) return job_level >= zero_at ? 0.0 : 1.0
  if (job_level <= decay_start) return 1.0
  if (job_level >= zero_at) return 0.0
  return 1.0 - (job_level - decay_start) / (zero_at - decay_start)
}

/**
 * Total on-chain job XP earned for crafting `count` units of a recipe at the current job level
 * (CraftQueue.java: xpPerCraft = craftXpFromIngredients * recipeLevelMultiplier; total = * n). Floored
 * to an integer (the on-chain VecMap value is u32). Both client (estimate) and server (award) call it.
 * @param {number} ingredient_count @param {number} job_level @param {boolean} is_gathering
 * @param {number} [count] @returns {number}
 */
export function craft_xp_reward(
  ingredient_count,
  job_level,
  is_gathering,
  count = 1,
) {
  const per_craft =
    craft_xp_from_ingredients(ingredient_count, is_gathering) *
    recipe_level_multiplier(ingredient_count, job_level)
  return Math.max(0, Math.floor(per_craft) * Math.max(0, Math.floor(count)))
}

/**
 * Server + client affordability check for `count` crafts of `recipe_id`. `owned` maps an item_type
 * (== items.json id) to the total owned amount. Returns the resolved ingredient rows with a
 * `have`/`need`/`enough` triple per row (drives the GREEN/ORANGE UI) plus an `affordable` flag for
 * the requested `count`. Returns null when the item carries no recipe in the seed.
 * @param {string} recipe_id
 * @param {Record<string, number>} owned
 * @param {number} [count]
 * @returns {{ rows: { id: string, need: number, have: number, enough: boolean }[], affordable: boolean } | null}
 */
export function craft_affordability(recipe_id, owned, count = 1) {
  const ingredients = recipe_ingredients(recipe_id)
  if (!ingredients.length) return null
  const rows = ingredients.map(({ id, qty }) => {
    const have = owned[id] ?? 0
    const need = qty * count
    return { id, need, have, enough: have >= need }
  })
  return { rows, affordable: rows.every(({ enough }) => enough) }
}

// ── Gathering formulas (GatheringFormulas.java — retro 1.29, exact 1:1) ─────────────────────
/** Tier to required job level (1->1, 2->10, 3->20, ..., 10->90, 11->100). @param {number} tier */
export function tier_to_level(tier) {
  if (tier <= 1) return 1
  return Math.min((tier - 1) * 10, JOB_MAX_LEVEL)
}

/** Gather XP: 10 + floor(requiredLevel / 2). @param {number} required_level */
export function gather_xp(required_level) {
  return 10 + Math.floor(required_level / 2)
}

/**
 * Gather quantity range [min, max]: min=1, max = 2 + floor((jobLevel - requiredLevel) / 5);
 * level-100 bonus +5/+5.
 * @param {number} job_lvl @param {number} required_level @returns {[number, number]}
 */
export function gather_amount(job_lvl, required_level) {
  const extra = Math.max(0, Math.floor((job_lvl - required_level) / 5))
  let min = 1
  let max = Math.max(1, 2 + extra)
  if (job_lvl >= JOB_MAX_LEVEL) {
    min += 5
    max += 5
  }
  return [min, max]
}

/** Gather time in seconds (~12s at lvl 1, ~2s at lvl 100, linear). @param {number} level */
export function gather_time(level) {
  const t = (level - 1) / (JOB_MAX_LEVEL - 1)
  return Math.max(2, 12 + (2 - 12) * t)
}

/**
 * Respawn seconds: 120 base for tier 1, +30/tier; herbalist 0.8x, miner 1.2x, farmer 1.0x.
 * @param {number} required_level @param {string} job_id @returns {number}
 */
export function respawn_secs(required_level, job_id) {
  const tier = Math.max(1, Math.floor(required_level / 5) + 1)
  const base = 120 + (tier - 1) * 30
  const multiplier = job_id === 'herbalist' ? 0.8 : job_id === 'miner' ? 1.2 : 1
  return Math.floor(base * multiplier)
}
