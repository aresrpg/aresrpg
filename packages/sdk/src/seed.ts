// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable max-lines -- the seed-plan compiler keeps every phase's batching in one
   deterministic command boundary (the validator carries the same exemption); splitting the
   phases apart forces six shared helpers into a cyclic module. */
// Pure seed data → generated Move calls. Content stays outside the SDK; this module only knows
// the writer schema and deterministic batching law used by the admin page.

import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import { MIST_PER_SUI } from '@mysten/sui/utils'
import { craft_job_of, craft_max_ingredients, item_stat_center, stat_names, type StatName } from '@aresrpg/immutable'

import { bind_doors, type BoundDoors, type Resolvable, type Sdk } from './client.ts'
import * as seed_projection from './seed_doors.gen.ts'
import {
  airdrop_id,
  board_catalog_id,
  giftcard_id,
  item_template_id,
  mob_template_id,
  recipe_id,
  sale_id,
  spell_template_id,
  world_content_id,
  world_id,
} from './seed_ids.ts'
import type {
  SeedBatch,
  SeedBoard,
  SeedBuildContext,
  SeedConsumable,
  SeedContent,
  SeedEffect,
  SeedItem,
  SeedMob,
  SeedPhase,
  SeedPlan,
  SeedRecipe,
  SeedSpell,
  SeedSpellLevel,
} from './seed_types.ts'

export {
  airdrop_id,
  giftcard_id,
  item_template_id,
  mob_template_id,
  recipe_id,
  sale_id,
  spell_template_id,
} from './seed_ids.ts'
export type * from './seed_types.ts'

export type SeedSdk = Sdk & Readonly<{ seed_doors: BoundDoors<typeof seed_projection> }>

export const seed_sdk = (sdk: Sdk): SeedSdk =>
  Object.freeze({ ...sdk, seed_doors: bind_doors(seed_projection, sdk.door_context) })

const recipe_inputs = (recipe: SeedRecipe): readonly (readonly [string, number])[] => {
  const inputs = Object.entries(recipe.inputs)
  if (inputs.length < 1 || inputs.length > craft_max_ingredients)
    throw new Error(`${recipe.output_type} must use 1..${craft_max_ingredients} distinct ingredients`)
  return inputs
}

// Three BCS prefix bytes keep vector<u8> pure arguments below Sui's 16,384-byte ceiling.
const MAX_BIOME_CELLS_PER_ARGUMENT = 16_381
// Protocol v132 configures 1,024 commands, while validation requires len < limit.
// Keep headroom for the batch cap lifecycle and future transaction-level commands.
const MAX_SEED_COMMANDS = 1_000

export const bounded_transaction = (tx: Transaction, batch: string): Transaction => {
  const commands = tx.getData().commands.length
  if (commands > MAX_SEED_COMMANDS)
    throw new Error(`Seed batch ${batch} has ${commands} commands; maximum is ${MAX_SEED_COMMANDS}`)
  return tx
}

export const package_id_of = (sdk: Sdk, key: 'package' | 'math_package' | 'seed_package_original'): string => {
  const value = sdk.pins[key]
  if (typeof value !== 'string' || !value) throw new Error(`Seed planning requires pins.${key}`)
  return value
}

const shared_pin_id = (pin: unknown, what: string): string => {
  const id = typeof pin === 'object' && pin !== null ? Reflect.get(pin, 'id') : null
  if (typeof id !== 'string' || !id) throw new Error(`Seed planning requires pins.${what}`)
  return id
}

export const content_root_id_of = (sdk: Sdk): string => shared_pin_id(sdk.pins.content_root, 'content_root')

export const game_type_of = (sdk: Sdk): string => {
  const value = sdk.game_type_package
  if (typeof value !== 'string' || !value) throw new Error('Seed planning requires the game type package')
  return value
}

