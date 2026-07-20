// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTHORED world knowledge (burial-reseed corpus join, 2026-07-13). The encyclopedia is STATIC
// KNOWLEDGE: a world's display name, level band, mob roster and gatherable resources are authored
// corpus facts (seed/mainnet/<wid>/{world.json,mobs.json,resources.json}), not live chain state.
//
// WHY AUTHORED CORPUS AND NOT /v1: the read-API's mob rows carry NO world provenance (views.js projects
// template_id/name/levels/element/drops — never the world), so the world->roster relation simply does
// not exist on /v1 and cannot be joined client-side from it. Rather than grow a new indexer projection
// (packages/rpc image rebuild + repush) for facts that only ever change when we re-seed, the join is
// computed from authored seed JSON and keyed by the CURRENT lineage's ids from the seed receipt. There is
// no second checked-in ID projection that can lag a republish.
//
// The chain stays the source of truth for WHICH worlds are live: the worlds tab lists /v1's rows and
// joins THIS for their display knowledge (a /v1 world absent here still renders, honestly degraded).
import { bun_runtime, is_object_id, seed_manifest } from '../../content/seed_manifest'
import jobs_data from '../../data/jobs.json'

const { JOB_MASTER_JOBS } = jobs_data

export interface CorpusMob {
  /** on-chain mob TEMPLATE id — the key the bestiary detail route matches on */
  id: string
  name: string
  element: string | null
  /** trash · archi · elite · boss · dungeon_boss (authored) */
  role: string | null
  minLevel: number
  maxLevel: number
}

export interface CorpusResource {
  /** on-chain item TEMPLATE id — the key the items detail route matches on */
  id: string
  slug: string
  name: string
  /** localized {name:{<locale>}} blob for template_t (undefined ⇒ EN-only) */
  i18nJson?: string
  /** 0 farmer · 1 herbalist · 2 miner */
  job: number
  tier: number
  level: number
}

export interface CorpusWorld {
  /** world OBJECT id — joins /v1's `world_id` */
  id: string
  wid: string
  name: string
  band: [number, number] | null
  biome: string
  mobs: CorpusMob[]
  resources: CorpusResource[]
  /** on-chain TEMPLATE id of this world's dungeon entry key (world.json `dungeonKey` slug → seed_manifest.items) —
   *  the id the encyclopedia items detail route matches on, so the dungeon modal can deep-link the key name. */
  dungeon_key_template_id?: string
}

/** One authored mob spell EFFECT row — the exact JSON the seeder minted into the on-chain
 * SpellEffect (seed_full_corpus.mjs `mobEffect`: kind passes through, `base ?? value` becomes the
 * chain `value`, string elements map to their ids). Kept raw here; display decode = mob_spells.ts. */
export interface CorpusMobSpellEffect {
  kind?: number
  op?: string
  element?: string | null
  base?: number
  value?: number
  stat?: number
  turns?: number
  chance?: number
  area_shape?: number
  area_size?: number
}

/** One authored mob spell — minted 1:1 into the MobTemplate's SpellLevel kit (seed_full_corpus.mjs
 * PHASE 5 `spellLevel`: ap/rmin/rmax/cd/crit pass through; los defaults to true). */
export interface CorpusMobSpell {
  ap?: number
  rmin?: number
  rmax?: number
  cd?: number
  crit?: number
  los?: boolean
  effects?: CorpusMobSpellEffect[]
  crit_effects?: CorpusMobSpellEffect[]
}

/** Per-TEMPLATE authored facts the §14 index deliberately does not decode (xp / the spell kit live in
 * the MobTemplate's nested tail — see bestiary_tab.tsx's header). Same corpus-join justification as the
 * world knowledge above: these values were minted VERBATIM from these rows (same generation, id-gated),
 * so displaying them never drifts from chain truth. */
export interface CorpusMobFacts {
  /** on-chain MobTemplate.xp_reward (null = no authored row → the caller hides the box, never fakes 0) */
  xp: number | null
  spells: CorpusMobSpell[]
  /** authored kind (trash · archi · elite · boss · dungeon_boss · protector). The bestiary detail gates
   * the archimob-odds chip on `role === 'archi'` — only an archi-eligible mob has an archimob variant. */
  role: string | null
}

/** Resource PROTECTORS (the ambrine precedent) guard a gatherable and are NOT roster mobs —
 * they never enter the world roster or the mob encyclopedia. Every other authored role lists normally.
 * (Today a data-audit mislabels some protectors `archi`; this rule activates the moment the data is fixed —
 * the component renders whatever the corpus says, it does not second-guess the label.) */
export const is_listed_mob_role = (role: string | null | undefined): boolean => role !== 'protector'

interface AuthoredMob {
  key?: string
  name?: string
  element?: string | null
  role?: string | null
  minLevel?: number
  maxLevel?: number
  xp?: number
  spells?: CorpusMobSpell[]
}

interface AuthoredResource {
  slug?: string
  name?: string
  level?: number
  i18n?: Record<string, { name?: string }>
}

