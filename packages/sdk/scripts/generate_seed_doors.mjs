#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'

import { generate_projected_doors, parse_doors } from './generate_doors.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SEED_DOORS_OUT_PATH = join(root, 'src/seed_doors.gen.ts')
export const SEED_CONTRACT_OUT_PATH = join(root, 'src/seed_contract.gen.ts')

const modules = [
  // Core's LIVING distribution + loot-pool doors (they claim/bump through the seed registry —
  // the freeze_forever flag closes them with all content).
  {
    path: join(root, '../move/sources/world.move'),
    module: 'world',
    package_key: 'package',
    selected: { create: 'create_world' },
  },
  {
    path: join(root, '../move/sources/distribution.move'),
    module: 'distribution',
    package_key: 'package',
    selected: {
      new_airdrop: 'new_airdrop',
      new_giftcard: 'new_giftcard',
    },
  },
  {
    path: join(root, '../move/sources/loot_box.move'),
    module: 'loot_box',
    package_key: 'package',
    selected: { add_loot_reward: 'add_loot_reward', clear_loot_table: 'clear_loot_table' },
  },
  {
    path: join(root, '../move/sources/mastery.move'),
    module: 'mastery',
    package_key: 'package',
    selected: { new_offer: 'new_mastery_offer', set_offer: 'set_mastery_offer' },
  },
  // The living-content layer (owner 2026-08-23): world content + fight boards live in the
  // seed PACKAGE behind AdminCap doors — the ceremony and every later rebalance compose these.
  {
    path: join(root, '../seed/sources/world_content.move'),
    module: 'world_content',
    package_key: 'seed_package',
    selected: {
      create: 'create',
      share: 'share',
      set_entry_level: 'set_entry_level',
      set_mobs: 'set_mobs',
      set_archi_rows: 'set_archi_rows',
      set_biome_window: 'set_biome_window',
      append_biome_cells: 'append_biome_cells',
      clear_biome_map: 'clear_biome_map',
      set_resources: 'set_resources',
      set_cities: 'set_cities',
    },
  },
  {
    path: join(root, '../seed/sources/dungeon_content.move'),
    module: 'dungeon_content',
    package_key: 'seed_package',
    selected: { add: 'add_dungeon', overwrite: 'overwrite_dungeon' },
  },
  {
    path: join(root, '../seed/sources/mob_rows.move'),
    module: 'mob_rows',
    package_key: 'seed_package',
    selected: { add_mob: 'add_mob', overwrite_mob: 'overwrite_mob' },
  },
  {
    path: join(root, '../seed/sources/spell_rows.move'),
    module: 'spell_rows',
    package_key: 'seed_package',
    selected: { add_spell: 'add_spell', overwrite_spell: 'overwrite_spell' },
  },
  {
    path: join(root, '../seed/sources/item_rows.move'),
    module: 'item_rows',
    package_key: 'seed_package',
    selected: {
      add_item: 'add_item',
      share_item: 'share_item',
      overwrite_item: 'overwrite_item',
      set_stats: 'set_stats',
      clear_stats: 'clear_stats',
      set_damages: 'set_damages',
      clear_damages: 'clear_damages',
      set_effect: 'set_effect',
      clear_effect: 'clear_effect',
    },
  },
  {
    path: join(root, '../seed/sources/recipe_rows.move'),
    module: 'recipe_rows',
    package_key: 'seed_package',
    selected: {
      add_recipe: 'add_recipe',
      overwrite_recipe: 'overwrite_recipe',
      retire_recipe: 'retire_recipe',
    },
  },
  {
    path: join(root, '../seed/sources/board_catalog.move'),
    module: 'board_catalog',
    package_key: 'seed_package',
    selected: {
      create_catalog: 'create_catalog',
      add_board: 'add_board',
      replace_board: 'replace_board',
      remove_last_board: 'remove_last_board',
    },
  },
  {
    path: join(root, '../seed/sources/registry.move'),
    module: 'registry',
    package_key: 'seed_package',
    selected: { freeze_forever: 'freeze_forever' },
  },
  {
    path: join(root, '../move-math/sources/item_stats.move'),
    module: 'item_stats',
    package_key: 'math_package',
    selected: { new: 'new_item_stats' },
  },
  {
    path: join(root, '../move-math/sources/consumable_effect.move'),
    module: 'consumable_effect',
    package_key: 'math_package',
    selected: {
      heal: 'consumable_heal',
      reset_stats: 'consumable_reset_stats',
      reset_spells: 'consumable_reset_spells',
      recall: 'consumable_recall',
      city: 'consumable_city',
      loot_box: 'consumable_loot_box',
    },
  },
  {
    path: join(root, '../move-math/sources/item_damages.move'),
    module: 'item_damages',
    package_key: 'math_package',
    selected: { new: 'new_item_damages' },
  },
  {
    path: join(root, '../move-math/sources/spell_effect.move'),
    module: 'spell_effect',
    package_key: 'math_package',
    selected: { new_effect: 'new_effect', new_spell_level: 'new_spell_level' },
  },
  {
    path: join(root, '../move-math/sources/mob_data.move'),
    module: 'mob_data',
    package_key: 'math_package',
    selected: {
      new_loot_entry: 'new_mob_loot_entry',
      new_mob_spell: 'new_mob_spell',
      new_mob_data: 'new_mob_data',
    },
  },
  {
    path: join(root, '../move-math/sources/combat_grid.move'),
    module: 'combat_grid',
    package_key: 'math_package',
    selected: { grid_spec: 'new_grid_spec' },
  },
  {
    path: join(root, '../move-math/sources/city_map.move'),
    module: 'city_map',
    package_key: 'math_package',
    selected: { new_city: 'new_city' },
  },
  {
    path: join(root, '../move-math/sources/dungeon_data.move'),
    module: 'dungeon_data',
    package_key: 'math_package',
    selected: {
      new_dungeon: 'new_dungeon_data',
      new_room: 'new_dungeon_room_data',
      new_room_mob: 'new_dungeon_room_mob',
    },
  },
  {
    path: join(root, '../move-math/sources/world_map.move'),
    module: 'world_map',
    package_key: 'math_package',
    selected: {
      new_mob_row: 'new_mob_row',
      new_archi_row: 'new_archi_row',
      new_resource_row: 'new_resource_row',
    },
  },
]

