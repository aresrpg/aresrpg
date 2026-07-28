// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTHORED world knowledge (burial-reseed corpus join, 2026-07-13). The encyclopedia is STATIC
// KNOWLEDGE: a world's display name, level band, mob roster and gatherable resources are authored
// corpus facts, not live chain state.
//
// RUNTIME BLOB, NOT A BUILD-TIME GLOB (#196): the authored trio (world/mobs/resources per wid) is ONE
// published asset-host blob (world_corpus.json), fetched at boot exactly like game/data/spell_corpus.js and
// mob_catalog.js — one runtime-content pattern, now three consumers. Gameplay content NEVER ships inside
// this repo; it reaches the game only as published chain state + CDN blobs. Until the blob publishes (or
// on a fetch failure) the corpus DEGRADES LOUDLY to inert (zero worlds + ONE console.error) and the app
// still mounts — never a crash, never a cached absence (a failed load leaves the cache empty AND `status`
// non-ready, so a later load still populates it). The prior build-time `import.meta.glob` over the
// (repo-absent) seed/mainnet/*.json is what logged `joined 0 worlds` in prod; this loader replaces it.
//
// WHO LOADS IT: main.tsx, next to load_mob_catalog / load_pet_catalog / load_spell_corpus — the ONE boot home
// for every runtime content blob. The cache is a store (below), so surfaces mounted before the blob lands
// re-render when it does.
//
// WHY AUTHORED CORPUS AND NOT /v1: the read-API's mob rows carry NO world provenance (views.js projects
// template_id/name/levels/element/drops — never the world), so the world->roster relation simply does
// not exist on /v1 and cannot be joined client-side from it. Rather than grow a new indexer projection
// (packages/rpc image rebuild + repush) for facts that only ever change when we re-seed, the join is
// computed from the authored blob and keyed by the CURRENT lineage's ids from the seed receipt. The blob
// carries NO object ids (deliberately, #196): the app joins authored rows to the live lineage via its own
// seed_manifest receipt, so a republish never stales the blob. There is no second checked-in ID projection.
//
// The chain stays the source of truth for WHICH worlds are live: the worlds tab lists /v1's rows and
// joins THIS for their display knowledge (a /v1 world absent here still renders, honestly degraded).
import { create } from 'zustand'
import { asset_url } from '@aresrpg/sdk/jobs'

import { is_object_id, seed_manifest } from '../../content/seed_manifest'
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
  // ── COMBAT BLOCK (optional) — the Fight-side mob truth (`MobSpec`: base_hp/ap/mp/stats, mob.move:52-62).
  // It exists nowhere else client-side: /v1's mob rows stop before the stats tail, so a chain-free consumer
  // (the local fight simulator) can only get it from this blob. The authored rows spell it `hp`/`ap`/`mp`/
  // `stats` with seeder defaults 30/6/3 (move/scripts/apply_xp_payload.mjs `desired_state_by_key`); it lands
  // here under the CHAIN names the consumers read, `stats` in TRUE magnitudes (the chain's centering is a
  // storage convention the seeder applies at mint — MobSpec's own doc: "already DECENTERED").
  // ABSENT ⇒ UNPUBLISHED, never 0: a consumer must degrade loudly (badge + a declared fallback), never
  // present a fabricated combat block as truth.
  base_hp?: number
  ap?: number
  mp?: number
  stats?: Record<string, number>
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
  /** the authored combat tail (seeder vocabulary) — projected onto CorpusMob's chain names. */
  hp?: number
  ap?: number
  mp?: number
  stats?: Record<string, number>
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

/** The published world-corpus blob (#196 contract): the authored trio VERBATIM, keyed by wid, sorted.
 *  `blob[wid][name]` is the exact JSON the old build-time seed/mainnet/<wid>/{world,mobs,resources}.json
 *  glob served — every downstream derivation below is unchanged; only the SOURCE moved to runtime. */
export interface WorldCorpusBlob {
  [wid: string]: { world: AuthoredWorld; mobs: AuthoredMob[]; resources: AuthoredResource[] }
}

export interface GatherRow extends CorpusResource {
  /** XP per harvest — the authored on-chain formula (@aresrpg/sdk/jobs `gather_xp`), never a literal ladder. */
  xp: number
}

/** The authored on-chain gather-XP curve (packages/sdk/src/jobs.js `gather_xp`). */
const gather_xp = (required_level: number) => 10 + Math.floor(required_level / 2)

// world.json's numeric `job` is the authoring order of the three gather jobs — the SAME order
// JOB_MASTER_JOBS declares them in ('Gathering' category), so the mapping is derived, never a literal.
const GATHER_JOB_IDS: string[] = JOB_MASTER_JOBS.filter((j) => j.category === 'Gathering').map((j) => j.id)

