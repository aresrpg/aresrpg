// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The CHECK-CHANGES lane: compare the authored JSON against what was last written on chain
// and turn the difference into the rebalance doors. pins.json durably records every derived
// address, authored hash, and immutable identity fact, namespaced by Registry root. This record
// is deployment state: it must survive because omitted rows have no current JSON address source.
// Rows fall into four buckets:
//   new        — the object does not exist yet (the publish lane creates it)
//   changed    — the object exists and the file no longer matches the last write (apply here)
//   removed    — the file dropped a row the chain still holds (shown, never deleted — things
//                leave play by editing what points at them); omitted sales and recipes are the
//                exceptions: their existing living rows are disabled automatically
//   fixed      — airdrops/giftcards are one-shot objects with no rewrite door; a change here
//                needs a new row under a new name

import type { Transaction } from '@mysten/sui/transactions'
import { MIST_PER_SUI } from '@mysten/sui/utils'

import type { Resolvable } from './client.ts'
import {
  board_value,
  bounded_transaction,
  box_rewards,
  content_root_id_of,
  game_type_of,
  item_cost,
  replace_item_facts,
  level_value,
  mob_cost,
  mob_data_value,
  pack,
  package_id_of,
  recipe_door_args,
  recipe_input_args,
  recipe_job,
  seed_sdk,
  slice_chunks,
  spell_cost,
  type SeedSdk,
} from './seed.ts'
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
import type { SeedBoard, SeedContent } from './seed_types.ts'

/** One ledger entry: the fingerprint of the row as last written, plus immutable identity facts. */
export type SeedLedger = Readonly<
  Record<
    string,
    Readonly<{
      hash: string
      label: string
      /** Every chain object address this authored identity owns. */
      addresses?: readonly string[]
      domain?: string
      item?: Readonly<{ category: string }>
      sale?: Readonly<{ infinite: boolean; supply: number }>
      spell?: Readonly<{ classe: string; unlock_level?: number }>
    }>
  >
>

export type SeedSyncRow = Readonly<{
  /** ledger key — a chain object id for most rows, `board:N` for boards */
  key: string
  label: string
  hash: string
  kind: 'template' | 'board' | 'supply'
  domain: 'item' | 'spell' | 'mob' | 'recipe' | 'world' | 'board' | 'sale' | 'airdrop' | 'giftcard'
  item?: Readonly<{ category: string }>
  sale?: Readonly<{ infinite: boolean; supply: number }>
  /** spell rows carry their immutable class so the ledger can refuse illegal rewrites */
  spell?: Readonly<{ classe: string; unlock_level: number }>
  /** the chain object whose existence says "already created" (the shared catalog for boards) */
  chain_id: string
  /** Durable address book persisted in pins.json. */
  addresses: readonly string[]
  /** shared objects the rewrite needs resolved before composing */
  hydrate: readonly string[]
  /** commands this row's rewrite roughly costs (transaction packing) */
  cost: number
  /** composes the rewrite doors — absent on supply rows (no rewrite exists) */
  update?: (sdk: SeedSdk, tx: Transaction, cap: Resolvable, root: Resolvable) => void
  /** the authored board itself — only on board rows (the append path rebuilds the value) */
  board_source?: SeedBoard
}>

export type SeedSyncView = Readonly<{
  new_rows: readonly SeedSyncRow[]
  changed: readonly SeedSyncRow[]
  /** Dense board indexes present on chain beyond the authored tail; these are real deletions. */
  board_removals: readonly Readonly<{ key: string; label: string }>[]
  removed: readonly Readonly<{ key: string; label: string }>[]
  fixed: readonly SeedSyncRow[]
  unchanged: number
  /** law violations — nothing can be written while any stand */
  errors: readonly string[]
}>

