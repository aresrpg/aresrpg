// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure seed data → generated Move calls. Content stays outside the SDK; this module only knows
// the writer schema and deterministic batching law used by the admin page.

import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions'
import { craft_job_of, item_stat_center, stat_names, type StatName } from '@aresrpg/immutable'

import { bind_doors, type BoundDoors, type Resolvable, type Sdk } from './client.ts'
import * as seed_projection from './seed_doors.gen.ts'
import {
  airdrop_id,
  giftcard_id,
  item_template_id,
  mob_template_id,
  recipe_id,
  sale_id,
  seal_marker_id,
  spell_template_id,
  world_seed_marker_id,
} from './seed_ids.ts'
import type {
  SeedBatch,
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
  seal_marker_id,
  spell_template_id,
  world_seed_marker_id,
} from './seed_ids.ts'
export type * from './seed_types.ts'

type SeedSdk = Sdk & Readonly<{ seed_doors: BoundDoors<typeof seed_projection> }>

const seed_sdk = (sdk: Sdk): SeedSdk =>
  Object.freeze({ ...sdk, seed_doors: bind_doors(seed_projection, sdk.door_context) })

// Three BCS prefix bytes keep vector<u8> pure arguments below Sui's 16,384-byte ceiling.
const MAX_BIOME_CELLS_PER_ARGUMENT = 16_381
// Protocol v132 configures 1,024 commands, while validation requires len < limit.
// Keep headroom for the batch cap lifecycle and future transaction-level commands.
const MAX_SEED_COMMANDS = 1_000

const bounded_transaction = (tx: Transaction, batch: string): Transaction => {
  const commands = tx.getData().commands.length
  if (commands > MAX_SEED_COMMANDS)
    throw new Error(`Seed batch ${batch} has ${commands} commands; maximum is ${MAX_SEED_COMMANDS}`)
  return tx
}

const package_id_of = (sdk: Sdk, key: 'package' | 'math_package'): string => {
  const value = sdk.pins[key]
  if (typeof value !== 'string' || !value) throw new Error(`Seed planning requires pins.${key}`)
  return value
}

const registry_id_of = (sdk: Sdk): string => {
  const pin = sdk.pins.template_registry
  const id = typeof pin === 'object' && pin !== null ? Reflect.get(pin, 'id') : null
  if (typeof id !== 'string' || !id) throw new Error('Seed planning requires pins.template_registry')
  return id
}

const begin = (sdk: SeedSdk, tx: Transaction, admin_cap: Resolvable): TransactionObjectArgument =>
  sdk.seed_doors.begin_batch(tx, { admin: admin_cap })

const finish = (sdk: SeedSdk, tx: Transaction, cap: TransactionObjectArgument): void => {
  sdk.seed_doors.destroy_seed_cap(tx, { cap })
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

const level_value = (sdk: SeedSdk, tx: Transaction, level: SeedSpellLevel): TransactionObjectArgument =>
  sdk.seed_doors.new_spell_level(tx, {
    ...level,
    effects: level.effects.map((effect) => effect_value(sdk, tx, effect)),
    crit_effects: level.crit_effects.map((effect) => effect_value(sdk, tx, effect)),
  })

const consume_effect = (
  sdk: SeedSdk,
  tx: Transaction,
  template: TransactionObjectArgument,
  consumable: SeedConsumable
): void => {
  if (consumable.type === 'heal') sdk.seed_doors.set_consumable_heal(tx, { template, amount: consumable.amount })
  else if (consumable.type === 'reset_stats') sdk.seed_doors.set_consumable_reset_stats(tx, { template })
  else if (consumable.type === 'reset_spells') sdk.seed_doors.set_consumable_reset_spells(tx, { template })
  else if (consumable.type === 'recall') sdk.seed_doors.set_consumable_recall(tx, { template })
  else sdk.seed_doors.set_consumable_loot_box(tx, { template })
}

const pack = <T>(
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

const slice_chunks = <T>(rows: readonly T[], size: number): readonly (readonly T[])[] => {
  const batches: T[][] = []
  for (let index = 0; index < rows.length; index += size) batches.push(rows.slice(index, index + size))
  return batches
}

const item_cost = (item: SeedItem): number =>
  3 +
  (item.stats ? 3 : 0) +
  (item.damages?.length ?? 0) +
  (item.damages ? 1 : 0) +
  (item.consumable ? 1 : 0) +
  (item.consumable?.type === 'loot_box' ? item.consumable.rewards.length : 0)

const spell_cost = (spell: SeedSpell): number =>
  3 + spell.levels.reduce((sum, level) => sum + 3 + level.effects.length + level.crit_effects.length, 0)

const mob_cost = (mob: SeedMob): number =>
  4 +
  mob.loot.length +
  mob.spells.reduce(
    (sum, spell) =>
      sum +
      2 +
      spell.levels.reduce((levels, level) => levels + 3 + level.effects.length + level.crit_effects.length, 0),
    0
  )

const target_batch = <T>(
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
    compose: (sdk: SeedSdk, tx: Transaction, cap: TransactionObjectArgument, row: T) => void
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
      const cap = begin(sdk, tx, context.admin_cap)
      for (const row of pending) compose(sdk, tx, cap, row)
      finish(sdk, tx, cap)
      return bounded_transaction(tx, id)
    },
  })
}

