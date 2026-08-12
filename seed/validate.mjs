// THE SEED GATE — schema, referential closure, and every cap the chain would abort on.
//
// Run: `bun seed/validate.mjs`. Exit 0 means the six files could be walked into the seeding
// without a single abort; any RED is a row the chain would refuse, or a fact nobody has authored
// yet. Each RED maps to a row in PENDING_DECISIONS.md — a red here is the red-first check for a
// decision the owner has not made, not a bug to paper over. WARNs never fail the gate.
//
// Every rule cites the Move line it mirrors. The chain validates almost nothing about slugs:
// referential closure exists ONLY here (review M1), and a typo freezes forever.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
/// The 15 ItemStatistics fields in DECLARATION ORDER (item_stats.move:10-26) — the seeding's
/// `item_stats::new(...)` is positional, so authoring order IS the contract.
const STAT_FIELDS = [
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'range',
  'movement',
  'action',
  'critical',
  'raw_damage',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
]
/// The class slugs the chain accepts (character.move:247-260).
const CLASSES = [
  'shugo',
  'tomoda',
  'rojin',
  'yajin',
  'tokei',
  'asobi',
  'iyashi',
  'senshi',
  'yogan',
  'mori',
  'ikari',
  'shusen',
]
const PARKED_CLASSES = []

const seed_dir = dirname(fileURLToPath(import.meta.url))
const load = (name) => JSON.parse(readFileSync(join(seed_dir, name), 'utf8'))

const reds = []
const warns = []
const red = (rule, message) => reds.push(`RED  ${rule} — ${message}`)
const warn = (rule, message) => warns.push(`WARN ${rule} — ${message}`)

/// item.move:429-466 verify_category — a category outside this set aborts `new_template`.
const CATEGORIES = new Set([
  'helmet',
  'chestplate',
  'belt',
  'gauntlets',
  'pants',
  'boots',
  'amulet',
  'ring',
  'pet',
  'relic',
  'title',
  'hat',
  'cloak',
  'longsword',
  'daggers',
  'battleaxe',
  'spear',
  'staff',
  'spellbook',
  'bow',
  'axe',
  'mace',
  'club',
  'sword',
  'tool_farmer',
  'tool_herbalist',
  'tool_miner',
  'consumable',
  'resource',
  'rune',
  'pet_food',
  'key',
])
/// item.move:418-423 — stackability is DERIVED from the category, never a stored flag.
const STACKABLE = new Set(['consumable', 'resource', 'rune', 'pet_food'])
const ELEMENTS = new Set(['earth', 'fire', 'water', 'air'])
const TOOLS = new Set(['tool_farmer', 'tool_herbalist', 'tool_miner'])
/// crafting.move:78 + item.move:403-415 — the 12 craft-job slugs.
const JOBS = new Set([
  'SWORD_SMITH',
  'AXE_SMITH',
  'BLUNT_SMITH',
  'STAFF_CARVER',
  'BOWYER',
  'ARMORSMITH',
  'TAILOR',
  'TANNER',
  'JEWELER',
  'HANDYMAN',
  'ALCHEMIST',
  'BAKER',
])
/// item.move:33-35 + consumable.move:27-30 — the four sealed consumable kinds.
const CONSUMABLE_KINDS = ['heal', 'reset_stat_points', 'reset_spell_points', 'teleport_to_center']
const SHIFT = 32768

const is_u = (value, bits) => Number.isInteger(value) && value >= 0 && value < 2 ** bits

/// The one home of "does this number belong on chain": u32 range, integer, never a float.
const check_number = (where, field, value, bits) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return red('L-TYPE', `${where}.${field} is not a number`)
  if (!Number.isInteger(value)) return red('L-FLOAT', `${where}.${field} = ${value} is a float; chain integers only`)
  if (!is_u(value, bits)) red('L-RANGE', `${where}.${field} = ${value} does not fit u${bits}`)
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
}

// ╔════ [ The files ] ══════════════════════════════════════════════════════════════════════ ]

const items = load('items.json')
const mobs = load('mobs.json')
const spells = load('spells.json')
const recipes = load('recipes.json')
const worlds = load('worlds.json')
const shop = load('shop.json')

const item_types = new Set(items.map((row) => row.item_type))
const mob_types = new Set(mobs.map((row) => row.mob_type))
const categories_of = new Map(items.map((row) => [row.item_type, row.category]))

