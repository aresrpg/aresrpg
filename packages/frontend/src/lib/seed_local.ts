// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SEED-LOCAL corpus source — surfaces the entire local seed data with icon/no-icon status for one-click
// generation. A DEV/ADMIN-ONLY reader of the repo seed JSON (seed/mainnet/**) via
// `import.meta.glob`, mapped into a flat row shape the icon-workflow view + the shared ImageGeneratorModal
// consume. NEVER a build-time snapshot: the glob is gated on `import.meta.env.DEV` so a production bundle
// tree-shakes it away entirely (players never load the corpus), and in dev a page refresh re-reads whatever
// the seed files currently hold (another lane actively rewrites them — READ at runtime, never freeze counts).
//
// One home per fact: the census "visual" prompt is literally `one_line(item.description)` (see
// seed/import/p_icon_census.py) — so `census_prompt` DERIVES it from the row's own description rather than
// porting the icon-needs census table (regenerable via that script) into a second, drifting home for the same string.

// ─────────────────────────────────────────────────────────────────────────────
//  Row shape — the single view/modal contract
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedRow {
  /** = the modal `template_id` AND the icon asset id: items resolve at `items/<slug>.png`. */
  slug: string
  name: string
  /** ImageGeneratorModal `mode`/`template_type`. Only 'item' has a local generate+save path in this build. */
  kind: 'item' | 'spell'
  /** The SEMANTIC type fed to the generator (the modal's `item_type`): the category (CLUB / RING / RESOURCE
   *  …), NOT the seed `itemType` — which for weapons is the wielding CLASS (senshi/tomoda), meaningless to an
   *  icon prompt. Matches quick_generate_icon, which passes `edit_data.category`. */
  item_type: string
  /** CONSUMABLE / RESOURCE / PET / HELMET / RUNE / COSMETIC / SPELL … (uppercased). */
  category: string
  level: number
  /** Grouping key: a world folder id ('05_drowned_fen'), a spell classType ('senshi'), or 'shop'. */
  world: string
  quality?: string
  /** Elements (spells + shop pets) — passed to the modal so spell art picks up the element tint. */
  elements?: string[]
  description?: string
  /** Census-style one-liner prefilled into the modal's VISUAL DESCRIPTION field. */
  default_prompt: string
  /** Which asset path proves presence: 'item' → items/<slug>.png, 'spell' → spells/<slug>.png. */
  icon_kind: 'item' | 'spell'
  /** [min,max] roll range per stat key — feeds ItemDetailView's `stats` prop (admin SEEDS item detail). */
  stats?: Record<string, [number, number]>
  /** Weapon damage line(s) (seed `dmg`, a single object or an array) — feeds ItemDetailView's `damages`. */
  damages?: { from: number; to: number; damage_type?: string; element: string }[]
  /** Vanilla model reference (ItemImage's appearance-fallback candidate). */
  appearance?: string
  /** Flattened `{name:{lang},description:{lang}}` JSON string — `use_template_t`'s i18nJson fallback path. */
  i18nJson?: string
}

/** `{min:{k:v},max:{k:v}}` → `{k:[v_min,v_max]}` over the union of both key sets (0-filled if one side is
 *  missing a key a weapon/pet roll range never actually omits in practice, but never assume). */
function zip_stats_min_max(stats: any): Record<string, [number, number]> | undefined {
  const min = stats?.min
  const max = stats?.max
  if (!min && !max) return undefined
  const keys = new Set([...Object.keys(min || {}), ...Object.keys(max || {})])
  const out: Record<string, [number, number]> = {}
  for (const k of keys) out[k] = [Number(min?.[k]) || 0, Number(max?.[k]) || 0]
  return out
}

/** Seed `dmg` (a single `{from,to,type,element}` object OR an array of them) → ItemDetailView's damages[]. */
function normalize_damages(
  dmg: any
): { from: number; to: number; damage_type?: string; element: string }[] | undefined {
  if (!dmg) return undefined
  const list = Array.isArray(dmg) ? dmg : [dmg]
  const out = list
    .filter((d) => d && (Number(d.from) || Number(d.to)))
    .map((d) => ({
      from: Number(d.from) || 0,
      to: Number(d.to) || 0,
      damage_type: d.type || d.damage_type,
      element: String(d.element || ''),
    }))
  return out.length > 0 ? out : undefined
}

// ─────────────────────────────────────────────────────────────────────────────
//  Census prompt — mirrors seed/import/p_icon_census.py `one_line(description)`
// ─────────────────────────────────────────────────────────────────────────────

/** First sentence of the description (≤92 chars, else 90+'…'), exactly like the census. No description ⇒
 *  a derived phrase from name+category in the same style. This is the modal's `default_prompt`. */