const stat_value = (
  sdk: SeedSdk,
  tx: Transaction,
  block: NonNullable<SeedItem['stats']>['min']
): TransactionObjectArgument =>
  sdk.seed_doors.new_item_stats(
    tx,
    Object.fromEntries(stat_names.map((field) => [field, block[field] + item_stat_center])) as Record<StatName, number>
  )

const effect_value = (sdk: SeedSdk, tx: Transaction, effect: SeedEffect): TransactionObjectArgument =>
  sdk.seed_doors.new_effect(tx, { ...effect })

export const level_value = (sdk: SeedSdk, tx: Transaction, level: SeedSpellLevel): TransactionObjectArgument =>
  sdk.seed_doors.new_spell_level(tx, {
    ...level,
    effects: level.effects.map((effect) => effect_value(sdk, tx, effect)),
    crit_effects: level.crit_effects.map((effect) => effect_value(sdk, tx, effect)),
  })

const consume_effect = (
  sdk: SeedSdk,
  tx: Transaction,
  cap: Resolvable,
  root: Resolvable,
  template: Resolvable,
  consumable: SeedConsumable
): void => {
  const effect =
    consumable.type === 'heal'
      ? sdk.seed_doors.consumable_heal(tx, { amount: consumable.amount })
      : consumable.type === 'reset_stats'
        ? sdk.seed_doors.consumable_reset_stats(tx, {})
        : consumable.type === 'reset_spells'
          ? sdk.seed_doors.consumable_reset_spells(tx, {})
          : consumable.type === 'recall'
            ? sdk.seed_doors.consumable_recall(tx, {})
            : sdk.seed_doors.consumable_loot_box(tx, {})
  sdk.seed_doors.set_effect(tx, { cap, root, template, effect })
}

/** The tunable half of an item template (stat ranges, damage lines, consumable effect) —
 * one home for authoring AND rebalancing; `template` is the fresh add_item value at creation
 * or the shared object's id at rebalance. */
export const item_facts = (
  sdk: SeedSdk,
  tx: Transaction,
  cap: Resolvable,
  root: Resolvable,
  template: Resolvable,
  item: SeedItem
): void => {
  if (item.stats) {
    const min = stat_value(sdk, tx, item.stats.min)
    const max = stat_value(sdk, tx, item.stats.max)
    sdk.seed_doors.set_stats(tx, { cap, root, template, min, max })
  }
  if (item.damages) {
    const lines = item.damages.map((line) => sdk.seed_doors.new_item_damages(tx, { ...line }))
    sdk.seed_doors.set_damages(tx, { cap, root, template, lines })
  }
  if (item.consumable) consume_effect(sdk, tx, cap, root, template, item.consumable)
}

/** Reconcile every optional item fact. Missing authored values remove old chain attachments. */
export const replace_item_facts = (
  sdk: SeedSdk,
  tx: Transaction,
  cap: Resolvable,
  root: Resolvable,
  template: Resolvable,
  item: SeedItem
): void => {
  if (item.stats) {
    const min = stat_value(sdk, tx, item.stats.min)
    const max = stat_value(sdk, tx, item.stats.max)
    sdk.seed_doors.set_stats(tx, { cap, root, template, min, max })
  } else sdk.seed_doors.clear_stats(tx, { cap, root, template })
  if (item.damages) {
    const lines = item.damages.map((line) => sdk.seed_doors.new_item_damages(tx, { ...line }))
    sdk.seed_doors.set_damages(tx, { cap, root, template, lines })
  } else sdk.seed_doors.clear_damages(tx, { cap, root, template })
  if (item.consumable) consume_effect(sdk, tx, cap, root, template, item.consumable)
  else sdk.seed_doors.clear_effect(tx, { cap, root, template })
}

