// THE SEED GATE — schema, referential closure, and every cap the chain would abort on.
/* eslint-disable complexity, max-depth, max-lines -- the validator keeps cross-row diagnostics in one deterministic command boundary. */
//
// Run: `bun scripts/validate_seed.mjs`. Exit 0 means the content files could be walked into the seeding
// without a single abort; any RED is a row the chain would refuse, or a fact nobody has authored
// yet. Each RED maps to a row in PENDING_SEED_DECISIONS.md — a red here is the red-first check for a
// decision the owner has not made, not a bug to paper over. WARNs never fail the gate.
//
// Every rule cites the Move line it mirrors. The chain validates almost nothing about slugs:
// referential closure exists ONLY here (review M1), and a typo freezes forever.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { validate_world_recipe } from '../packages/engine/src/index.ts'
import {
  acquisition_catalog,
  acquisition_average_seconds,
  acquisition_target_range,
  acquisition_target_status,
  class_names,
  class_spell_shape_errors,
  consumable_types,
  craft_job_of,
  craft_max_ingredients,
  element_names,
  gatherable_catalog,
  gatherable_of,
  item_categories,
  item_is_stackable,
  item_stat_center,
  job_slugs,
  model_variant_identity,
  recipe_progression_issues,
  stat_names,
} from '../packages/immutable/src/index.ts'
const PARKED_CLASSES = []

const repo_dir = dirname(dirname(fileURLToPath(import.meta.url)))
const argument = (name) => {
  const index = process.argv.indexOf(name)
  return index < 0 ? null : process.argv[index + 1]
}
const json_output = process.argv.includes('--json')
const seed_dir = argument('--seed-dir') ?? join(repo_dir, 'seed')
const content_dir = argument('--content-dir') ?? join(seed_dir, 'content')
const load = (name) => JSON.parse(readFileSync(join(content_dir, name), 'utf8'))
const deployment_object_ids = new Set(
  Object.values(JSON.parse(readFileSync(join(repo_dir, 'pins.json'), 'utf8'))).flatMap((deployment) =>
    Object.values(deployment ?? {}).filter((value) => typeof value === 'string' && /^0x[\da-f]{64}$/iu.test(value))
  )
)

const reds = []
const warns = []
const red = (rule, message) => reds.push(`RED  ${rule} — ${message}`)
const warn = (rule, message) => warns.push(`WARN ${rule} — ${message}`)
const check_rule = (condition, rule, message) => {
  if (!condition) red(rule, message)
}

// The seed boundary has five physical homes; structures keep generated voxel types beside editable packs.
const SEED_HOMES = ['content', 'icons', 'models', 'sounds', 'structures']
const actual_seed_homes = readdirSync(seed_dir).sort()
if (actual_seed_homes.join(',') !== SEED_HOMES.join(','))
  red('S-LAYOUT', `seed contains [${actual_seed_homes.join(', ')}], expected only [${SEED_HOMES.join(', ')}]`)
const duplicate_mob_renders = readdirSync(join(seed_dir, 'icons', 'mobs')).filter((name) => name.startsWith('hy_'))
if (duplicate_mob_renders.length)
  red('S-MOB-ICON', `${duplicate_mob_renders.length} duplicate hy_* model renders remain under icons/mobs`)

/// item.move:429-466 verify_category — a category outside this set aborts `new_template`.
const CATEGORIES = new Set(item_categories)
const ELEMENTS = new Set(element_names)
const MOB_ROLES = new Set(['normal', 'boss', 'archi', 'protector'])
/// Recipe jobs (owner 2026-08-16): the 12 craft slugs PLUS the gathering jobs — each gathering
/// job transforms its own harvest (FARMER mills flour, MINER grinds powder, HERBALIST distills);
/// HANDYMAN sweeps the intermediates no dedicated job claims. crafting.move:78 derives the job
/// from the output category and falls back to the authored slug — the chain accepts all 15.
const RECIPE_JOBS = new Set(job_slugs)
/// consumable.move::Effect — authored names mirror the on-chain enum one-for-one.
const CONSUMABLE_TYPES = new Set(consumable_types)

const is_u = (value, bits) => Number.isSafeInteger(value) && value >= 0 && BigInt(value) < 1n << BigInt(bits)

/// The one home of "does this number belong on chain": u32 range, integer, never a float.
const check_number = (where, field, value, bits) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return red('L-TYPE', `${where}.${field} is not a number`)
  if (!Number.isInteger(value)) return red('L-FLOAT', `${where}.${field} = ${value} is a float; chain integers only`)
  if (!Number.isSafeInteger(value))
    return red('L-PRECISION', `${where}.${field} = ${value} cannot be represented exactly by JSON numbers`)
  if (!is_u(value, bits)) red('L-RANGE', `${where}.${field} = ${value} does not fit u${bits}`)
}

const check_exact_keys = (where, value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return red('L-SHAPE', `${where} must be an object`)
  const actual = Object.keys(value).sort().join(',')
  const wanted = [...expected].sort().join(',')
  if (actual !== wanted) red('L-SHAPE', `${where} fields [${actual}] must be exactly [${wanted}]`)
}

const check_fixed_remove = (where, effect) => {
  if (effect.kind !== 20) return
  if (![6, 7].includes(effect.stat)) red('C-STAT', `${where}: fixed_remove only addresses AP or MP`)
  if (effect.element !== '') red('C-ELEMENT', `${where}: fixed_remove carries no element`)
}

// ╔════ [ Effects and spell levels — spell_effect.move ] ═══════════════════════════════════ ]

const check_effect = (where, effect) => {
  if (!is_u(effect.kind, 8) || effect.kind >= 21)
    red('C-KIND', `${where}: kind ${effect.kind} outside the sealed 0..20 (spell_effect.move KIND_COUNT)`)
  if (!is_u(effect.area_shape, 8) || effect.area_shape >= 10)
    red('C-SHAPE', `${where}: area_shape ${effect.area_shape} outside 0..9 (spell_effect.move:41)`)
  if (!is_u(effect.target_filter, 8) || effect.target_filter >= 5)
    red(
      'C-FILTER',
      `${where}: target_filter ${effect.target_filter} outside 0..4 — a raw legacy bitmask value (spell_effect.move:44)`
    )
  if (effect.element !== '' && !ELEMENTS.has(effect.element))
    red('C-ELEMENT', `${where}: element "${effect.element}" is not one of the 4`)
  check_number(where, 'value', effect.value, 32)
  check_number(where, 'value_max', effect.value_max, 32)
  if (effect.value > effect.value_max)
    red('C-VALUES', `${where}: value ${effect.value} > value_max ${effect.value_max} (EBadValues)`)
  if (!is_u(effect.chance_bp, 16) || effect.chance_bp > 10000)
    red('C-CHANCE', `${where}: chance_bp ${effect.chance_bp} above 100% (EBadChance)`)
  check_number(where, 'turns', effect.turns, 8)
  check_number(where, 'area_size', effect.area_size, 8)
  check_rule(
    effect.area_size <= 10,
    'C-AREA-SIZE',
    `${where}: area_size ${effect.area_size} exceeds the bounded maximum 10`
  )
  const instant = effect.kind <= 3 || (effect.kind >= 8 && effect.kind <= 12) || effect.kind === 16
  const timed = [13, 14, 15, 17, 18, 19].includes(effect.kind)
  if (instant && effect.turns !== 0)
    red('C-TURNS', `${where}: instantaneous kind ${effect.kind} must carry turns 0 (EBadTurns)`)
  if (timed && effect.turns < 1)
    red('C-TURNS', `${where}: timed kind ${effect.kind} must carry at least one turn (EBadTurns)`)
  // the CHANNEL rules — spell_effect.move aborts on each of these before the freeze:
  // add/remove/steal (4/5/6) take any channel 0..12; remove(hp) needs turns ≥ 1; remove/steal
  // on hp carry an element, add(hp) — a heal — carries none; reaction (7) takes stat channels
  // 0..5 or 8..10, turns ≥ 1, no element.
  if ([4, 5, 6].includes(effect.kind)) {
    if (!(effect.stat <= 12))
      red('C-STAT', `${where}: kind ${effect.kind} channel ${effect.stat} outside 0..12 (EBadStat)`)
    if (effect.stat === 12) {
      if (effect.kind === 5 && effect.turns < 1)
        red('C-STAT', `${where}: remove(hp) is the dot — turns ≥ 1 required (instant damage is the damage kinds)`)
      if ([5, 6].includes(effect.kind) && effect.element === '')
        red('C-ELEMENT', `${where}: remove/steal on hp needs an element (resist math)`)
      if (effect.kind === 4 && effect.element !== '')
        red('C-ELEMENT', `${where}: add(hp) is a heal — no element (heals amplify off intelligence)`)
    }
  }
  if (effect.kind === 7) {
    if (!(effect.stat <= 5 || (effect.stat >= 8 && effect.stat <= 10)))
      red('C-STAT', `${where}: reaction channel ${effect.stat} — stat channels 0..5 or 8..10 only (EBadStat)`)
    if (effect.turns < 1) red('C-STAT', `${where}: a reaction is a stance — turns ≥ 1 (EBadStat)`)
    if (effect.element !== '') red('C-ELEMENT', `${where}: a reaction carries no element`)
  }
  check_fixed_remove(where, effect)
}

