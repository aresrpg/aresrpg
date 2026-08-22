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
  character_consumable_types,
  class_names,
  consumable_types,
  craft_job_of,
  element_names,
  item_categories,
  item_is_stackable,
  item_stat_center,
  job_slugs,
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

const reds = []
const warns = []
const red = (rule, message) => reds.push(`RED  ${rule} — ${message}`)
const warn = (rule, message) => warns.push(`WARN ${rule} — ${message}`)

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
const GATHERING_JOBS = new Set(job_slugs.slice(0, 3))
/// Recipe jobs (owner 2026-08-16): the 12 craft slugs PLUS the gathering jobs — each gathering
/// job transforms its own harvest (FARMER mills flour, MINER grinds powder, HERBALIST distills);
/// HANDYMAN sweeps the intermediates no dedicated job claims. crafting.move:78 derives the job
/// from the output category and falls back to the authored slug — the chain accepts all 15.
const RECIPE_JOBS = new Set(job_slugs)
/// consumable.move::Effect — authored names mirror the on-chain enum one-for-one.
const CHARACTER_CONSUMABLES = new Set(character_consumable_types)
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

// ╔════ [ Effects and spell levels — spell_effect.move ] ═══════════════════════════════════ ]

const check_effect = (where, effect) => {
  if (!is_u(effect.kind, 8) || effect.kind >= 20)
    red('C-KIND', `${where}: kind ${effect.kind} outside the sealed 0..19 (spell_effect.move KIND_COUNT)`)
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
}

const check_level = (where, level) => {
  check_number(where, 'ap_cost', level.ap_cost, 8)
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
  if (level.effects.length === level.crit_effects.length)
    level.effects.forEach((effect, i) => {
      if (effect.target_filter !== level.crit_effects[i].target_filter)
        red('C-CRIT-TARGET', `${where}.crit_effects[${i}]: target filter must inherit effects[${i}]`)
    })
}

// ╔════ [ The files ] ══════════════════════════════════════════════════════════════════════ ]

const items = load('items.json')
const mobs = load('mobs.json')
const spells = load('spells.json')
const recipes = load('recipes.json')
const structure_packs_file = load('structure_packs.json')
const worlds = load('worlds.json')
const shop = load('shop.json')
const structure_types_file = JSON.parse(readFileSync(join(seed_dir, 'structures', 'types.json'), 'utf8'))
const structure_packs = structure_packs_file?.packs ?? {}
const structure_types = structure_types_file?.types ?? {}

if (structure_packs_file?.version !== 1 || !structure_packs_file.packs)
  red('S-STRUCTURE', 'structure_packs.json must contain version 1 and a packs object')
if (structure_types_file?.version !== 1 || !structure_types_file.types)
  red('S-STRUCTURE', 'structures/types.json must contain version 1 and a types object')
for (const [name, pack] of Object.entries(structure_packs)) {
  const where = `structure_packs[${name}]`
  check_exact_keys(where, pack, ['category', 'spacing', 'density_bp', 'max_slope', 'bury', 'types'])
  if (!['trees', 'rocks', 'ruins'].includes(pack.category))
    red('S-STRUCTURE', `${where}: unknown category ${pack.category}`)
  if (!Number.isInteger(pack.spacing) || pack.spacing < 4)
    red('S-STRUCTURE', `${where}: spacing must be an integer >= 4`)
  if (!Number.isInteger(pack.density_bp) || pack.density_bp < 0 || pack.density_bp > 10000)
    red('S-STRUCTURE', `${where}: density_bp must be within 0..10000`)
  if (!Number.isInteger(pack.max_slope) || pack.max_slope < 0)
    red('S-STRUCTURE', `${where}: max_slope must be a non-negative integer`)
  if (!Number.isInteger(pack.bury) || pack.bury < 0) red('S-STRUCTURE', `${where}: bury must be a non-negative integer`)
  if (!Array.isArray(pack.types) || pack.types.length === 0) red('S-STRUCTURE', `${where}: types must not be empty`)
  for (const [index, row] of (pack.types ?? []).entries()) {
    if (!structure_types[row.type]) red('S-STRUCTURE', `${where}.types[${index}]: unknown type "${row.type}"`)
    if (!Number.isInteger(row.weight) || row.weight < 1)
      red('S-STRUCTURE', `${where}.types[${index}]: weight must be a positive integer`)
  }
}