const item_batches = (sdk: SeedSdk, items: readonly SeedItem[]): readonly SeedBatch[] => {
  const registry = registry_id_of(sdk)
  const regular = items.filter((item) => item.consumable?.type !== 'loot_box')
  const boxes = items.filter((item) => item.consumable?.type === 'loot_box')
  const compose_item = (
    game_sdk: SeedSdk,
    tx: Transaction,
    cap: TransactionObjectArgument,
    item: SeedItem
  ): TransactionObjectArgument => {
    const template = game_sdk.seed_doors.new_item_template(tx, {
      _: cap,
      name: item.name,
      item_type: item.item_type,
      category: item.category,
      level: item.level,
      pet_foods: [...(item.pet_foods ?? [])],
    })
    if (item.stats) {
      const min = stat_value(game_sdk, tx, item.stats.min)
      const max = stat_value(game_sdk, tx, item.stats.max)
      game_sdk.seed_doors.set_stats(tx, { template, min, max })
    }
    if (item.damages) {
      const lines = item.damages.map((line) => game_sdk.seed_doors.new_item_damages(tx, { ...line }))
      game_sdk.seed_doors.set_damages(tx, { template, lines })
    }
    if (item.consumable) consume_effect(game_sdk, tx, template, item.consumable)
    return template
  }
  const regular_batches = pack(regular, item_cost).map((rows, index) =>
    target_batch(sdk, {
      id: `items:${index}`,
      phase: 'items',
      rows,
      target: (item) => item_template_id(registry, item.item_type),
      compose: (game_sdk, tx, cap, item) => {
        const template = compose_item(game_sdk, tx, cap, item)
        game_sdk.seed_doors.freeze_item_template(tx, { template })
      },
    })
  )
  const box_batches = pack(boxes, item_cost).map((rows, index) =>
    target_batch(sdk, {
      id: `loot_boxes:${index}`,
      phase: 'loot_boxes',
      rows,
      target: (item) => item_template_id(registry, item.item_type),
      dependencies: (item) =>
        item.consumable?.type === 'loot_box'
          ? item.consumable.rewards.map(({ item_type }) => item_template_id(registry, item_type))
          : [],
      compose: (game_sdk, tx, cap, item) => {
        const template = compose_item(game_sdk, tx, cap, item)
        if (item.consumable?.type !== 'loot_box') throw new Error(`${item.item_type} is not a loot box`)
        for (const reward of item.consumable.rewards)
          game_sdk.seed_doors.add_loot_reward(tx, {
            _: cap,
            box_template: template,
            reward_template: item_template_id(registry, reward.item_type),
            weight: reward.weight,
            amount: reward.amount,
          })
        game_sdk.seed_doors.freeze_loot_box_template(tx, { template })
      },
    })
  )
  return [...regular_batches, ...box_batches]
}

const spell_batches = (sdk: SeedSdk, spells: readonly SeedSpell[]): readonly SeedBatch[] => {
  const registry = registry_id_of(sdk)
  const package_id = package_id_of(sdk, 'package')
  return pack(spells, spell_cost).map((rows, index) =>
    target_batch(sdk, {
      id: `spells:${index}`,
      phase: 'spells',
      rows,
      target: (spell) => spell_template_id(registry, package_id, spell.name),
      compose: (game_sdk, tx, cap, spell) => {
        const template = game_sdk.seed_doors.new_spell(tx, {
          _: cap,
          name: spell.name,
          classe: spell.classe,
          unlock_level: spell.unlock_level,
          levels: spell.levels.map((level) => level_value(game_sdk, tx, level)),
        })
        game_sdk.seed_doors.freeze_spell(tx, { template })
      },
    })
  )
}