const check_level = (where, level) => {
  check_number(where, 'ap_cost', level.ap_cost, 8)
  check_rule(level.ap_cost >= 1, 'C-AP', `${where}: every spell must cost at least 1 AP`)
  check_number(where, 'range_min', level.range_min, 8)
  check_number(where, 'range_max', level.range_max, 8)
  if (level.range_min > level.range_max)
    red('C-RANGE', `${where}: range_min ${level.range_min} > range_max ${level.range_max} (EBadLevel)`)
  if (!is_u(level.crit_1_in, 16) || level.crit_1_in === 1)
    red('C-CRIT', `${where}: crit_1_in ${level.crit_1_in} — 1-in-1 is not a crit (spell_effect.move:124)`)
  for (const field of ['casts_per_turn', 'casts_per_target', 'cooldown_turns'])
    check_number(where, field, level[field], 8)
  for (const field of ['modifiable_range', 'line_of_sight', 'line_launch', 'free_cell'])
    if (typeof level[field] !== 'boolean') red('L-TYPE', `${where}.${field} is not a boolean`)
  level.effects.forEach((effect, i) => check_effect(`${where}.effects[${i}]`, effect))
  level.crit_effects.forEach((effect, i) => check_effect(`${where}.crit_effects[${i}]`, effect))
  check_rule(
    level.effects.length <= 8 && level.crit_effects.length <= 8,
    'C-ROWS',
    `${where}: an effect branch exceeds the bounded maximum of 8 rows`
  )
  if (level.effects.length === level.crit_effects.length)
    level.effects.forEach((effect, i) => {
      if (effect.target_filter !== level.crit_effects[i].target_filter)
        red('C-CRIT-TARGET', `${where}.crit_effects[${i}]: target filter must inherit effects[${i}]`)
    })
}

const mob_level_targets_enemy = (level) => {
  const rows = [...level.effects, ...level.crit_effects]
  return rows.length > 0 && !rows.every(({ target_filter }) => target_filter === 3 || target_filter === 4)
}

// ╔════ [ The files ] ══════════════════════════════════════════════════════════════════════ ]

const items = load('items.json')
const mobs = load('mobs.json')
const spells = load('spells.json')
const recipes = load('recipes.json')
const structure_packs_file = load('structure_packs.json')
const worlds = load('worlds.json')
const dungeons = load('dungeons.json')
const mastery = load('mastery.json')
const structure_types_file = JSON.parse(readFileSync(join(seed_dir, 'structures', 'types.json'), 'utf8'))
const structure_packs = structure_packs_file?.packs ?? {}
const structure_types = structure_types_file?.types ?? {}

if (structure_packs_file?.version !== 1 || !structure_packs_file.packs)
  red('S-STRUCTURE', 'structure_packs.json must contain version 1 and a packs object')
if (structure_types_file?.version !== 1 || !structure_types_file.types)
  red('S-STRUCTURE', 'structures/types.json must contain version 1 and a types object')
for (const [name, pack] of Object.entries(structure_packs)) {
  const where = `structure_packs[${name}]`
  check_exact_keys(where, pack, [
    'category',
    'spacing',
    'density_bp',
    'max_slope',
    'bury',
    'types',
    ...(pack.scale === undefined ? [] : ['scale']),
  ])
  if (!['trees', 'rocks', 'ruins'].includes(pack.category))
    red('S-STRUCTURE', `${where}: unknown category ${pack.category}`)
  if (!Number.isInteger(pack.spacing) || pack.spacing < 4)
    red('S-STRUCTURE', `${where}: spacing must be an integer >= 4`)
  if (!Number.isInteger(pack.density_bp) || pack.density_bp < 0 || pack.density_bp > 10000)
    red('S-STRUCTURE', `${where}: density_bp must be within 0..10000`)
  if (!Number.isInteger(pack.max_slope) || pack.max_slope < 0)
    red('S-STRUCTURE', `${where}: max_slope must be a non-negative integer`)
  if (!Number.isInteger(pack.bury) || pack.bury < 0) red('S-STRUCTURE', `${where}: bury must be a non-negative integer`)
  if (
    pack.scale !== undefined &&
    (!Array.isArray(pack.scale) ||
      pack.scale.length !== 2 ||
      !pack.scale.every((value) => Number.isInteger(value) && value >= 1 && value <= 8) ||
      pack.scale[0] > pack.scale[1])
  )
    red('S-STRUCTURE', `${where}: scale must be an ordered [min,max] pair within 1..8`)
  if (!Array.isArray(pack.types) || pack.types.length === 0) red('S-STRUCTURE', `${where}: types must not be empty`)
  for (const [index, row] of (pack.types ?? []).entries()) {
    if (!structure_types[row.type]) red('S-STRUCTURE', `${where}.types[${index}]: unknown type "${row.type}"`)
    if (!Number.isInteger(row.weight) || row.weight < 1)
      red('S-STRUCTURE', `${where}.types[${index}]: weight must be a positive integer`)
  }
}

const item_types = new Set(items.map((row) => row.item_type))
const mob_types = new Set(mobs.map((row) => row.mob_type))
const boss_types = new Set(mobs.filter(({ role }) => role === 'boss').map(({ mob_type }) => mob_type))
const archi_types = new Set(mobs.filter(({ role }) => role === 'archi').map(({ mob_type }) => mob_type))
const categories_of = new Map(items.map((row) => [row.item_type, row.category]))
const items_by_type = new Map(items.map((row) => [row.item_type, row]))
const mobs_by_type = new Map(mobs.map((row) => [row.mob_type, row]))
const archis_by_family = new Map()
for (const archi of mobs.filter(({ role }) => role === 'archi')) {
  if (archis_by_family.has(archi.family))
    red('M2-ARCHI-FAMILY', `family ${archi.family} has more than one archimob replacement`)
  else archis_by_family.set(archi.family, archi.mob_type)
  if (!mobs.some(({ family, role }) => family === archi.family && role === 'normal'))
    red('M2-ARCHI-FAMILY', `archimob ${archi.mob_type} has no normal family member`)
}
const dungeons_by_slug = new Map(dungeons.map((row) => [row.dungeon, row]))
const city_rows = worlds.flatMap((world) => (world.cities ?? []).map((city) => ({ ...city, world: world.world })))
const cities_by_slug = new Map(city_rows.map((row) => [row.city, row]))

