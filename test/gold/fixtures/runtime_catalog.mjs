// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gold-localnet frontend content modules. Every generated module derives from this boot's seed receipt and
// lives under test/gold/out/fixtures; no production content projection is copied or rewritten.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const MAINNET_SPELLS = path.join(REPO, 'seed', 'mainnet', 'spells')
const ACTIVE_CONTENT = path.join(REPO, 'packages', 'move', 'scripts', 'seed_content.json')
const DEPLOYMENT_SOURCE = path.join(REPO, 'packages', 'frontend', 'src', 'chain', 'deployment.ts')
const FIGHT_SPELLS_SOURCE = path.join(REPO, 'packages', 'frontend', 'src', 'game', 'screens', 'hud', 'fight-spells.js')
const ID_RE = /^0x[0-9a-fA-F]{64}$/

const read_json = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'))
const valid_id = (value) => typeof value === 'string' && ID_RE.test(value)
const unique_ids = (values) => [...new Set(values.filter(valid_id))].sort()
const object_id = (value) => (typeof value === 'string' ? value : value?.id)
const name_key = (name) =>
  String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

const kind_names = {
  0: 'DAMAGE',
  1: 'PERCENT_LIFE',
  2: 'LIFE_STEAL',
  3: 'CASTER_DAMAGE',
  4: 'PUNISHMENT',
  5: 'HEAL',
  6: 'GIVE_POINTS',
  7: 'REMOVE_POINTS',
  8: 'STEAL_POINTS',
  9: 'ALTER_STAT',
  10: 'STEAL_STAT',
  11: 'ALTER_RESIST',
  12: 'PUSH',
  13: 'PULL',
  14: 'TELEPORT',
  15: 'SWAP',
  16: 'CARRY',
  17: 'THROW',
  19: 'PLACE_TRAP',
  20: 'PLACE_GLYPH',
  21: 'APPLY_DOT',
  22: 'APPLY_STATE',
  23: 'REMOVE_STATE',
  24: 'REDUCE_DAMAGE',
  25: 'REFLECT_DAMAGE',
  26: 'DISPEL',
  27: 'INVISIBILITY',
  28: 'REVEAL',
  29: 'RETURN_SPELL',
}
const element_names = { 0: 'fire', 1: 'water', 2: 'earth', 3: 'air', 255: 'neutral' }
const shape_names = { 0: 'POINT', 1: 'CIRCLE', 2: 'CROSS', 3: 'LINE', 4: 'TBAR', 5: 'RING', 6: 'ALLMAP', 7: 'CONE' }

const decode_effect = (effect) => ({
  kind: kind_names[effect.kind] ?? String(effect.kind),
  ...(effect.element != null ? { element: element_names[effect.element] ?? String(effect.element) } : {}),
  base: effect.value ?? 0,
  ...(effect.damageMin != null ? { damageMin: effect.damageMin } : {}),
  ...(effect.damageMax != null ? { damageMax: effect.damageMax } : {}),
  chance: effect.chance ?? 100,
  turns: effect.turns ?? 0,
  area_shape: shape_names[effect.area_shape ?? 0] ?? 'POINT',
  area_size: effect.area_size ?? 0,
  ...(effect.zone != null
    ? { zone: { shape: shape_names[effect.zone.shape ?? 0] ?? 'POINT', size: effect.zone.size ?? 0 } }
    : {}),
  ...(effect.stat != null ? { stat: effect.stat } : {}),
})

const level_of = (level) => ({
  min_char_level: level.min_char_level,
  ap: level.ap_cost,
  mp: 0,
  range: [level.range_min, level.range_max],
  modifiable_range: level.modifiable_range ?? false,
  line_of_sight: level.line_of_sight !== false,
  linear: level.line_launch ?? false,
  free_cell: level.free_cell ?? false,
  casts_per_turn: level.casts_per_turn,
  casts_per_target: level.casts_per_target,
  cooldown: level.cooldown_turns,
  crit_rate: level.crit_rate,
  effects: (level.effects ?? []).map((effect) => {
    const decoded = decode_effect(effect)
    const critical = (level.crit_effects ?? []).find((candidate) => candidate.kind === effect.kind)
    if (critical) decoded.crit_base = critical.value
    return decoded
  }),
})