// FNV-1a 64-bit over the canonical JSON — collisions are ~impossible at this corpus size,
// and a collision's worst case is one missed rewrite caught by the next content edit.
const fingerprint = (value: unknown): string => {
  const text = JSON.stringify(value)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

/** Every authored row, flattened with its fingerprint and its rewrite composer. */
export const seed_sync_rows = (
  sdk_in: Parameters<typeof seed_sdk>[0],
  content: SeedContent
): readonly SeedSyncRow[] => {
  const sdk = seed_sdk(sdk_in)
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  const game_type = game_type_of(sdk)
  const catalog = board_catalog_id(content_root, seed_original)
  const categories = new Map(content.items.map(({ item_type, category }) => [item_type, category] as const))
  const maps = new Map(content.biome_maps.map((map) => [map.world, map]))

  const items: SeedSyncRow[] = content.items.map((item) => {
    const id = item_template_id(content_root, seed_original, item.item_type)
    const box = item.consumable?.type === 'loot_box'
    return Object.freeze({
      key: id,
      label: `item ${item.item_type}`,
      hash: fingerprint(item),
      kind: 'template' as const,
      domain: 'item' as const,
      item: Object.freeze({ category: item.category }),
      chain_id: id,
      addresses: Object.freeze([id]),
      hydrate: box
        ? [
            id,
            ...(item.consumable?.type === 'loot_box'
              ? item.consumable.rewards.map(({ item_type }) => item_template_id(content_root, seed_original, item_type))
              : []),
          ]
        : [id],
      cost: item_cost(item),
      update: (game_sdk, tx, cap, root) => {
        game_sdk.seed_doors.overwrite_item(tx, {
          cap,
          root,
          template: id,
          name: item.name,
          level: item.level,
          pet_foods: [...(item.pet_foods ?? [])],
        })
        replace_item_facts(game_sdk, tx, cap, root, id, item)
        if (box) {
          game_sdk.seed_doors.clear_loot_table(tx, { cap, root, box_template: id })
          box_rewards(game_sdk, tx, cap, root, id, item, content_root, seed_original)
        }
      },
    })
  })

  const spells: SeedSyncRow[] = content.spells.map((spell) => {
    const id = spell_template_id(content_root, seed_original, spell.name)
    return Object.freeze({
      key: id,
      label: `spell ${spell.name}`,
      hash: fingerprint(spell),
      kind: 'template' as const,
      domain: 'spell' as const,
      spell: Object.freeze({ classe: spell.classe, unlock_level: spell.unlock_level }),
      chain_id: id,
      addresses: Object.freeze([id]),
      hydrate: [id],
      cost: spell_cost(spell),
      update: (game_sdk, tx, cap, root) => {
        game_sdk.seed_doors.overwrite_spell(tx, {
          cap,
          root,
          template: id,
          levels: spell.levels.map((level) => level_value(game_sdk, tx, level)),
        })
      },
    })
  })

  const mobs: SeedSyncRow[] = content.mobs.map((mob) => {
    const id = mob_template_id(content_root, seed_original, mob.mob_type)
    return Object.freeze({
      key: id,
      label: `mob ${mob.mob_type}`,
      hash: fingerprint(mob),
      kind: 'template' as const,
      domain: 'mob' as const,
      chain_id: id,
      addresses: Object.freeze([id]),
      hydrate: [id],
      cost: mob_cost(mob),
      update: (game_sdk, tx, cap, root) => {
        game_sdk.seed_doors.overwrite_mob(tx, { cap, root, template: id, data: mob_data_value(game_sdk, tx, mob) })
      },
    })
  })

  const recipes: SeedSyncRow[] = content.recipes.map((recipe) => {
    const id = recipe_id(content_root, seed_original, recipe.output_type)
    const job = recipe_job(categories, recipe)
    return Object.freeze({
      key: id,
      label: `recipe ${recipe.output_type}`,
      // the job derives from the output item's category — a category change retunes the recipe
      hash: fingerprint({ recipe, job }),
      kind: 'template' as const,
      domain: 'recipe' as const,
      chain_id: id,
      addresses: Object.freeze([id]),
      hydrate: [id],
      cost: 4,
      update: (game_sdk, tx, cap, root) => {
        game_sdk.seed_doors.overwrite_recipe(tx, {
          cap,
          root,
          recipe: id,
          ...recipe_input_args(content_root, seed_original, recipe, job),
        })
      },
    })
  })

  const worlds: SeedSyncRow[] = content.worlds.map((world) => {
    const id = world_content_id(content_root, seed_original, world.world)
    const gameplay_id = world_id(content_root, game_type, world.world)
    const map = maps.get(world.world)
    return Object.freeze({
      key: id,
      label: `world ${world.world}`,
      hash: fingerprint({ world, map }),
      kind: 'template' as const,
      domain: 'world' as const,
      chain_id: id,
      addresses: Object.freeze([id, gameplay_id]),
      hydrate: [id, gameplay_id],
      cost: 8 + (map ? 1 + Math.ceil(map.cells.length / 16_381) : 0),
      update: (game_sdk, tx, cap, root) => {
        game_sdk.seed_doors.set_entry_level(tx, { cap, root, wc: id, entry_level: world.entry_level })
        const biome_names = world.terrain?.biomes.map(({ name }) => name) ?? []
        const biome_ids = (names?: readonly string[]): readonly number[] => {
          if (!world.terrain) return [0]
          return (names ?? []).map((name) => {
            const index = biome_names.indexOf(name)
            if (index < 0) throw new Error(`${world.world} references unknown biome ${name}`)
            return index
          })
        }
        const mob_list = Array.isArray(world.mobs)
          ? world.mobs
          : Object.entries(world.mobs).map(([mob_type, weight_bp]) => ({ mob_type, weight_bp, biomes: [] }))
        game_sdk.seed_doors.set_mobs(tx, {
          cap,
          root,
          wc: id,
          rows: mob_list.map((row) =>
            game_sdk.seed_doors.new_mob_row(tx, {
              mob_type: row.mob_type,
              weight_bp: row.weight_bp,
              biomes: biome_ids(row.biomes),
            })
          ),
        })
        game_sdk.seed_doors.set_resources(tx, {
          cap,
          root,
          wc: id,
          rows: world.resources.map((row) =>
            game_sdk.seed_doors.new_resource_row(tx, {
              item_type: row.item_type,
              job: row.job,
              tier: row.tier,
              protector: row.protector,
              rare_item_type: row.rare_item_type,
              biomes: biome_ids(row.biomes),
            })
          ),
        })
        if (map) {
          // setting the window RESETS the stored grid, so the rewrite is create-identical
          game_sdk.seed_doors.set_biome_window(tx, {
            cap,
            root,
            wc: id,
            zone_x0: map.zone_x0,
            zone_z0: map.zone_z0,
            side: map.side,
          })
          for (const cells of slice_chunks(map.cells, 16_381))
            game_sdk.seed_doors.append_biome_cells(tx, { cap, root, wc: id, cells })
        } else game_sdk.seed_doors.clear_biome_map(tx, { cap, root, wc: id })
        game_sdk.seed_doors.set_dungeon_key(tx, { cap, root, wc: id, item_type: world.dungeon.key })
        game_sdk.seed_doors.set_dungeon_rooms(tx, {
          cap,
          root,
          wc: id,
          rooms: world.dungeon.rooms.map((room) =>
            game_sdk.seed_doors.new_dungeon_room(tx, {
              mobs: room.map((mob) => game_sdk.seed_doors.new_room_mob(tx, { mob_type: mob.mob_type })),
            })
          ),
        })
      },
    })
  })

  // boards live at an INDEX in the one shared catalog — the ledger is their identity: a board
  // beyond the last written index is appended, a changed one is replaced in place.
  const boards: SeedSyncRow[] = content.boards.map((board, index) =>
    Object.freeze({
      key: `board:${index}`,
      label: `board #${index}`,
      hash: fingerprint(board),
      kind: 'board' as const,
      domain: 'board' as const,
      chain_id: catalog,
      addresses: Object.freeze([catalog]),
      hydrate: [catalog],
      cost: 2,
      board_source: board,
      update: (game_sdk, tx, cap, root) => {
        const value = board_value(game_sdk, tx, board)
        game_sdk.seed_doors.replace_board(tx, { cap, root, catalog, index, board: value })
      },
    })
  )

  const supply: SeedSyncRow[] = [
    ...content.shop.sales.map((sale) => {
      const id = sale_id(content_root, game_type, sale.item_type)
      return Object.freeze({
        key: id,
        label: `sale ${sale.item_type}`,
        hash: fingerprint(sale),
        kind: 'template' as const,
        domain: 'sale' as const,
        sale: Object.freeze({ infinite: sale.supply === null, supply: sale.supply ?? 0 }),
        chain_id: id,
        addresses: Object.freeze([id]),
        hydrate: [id],
        cost: 1,
        update: (game_sdk: SeedSdk, tx: Transaction, cap: Resolvable, root: Resolvable) =>
          game_sdk.seed_doors.set_sale(tx, {
            cap,
            root,
            sale: id,
            price: BigInt(sale.price) * MIST_PER_SUI,
            enabled: sale.enabled ?? true,
          }),
      })
    }),
    ...content.airdrop.drops.map((drop) =>
      Object.freeze({
        key: airdrop_id(content_root, game_type, drop.id),
        label: `airdrop ${drop.id}`,
        hash: fingerprint(drop),
        kind: 'supply' as const,
        domain: 'airdrop' as const,
        chain_id: airdrop_id(content_root, game_type, drop.id),
        addresses: Object.freeze([airdrop_id(content_root, game_type, drop.id)]),
        hydrate: [],
        cost: 1,
      })
    ),
    ...content.airdrop.giftcards.map((card) =>
      Object.freeze({
        key: giftcard_id(content_root, game_type, card.id),
        label: `gift card ${card.id}`,
        hash: fingerprint(card),
        kind: 'supply' as const,
        domain: 'giftcard' as const,
        chain_id: giftcard_id(content_root, game_type, card.id),
        addresses: Object.freeze([giftcard_id(content_root, game_type, card.id)]),
        hydrate: [],
        cost: 1,
      })
    ),
  ]

  return Object.freeze([...items, ...spells, ...mobs, ...recipes, ...worlds, ...boards, ...supply])
}

/** Sort every row into its bucket. `exists` answers from the hydrated cache. */
/* eslint-disable complexity -- One pure partition reports every domain and immutable identity violation. */
export const seed_sync_view = (
  rows: readonly SeedSyncRow[],
  ledger: SeedLedger,
  exists: (id: string) => boolean,
  board_len = 0
): SeedSyncView => {
  const new_rows: SeedSyncRow[] = []
  const changed: SeedSyncRow[] = []
  const fixed: SeedSyncRow[] = []
  let unchanged = 0
  for (const row of rows) {
    const recorded = ledger[row.key]
    if (row.kind === 'board') {
      // the catalog itself is created by the publish lane; boards wait for it
      if (!exists(row.chain_id)) new_rows.push(row)
      else if (Number(row.key.slice('board:'.length)) >= board_len) changed.push(row)
      else if (recorded?.hash === row.hash) unchanged += 1
      else changed.push(row)
      continue
    }
    if (!exists(row.chain_id)) {
      new_rows.push(row)
      continue
    }
    if (recorded?.hash === row.hash) {
      unchanged += 1
      continue
    }
    if (row.kind === 'supply') fixed.push(row)
    else changed.push(row)
  }
  const current = new Set(rows.map(({ key }) => key))
  const authored_board_len = rows.filter(({ kind }) => kind === 'board').length
  const board_removals = Object.freeze(
    Array.from({ length: Math.max(0, board_len - authored_board_len) }, (_, offset) => {
      const index = authored_board_len + offset
      return Object.freeze({ key: `board:${index}`, label: `board #${index}` })
    })
  )
  for (const [key, entry] of Object.entries(ledger)) {
    if (current.has(key)) continue
    if (entry.domain === 'sale' || entry.label.startsWith('sale '))
      changed.push(
        Object.freeze({
          key,
          label: `retire ${entry.label}`,
          hash: 'retired',
          kind: 'template' as const,
          domain: 'sale' as const,
          chain_id: key,
          addresses: Object.freeze([key]),
          hydrate: Object.freeze([key]),
          cost: 1,
          update: (game_sdk: SeedSdk, tx: Transaction, cap: Resolvable, root: Resolvable) =>
            game_sdk.seed_doors.set_sale(tx, { cap, root, sale: key, price: 0n, enabled: false }),
        })
      )
    else if (entry.domain === 'recipe' || entry.label.startsWith('recipe '))
      changed.push(
        Object.freeze({
          key,
          label: `retire ${entry.label}`,
          hash: 'retired',
          kind: 'template' as const,
          domain: 'recipe' as const,
          chain_id: key,
          addresses: Object.freeze([key]),
          hydrate: Object.freeze([key]),
          cost: 1,
          update: (game_sdk: SeedSdk, tx: Transaction, cap: Resolvable, root: Resolvable) =>
            game_sdk.seed_doors.retire_recipe(tx, { cap, root, recipe: key }),
        })
      )
  }
  const removed = Object.entries(ledger)
    .filter(
      ([key, entry]) =>
        !current.has(key) &&
        !key.startsWith('board:') &&
        !(entry.domain === 'sale' || entry.label.startsWith('sale ')) &&
        !(entry.domain === 'recipe' || entry.label.startsWith('recipe '))
    )
    .map(([key, { label }]) => Object.freeze({ key, label }))
  const errors: string[] = []
  // a spell object IS part of its class's kit forever — dropping the row cannot take it back
  for (const [key, entry] of Object.entries(ledger))
    if (!current.has(key) && (entry.domain === 'spell' || entry.label.startsWith('spell ')))
      errors.push(
        `${entry.label} was removed from the files, but a written spell stays in its class's kit forever — restore the row and rebalance it instead`
      )
  // item category and spell class are identity; their overwrite doors deliberately omit them
  for (const row of changed) {
    const recorded = ledger[row.key]
    if (row.domain === 'item' && row.item && recorded?.item && recorded.item.category !== row.item.category)
      errors.push(
        `${row.label} moved from category ${recorded.item.category} to ${row.item.category} — an item keeps its category forever`
      )
    if (
      row.domain === 'sale' &&
      row.sale &&
      recorded?.sale &&
      (recorded.sale.infinite !== row.sale.infinite || recorded.sale.supply !== row.sale.supply)
    )
      errors.push(`${row.label} changed its immutable supply policy — create another item sale instead`)
    if (row.domain === 'spell' && row.spell && recorded?.spell) {
      if (recorded.spell.classe !== row.spell.classe)
        errors.push(
          `${row.label} moved from ${recorded.spell.classe} to ${row.spell.classe} — a written spell keeps its class forever`
        )
      if (recorded.spell.unlock_level !== undefined && recorded.spell.unlock_level !== row.spell.unlock_level)
        errors.push(
          `${row.label} moved from unlock level ${recorded.spell.unlock_level} to ${row.spell.unlock_level} — a written spell keeps its slot on the ladder`
        )
    }
  }
  return Object.freeze({
    new_rows: Object.freeze(new_rows),
    changed: Object.freeze(changed),
    board_removals,
    removed: Object.freeze(removed),
    fixed: Object.freeze(fixed),
    unchanged,
    errors: Object.freeze(errors),
  })
}
/* eslint-enable complexity */

/** The rewrite transactions for the changed rows, packed under the command ceiling. A board
 * beyond the last written index APPENDS (the catalog grows in file order); every other
 * changed board replaces in place. */
export const seed_update_transactions = (
  sdk_in: Parameters<typeof seed_sdk>[0],
  rows: readonly SeedSyncRow[],
  context: Readonly<{ admin_cap: Resolvable; content_root: Resolvable }>,
  boards: Readonly<{ chain_len: number; authored_len: number }> = { chain_len: 0, authored_len: 0 }
): readonly Transaction[] => {
  const sdk = seed_sdk(sdk_in)
  const content_root = content_root_id_of(sdk)
  const seed_original = package_id_of(sdk, 'seed_package_original')
  const catalog = board_catalog_id(content_root, seed_original)
  const updates = pack(
    rows,
    ({ cost }) => cost,
    undefined,
    ({ label }) => label
  ).map((group, index) => {
    const tx = sdk.tx()
    for (const row of group) {
      if (row.kind === 'board' && Number(row.key.slice('board:'.length)) >= boards.chain_len && row.board_source) {
        const board = board_value(sdk, tx, row.board_source)
        sdk.seed_doors.add_board(tx, { cap: context.admin_cap, root: context.content_root, catalog, board })
      } else row.update?.(sdk, tx, context.admin_cap, context.content_root)
    }
    return bounded_transaction(tx, `changes:${index}`)
  })
  if (boards.chain_len <= boards.authored_len) return updates
  const tx = sdk.tx()
  let remaining = boards.chain_len - boards.authored_len
  while (remaining > 0) {
    sdk.seed_doors.remove_last_board(tx, { cap: context.admin_cap, root: context.content_root, catalog })
    remaining -= 1
  }
  return Object.freeze([...updates, bounded_transaction(tx, 'boards:remove')])
}

/** The ledger as it stands after a successful apply: every current row that now exists and
 * matches its file, fingerprinted; dropped rows leave the ledger with the files. */
export const seed_ledger_after = (
  rows: readonly SeedSyncRow[],
  ledger: SeedLedger,
  written: ReadonlySet<string>,
  exists: (id: string) => boolean
): SeedLedger =>
  Object.freeze(
    Object.fromEntries(
      rows
        .filter((row) => written.has(row.key) || (exists(row.chain_id) && ledger[row.key]?.hash === row.hash))
        .map((row) => [
          row.key,
          Object.freeze({
            hash: row.hash,
            label: row.label,
            addresses: row.addresses,
            domain: row.domain,
            ...(row.item ? { item: row.item } : {}),
            ...(row.sale ? { sale: row.sale } : {}),
            ...(row.spell ? { spell: row.spell } : {}),
          }),
        ])
    )
  )