/** A loot box's reward pool rows — shared by authoring and rebalance (rebalance clears first). */
export const box_rewards = (
  sdk: SeedSdk,
  tx: Transaction,
  cap: Resolvable,
  root: Resolvable,
  template: Resolvable,
  item: SeedItem,
  content_root: string,
  seed_original: string
): void => {
  if (item.consumable?.type !== 'loot_box') throw new Error(`${item.item_type} is not a loot box`)
  for (const reward of item.consumable.rewards)
    sdk.seed_doors.add_loot_reward(tx, {
      cap,
      root,
      box_template: template,
      reward_template: item_template_id(content_root, seed_original, reward.item_type),
      weight: reward.weight,
      amount: reward.amount,
    })
}

/** One mob's full authored data value — shared by authoring and rebalance. */
export const mob_data_value = (sdk: SeedSdk, tx: Transaction, mob: SeedMob): TransactionObjectArgument => {
  const spells = mob.spells.map((spell) =>
    sdk.seed_doors.new_mob_spell(tx, {
      name: spell.name,
      level: level_value(sdk, tx, spell.levels[0]!),
    })
  )
  const loot = mob.loot.map((row) => sdk.seed_doors.new_mob_loot_entry(tx, { ...row }))
  return sdk.seed_doors.new_mob_data(tx, {
    name: mob.name,
    mob_type: mob.mob_type,
    element: mob.element,
    level_min: mob.level_min,
    level_max: mob.level_max,
    hp: mob.hp,
    ap: mob.ap,
    mp: mob.mp,
    agility: mob.agility,
    wisdom: mob.wisdom,
    earth_resistance: mob.resistances.earth,
    fire_resistance: mob.resistances.fire,
    water_resistance: mob.resistances.water,
    air_resistance: mob.resistances.air,
    spells,
    loot,
    xp: mob.xp,
  })
}

/** A recipe door's argument row — shared by authoring and rebalance. The craft job derives
 * from the OUTPUT item's category, so an item category change retunes the recipe too. */
export const recipe_door_args = (
  content_root: string,
  seed_original: string,
  recipe: SeedRecipe,
  job: string
): Readonly<{
  output_type: string
  output_template: string
  input_templates: readonly string[]
  input_quantities: readonly number[]
  job: string
}> => {
  const inputs = recipe_inputs(recipe)
  return Object.freeze({
    output_type: recipe.output_type,
    output_template: item_template_id(content_root, seed_original, recipe.output_type),
    input_templates: inputs.map(([item_type]) => item_template_id(content_root, seed_original, item_type)),
    input_quantities: inputs.map(([, amount]) => amount),
    job,
  })
}

export const recipe_input_args = (
  content_root: string,
  seed_original: string,
  recipe: SeedRecipe,
  job: string
): Readonly<{ input_templates: readonly string[]; input_quantities: readonly number[]; job: string }> => {
  const inputs = recipe_inputs(recipe)
  return Object.freeze({
    input_templates: inputs.map(([item_type]) => item_template_id(content_root, seed_original, item_type)),
    input_quantities: inputs.map(([, amount]) => amount),
    job,
  })
}

export const recipe_job = (categories: ReadonlyMap<string, string>, recipe: SeedRecipe): string =>
  craft_job_of(categories.get(recipe.output_type) ?? '') ?? recipe.job ?? ''

/** One authored board as a GridSpec value — shared by authoring and rebalance. */
export const board_value = (sdk: SeedSdk, tx: Transaction, board: SeedBoard): TransactionObjectArgument =>
  sdk.seed_doors.new_grid_spec(tx, {
    width: board.width,
    height: board.height,
    shape_mask: board.shape_mask,
    obstacles: board.obstacles,
    holes: board.holes,
    start_cells_a: board.start_cells_a,
    start_cells_b: board.start_cells_b,
  })