const mob_batches = (sdk: SeedSdk, mobs: readonly SeedMob[]): readonly SeedBatch[] => {
  const registry = registry_id_of(sdk)
  const package_id = package_id_of(sdk, 'package')
  return pack(mobs, mob_cost).map((rows, index) =>
    target_batch(sdk, {
      id: `mobs:${index}`,
      phase: 'mobs',
      rows,
      target: (mob) => mob_template_id(registry, package_id, mob.mob_type),
      dependencies: (mob) => mob.loot.map(({ item_type }) => item_template_id(registry, item_type)),
      compose: (game_sdk, tx, cap, mob) => {
        const spells = mob.spells.map((spell) =>
          game_sdk.seed_doors.new_mob_spell(tx, {
            name: spell.name,
            levels: spell.levels.map((level) => level_value(game_sdk, tx, level)),
          })
        )
        const loot = mob.loot.map((row) => game_sdk.seed_doors.new_mob_loot_entry(tx, { ...row }))
        const template = game_sdk.seed_doors.new_mob_template(tx, {
          _: cap,
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
        game_sdk.seed_doors.freeze_mob_template(tx, { template })
      },
    })
  )
}

const recipe_batches = (
  sdk: SeedSdk,
  recipes: readonly SeedRecipe[],
  items: readonly SeedItem[]
): readonly SeedBatch[] => {
  const registry = registry_id_of(sdk)
  const package_id = package_id_of(sdk, 'package')
  const categories = new Map(items.map(({ item_type, category }) => [item_type, category] as const))
  // Recipe vectors are input-byte-bound before they are command-bound. The weight keeps the
  // current corpus below Sui's 128 KiB transaction ceiling with deliberate headroom.
  return pack(recipes, () => 4).map((rows, index) =>
    target_batch(sdk, {
      id: `recipes:${index}`,
      phase: 'recipes',
      rows,
      target: (recipe) => recipe_id(registry, package_id, recipe.output_type),
      dependencies: (recipe) => [
        item_template_id(registry, recipe.output_type),
        ...Object.keys(recipe.inputs).map((item_type) => item_template_id(registry, item_type)),
      ],
      compose: (game_sdk, tx, cap, recipe) => {
        const inputs = Object.entries(recipe.inputs)
        const value = game_sdk.seed_doors.new_recipe(tx, {
          _: cap,
          output_type: recipe.output_type,
          output_template: item_template_id(registry, recipe.output_type),
          input_templates: inputs.map(([item_type]) => item_template_id(registry, item_type)),
          input_quantities: inputs.map(([, amount]) => amount),
          job: craft_job_of(categories.get(recipe.output_type) ?? '') ?? recipe.job ?? '',
        })
        game_sdk.seed_doors.freeze_recipe(tx, { recipe: value })
      },
    })
  )
}

const sale_batches = (sdk: SeedSdk, sales: SeedContent['shop']['sales']): readonly SeedBatch[] => {
  const registry = registry_id_of(sdk)
  const package_id = package_id_of(sdk, 'package')
  return pack(sales, () => 1).map((rows, index) =>
    target_batch(sdk, {
      id: `sales:${index}`,
      phase: 'sales',
      rows,
      target: (sale) => sale_id(registry, package_id, sale.item_type),
      dependencies: (sale) => [item_template_id(registry, sale.item_type)],
      compose: (game_sdk, tx, cap, sale) => {
        game_sdk.seed_doors.new_sale(tx, {
          _: cap,
          item_type: sale.item_type,
          template: item_template_id(registry, sale.item_type),
          price: sale.price,
          supply: sale.supply,
        })
      },
    })
  )
}

const world_batches = (sdk: SeedSdk, content: SeedContent): readonly SeedBatch[] => {
  const registry = registry_id_of(sdk)
  const package_id = package_id_of(sdk, 'package')
  const maps = new Map(content.biome_maps.map((map) => [map.world, map]))
  const dependencies = (world: SeedContent['worlds'][number]): readonly string[] => [
    ...(Array.isArray(world.mobs) ? world.mobs.map(({ mob_type }) => mob_type) : Object.keys(world.mobs)).map(
      (mob_type) => mob_template_id(registry, package_id, mob_type)
    ),
    ...world.resources.flatMap(({ item_type, protector, rare_item_type }) => [
      item_template_id(registry, item_type),
      ...(protector ? [mob_template_id(registry, package_id, protector)] : []),
      ...(rare_item_type ? [item_template_id(registry, rare_item_type)] : []),
    ]),
    ...(world.dungeon.key ? [item_template_id(registry, world.dungeon.key)] : []),
    ...world.dungeon.rooms.flatMap((room) =>
      room.map(({ mob_type }) => mob_template_id(registry, package_id, mob_type))
    ),
  ]
  return content.worlds.map((world, world_index) =>
    Object.freeze({
      id: `worlds:${world_index}:${world.world}`,
      phase: 'worlds' as const,
      target_ids: Object.freeze([world_seed_marker_id(registry, package_id, world.world)]),
      dependencies: Object.freeze([...new Set(dependencies(world))]),
      build: (context: SeedBuildContext, existing: ReadonlySet<string>) => {
        if (existing.has(world_seed_marker_id(registry, package_id, world.world))) return null
        const tx = sdk.tx()
        const cap = begin(sdk, tx, context.admin_cap)
        {
          const world_object = context.worlds[world.world]
          if (!world_object) throw new Error(`Missing shared World object for ${world.world}`)
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
          sdk.seed_doors.set_world_mobs(tx, { _: cap, world: world_object, rows: mob_rows })
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
          sdk.seed_doors.set_world_resources(tx, { _: cap, world: world_object, rows: resource_rows })
          const map = maps.get(world.world)
          if (map) {
            sdk.seed_doors.set_world_biome_window(tx, {
              _: cap,
              world: world_object,
              zone_x0: map.zone_x0,
              zone_z0: map.zone_z0,
              side: map.side,
            })
            for (const cells of slice_chunks(map.cells, MAX_BIOME_CELLS_PER_ARGUMENT))
              sdk.seed_doors.append_world_biome_cells(tx, { _: cap, world: world_object, cells })
          }
          sdk.seed_doors.set_world_dungeon_key(tx, { _: cap, world: world_object, item_type: world.dungeon.key })
          const rooms = world.dungeon.rooms.map((room) =>
            sdk.seed_doors.new_dungeon_room(tx, {
              mobs: room.map((mob) => sdk.seed_doors.new_room_mob(tx, { ...mob })),
            })
          )
          sdk.seed_doors.set_world_dungeon_rooms(tx, { _: cap, world: world_object, rooms })
          sdk.seed_doors.mark_world_seeded(tx, { _: cap, world_name: world.world })
        }
        finish(sdk, tx, cap)
        return bounded_transaction(tx, `worlds:${world_index}:${world.world}`)
      },
    })
  )
}

const supply_batches = (sdk: SeedSdk, content: SeedContent): readonly SeedBatch[] => {
  const registry = registry_id_of(sdk)
  const package_id = package_id_of(sdk, 'package')
  const rows = [
    ...content.airdrop.drops.map((drop) => ({ type: 'drop' as const, row: drop })),
    ...content.airdrop.giftcards.map((card) => ({ type: 'giftcard' as const, row: card })),
  ]
  return rows.map((entry, index) =>
    target_batch(sdk, {
      id: `supply:${index}:${entry.row.id}`,
      phase: 'supply',
      rows: [entry],
      target: (value) =>
        value.type === 'drop'
          ? airdrop_id(registry, package_id, value.row.id)
          : giftcard_id(registry, package_id, value.row.id),
      dependencies: (value) => [item_template_id(registry, value.row.item_type)],
      compose: (game_sdk, tx, cap, value) => {
        const template = item_template_id(registry, value.row.item_type)
        if (value.type === 'drop')
          game_sdk.seed_doors.new_airdrop(tx, {
            _: cap,
            drop_id: value.row.id,
            template,
            amount_each: value.row.amount_each,
            whitelist: value.row.whitelist,
          })
        else {
          const card = game_sdk.seed_doors.new_giftcard(tx, {
            _: cap,
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
    ...supply_batches(writer, content),
  ]
  const targets = new Map<string, string>()
  for (const batch of batches)
    for (const target of batch.target_ids) {
      const owner = targets.get(target)
      if (owner) throw new Error(`Seed target ${target} is claimed by both ${owner} and ${batch.id}`)
      targets.set(target, batch.id)
    }
  return Object.freeze({
    batches: Object.freeze(batches),
    seal_id: seal_marker_id(registry_id_of(sdk), package_id_of(sdk, 'package')),
  })
}

export const create_seal_transaction = (sdk: Sdk, admin_cap: Resolvable): Transaction => {
  const tx = sdk.tx()
  seed_sdk(sdk).seed_doors.seal(tx, { admin: admin_cap })
  return tx
}