if (dungeons_by_slug.size !== dungeons.length) red('CITY-DUNGEON-DUP', 'dungeons.json contains duplicate slugs')
if (cities_by_slug.size !== city_rows.length) red('CITY-DUP', 'city slugs must be globally unique')
for (const world of worlds) {
  const dungeon_ids = (world.cities ?? []).map(({ dungeon }) => dungeon)
  if (new Set(dungeon_ids).size !== dungeon_ids.length)
    red('CITY-DUNGEON-WEIGHT', `${world.world} repeats a dungeon across cities and would bias daily selection`)
}

for (const dungeon of dungeons) {
  const where = `dungeons[${dungeon.dungeon}]`
  check_exact_keys(where, dungeon, ['dungeon', 'key', 'rooms'])
  const expected_key = `key_of_${dungeon.dungeon}`
  if (dungeon.key !== expected_key)
    red('CITY-DUNGEON-KEY-NAME', `${where}: key must be the matching identity ${expected_key}`)
  if (!item_types.has(dungeon.key) || categories_of.get(dungeon.key) !== 'key')
    red('CITY-DUNGEON-KEY', `${where}: ${dungeon.key} must reference an existing item in the key category`)
  if (!Array.isArray(dungeon.rooms) || dungeon.rooms.length === 0)
    red('CITY-DUNGEON-ROOMS', `${where}: a dungeon requires at least one room`)
  for (const [room_index, room] of (dungeon.rooms ?? []).entries()) {
    if (!room.length || room.length > 6)
      red('CITY-DUNGEON-ROOMS', `${where}: room ${room_index + 1} must contain 1..6 enemies`)
    for (const seat of room) {
      check_exact_keys(`${where}.rooms[${room_index}]`, seat, ['mob_type'])
      if (!mob_types.has(seat.mob_type))
        red('CITY-DUNGEON-MOB', `${where}: room ${room_index + 1} references unknown mob ${seat.mob_type}`)
    }
  }
}

const mob_model_dir = join(seed_dir, 'models', 'mobs')
const mob_model_basenames = readdirSync(mob_model_dir)
  .filter((name) => name.endsWith('.glb'))
  .map((name) => name.slice(0, -4))
const glb_json = (basename) => {
  const bytes = readFileSync(join(mob_model_dir, `${basename}.glb`))
  const json_length = bytes.readUInt32LE(12)
  return JSON.parse(
    bytes
      .subarray(20, 20 + json_length)
      .toString()
      .replace(/\0+$/u, '')
  )
}
const used_mob_models = new Set()
for (const { mob_type } of mobs) {
  const model = model_variant_identity(mob_type, mob_model_basenames)
  if (!model) {
    red('M-MOB-MODEL', `mob ${mob_type} has no exact or __-variant model`)
    continue
  }
  used_mob_models.add(model.basename)
  if (model.variant) {
    const json = glb_json(model.basename)
    const variants = json.extensions?.KHR_materials_variants?.variants ?? []
    const variant_index = variants.findIndex(({ name }) => name?.toLowerCase() === model.variant.toLowerCase())
    if (variant_index < 0) {
      red('M-MOB-MODEL', `mob ${mob_type} names missing ${model.basename}.glb variant "${model.variant}"`)
      continue
    }
    const mappings = (json.meshes ?? []).flatMap(({ primitives }) =>
      (primitives ?? []).flatMap(
        ({ extensions }) =>
          extensions?.KHR_materials_variants?.mappings?.filter(({ variants: indexes }) =>
            indexes?.includes(variant_index)
          ) ?? []
      )
    )
    if (!mappings.length)
      red('M-MOB-MODEL', `mob ${mob_type} variant "${model.variant}" has no primitive material mapping`)
  }
}
for (const basename of mob_model_basenames)
  if (!used_mob_models.has(basename)) red('M-MOB-MODEL', `models/mobs/${basename}.glb belongs to no mob_type`)

for (const pet of items.filter(({ category }) => category === 'pet'))
  if (!existsSync(join(seed_dir, 'models', 'pets', `${pet.item_type}.glb`)))
    red('M-PET-MODEL', `pet item ${pet.item_type} has no exact models/pets/${pet.item_type}.glb`)

const check_loot_rewards = (where, rewards) => {
  if (!Array.isArray(rewards) || rewards.length === 0)
    return red('I-LOOTBOX', `${where}: a loot box needs at least one reward row`)
  let weight_sum = 0n
  for (const [index, reward] of rewards.entries()) {
    const reward_where = `${where}.consumable.rewards[${index}]`
    check_exact_keys(reward_where, reward, ['item_type', 'weight', 'amount'])
    if (!item_types.has(reward.item_type)) red('I-LOOTBOX', `${reward_where}: unknown item_type "${reward.item_type}"`)
    check_number(reward_where, 'weight', reward.weight, 64)
    check_number(reward_where, 'amount', reward.amount, 32)
    if (reward.amount === 0) red('I-LOOTBOX', `${reward_where}: amount must be positive`)
    if (reward.amount > 1 && !item_is_stackable(categories_of.get(reward.item_type)))
      red('I-LOOTBOX', `${reward_where}: amount ${reward.amount} requires a stackable reward template`)
    if (Number.isSafeInteger(reward.weight) && reward.weight >= 0) weight_sum += BigInt(reward.weight)
  }
  if (weight_sum === 0n) red('I-LOOTBOX', `${where}: reward weights must have a positive sum`)
  if (weight_sum > 0xffff_ffff_ffff_ffffn) red('I-LOOTBOX', `${where}: reward weight sum ${weight_sum} overflows u64`)
}

const consumable_keys = new Map([
  ['heal', ['type', 'amount']],
  ['loot_box', ['type', 'rewards']],
  ['city', ['type', 'city']],
])
const consumable_checks = new Map([
  [
    'heal',
    (where, effect) => {
      check_number(where, 'consumable.amount', effect.amount, 32)
      if (effect.amount === 0) red('I-CONSUMABLE', `${where}: a heal amount must be positive`)
    },
  ],
  ['loot_box', (where, effect) => check_loot_rewards(where, effect.rewards)],
  [
    'city',
    (where, effect) => {
      if (!cities_by_slug.has(effect.city))
        red('CITY-POTION', `${where}: city potion targets unknown city "${effect.city}"`)
    },
  ],
])

const check_consumable = (where, effect) => {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect))
    return red('I-CONSUMABLE', `${where}: consumable must be an object`)
  if (!CONSUMABLE_TYPES.has(effect.type))
    return red('I-CONSUMABLE', `${where}: unknown consumable type "${effect.type}"`)
  check_exact_keys(`${where}.consumable`, effect, consumable_keys.get(effect.type) ?? ['type'])
  consumable_checks.get(effect.type)?.(where, effect)
}

const check_item_stat_block = (where, block) => {
  if (!block) return red('L-SHAPE', `${where} must be an object`)
  check_exact_keys(where, block, stat_names)
  for (const field of stat_names) {
    const value = block[field]
    if (!Number.isInteger(value)) red('L-FLOAT', `${where}.${field} = ${value} is not an integer`)
    else if (Math.abs(value) >= item_stat_center)
      red('I-STATMAG', `${where}.${field} = ${value} overflows the centred encoding (|v| < ${item_stat_center})`)
  }
}