export function census_prompt(description?: string, name?: string, category?: string): string {
  const d = (description || '').trim()
  if (d) {
    const [first] = d.split(/(?<=[.!?])\s/)
    return first.length > 92 ? `${first.slice(0, 90)}…` : first
  }
  const n = (name || '').trim()
  const c = (category || '').trim().toLowerCase()
  if (n && c) return `A ${c} named ${n}.`
  return n ? `${n}.` : ''
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pure mapper — Record<path, parsedJson> → SeedRow[]  (unit-tested on fixtures)
// ─────────────────────────────────────────────────────────────────────────────

/** '.../seed/mainnet/05_drowned_fen/items.json' → '05_drowned_fen'. */
function world_from_path(path: string): string {
  const m = path.match(/\/mainnet\/([^/]+)\//)
  return m ? m[1] : ''
}

function map_item_like(raw: any, world: string, icon_kind: 'item'): SeedRow | null {
  const slug = raw?.slug
  if (!slug || typeof slug !== 'string') return null
  const category = String(raw.category || raw.itemType || 'ITEM').toUpperCase()
  const description = typeof raw.description === 'string' ? raw.description : undefined
  const element = typeof raw.element === 'string' ? raw.element : undefined
  return {
    slug,
    name: raw.name || slug,
    kind: 'item',
    // Generation semantics = the category (a "CLUB", a "RING"), never the class-bearing seed itemType.
    item_type: category,
    category,
    level: Number(raw.level) || 0,
    world,
    quality: raw.quality ? String(raw.quality) : undefined,
    elements: element ? [element] : undefined,
    description,
    default_prompt: census_prompt(description, raw.name, category),
    icon_kind,
    stats: zip_stats_min_max(raw.stats),
    damages: normalize_damages(raw.dmg),
    appearance: typeof raw.appearance === 'string' ? raw.appearance : undefined,
    i18nJson: seed_i18n_json(raw.i18n),
  }
}

function map_spell(raw: any): SeedRow | null {
  const slug = raw?.id
  if (!slug || typeof slug !== 'string') return null
  const element = typeof raw.element === 'string' ? raw.element : undefined
  // Spells carry a description_key (i18n), no plain EN description — derive the prompt from name+element.
  const derived = element ? `A ${element} spell: ${raw.name || slug}.` : `A spell: ${raw.name || slug}.`
  return {
    slug,
    name: raw.name || slug,
    kind: 'spell',
    item_type: 'spell',
    category: 'SPELL',
    level: Number(raw.unlock) || 0,
    world: raw.classType || 'spells',
    quality: undefined,
    elements: element ? [element] : undefined,
    description: undefined,
    default_prompt: derived,
    icon_kind: 'spell',
  }
}

/**
 * Map the raw glob result (path → parsed JSON) into deduped SeedRows. Consumes ONLY the icon-bearing seed
 * files — items.json, resources.json, shop.json (cosmetics+pets), spells/*.json — and ignores mobs / recipes
 * / world / icon_requests. Pure: no I/O, no import.meta — the test drives it with fixtures.
 */
export function map_seed_corpus(files: Record<string, any>): SeedRow[] {
  const by_key = new Map<string, SeedRow>()
  const push = (row: SeedRow | null) => {
    if (row) by_key.set(`${row.icon_kind}:${row.slug}`, row)
  }

  for (const [path, raw] of Object.entries(files)) {
    if (raw == null) continue
    if (/\/items\.json$/.test(path) || /\/resources\.json$/.test(path)) {
      const world = world_from_path(path)
      if (Array.isArray(raw)) for (const it of raw) push(map_item_like(it, world, 'item'))
    } else if (/\/shop\.json$/.test(path)) {
      for (const it of raw.cosmetics ?? []) push(map_item_like(it, 'shop', 'item'))
      for (const it of raw.pets ?? []) push(map_item_like(it, 'shop', 'item'))
    } else if (/\/spells\/[^/]+\.json$/.test(path)) {
      if (Array.isArray(raw)) for (const sp of raw) push(map_spell(sp))
    }
  }

  return [...by_key.values()]
}

// ─────────────────────────────────────────────────────────────────────────────
//  Mobs / Worlds / Recipes — the SEEDS admin tab + encyclopedia World tab join surface
// ─────────────────────────────────────────────────────────────────────────────
// Owner (admin/encyclopedia consolidation): the admin SEEDS tab is a read-only encyclopedia-style browser
// over the LOCAL corpus (items already covered above; mobs/worlds/recipes extend the same glob). These rows
// feed adapters into the SHARED MobDetailView/ItemDetailView/RecipeSections components — never a forked
// card. `i18nJson` mirrors each row's `i18n: {fr:{name,description},...}` block into the flat
// `{name:{fr,de,...}, description:{fr,de,...}}` string `use_template_t` already knows how to read.

export interface SeedMobLoot {
  item: string
  chance: number
  min: number
  max: number
}

export interface SeedMobRow {
  /** = mobs.json `key` (stable id; matches loot/dungeonRooms/mobGroups references). */
  id: string
  name: string
  appearance?: string
  /** 'trash' | 'elite' | 'protector' | 'dungeon_boss' | 'archi' — free-form, whatever the seed carries. */
  role?: string
  minLevel: number
  maxLevel: number
  hp: number
  element?: string
  stats: Record<string, number>
  loot: SeedMobLoot[]
  xp: number
  /** Every world FOLDER this mob's `key` appears in (usually one; deduped). */
  worlds: string[]
  i18nJson?: string
}

export interface SeedWorldResource {
  slug: string
  rate: number
  job: number
  tier: number
  protector?: string
}

export interface SeedWorldMobGroup {
  mob: string
  rate: number
}

export interface SeedWorldRow {
  /** = world.json `id` (matches the folder name / seed_local `world` tag on items+mobs). */
  id: string
  name: string
  band: [number, number]
  biome: string
  neutral?: boolean
  specialty?: string
  statLean?: string
  resources: SeedWorldResource[]
  mobGroups: SeedWorldMobGroup[]
  dungeonKey?: string
  /** Each inner array is one dungeon room's mob roster (mob `key`s). */
  dungeonRooms: string[][]
}

export interface SeedRecipeRow {
  /** = recipes.json `label` (the natural unique key — "craft_woolamu"). */
  id: string
  /** SDK JOBS `id` string (e.g. 'jeweler') — recipe_sections.tsx wants the numeric index; resolved by the caller. */
  job: string
  output: string
  outQty: number
  inputs: { slug: string; qty: number }[]
  craft_xp: number
  world: string
}

/** `row.i18n = {fr:{name,description}, de:{...}}` → the flat `{name:{fr,...},description:{fr,...}}` JSON
 *  string `use_template_t` reads via its `i18nJson` fallback path. `undefined` when the row carries none. */
export function seed_i18n_json(
  i18n: Record<string, { name?: string; description?: string }> | undefined
): string | undefined {
  if (!i18n || typeof i18n !== 'object') return undefined
  const name: Record<string, string> = {}
  const description: Record<string, string> = {}
  for (const [lang, v] of Object.entries(i18n)) {
    if (v?.name) name[lang] = v.name
    if (v?.description) description[lang] = v.description
  }
  if (Object.keys(name).length === 0 && Object.keys(description).length === 0) return undefined
  return JSON.stringify({ name, description })
}

function map_mob(raw: any, world: string): SeedMobRow | null {
  const id = raw?.key
  if (!id || typeof id !== 'string') return null
  return {
    id,
    name: raw.name || id,
    appearance: typeof raw.appearance === 'string' ? raw.appearance : undefined,
    role: typeof raw.role === 'string' ? raw.role : undefined,
    minLevel: Number(raw.minLevel) || 0,
    maxLevel: Number(raw.maxLevel) || 0,
    hp: Number(raw.hp) || 0,
    element: typeof raw.element === 'string' ? raw.element : undefined,
    stats: raw.stats && typeof raw.stats === 'object' ? raw.stats : {},
    loot: Array.isArray(raw.loot)
      ? raw.loot.map((l: any) => ({
          item: String(l.item),
          chance: Number(l.chance) || 0,
          min: Number(l.min) || 0,
          max: Number(l.max) || 0,
        }))
      : [],
    xp: Number(raw.xp) || 0,
    worlds: world ? [world] : [],
    i18nJson: seed_i18n_json(raw.i18n),
  }
}

function map_world(raw: any): SeedWorldRow | null {
  const id = raw?.id
  if (!id || typeof id !== 'string') return null
  return {
    id,
    name: raw.name || id,
    band: Array.isArray(raw.band) && raw.band.length === 2 ? [Number(raw.band[0]), Number(raw.band[1])] : [0, 0],
    biome: raw.biome || '',
    neutral: !!raw.neutral,
    specialty: typeof raw.specialty === 'string' ? raw.specialty : undefined,
    statLean: typeof raw.statLean === 'string' ? raw.statLean : undefined,
    resources: Array.isArray(raw.resources)
      ? raw.resources.map((r: any) => ({
          slug: String(r.slug),
          rate: Number(r.rate) || 0,
          job: Number(r.job) || 0,
          tier: Number(r.tier) || 0,
          protector: typeof r.protector === 'string' ? r.protector : undefined,
        }))
      : [],
    mobGroups: Array.isArray(raw.mobGroups)
      ? raw.mobGroups.map((m: any) => ({ mob: String(m.mob), rate: Number(m.rate) || 0 }))
      : [],
    dungeonKey: typeof raw.dungeonKey === 'string' ? raw.dungeonKey : undefined,
    dungeonRooms: Array.isArray(raw.dungeonRooms)
      ? raw.dungeonRooms.map((room: any) => (Array.isArray(room) ? room.map(String) : []))
      : [],
  }
}

function map_recipe(raw: any, world: string): SeedRecipeRow | null {
  const id = raw?.label
  if (!id || typeof id !== 'string') return null
  return {
    id,
    job: String(raw.job || ''),
    output: String(raw.output || ''),
    outQty: Number(raw.outQty) || 1,
    inputs: Array.isArray(raw.inputs)
      ? raw.inputs.map((i: any) => ({ slug: String(i.slug), qty: Number(i.qty) || 1 }))
      : [],
    craft_xp: Number(raw.craft_xp) || 0,
    world,
  }
}

/**
 * Map the SAME raw glob result `load_seed_corpus` consumes into mobs/worlds/recipes rows — the sibling
 * read for `mobs.json` / `world.json` / `recipes.json` (ignored by `map_seed_corpus`). Mobs are deduped by
 * `id`, collecting every world folder they appear in (`worlds`); worlds/recipes are 1 row per file.
 */
export function map_seed_worldmobs(files: Record<string, any>): {
  mobs: SeedMobRow[]
  worlds: SeedWorldRow[]
  recipes: SeedRecipeRow[]
} {
  const mobs_by_id = new Map<string, SeedMobRow>()
  const worlds: SeedWorldRow[] = []
  const recipes: SeedRecipeRow[] = []

  for (const [path, raw] of Object.entries(files)) {
    if (raw == null) continue
    if (/\/mobs\.json$/.test(path)) {
      const world = world_from_path(path)
      if (!Array.isArray(raw)) continue
      for (const m of raw) {
        const row = map_mob(m, world)
        if (!row) continue
        const existing = mobs_by_id.get(row.id)
        if (existing) existing.worlds = [...new Set([...existing.worlds, ...row.worlds])]
        else mobs_by_id.set(row.id, row)
      }
    } else if (/\/world\.json$/.test(path)) {
      const row = map_world(raw)
      if (row) worlds.push(row)
    } else if (/\/recipes\.json$/.test(path)) {
      const world = world_from_path(path)
      if (!Array.isArray(raw)) continue
      for (const r of raw) {
        const row = map_recipe(r, world)
        if (row) recipes.push(row)
      }
    }
  }

  worlds.sort((a, b) => a.band[0] - b.band[0] || a.name.localeCompare(b.name))
  return { mobs: [...mobs_by_id.values()], worlds, recipes }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Dev-only loader — the glob is DCE'd out of any production build
// ─────────────────────────────────────────────────────────────────────────────

// Root-relative from src/lib/: ../../../../ → repo root, then seed/mainnet/**. Vite statically transforms the
// call; the `import.meta.env.DEV ? … : {}` guard lets Rollup drop the whole glob (and its JSON chunks) in prod.
const seed_glob: Record<string, () => Promise<any>> = import.meta.env.DEV
  ? import.meta.glob('../../../../seed/mainnet/**/*.json')
  : {}

/** Read every glob'd seed JSON once. Empty outside dev. Re-reads current file contents on every call
 *  (another lane rewrites these files live — never cache across calls). */
async function read_seed_files(): Promise<Record<string, any>> {
  const entries = await Promise.all(
    Object.entries(seed_glob).map(async ([path, loader]) => {
      try {
        const mod = await loader()
        return [path, mod?.default ?? mod] as const
      } catch {
        return [path, null] as const
      }
    })
  )
  return Object.fromEntries(entries)
}

/** Load + map the entire local seed corpus (icon-bearing rows only). Empty outside dev. */
export async function load_seed_corpus(): Promise<SeedRow[]> {
  return map_seed_corpus(await read_seed_files())
}

/** Load + map the mobs/worlds/recipes corpus (the SEEDS admin MOBS/WORLDS sub-tabs + the deep filters'
 *  recipe/loot joins). Empty outside dev. */
export async function load_seed_worldmobs_corpus(): Promise<{
  mobs: SeedMobRow[]
  worlds: SeedWorldRow[]
  recipes: SeedRecipeRow[]
}> {
  return map_seed_worldmobs(await read_seed_files())
}