export const pack = <T>(
  rows: readonly T[],
  cost: (row: T) => number,
  budget = MAX_SEED_COMMANDS - 2,
  label: (row: T) => string = (row) => JSON.stringify(row).slice(0, 80)
): readonly (readonly T[])[] => {
  const batches: T[][] = []
  let batch: T[] = []
  let used = 0
  for (const row of rows) {
    const row_cost = cost(row)
    // a row that cannot fit ANY batch would otherwise slip in as a batch opener and only
    // explode at build time with a bare count — refuse here, naming the offender
    if (row_cost > budget)
      throw new Error(
        `Seed row ${label(row)} alone needs ${row_cost} commands; the per-transaction budget is ${budget}`
      )
    if (batch.length && used + row_cost > budget) {
      batches.push(batch)
      batch = []
      used = 0
    }
    batch.push(row)
    used += row_cost
  }
  if (batch.length) batches.push(batch)
  return batches
}

export const slice_chunks = <T>(rows: readonly T[], size: number): readonly (readonly T[])[] => {
  const batches: T[][] = []
  for (let index = 0; index < rows.length; index += size) batches.push(rows.slice(index, index + size))
  return batches
}

export const item_cost = (item: SeedItem): number =>
  3 +
  (item.stats ? 3 : 0) +
  (item.damages?.length ?? 0) +
  (item.damages ? 1 : 0) +
  (item.consumable ? 1 : 0) +
  (item.consumable?.type === 'loot_box' ? item.consumable.rewards.length : 0)

export const spell_cost = (spell: SeedSpell): number =>
  3 + spell.levels.reduce((sum, level) => sum + 3 + level.effects.length + level.crit_effects.length, 0)

export const mob_cost = (mob: SeedMob): number =>
  4 +
  mob.loot.length +
  mob.spells.reduce(
    (sum, spell) =>
      sum +
      2 +
      spell.levels.reduce((levels, level) => levels + 3 + level.effects.length + level.crit_effects.length, 0),
    0
  )

/** ONE batch shape for the living era: every door takes the seed AdminCap + the registry
 * root (the same doors any later rebalance uses — seeding is just the first rebalance). */
const living_batch = <T>(
  sdk: SeedSdk,
  {
    id,
    phase,
    rows,
    target,
    dependencies = () => [],
    compose,
  }: Readonly<{
    id: string
    phase: SeedPhase
    rows: readonly T[]
    target: (row: T) => string
    dependencies?: (row: T) => readonly string[]
    compose: (sdk: SeedSdk, tx: Transaction, cap: Resolvable, root: Resolvable, row: T) => void
  }>
): SeedBatch => {
  const target_ids = rows.map(target)
  return Object.freeze({
    id,
    phase,
    target_ids,
    dependencies: [...new Set(rows.flatMap((row) => dependencies(row)))],
    build: (context, existing) => {
      const pending = rows.filter((row) => !existing.has(target(row)))
      if (!pending.length) return null
      const tx = sdk.tx()
      for (const row of pending) compose(sdk, tx, context.admin_cap, context.content_root, row)
      return bounded_transaction(tx, id)
    },
  })
}

const item_batches = (sdk: SeedSdk, items: readonly SeedItem[]): readonly SeedBatch[] => {
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  const regular = items.filter((item) => item.consumable?.type !== 'loot_box')
  const boxes = items.filter((item) => item.consumable?.type === 'loot_box')
  const compose_item = (
    game_sdk: SeedSdk,
    tx: Transaction,
    cap: Resolvable,
    root: Resolvable,
    item: SeedItem
  ): TransactionObjectArgument => {
    const template = game_sdk.seed_doors.add_item(tx, {
      cap,
      root,
      name: item.name,
      item_type: item.item_type,
      category: item.category,
      level: item.level,
      pet_foods: [...(item.pet_foods ?? [])],
    })
    item_facts(game_sdk, tx, cap, root, template, item)
    return template
  }
  const regular_batches = pack(regular, item_cost).map((rows, index) =>
    living_batch(sdk, {
      id: `items:${index}`,
      phase: 'items',
      rows,
      target: (item) => item_template_id(content_root, seed_original, item.item_type),
      compose: (game_sdk, tx, cap, root, item) => {
        const template = compose_item(game_sdk, tx, cap, root, item)
        game_sdk.seed_doors.share_item(tx, { template })
      },
    })
  )
  const box_batches = pack(boxes, item_cost).map((rows, index) =>
    living_batch(sdk, {
      id: `loot_boxes:${index}`,
      phase: 'loot_boxes',
      rows,
      target: (item) => item_template_id(content_root, seed_original, item.item_type),
      dependencies: (item) =>
        item.consumable?.type === 'loot_box'
          ? item.consumable.rewards.map(({ item_type }) => item_template_id(content_root, seed_original, item_type))
          : [],
      compose: (game_sdk, tx, cap, root, item) => {
        const template = compose_item(game_sdk, tx, cap, root, item)
        if (item.consumable?.type !== 'loot_box') throw new Error(`${item.item_type} is not a loot box`)
        for (const reward of item.consumable.rewards)
          game_sdk.seed_doors.add_loot_reward(tx, {
            cap,
            root,
            box_template: template,
            reward_template: item_template_id(content_root, seed_original, reward.item_type),
            weight: reward.weight,
            amount: reward.amount,
          })
        game_sdk.seed_doors.share_item(tx, { template })
      },
    })
  )
  return [...regular_batches, ...box_batches]
}