export const seed_doors = () =>
  modules.flatMap(({ path, module, package_key, selected }) => {
    const parsed = parse_doors(readFileSync(path, 'utf8'), selected ? new Set(Object.keys(selected)) : null)
    return parsed
      .filter(({ name }) => !selected || selected[name])
      .map((door) => ({
        ...door,
        module,
        package_key,
        export_name: selected?.[door.name] ?? door.name,
      }))
  })

export const generate_seed_doors = () =>
  generate_projected_doors(seed_doors(), SEED_DOORS_OUT_PATH, {
    source: 'the living content doors and their Move value constructors',
    description: 'seeding door',
  })

const key_sources = [
  ...['distribution', 'mastery', 'world'].map((module) => ({
    module,
    path: join(root, `../move/sources/${module}.move`),
  })),
  // living-content key types (the seed PACKAGE — derivations anchor on the registry root)
  ...['item_rows', 'mob_rows', 'spell_rows', 'recipe_rows', 'world_content', 'dungeon_content', 'board_catalog'].map(
    (module) => ({
      module,
      path: join(root, `../seed/sources/${module}.move`),
    })
  ),
]

export const seed_string_keys = () =>
  key_sources.flatMap(({ path, module }) =>
    [...readFileSync(path, 'utf8').matchAll(/public struct (\w+Key)\(String\)\s+has[^;]*;/g)].map(([, name]) => ({
      name,
      module,
    }))
  )

export const generate_seed_contract = async () => {
  const rows = seed_string_keys()
  const raw = `// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GENERATED by scripts/generate_seed_doors.mjs from Move String key structs — DO NOT EDIT.

export const SEED_STRING_KEYS = Object.freeze({
${rows.map(({ name, module }) => `  ${name}: Object.freeze({ module: '${module}', name: '${name}' }),`).join('\n')}
})
`
  return prettier.format(raw, { ...(await prettier.resolveConfig(SEED_CONTRACT_OUT_PATH)), parser: 'typescript' })
}

const invoked_directly = import.meta.main ?? (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
if (invoked_directly) {
  const [output, contract] = await Promise.all([generate_seed_doors(), generate_seed_contract()])
  writeFileSync(SEED_DOORS_OUT_PATH, output)
  writeFileSync(SEED_CONTRACT_OUT_PATH, contract)
  console.log(`seed_doors.gen.ts written — ${seed_doors().length} doors`)
}