interface AuthoredWorldResource {
  slug?: string
  job?: number
  tier?: number
}

interface AuthoredWorld {
  name?: string
  band?: number[]
  biome?: string
  resources?: AuthoredWorldResource[]
  /** the dungeon entry-key item SLUG (resolved to its minted template id via seed_manifest.items). */
  dungeonKey?: string
}

const authored_names = ['world', 'mobs', 'resources'] as const
const authored_modules: Record<string, unknown> = bun_runtime
  ? Object.fromEntries(
      seed_manifest.worlds.flatMap(({ wid }) =>
        authored_names.map((name) => {
          const relative_path = `../../../../../seed/mainnet/${wid}/${name}.json`
          const data = (import.meta as ImportMeta & { require(path: string): unknown }).require(relative_path)
          return [relative_path, data]
        })
      )
    )
  : import.meta.glob(
      [
        '../../../../../seed/mainnet/*/world.json',
        '../../../../../seed/mainnet/*/mobs.json',
        '../../../../../seed/mainnet/*/resources.json',
      ],
      { eager: true, import: 'default' }
    )

function authored_json<T>(wid: string, name: (typeof authored_names)[number]): T {
  const relative_path = `../../../../../seed/mainnet/${wid}/${name}.json`
  const exact = authored_modules[relative_path]
  if (exact !== undefined) return exact as T
  const suffix = `/seed/mainnet/${wid}/${name}.json`
  const match = Object.entries(authored_modules).find(([file_path]) => file_path.endsWith(suffix))
  if (!match) throw new Error(`authored seed file missing: ${wid}/${name}.json`)
  return match[1] as T
}

const locales = ['fr', 'de', 'es', 'ja', 'uk'] as const
const resource_by_slug = new Map<string, { name: string; level: number; i18n_json?: string }>()
for (const { wid } of seed_manifest.worlds)
  for (const resource of authored_json<AuthoredResource[]>(wid, 'resources')) {
    if (!resource.slug || resource_by_slug.has(resource.slug)) continue
    const names: Record<string, string> = {}
    for (const locale of locales) {
      const name = resource.i18n?.[locale]?.name
      if (name) names[locale] = name
    }
    resource_by_slug.set(resource.slug, {
      name: resource.name ?? resource.slug,
      level: resource.level ?? 0,
      ...(Object.keys(names).length ? { i18n_json: JSON.stringify({ name: names }) } : {}),
    })
  }

const corpus_worlds: CorpusWorld[] = []
// template id → authored xp/spell facts. A mob authored in several worlds keeps its FIRST row (the
// seeder mints one template per key; kits are authored identically across placements).
const mob_facts_by_id = new Map<string, CorpusMobFacts>()
for (const world of seed_manifest.worlds) {
  if (!is_object_id(world.id)) throw new Error(`seed world ${world.wid} has an invalid object id`)
  const authored_world = authored_json<AuthoredWorld>(world.wid, 'world')
  const mobs: CorpusMob[] = []
  for (const mob of authored_json<AuthoredMob[]>(world.wid, 'mobs')) {
    const id = mob.key ? seed_manifest.mobs[mob.key]?.id : undefined
    if (!is_object_id(id)) continue
    if (!mob_facts_by_id.has(id))
      mob_facts_by_id.set(id, { xp: mob.xp ?? null, spells: mob.spells ?? [], role: mob.role ?? null })
    // Protectors keep their FACTS row (so the bestiary can recognize + exclude them) but never join a roster.
    if (!is_listed_mob_role(mob.role)) continue
    mobs.push({
      id,
      name: mob.name ?? mob.key ?? '',
      element: mob.element ?? null,
      role: mob.role ?? null,
      minLevel: mob.minLevel ?? 0,
      maxLevel: mob.maxLevel ?? 0,
    })
  }
  mobs.sort((left, right) => left.minLevel - right.minLevel || left.name.localeCompare(right.name))

  const resources: CorpusResource[] = []
  for (const resource of authored_world.resources ?? []) {
    const id = resource.slug ? seed_manifest.items[resource.slug] : undefined
    const metadata = resource.slug ? resource_by_slug.get(resource.slug) : undefined
    if (!resource.slug || !is_object_id(id) || !metadata) continue
    resources.push({
      id,
      slug: resource.slug,
      name: metadata.name,
      ...(metadata.i18n_json ? { i18nJson: metadata.i18n_json } : {}),
      job: resource.job ?? 0,
      tier: resource.tier ?? 0,
      level: metadata.level,
    })
  }
  resources.sort((left, right) => left.tier - right.tier || left.job - right.job)

  const band =
    Array.isArray(authored_world.band) && authored_world.band.length === 2
      ? ([authored_world.band[0], authored_world.band[1]] as [number, number])
      : null
  corpus_worlds.push({
    id: world.id,
    wid: world.wid,
    name: authored_world.name ?? world.wid,
    band,
    biome: authored_world.biome ?? '',
    mobs,
    resources,
    // Same slug→template resolution the resources use (above): the authored key slug → its minted template id.
    dungeon_key_template_id: authored_world.dungeonKey ? seed_manifest.items[authored_world.dungeonKey] : undefined,
  })
}