const locales = ['fr', 'de', 'es', 'ja', 'uk'] as const

interface Derived {
  worlds: CorpusWorld[]
  by_id: Map<string, CorpusWorld>
  by_mob_id: Map<string, CorpusWorld[]>
  by_resource_id: Map<string, CorpusWorld[]>
  mob_facts: Map<string, CorpusMobFacts>
  gather_ladders: Record<string, GatherRow[]>
}

type ResourceMeta = { name: string; level: number; i18n_json?: string }

/** slug → display metadata (localized name + level), FIRST authored row wins. The join both the world
 *  roster's gatherables and the JOBS ladders read; absent from the blob ⇒ an empty index (inert corpus). */
function index_resources_by_slug(blob: WorldCorpusBlob): Map<string, ResourceMeta> {
  const by_slug = new Map<string, ResourceMeta>()
  for (const { wid } of seed_manifest.worlds) {
    const entry = blob[wid]
    if (!entry) continue
    for (const resource of entry.resources) {
      if (!resource.slug || by_slug.has(resource.slug)) continue
      const names: Record<string, string> = {}
      for (const locale of locales) {
        const name = resource.i18n?.[locale]?.name
        if (name) names[locale] = name
      }
      by_slug.set(resource.slug, {
        name: resource.name ?? resource.slug,
        level: resource.level ?? 0,
        ...(Object.keys(names).length ? { i18n_json: JSON.stringify({ name: names }) } : {}),
      })
    }
  }
  return by_slug
}

/** One world's roster + the xp/spell facts to accumulate. A mob resolves its template id from the seed
 *  receipt (unresolved keys drop out); PROTECTORS keep a facts row (so the bestiary can exclude them) but
 *  never join a roster. `facts` is returned for the caller to apply FIRST-row-wins across worlds. */
function project_roster(authored_mobs: AuthoredMob[]): { roster: CorpusMob[]; facts: Array<[string, CorpusMobFacts]> } {
  const roster: CorpusMob[] = []
  const facts: Array<[string, CorpusMobFacts]> = []
  for (const mob of authored_mobs) {
    const id = mob.key ? seed_manifest.mobs[mob.key]?.id : undefined
    if (!is_object_id(id)) continue
    facts.push([id, { xp: mob.xp ?? null, spells: mob.spells ?? [], role: mob.role ?? null }])
    if (!is_listed_mob_role(mob.role)) continue
    roster.push({
      id,
      name: mob.name ?? mob.key ?? '',
      element: mob.element ?? null,
      role: mob.role ?? null,
      minLevel: mob.minLevel ?? 0,
      maxLevel: mob.maxLevel ?? 0,
      // The combat block rides through only when authored — an absent field stays absent (see CorpusMob).
      ...(mob.hp != null ? { base_hp: mob.hp } : {}),
      ...(mob.ap != null ? { ap: mob.ap } : {}),
      ...(mob.mp != null ? { mp: mob.mp } : {}),
      ...(mob.stats != null ? { stats: mob.stats } : {}),
    })
  }
  roster.sort((left, right) => left.minLevel - right.minLevel || left.name.localeCompare(right.name))
  return { roster, facts }
}

/** One world's gatherable placements → live item ids + display metadata (unresolved slugs drop out
 *  honestly). Tier-then-job sorted, the WORLDS-tab order. */
function project_gatherables(
  authored_world: AuthoredWorld,
  resource_by_slug: Map<string, ResourceMeta>
): CorpusResource[] {
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
  return resources
}

/** Invert worlds by a template-id selector — id → every world that places it (each world at most once by
 *  construction). Powers the bestiary/items "FOUND IN" lists (world_corpus_for_mob / _for_resource). */
function group_worlds_by(worlds: CorpusWorld[], ids_of: (world: CorpusWorld) => string[]): Map<string, CorpusWorld[]> {
  const map = new Map<string, CorpusWorld[]>()
  for (const world of worlds)
    for (const id of ids_of(world)) {
      const locations = map.get(id) ?? []
      locations.push(world)
      map.set(id, locations)
    }
  return map
}

/** The JOBS-tab gather ladders: job id ('FARMER'|'HERBALIST'|'MINER') → its progression, deduped by resource
 *  and tier-sorted, each row carrying the on-chain gather-xp. Worlds re-place lower-tier nodes, so a resource
 *  legitimately spans several worlds — the ladder lists each exactly once. */