function mainnet_spell_rows(seed, spells_dir) {
  // Returns BOTH the slim runtime rows and the RAW corpus rows: the emitted module must mirror the real
  // fight-spells.js template surface (normalize_chain_spell_corpus over the raw corpus, joined per row) —
  // the missing fight_spell_template export boot-crashed the app in gold runs (P1 twin-drift, 2026-07-19).
  const raw = fs
    .readdirSync(spells_dir)
    .filter((filename) => filename.endsWith('.json'))
    .flatMap((filename) => read_json(path.join(spells_dir, filename)))
  const rows = raw.map((spell) => {
    const key = `${spell.classType}:${spell.unlock}:${spell.id}`
    const entry = seed.spells?.[key]
    if (!valid_id(entry?.id)) throw new Error(`runtime_catalog: seed manifest has no spell id for ${key}`)
    return {
      object_id: entry.id,
      // template_id (NOT corpus_id): the real fight-spells.js emits `template_id: spell.id` and fight.js keys
      // SPELL_TEMPLATES by `spell.template_id` — a `corpus_id` field left that key `undefined`, silently dead in
      // gold. The value is unchanged (spell.id); only the field NAME aligns to the twinned production surface.
      template_id: spell.id,
      class: spell.classType,
      unlock_level: spell.unlock,
      name: spell.name,
      name_key: name_key(spell.name),
      kind: spell.role === 'heal' ? 'heal' : 'dmg',
      role: spell.role ?? 'damage',
      element: spell.element ?? null,
      levels: (spell.levels ?? []).map(level_of),
    }
  })
  return { rows, raw }
}

function mainnet_world_corpus(seed, corpus_root) {
  const resource_by_slug = new Map()
  for (const world of seed.worlds ?? []) {
    const resources_path = path.join(corpus_root, world.wid, 'resources.json')
    if (!fs.existsSync(resources_path)) continue
    for (const resource of read_json(resources_path)) {
      if (!resource?.slug || resource_by_slug.has(resource.slug)) continue
      const names = {}
      for (const locale of ['fr', 'de', 'es', 'ja', 'uk'])
        if (resource.i18n?.[locale]?.name) names[locale] = resource.i18n[locale].name
      resource_by_slug.set(resource.slug, {
        name: resource.name,
        level: resource.level ?? 0,
        ...(Object.keys(names).length ? { i18nJson: JSON.stringify({ name: names }) } : {}),
      })
    }
  }

  const worlds = []
  // template id → authored xp/spell facts, FIRST authored row wins — mirrors the real module's
  // mob_facts_by_id join (src/pages/encyclopedia/world_corpus.ts, mob_corpus_of).
  const mob_facts = {}
  for (const world of seed.worlds ?? []) {
    if (!valid_id(world?.id)) continue
    const world_dir = path.join(corpus_root, world.wid)
    const authored_world = read_json(path.join(world_dir, 'world.json'))
    const mobs = read_json(path.join(world_dir, 'mobs.json'))
      .flatMap((mob) => {
        const id = seed.mobs?.[mob.key]?.id
        if (!valid_id(id)) return []
        mob_facts[id] ??= { xp: mob.xp ?? null, spells: mob.spells ?? [] }
        return [
          {
            id,
            name: mob.name,
            element: mob.element ?? null,
            role: mob.role ?? null,
            minLevel: mob.minLevel ?? 0,
            maxLevel: mob.maxLevel ?? 0,
          },
        ]
      })
      .sort((left, right) => left.minLevel - right.minLevel || left.name.localeCompare(right.name))
    const resources = (authored_world.resources ?? [])
      .flatMap((resource) => {
        const id = seed.items?.[resource.slug]
        const metadata = resource_by_slug.get(resource.slug)
        return valid_id(id) && metadata
          ? [
              {
                id,
                slug: resource.slug,
                name: metadata.name,
                ...(metadata.i18nJson ? { i18nJson: metadata.i18nJson } : {}),
                job: resource.job ?? 0,
                tier: resource.tier ?? 0,
                level: metadata.level,
              },
            ]
          : []
      })
      .sort((left, right) => left.tier - right.tier || left.job - right.job)
    worlds.push({
      id: world.id,
      wid: world.wid,
      name: authored_world.name ?? world.wid,
      band: Array.isArray(authored_world.band) && authored_world.band.length === 2 ? authored_world.band : null,
      biome: authored_world.biome ?? '',
      mobs,
      resources,
    })
  }
  worlds.sort((left, right) => (left.band?.[0] ?? 0) - (right.band?.[0] ?? 0))
  return { worlds, mob_facts }
}