// ── items ────────────────────────────────────────────────────────────────────────────────
for (const item of items) {
  const where = `items[${item.item_type}]`
  if (typeof item.item_type !== 'string' || item.item_type === '') red('L-SLUG', `${where}: empty item_type`)
  if (typeof item.name !== 'string' || item.name === '') red('L-NAME', `${where}: empty name`)
  if (!CATEGORIES.has(item.category))
    red('I-CATEGORY', `${where}: category "${item.category}" would abort verify_category`)
  check_number(where, 'level', item.level, 8)
  const stackable = item_is_stackable(item.category)
  if (item.stats) {
    if (stackable) red('I-STACK', `${where}: a stackable carries no stats (item.move:159 EStackableStats)`)
    for (const side of ['min', 'max']) check_item_stat_block(`${where}.stats.${side}`, item.stats[side])
    for (const field of stat_names)
      if (item.stats.min?.[field] > item.stats.max?.[field])
        red(
          'I-STATRANGE',
          `${where}: ${field} min ${item.stats.min[field]} > max ${item.stats.max[field]} (item.move:163 EInvalidStatRange)`
        )
  }
  if (item.damages) {
    if (stackable) red('I-STACK', `${where}: a stackable carries no damage lines (item.move:172 EStackableStats)`)
    for (const [i, line] of item.damages.entries()) {
      check_number(`${where}.damages[${i}]`, 'from', line.from, 16)
      check_number(`${where}.damages[${i}]`, 'to', line.to, 16)
      if (line.from > line.to)
        red(
          'I-DMGRANGE',
          `${where}.damages[${i}]: from ${line.from} > to ${line.to} (item_damages.move:22 EInvalidRange)`
        )
      if (!ELEMENTS.has(line.element))
        red('I-DMGELEM', `${where}.damages[${i}]: element "${line.element}" is not one of the 4`)
      // item_damages.move:16 — an unvalidated String on chain, so the allowed set is pinned HERE
      if (line.damage_type !== 'weapon')
        red('I-DMGTYPE', `${where}.damages[${i}]: damage_type "${line.damage_type}" outside the pinned set {weapon}`)
    }
  }
  if (item.category === 'consumable' && !item.consumable)
    red('I-CONSUMABLE', `${where}: every consumable template needs one typed effect`)
  if (item.category !== 'consumable' && item.consumable)
    red('I-CONSUMABLE', `${where}: only consumable templates may carry a consumable effect`)
  if (item.consumable) check_consumable(where, item.consumable)
  if (item.category === 'pet') {
    if (!item.stats) red('H4-PETSTATS', `${where}: every pet must author the stats reached after feeding`)
    if (!Array.isArray(item.pet_foods) || item.pet_foods.length === 0)
      red('H4-PETFOOD', `${where}: every pet must author at least one resource item_type in pet_foods`)
    if (Array.isArray(item.pet_foods)) {
      if (new Set(item.pet_foods).size !== item.pet_foods.length)
        red('H4-PETFOOD', `${where}: pet_foods contains duplicate item types`)
      for (const food_type of item.pet_foods) {
        if (!item_types.has(food_type)) red('H4-PETFOOD', `${where}: pet_foods references unknown item "${food_type}"`)
        else if (categories_of.get(food_type) !== 'resource')
          red('H4-PETFOOD', `${where}: pet food "${food_type}" is ${categories_of.get(food_type)}, not resource`)
      }
    }
  } else if (item.pet_foods !== undefined) {
    red('H4-PETFOOD', `${where}: only pet templates may author pet_foods`)
  }
}
if (new Set(items.map((row) => row.item_type)).size !== items.length)
  red('L-DUP', 'items.json holds a duplicate item_type — derived_object::claim aborts on the second')

// H2 — the rune catalog needs one template per (stat, tier) it populates, or that stat is
// un-scribable forever (rune_catalog.move:19-40, forgemagie.move:121-122).
const MULTI_TIER = new Set([
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
])
for (const stat of stat_names)
  for (const tier of MULTI_TIER.has(stat) ? ['ba', 'pa', 'ra'] : ['ba']) {
    const slug = `rune_${stat}_${tier}`
    if (!item_types.has(slug))
      red('H2-RUNE', `the catalog rune ${slug} has no item template — that stat is un-scribable forever`)
    else if (categories_of.get(slug) !== 'rune')
      red('H2-RUNE', `${slug} is category "${categories_of.get(slug)}", not rune`)
  }

// ── mobs ─────────────────────────────────────────────────────────────────────────────────
for (const mob of mobs) {
  const where = `mobs[${mob.mob_type}]`
  if (typeof mob.family !== 'string' || !/^[a-z][a-z0-9_]*$/.test(mob.family))
    red('M-FAMILY', `${where}: family must be a non-empty snake_case editor taxonomy`)
  if (!MOB_ROLES.has(mob.role)) red('M-ROLE', `${where}: unknown role "${mob.role}"`)
  if (!ELEMENTS.has(mob.element))
    red('M-ELEMENT', `${where}: element "${mob.element}" is not one of the 4 (mob_template.move:109)`)
  check_number(where, 'level_min', mob.level_min, 8)
  check_number(where, 'level_max', mob.level_max, 8)
  if (mob.level_min > mob.level_max)
    red('M-BAND', `${where}: level_min > level_max (mob_template.move:106 EInvalidLevelBand)`)
  for (const [field, bits] of [
    ['hp', 64],
    ['ap', 8],
    ['mp', 8],
    ['agility', 16],
    ['wisdom', 16],
    ['xp', 64],
  ])
    check_number(where, field, mob[field], bits)
  for (const element of element_names) check_number(where, `resistances.${element}`, mob.resistances[element], 16)
  if (mob.spells.length > 5)
    red('M2-KIT', `${where}: ${mob.spells.length} spells, the cap is 5 (mob_template.move:107)`)
  for (const spell of mob.spells) {
    if (spell.levels.length !== 1)
      red('M2-LEVELS', `${where}.${spell.name}: ${spell.levels.length} levels, every mob spell requires exactly 1`)
    spell.levels.forEach((level, i) => {
      check_level(`${where}.${spell.name}[${i}]`, level)
      if (level.ap_cost < 1)
        red('M2-MOB-AP', `${where}.${spell.name}[${i}]: mob spells cost at least 1 AP so AI turns terminate`)
      if (mob_level_targets_enemy(level) && level.range_min > 1)
        red(
          'M2-MOB-MIN-RANGE',
          `${where}.${spell.name}[${i}]: enemy-targeting mob spells must start at range 1, got ${level.range_min}–${level.range_max}`
        )
    })
  }
  const spell_levels = mob.spells.flatMap(({ levels }) => levels)
  if (spell_levels.length) {
    const cheapest = Math.min(...spell_levels.map(({ ap_cost }) => ap_cost))
    const largest_branch = Math.max(
      ...spell_levels.map(({ effects, crit_effects }) => Math.max(effects.length, crit_effects.length))
    )
    if (Math.floor(mob.ap / cheapest) * largest_branch > 10)
      red('M2-TURN-WORK', `${where}: conservative mob row-casts per turn exceed the bounded maximum 10`)
  }
  if (mob.loot.length > 16)
    red('M2-LOOT', `${where}: ${mob.loot.length} loot rows, the cap is 16 (mob_template.move:108)`)
  for (const entry of mob.loot) {
    if (!is_u(entry.chance_bp, 16) || entry.chance_bp > 10000)
      red('M2-CHANCE', `${where}: loot chance_bp ${entry.chance_bp} above 100% (EInvalidChance)`)
    if (!(entry.min_qty > 0 && entry.min_qty <= entry.max_qty))
      red(
        'M2-QTY',
        `${where}: loot ${entry.item_type} qty ${entry.min_qty}..${entry.max_qty} (mob_template.move:75 EInvalidQty)`
      )
    if (!item_types.has(entry.item_type))
      red('X-LOOT', `${where}: loot references the unknown item "${entry.item_type}"`)
  }
}
if (new Set(mobs.map((row) => row.mob_type)).size !== mobs.length) red('L-DUP', 'mobs.json holds a duplicate mob_type')
const wisdomless = mobs.filter((mob) => mob.wisdom === 0).length
if (wisdomless)
  warn('H5-WISDOM', `${wisdomless} mobs carry wisdom 0 — the dodge stat has NO legacy source and is unauthored`)