function build_gather_ladders(worlds: CorpusWorld[]): Record<string, GatherRow[]> {
  const ladders: Record<string, GatherRow[]> = {}
  const seen: Record<string, Set<string>> = {}
  for (const job_id of GATHER_JOB_IDS) {
    ladders[job_id] = []
    seen[job_id] = new Set()
  }
  for (const world of worlds)
    for (const resource of world.resources) {
      const job_id = GATHER_JOB_IDS[resource.job]
      if (!job_id || seen[job_id].has(resource.slug)) continue
      seen[job_id].add(resource.slug)
      ladders[job_id].push({ ...resource, xp: gather_xp(resource.level) })
    }
  for (const job_id of GATHER_JOB_IDS) ladders[job_id].sort((a, b) => a.tier - b.tier || a.level - b.level)
  return ladders
}

/**
 * PURE projection: the published blob (+ the current seed receipt for ids) → the derived corpus the UI
 * reads. Worlds present in the seed manifest but absent from the blob are SKIPPED (the migration / empty
 * state degrades to inert). The per-world object-id guard stays HARD — a seeded-but-malformed world is a
 * real data bug, not the absence case. Same math the build-time glob fed; only the source moved.
 */
function build_world_corpus(blob: WorldCorpusBlob): Derived {
  const resource_by_slug = index_resources_by_slug(blob)
  const worlds: CorpusWorld[] = []
  // template id → authored xp/spell facts, FIRST row wins (the seeder mints one template per key; kits are
  // authored identically across placements).
  const mob_facts = new Map<string, CorpusMobFacts>()
  for (const world of seed_manifest.worlds) {
    if (!is_object_id(world.id)) throw new Error(`seed world ${world.wid} has an invalid object id`)
    const entry = blob[world.wid]
    if (!entry) continue
    const { roster, facts } = project_roster(entry.mobs)
    for (const [id, row] of facts) if (!mob_facts.has(id)) mob_facts.set(id, row)
    const authored_world = entry.world
    const band =
      Array.isArray(authored_world.band) && authored_world.band.length === 2
        ? ([authored_world.band[0], authored_world.band[1]] as [number, number])
        : null
    worlds.push({
      id: world.id,
      wid: world.wid,
      name: authored_world.name ?? world.wid,
      band,
      biome: authored_world.biome ?? '',
      mobs: roster,
      resources: project_gatherables(authored_world, resource_by_slug),
      // Same slug→template resolution the gatherables use: the authored key slug → its minted template id.
      dungeon_key_template_id: authored_world.dungeonKey ? seed_manifest.items[authored_world.dungeonKey] : undefined,
    })
  }
  worlds.sort((left, right) => (left.band?.[0] ?? 0) - (right.band?.[0] ?? 0))
  return {
    worlds,
    by_id: new Map(worlds.map((w) => [w.id, w])),
    by_mob_id: group_worlds_by(worlds, (w) => w.mobs.map((m) => m.id)),
    by_resource_id: group_worlds_by(worlds, (w) => w.resources.map((r) => r.id)),
    mob_facts,
    gather_ladders: build_gather_ladders(worlds),
  }
}

// ─── runtime cache (mirrors spell_corpus.js / mob_catalog.js) ────────────────────────────────────────
// A STORE, not a module `let`: a mutable module object is invisible to React, so every component that read
// it once (the simulator's mob picker) stayed frozen on the boot-empty corpus forever even after the blob
// landed. Sync callers below read `.getState()`; components subscribe with the hook — ONE home either way.
//
// `status` is the honest three-state the UI needs: 'loading' until a load settles (absence is NEVER rendered
// as emptiness), 'ready' once a blob joined, 'inert' when the load degraded — inert stays RETRYABLE, so a
// later load_world_corpus still populates it.
type CorpusStatus = 'loading' | 'ready' | 'inert'

/** The ONE cache input: a load settled (a blob ⇒ ready, nothing ⇒ inert), or the cache was reset to pristine. */
type CorpusInput = { type: 'settled'; blob?: WorldCorpusBlob } | { type: 'pristine' }

const reduce_world_corpus = (message: Readonly<CorpusInput>): Derived & { status: CorpusStatus } =>
  message.type === 'pristine'
    ? { ...build_world_corpus({}), status: 'loading' }
    : { ...build_world_corpus(message.blob ?? {}), status: message.blob ? 'ready' : 'inert' }

export const use_world_corpus = create<Derived & { status: CorpusStatus; input: (message: CorpusInput) => void }>(
  (set) => ({
    ...build_world_corpus({}),
    status: 'loading',
    input: (message) => set(reduce_world_corpus(message)),
  })
)

/** The live derivation + its load status — the synchronous read every non-React caller below takes. */
const corpus = (): Derived & { status: CorpusStatus } => use_world_corpus.getState()

let warned = false