const item_types = new Set(items.map((row) => row.item_type))
const mob_types = new Set(mobs.map((row) => row.mob_type))
const categories_of = new Map(items.map((row) => [row.item_type, row.category]))
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

const check_consumable = (where, effect) => {
  if (!effect || typeof effect !== 'object' || Array.isArray(effect))
    return red('I-CONSUMABLE', `${where}: consumable must be an object`)
  if (!CONSUMABLE_TYPES.has(effect.type))
    return red('I-CONSUMABLE', `${where}: unknown consumable type "${effect.type}"`)
  check_exact_keys(
    `${where}.consumable`,
    effect,
    effect.type === 'heal' ? ['type', 'amount'] : effect.type === 'loot_box' ? ['type', 'rewards'] : ['type']
  )
  if (effect.type === 'heal') {
    check_number(where, 'consumable.amount', effect.amount, 32)
    if (effect.amount === 0) red('I-CONSUMABLE', `${where}: a heal amount must be positive`)
  }
  if (effect.type === 'loot_box') check_loot_rewards(where, effect.rewards)
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
    if (!item.stats)
      red(
        'H4-PETSTATS',
        `${where}: a fully fed pet gives stats — every pet must author a stats block (owner 2026-08-20)`
      )
    if (!Array.isArray(item.pet_foods) || item.pet_foods.length === 0)
      red('H4-PETFOOD', `${where}: every pet must author at least one resource item_type in pet_foods`)
    else {
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

// H3 — a character consumable resolver with no template is a live door with no content.
for (const type of CHARACTER_CONSUMABLES)
  if (!items.some((row) => row.consumable?.type === type))
    red(
      'H3-CONSUMABLE',
      `no item template authors consumable type ${type} — consumable.move implements it and nothing can create one`
    )

// ── mobs ─────────────────────────────────────────────────────────────────────────────────
for (const mob of mobs) {
  const where = `mobs[${mob.mob_type}]`
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
    if (spell.levels.length < 1 || spell.levels.length > 6)
      red(
        'M2-LEVELS',
        `${where}.${spell.name}: ${spell.levels.length} levels, the chain takes 1..6 (mob_template.move:81)`
      )
    spell.levels.forEach((level, i) => check_level(`${where}.${spell.name}[${i}]`, level))
  }
  if (mob.loot.length > 16)
    red('M2-LOOT', `${where}: ${mob.loot.length} loot rows, the cap is 16 (mob_template.move:108)`)
  for (const entry of mob.loot) {
    if (!is_u(entry.chance_bp, 16) || entry.chance_bp > 10000)
      red('M2-CHANCE', `${where}: loot chance_bp ${entry.chance_bp} above 100% (EInvalidChance)`)
    if (!(entry.min_qty <= entry.max_qty && entry.max_qty > 0))
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

// ── spells ───────────────────────────────────────────────────────────────────────────────
for (const spell of spells) {
  const where = `spells[${spell.name}]`
  if (!class_names.includes(spell.classe))
    red('C2-CLASSE', `${where}: classe "${spell.classe}" is not one of the 12 (spell_template.move:38 EBadClasse)`)
  check_number(where, 'unlock_level', spell.unlock_level, 8)
  if (spell.levels.length < 1 || spell.levels.length > 6)
    red('M2-LEVELS', `${where}: ${spell.levels.length} levels, the chain takes 1..6 (spell_template.move:39)`)
  spell.levels.forEach((level, i) => check_level(`${where}[${i}]`, level))
}
if (new Set(spells.map((row) => row.name)).size !== spells.length)
  red('L-DUP', 'spells.json holds a duplicate name — the spell address derives from it')
const covered = new Set(spells.map((row) => row.classe))
const missing = class_names.filter((classe) => !covered.has(classe))
if (missing.length)
  red(
    'C2-PARKED',
    `no spell ships for the chain classes ${missing.join(', ')} — the legacy corpus files ${PARKED_CLASSES.join(', ')} are PARKED on the slug rename`
  )

// ── recipes ──────────────────────────────────────────────────────────────────────────────
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
  if (!item_types.has(recipe.output_type))
    red('X-RECIPE', `${where}: output references the unknown item "${recipe.output_type}"`)
  for (const [slug, quantity] of inputs) {
    if (!item_types.has(slug)) red('X-RECIPE', `${where}: input references the unknown item "${slug}"`)
    if (!Number.isInteger(quantity) || quantity < 1) red('R-INPUTQTY', `${where}: input ${slug} quantity ${quantity}`)
  }
}
if (new Set(recipes.map((row) => row.output_type)).size !== recipes.length)
  red('L-DUP', 'recipes.json holds two recipes for one output — RecipeKey derivation aborts on the second')

// ── worlds ───────────────────────────────────────────────────────────────────────────────
let unauthored_scalars = 0
let roaming_bosses = 0
for (const world of worlds) {
  const where = `worlds[${world.world}]`
  // Spawn shape (ruling 2026-08-14): a world WITH a terrain recipe authors ONE world-level
  // mob list — rows of { mob_type, weight_bp, biomes: [names] } (per-biome weights = two rows
  // with disjoint biome lists); a world WITHOUT terrain keeps the flat name→weight map
  // (seeded as biome [0] until its recipe lands).
  const biomes = world.terrain?.biomes ?? []
  const biome_names = new Set(biomes.map(({ name }) => name))
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
    ? (world.mobs ?? []).map((row) => [row.mob_type, row.mob_type, row.weight_bp, row.biomes])
    : Object.entries(world.mobs ?? {}).map(([mob, weight]) => [mob, mob, weight, null])
  for (const [label, mob_type, weight, row_biomes] of spawn_entries) {
    if (!is_u(weight, 16) || weight < 1 || weight > 10000)
      red('M2-WEIGHT', `${where}: ${label} weight_bp ${weight} outside 1..10000 (world.move EInvalidRate)`)
    if (!mob_types.has(mob_type)) red('X-SPAWN', `${where}: spawns the unknown mob "${mob_type}"`)
    if (!world.terrain) continue
    if (!Array.isArray(row_biomes) || row_biomes.length === 0) {
      red('M2-MOBBIOMES', `${where}: mob ${mob_type} names no biomes`)
      continue
    }
    for (const name of row_biomes)
      if (!biome_names.has(name)) red('M2-MOBBIOMES', `${where}: mob ${mob_type} names the unknown biome "${name}"`)
  }
  if (world.terrain && spawn_entries.length === 0)
    red('M2-COVERAGE', `${where}: no mob rows — every zone of this world would be lifeless`)
  const spawnable_mobs = new Set(spawn_entries.map(([, mob]) => mob))
  // Resources are ONE world-level list; each entry names its biomes (terrain worlds only) —
  // one row per resource, so divergent per-biome copies cannot exist by construction.
  const resource_entries = world.resources ?? []
  for (const resource of resource_entries) {
    if (!world.terrain) continue
    if (!Array.isArray(resource.biomes) || resource.biomes.length === 0)
      red('M2-RESBIOMES', `${where}: resource ${resource.item_type} names no biomes`)
    else
      for (const name of resource.biomes)
        if (!biome_names.has(name))
          red('M2-RESBIOMES', `${where}: resource ${resource.item_type} names the unknown biome "${name}"`)
  }
  for (const resource of resource_entries) {
    if (!GATHERING_JOBS.has(resource.job))
      red('M2-JOB', `${where}: resource ${resource.item_type} job "${resource.job}" (world.move EInvalidJob)`)
    check_number(`${where}.${resource.item_type}`, 'tier', resource.tier, 8)
    if (!item_types.has(resource.item_type))
      red('X-RESOURCE', `${where}: resource references the unknown item "${resource.item_type}"`)
    if (resource.protector !== '' && !mob_types.has(resource.protector))
      red('X-PROTECTOR', `${where}: protector "${resource.protector}" is not a mob`)
    if (resource.rare_item_type !== '' && !item_types.has(resource.rare_item_type))
      red('X-RARE', `${where}: rare variant "${resource.rare_item_type}" is not an item`)
  }
  if (world.dungeon.key !== '' && !item_types.has(world.dungeon.key))
    red('X-KEY', `${where}: dungeon key "${world.dungeon.key}" is not an item`)
  world.dungeon.rooms.forEach((room, i) => {
    if (!room.length) red('M2-ROOM', `${where}: dungeon room ${i + 1} is empty (world.move:148 EEmptyRoom)`)
    for (const seat of room) {
      if (!mob_types.has(seat.mob_type))
        red('X-ROOM', `${where}: room ${i + 1} seats the unknown mob "${seat.mob_type}"`)
      if (!is_u(seat.level_scalar, 8) || seat.level_scalar > 100)
        red('W-SCALAR', `${where}: room ${i + 1} ${seat.mob_type} level_scalar ${seat.level_scalar} outside 0..100`)
      if (seat.level_scalar === 0) unauthored_scalars += 1
      // "bosses never roam" (world.move:56-58) — the rule survives only because mobs.json keeps `role`
      if (spawnable_mobs.has(seat.mob_type)) roaming_bosses += 1
    }
  })
}
if (unauthored_scalars)
  red(
    'H6-SCALAR',
    `${unauthored_scalars} dungeon room seats carry the unauthored level_scalar 0 across ${worlds.length} worlds — the room difficulty band has never been balanced`
  )

// A castable level with zero effects is a dead button — the voided-effect drift (PD-7/14/15)
// made flesh. Counts both books: class spells and inline mob kits.
{
  const dead_class = spells.filter((s) => s.levels.every((l) => !l.effects.length && !l.crit_effects.length))
  const empty_class_levels = spells.reduce((n, s) => n + s.levels.filter((l) => !l.effects.length).length, 0)
  const empty_mob_kits = mobs.reduce(
    (n, m) => n + m.spells.filter((s) => s.levels.some((l) => !l.effects.length)).length,
    0
  )
  if (dead_class.length || empty_class_levels || empty_mob_kits)
    red(
      'S-EMPTY',
      `${dead_class.length} class spells are fully dead and ${empty_class_levels} class levels + ${empty_mob_kits} mob kit spells carry zero effects — the sealed effect model voids their legacy payloads (PD-7/PD-15/PD-16)`
    )
}
if (roaming_bosses)
  warn(
    'H6-ROAM',
    `${roaming_bosses} dungeon room seats ALSO appear in their world's spawn weights — "bosses never roam" (world.move:58) is violated by the legacy corpus`
  )
const rareless = worlds.reduce((sum, world) => {
  const rows = world.terrain ? world.terrain.biomes.flatMap((biome) => biome.resources ?? []) : (world.resources ?? [])
  return sum + new Set(rows.filter((row) => row.rare_item_type === '').map((row) => row.item_type)).size
}, 0)
if (rareless)
  warn(
    'M7-RARE',
    `${rareless} resource rows carry no rare variant — the golden-gather jackpot draws nothing (gathering.move:53)`
  )

// ── shop ─────────────────────────────────────────────────────────────────────────────────
for (const sale of shop.sales) {
  if (!item_types.has(sale.item_type)) red('X-SALE', `shop sale references the unknown item "${sale.item_type}"`)
  if (!(sale.supply >= 1))
    red('S-SUPPLY', `shop sale ${sale.item_type}: supply ${sale.supply} (shop.move:100 EZeroQuantity)`)
  check_number(`shop.sales[${sale.item_type}]`, 'price', sale.price, 64)
}
if (new Set(shop.sales.map((row) => row.item_type)).size !== shop.sales.length)
  red('L-DUP', 'shop.json holds two sales for one item_type — SaleKey derivation aborts')
// airdrop.json — the airdrop domain (owner 2026-08-12: split from shop.json; shop = sales only):
// `showcase` rows are the airdrop page's display data; `drops`/`giftcards` are the chain rows.
const airdrop = load('airdrop.json')
for (const row of airdrop.showcase) {
  if (typeof row.id !== 'string' || row.id === '') red('A-SHOWCASE', `showcase row without an id`)
  if (typeof row.name !== 'string' || row.name === '') red('A-SHOWCASE', `showcase ${row.id}: empty name`)
  for (const asset of Object.values(row.art ?? {})) {
    const authored_path =
      typeof asset === 'string' && asset.startsWith('models/')
        ? join(seed_dir, asset)
        : join(seed_dir, 'icons', String(asset))
    if (typeof asset === 'string' && !existsSync(authored_path))
      red('A-ASSET', `showcase ${row.id}: missing seed/${asset}`)
  }
}
for (const drop of airdrop.drops) {
  check_exact_keys(`airdrop.drops[${drop.id ?? '?'}]`, drop, ['id', 'item_type', 'amount_each', 'whitelist'])
  if (typeof drop.id !== 'string' || drop.id === '') red('L-SLUG', 'airdrop row needs a non-empty derived id')
  if (!item_types.has(drop.item_type)) red('X-AIRDROP', `airdrop references the unknown item "${drop.item_type}"`)
  if (!(drop.amount_each >= 1) || !drop.whitelist.length)
    red(
      'L4-AIRDROP',
      `airdrop ${drop.item_type}: amount_each ${drop.amount_each}, ${drop.whitelist.length} addresses (shop.move:120 EZeroQuantity)`
    )
  if (new Set(drop.whitelist).size !== drop.whitelist.length)
    red(
      'L4-DUPADDR',
      `airdrop ${drop.item_type} lists a duplicate address — the VecSet insert aborts the seeding (shop.move:124)`
    )
}
if (new Set(airdrop.drops.map(({ id }) => id)).size !== airdrop.drops.length)
  red('L-DUP', 'airdrop.json holds two drops with one derived id')
for (const card of airdrop.giftcards) {
  check_exact_keys(`airdrop.giftcards[${card.id ?? '?'}]`, card, ['id', 'item_type', 'amount', 'custody'])
  if (typeof card.id !== 'string' || card.id === '') red('L-SLUG', 'giftcard row needs a non-empty derived id')
  if (!item_types.has(card.item_type)) red('X-GIFTCARD', `giftcard references the unknown item "${card.item_type}"`)
  if (!(card.amount >= 1))
    red('L4-GIFTCARD', `giftcard ${card.item_type}: amount ${card.amount} (shop.move:139 EZeroQuantity)`)
  if (typeof card.custody !== 'string' || card.custody === '')
    red(
      'L4-CUSTODY',
      `giftcard ${card.item_type}: no custody address — the seeding must route the minted object somewhere`
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

// ── verdict ──────────────────────────────────────────────────────────────────────────────
const counts = [
  `items ${items.length}`,
  `mobs ${mobs.length}`,
  `spells ${spells.length}`,
  `recipes ${recipes.length}`,
  `worlds ${worlds.length}`,
  `sales ${shop.sales.length}`,
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