const unfinished_mobs = mobs.filter(
  ({ role, hp, ap, mp, xp, spells }) =>
    role !== 'protector' && hp === 1 && ap === 0 && mp === 0 && xp === 0 && !spells.length
)
if (unfinished_mobs.length)
  warn('M-PLACEHOLDER', `${unfinished_mobs.length} curated mobs await manual stats, levels, XP, and spells`)

// ── spells ───────────────────────────────────────────────────────────────────────────────
for (const spell of spells) {
  const where = `spells[${spell.name}]`
  if (!class_names.includes(spell.classe))
    red('C2-CLASSE', `${where}: classe "${spell.classe}" is not one of the 12 (spell_template.move:38 EBadClasse)`)
  check_number(where, 'unlock_level', spell.unlock_level, 8)
  if (spell.levels.length !== 6)
    red('M2-LEVELS', `${where}: ${spell.levels.length} levels, every player spell requires exactly 6`)
  spell.levels.forEach((level, i) => check_level(`${where}[${i}]`, level))
}
if (new Set(spells.map((row) => row.name)).size !== spells.length)
  red('L-DUP', 'spells.json holds a duplicate name — the spell address derives from it')
// THE CLASS SPELL LAW (owner 2026-08-24): exactly twenty spells per class on the Dofus
// unlock ladder — three at level 1, then 3,6,9,… A class kit on chain is "every spell
// object naming that class", and chain objects are forever, so the shape must hold BEFORE
// anything is written.
for (const error of class_spell_shape_errors(spells)) red('C2-LADDER', error)
const covered = new Set(spells.map((row) => row.classe))
const missing = class_names.filter((classe) => !covered.has(classe))
if (missing.length)
  red(
    'C2-PARKED',
    `no spell ships for the chain classes ${missing.join(', ')} — the legacy corpus files ${PARKED_CLASSES.join(', ')} are PARKED on the slug rename`
  )

// ── recipes ──────────────────────────────────────────────────────────────────────────────
const recipe_outputs = new Set(recipes.map(({ output_type }) => output_type))
for (const recipe of recipes) {
  const where = `recipes[${recipe.output_type}]`
  if ('craft_xp' in recipe || 'output_quantity' in recipe)
    red('R-DERIVED', `${where}: craft XP and output quantity are derived crafting law, never authored`)
  const derived_job = craft_job_of(categories_of.get(recipe.output_type))
  if (derived_job && 'job' in recipe)
    red('R-DERIVED', `${where}: ${categories_of.get(recipe.output_type)} derives ${derived_job}; remove authored job`)
  if (!derived_job && !RECIPE_JOBS.has(recipe.job))
    red('M1-JOB', `${where}: invalid authored fallback job "${recipe.job}" (crafting.move)`)
  const inputs = Object.entries(recipe.inputs)
  if (!inputs.length) red('R-INPUTS', `${where}: a recipe with no inputs`)
  if (inputs.length > craft_max_ingredients)
    red('R-INPUTS', `${where}: ${inputs.length} ingredient slots exceed Dofus Retro's maximum ${craft_max_ingredients}`)
  if (!item_types.has(recipe.output_type))
    red('X-RECIPE', `${where}: output references the unknown item "${recipe.output_type}"`)
  for (const [slug, quantity] of inputs) {
    if (!item_types.has(slug)) red('X-RECIPE', `${where}: input references the unknown item "${slug}"`)
    if (!Number.isInteger(quantity) || quantity < 1) red('R-INPUTQTY', `${where}: input ${slug} quantity ${quantity}`)
  }
}
if (new Set(recipes.map((row) => row.output_type)).size !== recipes.length)
  red('L-DUP', 'recipes.json holds two recipes for one output — RecipeKey derivation aborts on the second')

const progression_recipes = recipes.map((recipe) => ({
  ...recipe,
  job: craft_job_of(categories_of.get(recipe.output_type)) ?? recipe.job,
}))
for (const issue of recipe_progression_issues(progression_recipes, job_slugs))
  red(
    'R-PROGRESSION',
    `${issue.job}: no reachable XP recipe at level ${issue.level} with ${issue.slot_capacity} slots (${issue.reachable_recipe_count} recipes reachable)`
  )

const acquisition_content = { items, recipes, mobs, worlds, dungeons, spells }
const acquisition = acquisition_catalog(acquisition_content)
const intermediary_types = new Set(
  items
    .filter(({ item_type, category }) => category === 'resource' && recipe_outputs.has(item_type))
    .map(({ item_type }) => item_type)
)
const recipes_using = new Map()
for (const recipe of recipes)
  for (const item_type of Object.keys(recipe.inputs))
    recipes_using.set(item_type, [...(recipes_using.get(item_type) ?? []), recipe.output_type])
const rare_gatherable_types = new Set(gatherable_catalog.map(({ rare_item_type }) => rare_item_type))
const pet_food_types = new Set(
  items.filter(({ category }) => category === 'pet').flatMap(({ pet_foods }) => pet_foods ?? [])
)
const source_resource_types = new Set([
  ...items
    .filter(({ item_type, category }) => category === 'resource' && !recipe_outputs.has(item_type))
    .map(({ item_type }) => item_type),
  ...gatherable_catalog.flatMap(({ item_type, rare_item_type }) => [item_type, rare_item_type]),
])
for (const item_type of source_resource_types) {
  const funnels_to_intermediary = (recipes_using.get(item_type) ?? []).some((output_type) =>
    intermediary_types.has(output_type)
  )
  if (funnels_to_intermediary) continue
  const item = items_by_type.get(item_type)
  const message = `${item_type}: source resource feeds no intermediary recipe`
  if (rare_gatherable_types.has(item_type) || (item?.level ?? 0) > 30) warn('R-FUNNEL-SOURCE', message)
  else red('R-FUNNEL-SOURCE', message)
}
for (const recipe of recipes) {
  const item = items_by_type.get(recipe.output_type)
  const actual = acquisition[recipe.output_type]?.craft ?? null
  if (!item || !actual) continue
  const target = acquisition_target_range(item)
  const status = acquisition_target_status(actual, target)
  if (status === 'within' || status === 'unavailable') continue
  warn(
    'R-ACQUISITION-RANGE',
    `${recipe.output_type}: average ${Math.round(acquisition_average_seconds(actual))}s is ${status} target ${Math.round(target.minimum_seconds)}..${Math.round(target.maximum_seconds)}s`
  )
}
const reaches_end_item = (item_type, visiting = new Set()) => {
  if (pet_food_types.has(item_type)) return true
  if (visiting.has(item_type)) return false
  const next = new Set([...visiting, item_type])
  return (recipes_using.get(item_type) ?? []).some((output_type) => {
    const output = items_by_type.get(output_type)
    return output?.category !== 'resource' || reaches_end_item(output_type, next)
  })
}
for (const item_type of intermediary_types) {
  if (reaches_end_item(item_type)) continue
  const item = items_by_type.get(item_type)
  const message = `${item_type}: intermediary reaches no usable end item`
  if ((item?.level ?? 0) > 30) warn('R-FUNNEL-DEAD', message)
  else red('R-FUNNEL-DEAD', message)
}
for (const item_type of source_resource_types) {
  const item = items_by_type.get(item_type)
  if (acquisition[item_type]?.best || rare_gatherable_types.has(item_type)) continue
  const message = `${item_type}: no placed gathering or mob source provides this resource`
  if ((item?.level ?? 0) > 30) warn('R-UNOBTAINABLE', message)
  else red('R-UNOBTAINABLE', message)
}