// ── items ────────────────────────────────────────────────────────────────────────────────
const stat_order = STAT_FIELDS.join(',')
for (const item of items) {
  const where = `items[${item.item_type}]`
  if (typeof item.item_type !== 'string' || item.item_type === '') red('L-SLUG', `${where}: empty item_type`)
  if (typeof item.name !== 'string' || item.name === '') red('L-NAME', `${where}: empty name`)
  if (!CATEGORIES.has(item.category))
    red('I-CATEGORY', `${where}: category "${item.category}" would abort verify_category`)
  check_number(where, 'level', item.level, 8)
  const stackable = STACKABLE.has(item.category)
  if (item.stats) {
    if (stackable) red('I-STACK', `${where}: a stackable carries no stats (item.move:159 EStackableStats)`)
    for (const side of ['min', 'max']) {
      const block = item.stats[side]
      if (!block || Object.keys(block).join(',') !== stat_order)
        red(
          'I-STATORDER',
          `${where}.stats.${side}: the block must be the 15 ItemStatistics fields in declaration order (item_stats.move:10-26)`
        )
      else
        for (const field of STAT_FIELDS) {
          const value = block[field]
          if (!Number.isInteger(value)) red('L-FLOAT', `${where}.stats.${side}.${field} = ${value} is not an integer`)
          else if (Math.abs(value) >= SHIFT)
            red(
              'I-STATMAG',
              `${where}.stats.${side}.${field} = ${value} overflows the centred encoding (|v| < ${SHIFT})`
            )
        }
    }
    for (const field of STAT_FIELDS)
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
  if (item.consumable) {
    if (item.category !== 'consumable')
      red('I-CONSUM', `${where}: set_consumable is consumable-only (item.move:180 EWrongCategory)`)
    if (!is_u(item.consumable.kind, 8) || item.consumable.kind >= 4)
      red(
        'I-CONSUMKIND',
        `${where}: consumable kind ${item.consumable.kind} outside the sealed 0..3 (item.move:181 EBadConsumable)`
      )
    check_number(where, 'consumable.power', item.consumable.power, 32)
  }
}
if (new Set(items.map((row) => row.item_type)).size !== items.length)
  red('L-DUP', 'items.json holds a duplicate item_type — derived_object::claim aborts on the second')

// H2 — the rune catalog needs one template per (stat, tier) it populates, or that stat is
// un-scribable forever (rune_catalog.move:19-40, forgemagie.move:121-122).
const RUNE_STATS = [
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'range',
  'movement',
  'action',
  'critical',
  'raw_damage',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
]
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
for (const stat of RUNE_STATS)
  for (const tier of MULTI_TIER.has(stat) ? ['ba', 'pa', 'ra'] : ['ba']) {
    const slug = `rune_${stat}_${tier}`
    if (!item_types.has(slug))
      red('H2-RUNE', `the catalog rune ${slug} has no item template — that stat is un-scribable forever`)
    else if (categories_of.get(slug) !== 'rune')
      red('H2-RUNE', `${slug} is category "${categories_of.get(slug)}", not rune`)
  }

// H3 — a sealed consumable kind with no template is a live door with no content.
for (const [kind, name] of CONSUMABLE_KINDS.entries())
  if (!items.some((row) => row.consumable?.kind === kind))
    red(
      'H3-CONSUMABLE',
      `no item template authors consumable kind ${kind} (${name}) — consumable.move implements it and nothing can create one`
    )
const effectless = items.filter((row) => row.category === 'consumable' && !row.consumable)
if (effectless.length)
  warn(
    'H3-EFFECTLESS',
    `${effectless.length} consumable templates carry no effect — item::consumable_of aborts on use (e.g. ${effectless[0].item_type})`
  )

// H4 — pets need food, and pet_food is its own authored category (pet.move:54-55).
if (items.some((row) => row.category === 'pet') && !items.some((row) => row.category === 'pet_food'))
  red(
    'H4-PETFOOD',
    `${items.filter((row) => row.category === 'pet').length} pet templates exist and NO pet_food template does — every pet is unfeedable`
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
  for (const element of ['earth', 'fire', 'water', 'air'])
    check_number(where, `resistances.${element}`, mob.resistances[element], 16)
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
  if (!CLASSES.includes(spell.classe))
    red('C2-CLASSE', `${where}: classe "${spell.classe}" is not one of the 12 (spell_template.move:38 EBadClasse)`)
  check_number(where, 'unlock_level', spell.unlock_level, 8)
  if (spell.levels.length < 1 || spell.levels.length > 6)
    red('M2-LEVELS', `${where}: ${spell.levels.length} levels, the chain takes 1..6 (spell_template.move:39)`)
  spell.levels.forEach((level, i) => check_level(`${where}[${i}]`, level))
}
if (new Set(spells.map((row) => row.name)).size !== spells.length)
  red('L-DUP', 'spells.json holds a duplicate name — the spell address derives from it')
const covered = new Set(spells.map((row) => row.classe))
const missing = CLASSES.filter((classe) => !covered.has(classe))
if (missing.length)
  red(
    'C2-PARKED',
    `no spell ships for the chain classes ${missing.join(', ')} — the legacy corpus files ${PARKED_CLASSES.join(', ')} are PARKED on the slug rename`
  )

// ── recipes ──────────────────────────────────────────────────────────────────────────────
for (const recipe of recipes) {
  const where = `recipes[${recipe.output_type}]`
  if (!JOBS.has(recipe.job))
    red(
      'M1-JOB',
      `${where}: job "${recipe.job}" outside the 12 craft slugs (crafting.move:78 — the chain never checks it)`
    )
  if (!(recipe.output_quantity >= 1))
    red('R-QTY', `${where}: output_quantity ${recipe.output_quantity} (crafting.move:118 EZeroQuantity)`)
  check_number(where, 'craft_xp', recipe.craft_xp, 64)
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
  for (const [mob_type, weight] of Object.entries(world.mobs)) {
    if (!is_u(weight, 16) || weight < 1 || weight > 10000)
      red('M2-WEIGHT', `${where}: ${mob_type} weight_bp ${weight} outside 1..10000 (world.move:116 EInvalidRate)`)
    if (!mob_types.has(mob_type)) red('X-SPAWN', `${where}: spawns the unknown mob "${mob_type}"`)
  }
  for (const resource of world.resources) {
    if (!TOOLS.has(resource.tool))
      red('M2-TOOL', `${where}: resource ${resource.item_type} tool "${resource.tool}" (world.move:128 EInvalidTool)`)
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
      if (world.mobs[seat.mob_type] !== undefined) roaming_bosses += 1
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
const rareless = worlds.reduce(
  (sum, world) => sum + world.resources.filter((row) => row.rare_item_type === '').length,
  0
)
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
}
for (const drop of airdrop.drops) {
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
for (const card of airdrop.giftcards) {
  if (!item_types.has(card.item_type)) red('X-GIFTCARD', `giftcard references the unknown item "${card.item_type}"`)
  if (!(card.amount >= 1))
    red('L4-GIFTCARD', `giftcard ${card.item_type}: amount ${card.amount} (shop.move:139 EZeroQuantity)`)
  if (typeof card.custody !== 'string' || card.custody === '')
    red(
      'L4-CUSTODY',
      `giftcard ${card.item_type}: no custody address — the seeding must route the minted object somewhere`
    )
}

// ── icons (M6) ───────────────────────────────────────────────────────────────────────────
// item.move:105 publishes image_url = https://assets.aresrpg.world/item/{item_type}_hd.png —
// an icon check against any other naming passes while every wallet shows a broken image.
const icons_dir = join(seed_dir, 'assets', 'icons')
if (existsSync(icons_dir)) {
  const present = new Set(readdirSync(icons_dir))
  const absent = items.filter((row) => !present.has(`${row.item_type}_hd.png`))
  if (absent.length)
    red(
      'M6-ICON',
      `${absent.length} items have no assets/icons/{item_type}_hd.png (e.g. ${absent[0].item_type}_hd.png)`
    )
} else {
  warn('M6-ICON', 'seed/assets/icons does not exist — icon presence unchecked (the asset move is a separate change)')
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
process.stdout.write(`${counts}\n\n`)
for (const line of warns) process.stdout.write(`${line}\n`)
if (warns.length) process.stdout.write('\n')
for (const line of reds) process.stdout.write(`${line}\n`)
process.stdout.write(`\n${reds.length} red · ${warns.length} warn\n`)
if (reds.length) {
  process.stdout.write('Every RED maps to a row in seed/PENDING_DECISIONS.md — they are owner decisions, not bugs.\n')
  process.exit(1)
}