const active_min_levels = (unlock) => [1, 20, 40, 60, 80, unlock + 100]
const active_effect = (spell, base) => ({
  kind: spell.kind === 'heal' ? 'HEAL' : 'DAMAGE',
  element: spell.kind === 'heal' ? 'neutral' : spell.element === 'none' ? 'neutral' : spell.element,
  base,
  ...(spell.kind === 'heal' ? {} : { crit_base: base + 10 }),
  chance: 100,
  turns: 0,
  area_shape: 'POINT',
  area_size: 0,
})

function active_spell_rows(seed) {
  const ids = seed.spells ?? {}
  const content = read_json(ACTIVE_CONTENT)
  return (content.spells ?? []).map((spell) => {
    const key = `${spell.class}:${spell.unlock}`
    const id = object_id(ids[key])
    if (!valid_id(id)) throw new Error(`runtime_catalog: seed manifest has no localnet spell id for ${key}`)
    const gates = active_min_levels(spell.unlock)
    return {
      object_id: id,
      class: spell.class,
      unlock_level: spell.unlock,
      name: spell.name,
      name_key: name_key(spell.name),
      kind: spell.kind === 'heal' ? 'heal' : 'dmg',
      role: spell.kind === 'heal' ? 'heal' : 'damage',
      element: spell.element === 'none' ? 'neutral' : (spell.element ?? null),
      levels: (spell.dmgRows ?? []).map((base, index) => ({
        min_char_level: gates[index],
        ap: 4,
        mp: 0,
        range: spell.kind === 'heal' ? [0, 4] : [1, 4],
        modifiable_range: false,
        line_of_sight: true,
        linear: false,
        free_cell: false,
        casts_per_turn: 255,
        casts_per_target: 255,
        cooldown: 0,
        crit_rate: spell.kind === 'heal' ? 0 : 50,
        effects: [active_effect(spell, base)],
      })),
    }
  })
}

function fixture_ids(fight_fixtures, kind) {
  const keys =
    kind === 'mobs'
      ? new Set(['mob', 'mob_id', 'mob_template', 'mob_template_id', 'mobs', 'mob_ids'])
      : new Set(['world', 'world_id', 'worlds', 'world_ids'])
  const found = []
  const visit = (value, key = '') => {
    if (keys.has(key)) {
      if (Array.isArray(value)) value.forEach((entry) => found.push(object_id(entry)))
      else found.push(object_id(value))
    }
    if (value && typeof value === 'object')
      for (const [child_key, child] of Object.entries(value)) visit(child, child_key.toLowerCase())
  }
  visit(fight_fixtures)
  return unique_ids(found)
}

function living_ids(seed, fight_fixtures) {
  const items = unique_ids(Object.values(seed.items ?? {}).map(object_id))
  const mobs = unique_ids([...Object.values(seed.mobs ?? {}).map(object_id), ...fixture_ids(fight_fixtures, 'mobs')])
  const worlds = unique_ids([
    object_id(seed.world),
    ...(Array.isArray(seed.worlds) ? seed.worlds.map(object_id) : Object.values(seed.worlds ?? {}).map(object_id)),
    ...fixture_ids(fight_fixtures, 'worlds'),
  ])
  if (!items.length || !mobs.length || !worlds.length)
    throw new Error(
      `runtime_catalog: refuse empty localnet whitelist (${items.length} items / ${mobs.length} mobs / ${worlds.length} worlds)`
    )
  return { items, mobs, worlds }
}