// ── worlds ───────────────────────────────────────────────────────────────────────────────
for (const world of worlds) {
  const where = `worlds[${world.world}]`
  check_number(where, 'entry_level', world.entry_level, 16)
  if (world.entry_level < 1) red('W-ENTRY', `${where}: entry_level must be at least 1`)
  const cities = world.cities ?? []
  if (cities.length > 256) red('CITY-LIMIT', `${where}: at most 256 cities fit the on-chain u8 membership index`)
  const city_names = new Set(cities.map(({ city }) => city))
  for (const [city_index, city] of cities.entries()) {
    const city_where = `${where}.cities[${city.city}]`
    check_exact_keys(city_where, city, ['city', 'x', 'z', 'structure_packs', 'dungeon'])
    check_number(city_where, 'x', city.x, 32)
    check_number(city_where, 'z', city.z, 32)
    const center_x = Math.floor(city.x / 512)
    const center_z = Math.floor(city.z / 512)
    if (city.x >= 100000 || city.z >= 100000 || center_x < 1 || center_x >= 195 || center_z < 1 || center_z >= 195)
      red('CITY-ANCHOR', `${city_where}: anchor or its 3×3 footprint leaves the world`)
    if (!dungeons_by_slug.has(city.dungeon)) red('CITY-DUNGEON', `${city_where}: unknown dungeon ${city.dungeon}`)
    const potion_type = `potion_of_${city.city}`
    const potion = items_by_type.get(potion_type)
    if (potion?.category !== 'consumable' || potion.consumable?.type !== 'city' || potion.consumable.city !== city.city)
      red('CITY-POTION-NAME', `${city_where}: city must own the matching teleport identity ${potion_type}`)
    for (const pack of city.structure_packs ?? [])
      if (!structure_packs[pack]) red('CITY-STRUCTURE', `${city_where}: unknown structure pack ${pack}`)
    for (const previous of cities.slice(0, city_index)) {
      const previous_x = Math.floor(previous.x / 512)
      const previous_z = Math.floor(previous.z / 512)
      if (Math.abs(center_x - previous_x) <= 2 && Math.abs(center_z - previous_z) <= 2)
        red('CITY-OVERLAP', `${city_where}: footprint overlaps ${previous.city}`)
    }
  }
  // Spawn shape (ruling 2026-08-14): a world WITH a terrain recipe authors ONE world-level
  // mob list — rows of { mob_type, weight_bp, biomes: [names], cities?: [slugs] }. Empty biomes
  // mean city-only and require at least one city; per-biome weights use two disjoint rows. A world
  // WITHOUT terrain keeps the flat name→weight map (seeded as biome [0] until its recipe lands).
  const biomes = world.terrain?.biomes ?? []
  const biome_names = new Set(biomes.map(({ name }) => name))
  const ocean_biome = world.terrain?.ocean?.biome
  if (world.terrain) {
    // The recipe must COMPILE, not just parse — a schema-broken terrain block otherwise
    // survives this gate and only explodes inside derive_biome_map at ceremony time.
    const recipe = validate_world_recipe(world.terrain)
    if (!recipe.ok) for (const error of recipe.errors) red('M2-RECIPE', `${where}: ${error}`)
    if (biomes.length > 255) red('M2-BIOMES', `${where}: ${biomes.length} biomes overflow the u8 biome id`)
    for (const [biome_index, biome] of biomes.entries())
      for (const [pack_index, pack_name] of (biome.structure_packs ?? []).entries()) {
        const pack = structure_packs[pack_name]
        if (!pack) {
          red('S-STRUCTURE', `${where}.terrain.biomes[${biome_index}].structure_packs[${pack_index}]: unknown pack`)
          continue
        }
        if (biome.name === ocean_biome && pack.category === 'trees')
          red('S-OCEAN', `${where}: ocean biome cannot reference tree pack ${pack_name}`)
        for (const { type } of pack.types) {
          const template = structure_types[type]
          for (const material of template?.palette ?? [])
            if (material !== 'air' && !world.terrain.materials[material])
              red('S-STRUCTURE', `${where}: pack ${pack_name} type ${type} needs missing material "${material}"`)
        }
      }
  }
  if (world.terrain && biomes.some((biome) => biome.mobs !== undefined || biome.resources !== undefined))
    red('M2-SHAPE', `${where}: biome objects carry mobs/resources — spawns are world-level lists with a biomes field`)
  if (world.mobs === undefined) red('M2-SHAPE', `${where}: carries no spawnable mobs`)
  const spawn_entries = world.terrain
    ? (world.mobs ?? []).map((row) => [row.mob_type, row.mob_type, row.weight_bp, row.biomes, row.cities ?? []])
    : Object.entries(world.mobs ?? {}).map(([mob, weight]) => [mob, mob, weight, null, null])
  for (const [label, mob_type, weight, row_biomes, row_cities] of spawn_entries) {
    if (!is_u(weight, 16) || weight < 1 || weight > 10000)
      red('M2-WEIGHT', `${where}: ${label} weight_bp ${weight} outside 1..10000 (world.move EInvalidRate)`)
    if (!mob_types.has(mob_type)) red('X-SPAWN', `${where}: spawns the unknown mob "${mob_type}"`)
    if (!world.terrain) continue
    if (!Array.isArray(row_biomes) || (row_biomes.length === 0 && row_cities.length === 0)) {
      red('M2-MOBBIOMES', `${where}: mob ${mob_type} names neither biomes nor cities`)
      continue
    }
    for (const name of row_biomes)
      if (!biome_names.has(name)) red('M2-MOBBIOMES', `${where}: mob ${mob_type} names the unknown biome "${name}"`)
      else if (name === ocean_biome) red('M2-OCEAN', `${where}: mob ${mob_type} cannot spawn in the ocean biome`)
  }
  for (const row of world.mobs ?? [])
    for (const city of row.cities ?? [])
      if (!city_names.has(city)) red('CITY-MOB', `${where}: mob ${row.mob_type} names unknown city ${city}`)
  const spawnable_mobs = new Set(spawn_entries.map(([, mob]) => mob))
  for (const mob_type of spawnable_mobs)
    if (boss_types.has(mob_type)) red('M2-BOSS', `${where}: boss ${mob_type} cannot appear in roaming spawns`)
    else if (archi_types.has(mob_type))
      red('M2-ARCHI', `${where}: archimob ${mob_type} needs rare substitution, not a normal spawn row`)
  // Resources are ONE world-level list; each entry names its biomes (terrain worlds only) —
  // one row per resource, so divergent per-biome copies cannot exist by construction.
  const resource_entries = world.resources ?? []
  for (const resource of resource_entries) {
    check_exact_keys(
      `${where}.resources[${resource.item_type}]`,
      resource,
      'cities' in resource ? ['item_type', 'biomes', 'cities'] : ['item_type', 'biomes']
    )
    if (!world.terrain) continue
    if (!Array.isArray(resource.biomes)) {
      red('M2-RESBIOMES', `${where}: resource ${resource.item_type} biomes must be an array`)
      continue
    }
    for (const name of resource.biomes)
      if (!biome_names.has(name))
        red('M2-RESBIOMES', `${where}: resource ${resource.item_type} names the unknown biome "${name}"`)
      else if (name === ocean_biome)
        red('M2-OCEAN', `${where}: resource ${resource.item_type} cannot spawn in the ocean biome`)
    for (const city of resource.cities ?? [])
      if (!city_names.has(city))
        red('CITY-RESOURCE', `${where}: resource ${resource.item_type} names unknown city ${city}`)
  }
  for (const resource of resource_entries) {
    if (!item_types.has(resource.item_type))
      red('X-RESOURCE', `${where}: resource references the unknown item "${resource.item_type}"`)
    if (!gatherable_of(resource.item_type))
      red('X-RESOURCE', `${where}: resource ${resource.item_type} is absent from the immutable gatherable catalog`)
  }
}