corpus_worlds.sort((left, right) => (left.band?.[0] ?? 0) - (right.band?.[0] ?? 0))
const roster_count = corpus_worlds.reduce((count, world) => count + world.mobs.length, 0)
const resource_count = corpus_worlds.reduce((count, world) => count + world.resources.length, 0)
if (!corpus_worlds.length || !roster_count || !resource_count)
  throw new Error(
    `seed world corpus joined ${corpus_worlds.length} worlds / ${roster_count} mobs / ${resource_count} resources`
  )

export const WORLD_CORPUS = { worlds: corpus_worlds }
const WORLDS = WORLD_CORPUS.worlds

const BY_ID = new Map<string, CorpusWorld>(WORLDS.map((w) => [w.id, w]))
const BY_MOB_ID = new Map<string, CorpusWorld[]>()
for (const world of WORLDS)
  for (const mob of world.mobs) {
    const locations = BY_MOB_ID.get(mob.id) ?? []
    locations.push(world)
    BY_MOB_ID.set(mob.id, locations)
  }
// Gatherable inversion — the exact BY_MOB_ID idiom over the same authored placement rows (a re-placed
// lower-tier node legitimately lists several worlds; each world at most once by construction).
const BY_RESOURCE_ID = new Map<string, CorpusWorld[]>()
for (const world of WORLDS)
  for (const resource of world.resources) {
    const locations = BY_RESOURCE_ID.get(resource.id) ?? []
    locations.push(world)
    BY_RESOURCE_ID.set(resource.id, locations)
  }

/** Authored knowledge for a live /v1 world row, or undefined (=> the caller renders an honest gap). */
export const world_corpus_of = (world_id: string | null | undefined): CorpusWorld | undefined =>
  BY_ID.get(world_id ?? '')

/** Offline-authored spawn provenance for a live mob template id; /v1 mob rows do not project a world field. */
export const world_corpus_for_mob = (mob_template_id: string | null | undefined): readonly CorpusWorld[] =>
  BY_MOB_ID.get(mob_template_id ?? '') ?? []

/** Offline-authored placement provenance for a live gatherable item template id — the items-tab
 * "FOUND IN" list (night-batch #8), mirroring the mob idiom above. Empty for non-gatherables. */
export const world_corpus_for_resource = (item_template_id: string | null | undefined): readonly CorpusWorld[] =>
  BY_RESOURCE_ID.get(item_template_id ?? '') ?? []

/** Authored xp/spell facts for a live mob template id (minted verbatim from these rows — see
 * CorpusMobFacts), or undefined => the caller renders an honest gap. */
export const mob_corpus_of = (mob_template_id: string | null | undefined): CorpusMobFacts | undefined =>
  mob_facts_by_id.get(mob_template_id ?? '')

// ─── gathering ladders (the JOBS tab) ──────────────────────────────────────────────────────────────
// ONE home for "which resource sits at which tier/level": the same authored rows the worlds tab shows.
// world.json's numeric `job` is the authoring order of the three gather jobs — the SAME order
// JOB_MASTER_JOBS declares them in ('Gathering' category), so the mapping is derived, never a literal.
const GATHER_JOB_IDS: string[] = JOB_MASTER_JOBS.filter((j) => j.category === 'Gathering').map((j) => j.id)

export interface GatherRow extends CorpusResource {
  /** XP per harvest — the authored on-chain formula (@aresrpg/sdk/jobs `gather_xp`), never a literal ladder. */
  xp: number
}

/** The authored on-chain gather-XP curve (packages/sdk/src/jobs.js `gather_xp`). */
const gather_xp = (required_level: number) => 10 + Math.floor(required_level / 2)

/**
 * job id ('FARMER'|'HERBALIST'|'MINER') -> its full progression, deduped by resource and tier-sorted.
 * Worlds re-place lower-tier nodes (12_static_fields re-uses 09_coral_throne's draconite), so the same
 * resource legitimately appears in several worlds — the ladder lists each exactly once.
 */
export const GATHER_LADDERS: Record<string, GatherRow[]> = (() => {
  const out: Record<string, GatherRow[]> = {}
  const seen: Record<string, Set<string>> = {}
  for (const job_id of GATHER_JOB_IDS) {
    out[job_id] = []
    seen[job_id] = new Set()
  }
  for (const world of WORLDS)
    for (const resource of world.resources) {
      const job_id = GATHER_JOB_IDS[resource.job]
      if (!job_id || seen[job_id].has(resource.slug)) continue
      seen[job_id].add(resource.slug)
      out[job_id].push({ ...resource, xp: gather_xp(resource.level) })
    }
  for (const job_id of GATHER_JOB_IDS) out[job_id].sort((a, b) => a.tier - b.tier || a.level - b.level)
  return out
})()