// ONE deduped content-degrade shout (per session). The boot-smoke check allowlists this exact prefix — the
// world_corpus blob is a seed-side publish dependency, not a repo artifact (issue #106 / #196).
const warn_degrade = (why: string): void => {
  if (warned) return
  warned = true
  console.error(
    `[world_corpus] world knowledge inert (${why}) — the encyclopedia lists no worlds until the seed ` +
      `ceremony publishes world_corpus.json (issue #106).`
  )
}

/** A load that never produced a blob: settle the cache INERT (retryable — never a frozen 'loading') + shout. */
const degrade = (why: string): void => {
  use_world_corpus.getState().input({ type: 'settled' })
  warn_degrade(why)
}

/**
 * Fetch the published blob once and cache its derivation. Non-blocking at boot (the app mounts while it
 * resolves; the encyclopedia fills in on arrival — the worlds tab re-renders when its /v1 list settles).
 * Loud no-op when the manifest has no `world_corpus` row yet (asset_url → null), the fetch fails, or
 * the blob joins to nothing — leaving the cache empty and RETRYABLE (never a frozen absence), never a throw.
 * Call after the asset manifest is seeded (main.tsx, post load_asset_manifest).
 */
export async function load_world_corpus(): Promise<void> {
  if (corpus().status === 'ready') return
  const url = asset_url('world_corpus', 'world_corpus.json')
  if (!url) return degrade('unpublished — not in the asset manifest')
  try {
    const response = await fetch(url)
    if (!response.ok) return degrade(`HTTP ${response.status}`)
    const blob = (await response.json()) as WorldCorpusBlob
    // The blob landed: it enters the cache through the reducer door, so every subscribed surface re-renders.
    use_world_corpus.getState().input({ type: 'settled', blob })
    const { worlds } = corpus()
    const roster = worlds.reduce((count, world) => count + world.mobs.length, 0)
    const gatherables = worlds.reduce((count, world) => count + world.resources.length, 0)
    if (!worlds.length || !roster || !gatherables)
      warn_degrade(`joined ${worlds.length} worlds / ${roster} mobs / ${gatherables} resources`)
  } catch (error) {
    // Network / parse failure — stay retryable; the encyclopedia stays inert until a later load lands.
    degrade(`fetch failed: ${(error as Error)?.message ?? String(error)}`)
  }
}

/**
 * Test seam (mirrors set_spell_corpus_for_test): seed the cache directly, no fetch. Pass a blob (the #196
 * shape) to exercise the real projection (marks the cache ready), or nothing to reset to PRISTINE — empty
 * and never-loaded, so load_world_corpus runs again. Always clears the degrade latch.
 */
export function set_world_corpus_for_test(blob?: WorldCorpusBlob): void {
  use_world_corpus.getState().input(blob === undefined ? { type: 'pristine' } : { type: 'settled', blob })
  warned = false
}

/** The derived corpus worlds (synchronous — read live; empty until load_world_corpus resolves the blob). */
export const WORLD_CORPUS = {
  get worlds(): CorpusWorld[] {
    return corpus().worlds
  },
}

/** Whether the runtime blob loaded with content (the loader ran and joined ≥1 world). Tests skip the
 * full-corpus cardinality cases on this — a headless unit test never fetches the blob (issue #106 / #196). */
export const has_world_corpus = (): boolean => corpus().worlds.length > 0

/** Authored knowledge for a live /v1 world row, or undefined (=> the caller renders an honest gap). */
export const world_corpus_of = (world_id: string | null | undefined): CorpusWorld | undefined =>
  corpus().by_id.get(world_id ?? '')

/** Offline-authored spawn provenance for a live mob template id; /v1 mob rows do not project a world field. */
export const world_corpus_for_mob = (mob_template_id: string | null | undefined): readonly CorpusWorld[] =>
  corpus().by_mob_id.get(mob_template_id ?? '') ?? []

/** Offline-authored placement provenance for a live gatherable item template id — the items-tab
 * "FOUND IN" list (night-batch #8), mirroring the mob idiom above. Empty for non-gatherables. */
export const world_corpus_for_resource = (item_template_id: string | null | undefined): readonly CorpusWorld[] =>
  corpus().by_resource_id.get(item_template_id ?? '') ?? []

/** Authored xp/spell facts for a live mob template id (minted verbatim from these rows — see
 * CorpusMobFacts), or undefined => the caller renders an honest gap. */
export const mob_corpus_of = (mob_template_id: string | null | undefined): CorpusMobFacts | undefined =>
  corpus().mob_facts.get(mob_template_id ?? '')

/** The gather progression for a job id ('FARMER'|'HERBALIST'|'MINER'), tier-sorted and deduped; [] until
 * the blob loads or for an unknown/absent job id. */
export const gather_ladder_of = (job_id: string | null | undefined): GatherRow[] =>
  corpus().gather_ladders[job_id ?? ''] ?? []