for (const dungeon of dungeons) {
  const references = city_rows.filter((city) => city.dungeon === dungeon.dungeon)
  if (references.length !== 1)
    red(
      'CITY-DUNGEON-REF',
      `dungeon ${dungeon.dungeon} must be referenced by exactly one city, got ${references.length}`
    )
}

// Empty class levels are explicit authoring placeholders during the hand-curation pass. Mob
// kits remain live content, author exactly one level, and may not carry dead buttons.
{
  const dead_class = spells.filter((s) => s.levels.every((l) => !l.effects.length && !l.crit_effects.length))
  const empty_class_levels = spells.reduce(
    (n, s) => n + s.levels.filter((l) => !l.effects.length && !l.crit_effects.length).length,
    0
  )
  const empty_mob_kits = mobs.reduce(
    (n, m) => n + m.spells.filter((s) => s.levels.some((l) => !l.effects.length && !l.crit_effects.length)).length,
    0
  )
  if (dead_class.length || empty_class_levels)
    warn(
      'S-PLACEHOLDER',
      `${dead_class.length} class spells / ${empty_class_levels} levels await manual effect authoring`
    )
  if (empty_class_levels !== dead_class.length * 6)
    red('S-PLACEHOLDER', 'a spell must be entirely authored or carry six empty placeholder levels')
  if (empty_mob_kits) red('S-EMPTY', `${empty_mob_kits} live mob spell kits carry an empty level`)
}
const protectors = new Set(gatherable_catalog.map(({ protector }) => protector))
for (const mob of mobs.filter(({ role }) => role === 'protector'))
  if (!protectors.has(mob.mob_type))
    red('M2-PROTECTOR', `${mob.mob_type}: protector role has no immutable gatherable link`)
for (const world of worlds)
  for (const mob_type of Array.isArray(world.mobs)
    ? world.mobs.map(({ mob_type }) => mob_type)
    : Object.keys(world.mobs ?? {}))
    if (protectors.has(mob_type)) red('M2-PROTECTOR', `${world.world}: protector ${mob_type} cannot roam`)
for (const gatherable of gatherable_catalog) {
  const where = `immutable.gatherables[${gatherable.item_type}]`
  if (!job_slugs.slice(0, 3).includes(gatherable.job))
    red('M2-JOB', `${where}: invalid gathering job ${gatherable.job}`)
  check_number(where, 'tier', gatherable.tier, 8)
  if (gatherable.tier < 1 || gatherable.tier > 11) red('M2-TIER', `${where}: tier ${gatherable.tier} outside 1..11`)
  if (!item_types.has(gatherable.item_type)) red('X-RESOURCE', `${where}: unknown base item`)
  if (!mob_types.has(gatherable.protector)) red('X-PROTECTOR', `${where}: unknown protector ${gatherable.protector}`)
  if (!item_types.has(gatherable.rare_item_type))
    red('X-RARE', `${where}: unknown rare variant ${gatherable.rare_item_type}`)
  const resource = items_by_type.get(gatherable.item_type)
  const rare = items_by_type.get(gatherable.rare_item_type)
  if (resource?.category !== 'resource') red('M2-GATHERABLE', `${where}: base item must be a resource`)
  if (rare?.category !== 'resource') red('M2-GATHERABLE', `${where}: rare item must be a resource`)
  const protector = mobs_by_type.get(gatherable.protector)
  if (protector?.role !== 'protector')
    red('M2-PROTECTOR', `${gatherable.protector}: gatherable protector must use the protector role`)
}
// ── mastery offers ─────────────────────────────────────────────────────────────────────────
if (!mastery || !Array.isArray(mastery.offers)) red('M-OFFERS', 'mastery.json must contain an offers array')
for (const offer of mastery.offers ?? []) {
  check_exact_keys(`mastery.offers[${offer.item_type ?? '?'}]`, offer, ['item_type', 'cost', 'enabled'])
  const item = items_by_type.get(offer.item_type)
  if (!item) red('M-ITEM', `mastery offer ${offer.item_type} references an unknown item`)
  else if (item.stats) red('M-STATS', `mastery offer ${offer.item_type} must reference a statless item`)
  if (!Number.isSafeInteger(offer.cost) || offer.cost < 1)
    red('M-COST', `mastery offer ${offer.item_type} cost must be a positive safe integer`)
  if (offer.enabled !== undefined && typeof offer.enabled !== 'boolean')
    red('M-ENABLED', `mastery offer ${offer.item_type} enabled must be a boolean when present`)
}
if (new Set((mastery.offers ?? []).map(({ item_type }) => item_type)).size !== (mastery.offers ?? []).length)
  red('M-DUP', 'mastery.json holds two offers for one item_type — MasteryOfferKey derivation aborts')
// airdrop.json — presentation plus the free airdrop/giftcard distribution rows.
// `showcase` rows are the airdrop page's display data; `drops`/`giftcards` are the chain rows.
const airdrop = load('airdrop.json')
for (const row of airdrop.showcase) {
  if (typeof row.id !== 'string' || row.id === '') red('A-SHOWCASE', `showcase row without an id`)
  if (typeof row.name !== 'string' || row.name === '') red('A-SHOWCASE', `showcase ${row.id}: empty name`)
  const item = items_by_type.get(row.id)
  if (!item) red('A-SHOWCASE', `showcase ${row.id}: no item uses this identity`)
  if (row.kind === 'pet_glb') {
    if (item?.category !== 'pet') red('A-SHOWCASE', `showcase ${row.id}: pet_glb must reference a pet item`)
    if (row.art?.glb !== `models/pets/${row.id}.glb` || row.art?.icon !== `items/${row.id}_hd.png`)
      red('A-SHOWCASE', `showcase ${row.id}: pet art must use its exact canonical GLB and HD icon paths`)
  }
  for (const asset of Object.values(row.art ?? {})) {
    const authored_path =
      typeof asset === 'string' && asset.startsWith('models/')
        ? join(seed_dir, asset)
        : join(seed_dir, 'icons', String(asset))
    if (typeof asset === 'string' && !existsSync(authored_path))
      red('A-ASSET', `showcase ${row.id}: missing seed/${asset}`)
  }
}
if (new Set(airdrop.showcase.map(({ id }) => id)).size !== airdrop.showcase.length)
  red('L-DUP', 'airdrop.json holds two showcase rows with one id')
for (const drop of airdrop.drops) {
  check_exact_keys(`airdrop.drops[${drop.id ?? '?'}]`, drop, ['id', 'item_type', 'amount_each', 'whitelist'])
  if (typeof drop.id !== 'string' || drop.id === '') red('L-SLUG', 'airdrop row needs a non-empty derived id')
  if (!item_types.has(drop.item_type)) red('X-AIRDROP', `airdrop references the unknown item "${drop.item_type}"`)
  const distributed = items_by_type.get(drop.item_type)
  if (
    distributed?.stats &&
    (distributed.category !== 'pet' || JSON.stringify(distributed.stats.min) !== JSON.stringify(distributed.stats.max))
  )
    red('L4-AIRDROP', `airdrop ${drop.item_type}: only statless items and fixed-endpoint pets can be distributed`)
  if (!(drop.amount_each >= 1) || !drop.whitelist.length)
    red(
      'L4-AIRDROP',
      `airdrop ${drop.item_type}: amount_each ${drop.amount_each}, ${drop.whitelist.length} addresses (distribution.move EZeroQuantity)`
    )
  if (new Set(drop.whitelist).size !== drop.whitelist.length)
    red(
      'L4-DUPADDR',
      `airdrop ${drop.item_type} lists a duplicate address — the VecSet insert aborts the seeding (distribution.move)`
    )
}
if (new Set(airdrop.drops.map(({ id }) => id)).size !== airdrop.drops.length)
  red('L-DUP', 'airdrop.json holds two drops with one derived id')