const spell_batches = (sdk: SeedSdk, spells: readonly SeedSpell[]): readonly SeedBatch[] => {
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  return pack(spells, spell_cost).map((rows, index) =>
    living_batch(sdk, {
      id: `spells:${index}`,
      phase: 'spells',
      rows,
      target: (spell) => spell_template_id(content_root, seed_original, spell.name),
      compose: (game_sdk, tx, cap, root, spell) => {
        game_sdk.seed_doors.add_spell(tx, {
          cap,
          root,
          name: spell.name,
          classe: spell.classe,
          unlock_level: spell.unlock_level,
          levels: spell.levels.map((level) => level_value(game_sdk, tx, level)),
        })
      },
    })
  )
}

const mob_batches = (sdk: SeedSdk, mobs: readonly SeedMob[]): readonly SeedBatch[] => {
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  return pack(mobs, mob_cost).map((rows, index) =>
    living_batch(sdk, {
      id: `mobs:${index}`,
      phase: 'mobs',
      rows,
      target: (mob) => mob_template_id(content_root, seed_original, mob.mob_type),
      dependencies: (mob) => mob.loot.map(({ item_type }) => item_template_id(content_root, seed_original, item_type)),
      compose: (game_sdk, tx, cap, root, mob) => {
        const spells = mob.spells.map((spell) =>
          game_sdk.seed_doors.new_mob_spell(tx, {
            name: spell.name,
            level: level_value(game_sdk, tx, spell.levels[0]!),
          })
        )
        const loot = mob.loot.map((row) => game_sdk.seed_doors.new_mob_loot_entry(tx, { ...row }))
        const data = game_sdk.seed_doors.new_mob_data(tx, {
          name: mob.name,
          mob_type: mob.mob_type,
          element: mob.element,
          level_min: mob.level_min,
          level_max: mob.level_max,
          hp: mob.hp,
          ap: mob.ap,
          mp: mob.mp,
          agility: mob.agility,
          wisdom: mob.wisdom,
          earth_resistance: mob.resistances.earth,
          fire_resistance: mob.resistances.fire,
          water_resistance: mob.resistances.water,
          air_resistance: mob.resistances.air,
          spells,
          loot,
          xp: mob.xp,
        })
        game_sdk.seed_doors.add_mob(tx, { cap, root, data })
      },
    })
  )
}