function source_details(corpus_source) {
  if (corpus_source == null || corpus_source === 'mainnet')
    return { kind: 'mainnet', corpus_root: path.dirname(MAINNET_SPELLS), spells_dir: MAINNET_SPELLS }
  if (corpus_source === 'active') return { kind: 'active', corpus_root: null, spells_dir: null }
  const candidate = path.resolve(REPO, String(corpus_source))
  const spells_dir = path.basename(candidate) === 'spells' ? candidate : path.join(candidate, 'spells')
  if (fs.existsSync(spells_dir)) return { kind: 'mainnet', corpus_root: path.dirname(spells_dir), spells_dir }
  throw new Error(`runtime_catalog: unsupported corpus source ${corpus_source}`)
}

function label_from_wid(wid) {
  return String(wid)
    .replace(/^\d+_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

function worlds_from_manifest(seed) {
  if (!Array.isArray(seed.worlds) || !seed.worlds.length)
    throw new Error('runtime_catalog: seed manifest has no worlds')
  return [...seed.worlds]
    .sort((left, right) => String(left.wid).localeCompare(String(right.wid)))
    .map((world) => {
      if (!valid_id(world.id)) throw new Error(`runtime_catalog: world ${world.wid} has an invalid id`)
      return { id: world.id, label: world.name ?? world.label ?? label_from_wid(world.wid) }
    })
}

function runtime_worlds(seed, fight_fixtures = null) {
  let worlds
  if (Array.isArray(seed.worlds) && seed.worlds.length) worlds = worlds_from_manifest(seed)
  else {
    const id = object_id(seed.world)
    if (!valid_id(id)) throw new Error('runtime_catalog: seed manifest has no localnet world id')
    worlds = [{ id, label: seed.world?.name ?? seed.world?.label ?? 'Gold Active' }]
  }
  const seen = new Set(worlds.map((world) => world.id))
  for (const [key, fixture] of Object.entries(fight_fixtures ?? {})) {
    const id = object_id(fixture?.world_id ?? fixture?.world)
    if (!valid_id(id) || seen.has(id)) continue
    seen.add(id)
    worlds.push({
      id,
      label:
        fixture?.world_label ??
        fixture?.mob_name ??
        `Gold ${key.replace(/[^a-z0-9]+/gi, ' ').trim() || 'Fight'} Fixture`,
    })
  }
  return worlds
}

function active_world_corpus(seed) {
  const [world] = runtime_worlds(seed)
  return {
    worlds: [
      {
        id: world.id,
        wid: 'gold_active',
        name: world.label,
        band: null,
        biome: seed.world?.biome ?? '',
        mobs: [],
        resources: [],
      },
    ],
    mob_facts: {},
  }
}

/** A relative import specifier back to a REAL app module, `?gold-base`-tagged so the anchor vite alias plugin
 *  (localnet_content_plugin, vite.anchor.config.ts) skips it — resolveId bails out whenever the source string
 *  contains `?gold-base`, letting vite's normal resolver load the actual file. Without the tag this would
 *  resolve to the exact path the plugin redirects TO THIS SAME FIXTURE — an infinite self-import loop. */
function gold_base_specifier(generated_dir, source_path) {
  let relative = path.relative(generated_dir, source_path).replaceAll(path.sep, '/')
  if (!relative.startsWith('.')) relative = `./${relative}`
  return `${relative}?gold-base`
}

export function fight_module(spells, raw_corpus, generated_dir) {
  // FORWARD, NEVER DUPLICATE (root-caused 2026-07-20): project_spell_effect/project_spell_level are pure,
  // chain-data-independent projections — re-exported straight from the real module (same `?gold-base` escape
  // hatch deployment_module already used) so any future pure export the real module gains flows through
  // automatically. Only the chain-derived DATA (raw_corpus/spells) and the 5 accessors that must query THIS
  // fixture's substituted spells — never production spells — stay locally defined; those can't be forwarded,
  // the whole point of the fixture is substituting the DATA they close over. The old copy-pasted-logic twin
  // silently drifted behind cd383d92 (added project_spell_effect/level to the real module, r12d's boot-crash);
  // runtime_catalog_export_parity.test.mjs now guards every aliased pair generically against this class.
  return `import { normalize_chain_spell_corpus } from '@aresrpg/sim/chain_spell_corpus'
export * from ${JSON.stringify(gold_base_specifier(generated_dir, FIGHT_SPELLS_SOURCE))}
const raw_corpus = ${JSON.stringify(raw_corpus)}
export const fight_spell_templates = normalize_chain_spell_corpus(raw_corpus)
const spells = ${JSON.stringify(spells)}.map((spell) => ({
  ...spell,
  template: spell.template_id != null ? (fight_spell_templates.get(spell.template_id) ?? null) : null,
}))
export const fight_spells_data = { spells }
const by_name_key = new Map(spells.map((spell) => [spell.name_key, spell]))
export function resolve_class_spells(class_id, char_level) {
  if (!class_id) return []
  const id = String(class_id).toLowerCase()
  const level = Number.isFinite(char_level) ? char_level : 0
  return spells.filter((spell) => spell.class === id && spell.unlock_level <= level)
    .sort((left, right) => left.unlock_level - right.unlock_level)
}
export function class_spells(class_id) {
  if (!class_id) return []
  const id = String(class_id).toLowerCase()
  return spells.filter((spell) => spell.class === id).sort((left, right) => left.unlock_level - right.unlock_level)
}
export function fight_spell(key) { return (key && by_name_key.get(key)) || null }
export function fight_spell_template(key) { return fight_spell(key)?.template ?? null }
export function spell_object_id(key) { return fight_spell(key)?.object_id ?? null }
`
}

export function living_module(living) {
  return `const item_ids = new Set(${JSON.stringify(living.items)})
const mob_ids = new Set(${JSON.stringify(living.mobs)})
const world_ids = new Set(${JSON.stringify(living.worlds)})
export const is_living_item = (row) => item_ids.has(row.template_id ?? '')
export const is_living_mob = (row) => mob_ids.has(row.template_id ?? '')
export const is_living_world = (row) => world_ids.has(row.world_id ?? '')
`
}

export function world_module(world_corpus, mob_facts) {
  return `// packages/frontend/src/pages/encyclopedia/world_corpus.ts is the truth for this generated module's non-data exports.
export const is_listed_mob_role = (role) => role !== 'protector'
export const WORLD_CORPUS = ${JSON.stringify(world_corpus)}
const by_id = new Map(WORLD_CORPUS.worlds.map((world) => [world.id, world]))
const by_mob_id = new Map()
for (const world of WORLD_CORPUS.worlds) for (const mob of world.mobs ?? []) {
  const locations = by_mob_id.get(mob.id) ?? []
  locations.push(world)
  by_mob_id.set(mob.id, locations)
}
const by_resource_id = new Map()
for (const world of WORLD_CORPUS.worlds) for (const resource of world.resources ?? []) {
  const locations = by_resource_id.get(resource.id) ?? []
  locations.push(world)
  by_resource_id.set(resource.id, locations)
}
const mob_facts_by_id = new Map(Object.entries(${JSON.stringify(mob_facts)}))
export const world_corpus_of = (world_id) => by_id.get(world_id ?? '')
export const world_corpus_for_mob = (mob_id) => by_mob_id.get(mob_id ?? '') ?? []
export const world_corpus_for_resource = (resource_id) => by_resource_id.get(resource_id ?? '') ?? []
export const mob_corpus_of = (mob_id) => mob_facts_by_id.get(mob_id ?? '')
const gather_job_ids = ['FARMER', 'HERBALIST', 'MINER']
export const GATHER_LADDERS = (() => {
  const out = Object.fromEntries(gather_job_ids.map((id) => [id, []]))
  const seen = Object.fromEntries(gather_job_ids.map((id) => [id, new Set()]))
  for (const world of WORLD_CORPUS.worlds) for (const resource of world.resources ?? []) {
    const job_id = gather_job_ids[resource.job]
    if (!job_id || seen[job_id].has(resource.slug)) continue
    seen[job_id].add(resource.slug)
    out[job_id].push({ ...resource, xp: 10 + Math.floor(resource.level / 2) })
  }
  for (const id of gather_job_ids) out[id].sort((left, right) => left.tier - right.tier || left.level - right.level)
  return out
})()
`
}

export function deployment_module(generated_dir, worlds) {
  return `export * from ${JSON.stringify(gold_base_specifier(generated_dir, DEPLOYMENT_SOURCE))}
export const T62_WORLDS = ${JSON.stringify(worlds)}
`
}

/** Generate disposable frontend modules for the exact objects minted by this gold boot. */
export function write_runtime_catalog({ seed, corpus_source = 'mainnet', out_dir, fight_fixtures = null }) {
  if (!seed || typeof seed !== 'object') throw new Error('runtime_catalog: seed manifest is required')
  if (!out_dir) throw new Error('runtime_catalog: out_dir is required')
  const source = source_details(corpus_source)
  const generated_dir = path.resolve(out_dir)
  fs.mkdirSync(generated_dir, { recursive: true })
  const spell_source =
    source.kind === 'active'
      ? // ACTIVE IS TEMPLATE-BLIND BY CONSTRUCTION (raw: []): the localnet `active` content (seed_content.json) is
        // authored in the synthesized-effect shape, NOT the Move SpellTemplate corpus shape
        // normalize_chain_spell_corpus consumes (it keys on row.id + level effects). There are no raw corpus rows to
        // normalize, so every active row's `template` resolves null and fight_spell_template returns null in active
        // gold runs — deliberate, not a silent gap: the MAINNET corpus is the twin-fidelity surface; active exercises
        // the id-join plumbing only. Fed raw:[] explicitly so the emission is honest about the blind template door.
        { rows: active_spell_rows(seed), raw: [] }
      : mainnet_spell_rows(seed, source.spells_dir)
  const spells = spell_source.rows.sort(
    (left, right) =>
      left.class.localeCompare(right.class) ||
      left.unlock_level - right.unlock_level ||
      left.name_key.localeCompare(right.name_key)
  )
  if (!spells.length) throw new Error('runtime_catalog: refuse empty localnet fight-spell catalog')

  const living = living_ids(seed, fight_fixtures)
  const living_module_path = path.join(generated_dir, 'living_corpus.ts')
  const spells_module_path = path.join(generated_dir, 'fight-spells.js')
  const world_module_path = path.join(generated_dir, 'world_corpus.ts')
  const deployment_path = path.join(generated_dir, 'deployment.ts')
  const { worlds: corpus_worlds, mob_facts } =
    source.kind === 'mainnet' ? mainnet_world_corpus(seed, source.corpus_root) : active_world_corpus(seed)
  // catalog/manifest keep the real module's WORLD_CORPUS shape ({ worlds }); facts ride separately.
  const world_corpus = { worlds: corpus_worlds }
  const worlds = runtime_worlds(seed, fight_fixtures)
  fs.writeFileSync(living_module_path, living_module(living))
  fs.writeFileSync(spells_module_path, fight_module(spells, spell_source.raw, generated_dir))
  fs.writeFileSync(world_module_path, world_module(world_corpus, mob_facts))
  fs.writeFileSync(deployment_path, deployment_module(generated_dir, worlds))
  return {
    living_module_path,
    spells_module_path,
    world_module_path,
    deployment_path,
    catalog: { living, spells, world_corpus, worlds },
    counts: {
      items: living.items.length,
      mobs: living.mobs.length,
      worlds: living.worlds.length,
      spells: spells.length,
      corpus_worlds: world_corpus.worlds.length,
      mob_facts: Object.keys(mob_facts).length,
    },
  }
}