for (const card of airdrop.giftcards) {
  check_exact_keys(`airdrop.giftcards[${card.id ?? '?'}]`, card, ['id', 'item_type', 'amount', 'custody'])
  if (typeof card.id !== 'string' || card.id === '') red('L-SLUG', 'giftcard row needs a non-empty derived id')
  if (!item_types.has(card.item_type)) red('X-GIFTCARD', `giftcard references the unknown item "${card.item_type}"`)
  const distributed = items_by_type.get(card.item_type)
  if (
    distributed?.stats &&
    (distributed.category !== 'pet' || JSON.stringify(distributed.stats.min) !== JSON.stringify(distributed.stats.max))
  )
    red('L4-GIFTCARD', `giftcard ${card.item_type}: only statless items and fixed-endpoint pets can be distributed`)
  if (!(card.amount >= 1))
    red('L4-GIFTCARD', `giftcard ${card.item_type}: amount ${card.amount} (distribution.move EZeroQuantity)`)
  if (typeof card.custody !== 'string' || !/^0x[\da-f]{64}$/iu.test(card.custody))
    red('L4-CUSTODY', `giftcard ${card.item_type}: custody must be a 32-byte Sui address`)
  else if (deployment_object_ids.has(card.custody))
    red(
      'L4-CUSTODY-OBJECT',
      `giftcard ${card.item_type}: custody is a pinned package/capability object ID, not a signer address`
    )
}
if (new Set(airdrop.giftcards.map(({ id }) => id)).size !== airdrop.giftcards.length)
  red('L-DUP', 'airdrop.json holds two giftcards with one derived id')

// ── icons (M6) ───────────────────────────────────────────────────────────────────────────
// Canonical small icons are required for lists; optional `_hd` renders never substitute for a missing thumbnail.
const icons_dir = join(seed_dir, 'icons', 'items')
if (existsSync(icons_dir)) {
  const present = new Set(readdirSync(icons_dir))
  const absent = items.filter((row) =>
    ['png', 'webp', 'jpg', 'jpeg'].every((extension) => !present.has(`${row.item_type}.${extension}`))
  )
  if (absent.length)
    red(
      'M6-ICON',
      `${absent.length} items have no canonical icons/items/{item_type} image (e.g. ${absent[0].item_type})`
    )
} else {
  warn('M6-ICON', 'seed/icons/items does not exist — icon presence unchecked')
}

// ── fight boards ─────────────────────────────────────────────────────────────────────────
// Boards are authored content (the ÷10 plan, Lever 1): the chain's `grid_spec` holds only a
// cheap sanity floor, so the DEEP proof — every open cell one connected component — lives
// HERE, on every board, before anything reaches the catalog doors.
const BOARD_GRID_W = 20
const BOARD_GRID_CELLS = 380
const boards_file = load('fight_boards.json')
const fight_boards = boards_file?.boards ?? []
if (boards_file?.version !== 1 || !Array.isArray(boards_file?.boards))
  red('B-SHAPE', 'fight_boards.json must be { version: 1, boards: [...] }')
if (fight_boards.length < 1)
  red('B-EMPTY', 'the catalog must hold at least one board (seed % 0 is a fight-creation DoS)')
const board_mask_get = (words, cell) => (BigInt(words[Math.floor(cell / 64)]) >> BigInt(cell % 64)) & 1n
fight_boards.forEach((board, i) => {
  const where = `fight_boards[${i}]`
  check_exact_keys(where, board, [
    'width',
    'height',
    'shape_mask',
    'obstacles',
    'holes',
    'start_cells_a',
    'start_cells_b',
  ])
  check_number(where, 'width', board.width, 8)
  check_number(where, 'height', board.height, 8)
  if (board.width < 1 || board.width > BOARD_GRID_W || board.height < 1 || board.height > 19)
    red('B-DIMS', `${where} is ${board.width}×${board.height}; the grid law is ≤20×19`)
  if (
    !Array.isArray(board.shape_mask) ||
    board.shape_mask.length !== 6 ||
    board.shape_mask.some((w) => typeof w !== 'string' || !/^\d+$/.test(w) || BigInt(w) >= 1n << 64n)
  )
    return red('B-MASK', `${where}.shape_mask must be 6 u64 words as strings (the 2^53 law)`)
  const on_mask = (cell) =>
    Number.isInteger(cell) && cell >= 0 && cell < BOARD_GRID_CELLS && board_mask_get(board.shape_mask, cell) === 1n
  for (let cell = 0; cell < BOARD_GRID_CELLS; cell += 1)
    if (on_mask(cell) && (cell % BOARD_GRID_W >= board.width || Math.floor(cell / BOARD_GRID_W) >= board.height))
      red('B-DIMS', `${where}.shape_mask contains cell ${cell} outside its declared dimensions`)
  const blocked = new Set([...board.obstacles, ...board.holes])
  for (const [field, need_open] of [
    ['obstacles', false],
    ['holes', false],
    ['start_cells_a', true],
    ['start_cells_b', true],
  ]) {
    if (!Array.isArray(board[field])) return red('B-CELLS', `${where}.${field} must be an array of cells`)
    for (const cell of board[field]) {
      if (!on_mask(cell)) red('B-CELLS', `${where}.${field} cell ${cell} is off-grid or off-shape`)
      if (need_open && blocked.has(cell)) red('B-STARTS', `${where}.${field} cell ${cell} sits on a blocker`)
    }
    if (need_open && board[field].length !== 6)
      red('B-STARTS', `${where}.${field} holds ${board[field].length} cells; every side requires exactly 6`)
    if (new Set(board[field]).size !== board[field].length) red('B-CELLS', `${where}.${field} contains duplicate cells`)
  }
  const overlap = board.start_cells_a.filter((cell) => board.start_cells_b.includes(cell))
  if (overlap.length) red('B-STARTS', `${where} gives both teams the same starts: ${overlap.join(', ')}`)
  // the connectivity PROOF: flood from one open cell, every open cell must be reached
  const open = []
  for (let cell = 0; cell < BOARD_GRID_CELLS; cell += 1) if (on_mask(cell) && !blocked.has(cell)) open.push(cell)
  if (open.length === 0) return red('B-CONNECT', `${where} has no open cell`)
  const seen = new Set([open[0]])
  const frontier = [open[0]]
  while (frontier.length > 0) {
    const cell = frontier.pop()
    const x = cell % BOARD_GRID_W
    for (const next of [
      x > 0 ? cell - 1 : -1,
      x < BOARD_GRID_W - 1 ? cell + 1 : -1,
      cell - BOARD_GRID_W,
      cell + BOARD_GRID_W,
    ]) {
      if (next >= 0 && next < BOARD_GRID_CELLS && on_mask(next) && !blocked.has(next) && !seen.has(next)) {
        seen.add(next)
        frontier.push(next)
      }
    }
  }
  if (seen.size !== open.length)
    red('B-CONNECT', `${where} splits into islands: ${seen.size}/${open.length} open cells reachable`)
})

// ── verdict ──────────────────────────────────────────────────────────────────────────────
const counts = [
  `items ${items.length}`,
  `mobs ${mobs.length}`,
  `spells ${spells.length}`,
  `recipes ${recipes.length}`,
  `worlds ${worlds.length}`,
  `boards ${fight_boards.length}`,
].join(' · ')
if (json_output) process.stdout.write(`${JSON.stringify({ counts, reds, warns })}\n`)
else {
  process.stdout.write(`${counts}\n\n`)
  for (const line of warns) process.stdout.write(`${line}\n`)
  if (warns.length) process.stdout.write('\n')
  for (const line of reds) process.stdout.write(`${line}\n`)
  process.stdout.write(`\n${reds.length} red · ${warns.length} warn\n`)
  if (reds.length)
    process.stdout.write('Every RED maps to a row in PENDING_SEED_DECISIONS.md — they are owner decisions, not bugs.\n')
}
if (reds.length) process.exit(1)