const recipe_batches = (
  sdk: SeedSdk,
  recipes: readonly SeedRecipe[],
  items: readonly SeedItem[]
): readonly SeedBatch[] => {
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  const categories = new Map(items.map(({ item_type, category }) => [item_type, category] as const))
  // Recipe vectors are input-byte-bound before they are command-bound. The weight keeps the
  // current corpus below Sui's 128 KiB transaction ceiling with deliberate headroom.
  return pack(recipes, () => 4).map((rows, index) =>
    living_batch(sdk, {
      id: `recipes:${index}`,
      phase: 'recipes',
      rows,
      target: (recipe) => recipe_id(content_root, seed_original, recipe.output_type),
      dependencies: (recipe) => [
        item_template_id(content_root, seed_original, recipe.output_type),
        ...Object.keys(recipe.inputs).map((item_type) => item_template_id(content_root, seed_original, item_type)),
      ],
      compose: (game_sdk, tx, cap, root, recipe) => {
        const inputs = recipe_inputs(recipe)
        game_sdk.seed_doors.add_recipe(tx, {
          cap,
          root,
          output_type: recipe.output_type,
          output_template: item_template_id(content_root, seed_original, recipe.output_type),
          input_templates: inputs.map(([item_type]) => item_template_id(content_root, seed_original, item_type)),
          input_quantities: inputs.map(([, amount]) => amount),
          job: craft_job_of(categories.get(recipe.output_type) ?? '') ?? recipe.job ?? '',
        })
      },
    })
  )
}

const sale_batches = (sdk: SeedSdk, sales: SeedContent['shop']['sales']): readonly SeedBatch[] => {
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  const game_type = game_type_of(sdk)
  return pack(sales, () => 1).map((rows, index) =>
    living_batch(sdk, {
      id: `sales:${index}`,
      phase: 'sales',
      rows,
      target: (sale) => sale_id(content_root, game_type, sale.item_type),
      dependencies: (sale) => [item_template_id(content_root, seed_original, sale.item_type)],
      compose: (game_sdk, tx, cap, root, sale) => {
        game_sdk.seed_doors.new_sale(tx, {
          cap,
          root,
          template: item_template_id(content_root, seed_original, sale.item_type),
          price: BigInt(sale.price) * MIST_PER_SUI,
          supply: sale.supply ?? 0,
          infinite: sale.supply === null,
          enabled: sale.enabled ?? true,
        })
      },
    })
  )
}

const supply_batches = (sdk: SeedSdk, content: SeedContent): readonly SeedBatch[] => {
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  const game_type = game_type_of(sdk)
  const rows = [
    ...content.airdrop.drops.map((drop) => ({ type: 'drop' as const, row: drop })),
    ...content.airdrop.giftcards.map((card) => ({ type: 'giftcard' as const, row: card })),
  ]
  return rows.map((entry, index) =>
    living_batch(sdk, {
      id: `supply:${index}:${entry.row.id}`,
      phase: 'supply',
      rows: [entry],
      target: (value) =>
        value.type === 'drop'
          ? airdrop_id(content_root, game_type, value.row.id)
          : giftcard_id(content_root, game_type, value.row.id),
      dependencies: (value) => [item_template_id(content_root, seed_original, value.row.item_type)],
      compose: (game_sdk, tx, cap, root, value) => {
        const template = item_template_id(content_root, seed_original, value.row.item_type)
        if (value.type === 'drop')
          game_sdk.seed_doors.new_airdrop(tx, {
            cap,
            root,
            drop_id: value.row.id,
            template,
            amount_each: value.row.amount_each,
            whitelist: value.row.whitelist,
          })
        else {
          const card = game_sdk.seed_doors.new_giftcard(tx, {
            cap,
            root,
            card_id: value.row.id,
            template,
            amount: value.row.amount,
          })
          tx.transferObjects([card], value.row.custody)
        }
      },
    })
  )
}

const world_batches = (sdk: SeedSdk, content: SeedContent): readonly SeedBatch[] => {
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  const game_original = game_type_of(sdk)
  const maps = new Map(content.biome_maps.map((map) => [map.world, map]))
  const dependencies = (world: SeedContent['worlds'][number]): readonly string[] => [
    ...(Array.isArray(world.mobs) ? world.mobs.map(({ mob_type }) => mob_type) : Object.keys(world.mobs)).map(
      (mob_type) => mob_template_id(content_root, seed_original, mob_type)
    ),
    ...world.resources.flatMap(({ item_type, protector, rare_item_type }) => [
      item_template_id(content_root, seed_original, item_type),
      ...(protector ? [mob_template_id(content_root, seed_original, protector)] : []),
      ...(rare_item_type ? [item_template_id(content_root, seed_original, rare_item_type)] : []),
    ]),
    ...(world.dungeon.key ? [item_template_id(content_root, seed_original, world.dungeon.key)] : []),
    ...world.dungeon.rooms.flatMap((room) =>
      room.map(({ mob_type }) => mob_template_id(content_root, seed_original, mob_type))
    ),
  ]
  return content.worlds.map((world, world_index) => {
    const content_id = world_content_id(content_root, seed_original, world.world)
    const gameplay_id = world_id(content_root, game_original, world.world)
    return Object.freeze({
      id: `worlds:${world_index}:${world.world}`,
      phase: 'worlds' as const,
      // resumability IS the derived address: a claimed WorldContent can never be re-created,
      // and every setter is an idempotent overwrite — no marker object needed.
      target_ids: Object.freeze([content_id, gameplay_id]),
      dependencies: Object.freeze([...new Set(dependencies(world))]),
      build: (context: SeedBuildContext, existing: ReadonlySet<string>) => {
        const has_content = existing.has(content_id)
        const has_gameplay = existing.has(gameplay_id)
        if (has_content && has_gameplay) return null
        const tx = sdk.tx()
        const cap = context.admin_cap
        const root = context.content_root
        if (!has_content) {
          const wc = sdk.seed_doors.create(tx, { cap, root, name: world.world, entry_level: world.entry_level })
          const biome_names = world.terrain?.biomes.map(({ name }) => name) ?? []
          const biome_ids = (names?: readonly string[]): readonly number[] => {
            if (!world.terrain) return [0]
            return (names ?? []).map((name) => {
              const id = biome_names.indexOf(name)
              if (id < 0) throw new Error(`${world.world} references unknown biome ${name}`)
              return id
            })
          }
          const mobs = Array.isArray(world.mobs)
            ? world.mobs
            : Object.entries(world.mobs).map(([mob_type, weight_bp]) => ({ mob_type, weight_bp, biomes: [] }))
          const mob_rows = mobs.map((row) =>
            sdk.seed_doors.new_mob_row(tx, {
              mob_type: row.mob_type,
              weight_bp: row.weight_bp,
              biomes: biome_ids(row.biomes),
            })
          )
          sdk.seed_doors.set_mobs(tx, { cap, root, wc, rows: mob_rows })
          const resource_rows = world.resources.map((row) =>
            sdk.seed_doors.new_resource_row(tx, {
              item_type: row.item_type,
              job: row.job,
              tier: row.tier,
              protector: row.protector,
              rare_item_type: row.rare_item_type,
              biomes: biome_ids(row.biomes),
            })
          )
          sdk.seed_doors.set_resources(tx, { cap, root, wc, rows: resource_rows })
          const map = maps.get(world.world)
          if (map) {
            sdk.seed_doors.set_biome_window(tx, {
              cap,
              root,
              wc,
              zone_x0: map.zone_x0,
              zone_z0: map.zone_z0,
              side: map.side,
            })
            for (const cells of slice_chunks(map.cells, MAX_BIOME_CELLS_PER_ARGUMENT))
              sdk.seed_doors.append_biome_cells(tx, { cap, root, wc, cells })
          }
          sdk.seed_doors.set_dungeon_key(tx, { cap, root, wc, item_type: world.dungeon.key })
          const rooms = world.dungeon.rooms.map((room) =>
            sdk.seed_doors.new_dungeon_room(tx, {
              mobs: room.map((mob) => sdk.seed_doors.new_room_mob(tx, { mob_type: mob.mob_type })),
            })
          )
          sdk.seed_doors.set_dungeon_rooms(tx, { cap, root, wc, rooms })
          if (!has_gameplay) sdk.seed_doors.create_world(tx, { cap, root, content: wc })
          sdk.seed_doors.share(tx, { wc })
        } else if (!has_gameplay) sdk.seed_doors.create_world(tx, { cap, root, content: content_id })
        return bounded_transaction(tx, `worlds:${world_index}:${world.world}`)
      },
    })
  })
}

/** The board home is ONE shared catalog. Creation only births it EMPTY (Sui refuses writes
 * to an object in the transaction that shares it); the boards land through the same
 * check-changes lane every later board tune uses. */
const board_batches = (sdk: SeedSdk, boards: readonly SeedBoard[]): readonly SeedBatch[] => {
  if (!boards.length) return []
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  return [
    living_batch(sdk, {
      id: 'boards:catalog',
      phase: 'boards',
      rows: ['catalog'],
      target: () => board_catalog_id(content_root, seed_original),
      compose: (game_sdk, tx, cap, root) => {
        game_sdk.seed_doors.create_catalog(tx, { cap, root })
      },
    }),
  ]
}

const validate_biome_maps = (content: SeedContent): void => {
  const maps = new Map<string, SeedContent['biome_maps'][number]>()
  for (const map of content.biome_maps) {
    if (maps.has(map.world)) throw new Error(`Duplicate biome map for ${map.world}`)
    maps.set(map.world, map)
  }
  for (const world of content.worlds) {
    const map = maps.get(world.world)
    if (!world.terrain) {
      if (map) throw new Error(`${world.world} has a biome map without a terrain recipe`)
      continue
    }
    if (!map) throw new Error(`${world.world} has a terrain recipe without a biome map`)
    if (!Number.isSafeInteger(map.side) || map.side < 1 || map.side > 0xffff || map.cells.length !== map.side ** 2)
      throw new Error(`${world.world} has an invalid biome grid shape`)
    if (map.cells.some((cell) => !Number.isSafeInteger(cell) || cell < 0 || cell >= world.terrain!.biomes.length))
      throw new Error(`${world.world} has a biome grid cell outside its biome array`)
  }
}

export const create_seed_plan = (sdk: Sdk, content: SeedContent): SeedPlan => {
  validate_biome_maps(content)
  const writer = seed_sdk(sdk)
  const batches = [
    ...item_batches(writer, content.items),
    ...spell_batches(writer, content.spells),
    ...mob_batches(writer, content.mobs),
    ...recipe_batches(writer, content.recipes, content.items),
    ...sale_batches(writer, content.shop.sales),
    ...world_batches(writer, content),
    ...board_batches(writer, content.boards),
    ...supply_batches(writer, content),
  ]
  const targets = new Map<string, string>()
  for (const batch of batches)
    for (const target of batch.target_ids) {
      const owner = targets.get(target)
      if (owner) throw new Error(`Seed target ${target} is claimed by both ${owner} and ${batch.id}`)
      targets.set(target, batch.id)
    }
  return Object.freeze({ batches: Object.freeze(batches) })
}

/** THE ENDGAME (owner ruling 2026-08-23): one irreversible cold-key transaction freezes every
 * content and supply door forever. Never part of seeding — pulled once, after months. */
export const create_freeze_forever_transaction = (
  sdk: Sdk,
  admin_cap: Resolvable,
  content_root: Resolvable,
  upgrade_caps: readonly Resolvable[]
): Transaction => {
  const tx = sdk.tx()
  seed_sdk(sdk).seed_doors.freeze_forever(tx, { cap: admin_cap, root: content_root })
  // the cold cap stays owned — every door asserts the frozen flag, so it opens nothing;
  // a destroy door would only add a way to brick the cap WITHOUT freezing (owner 2026-08-24)
  for (const upgrade_cap of upgrade_caps)
    tx.moveCall({
      target: '0x2::package::make_immutable',
      arguments: [sdk.door_context.obj(tx, upgrade_cap, true)],
    })
  return tx
}
