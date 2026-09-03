// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHECK-CHANGES compares authored JSON with the last chain write and composes rebalance doors.
// pins.json owns derived addresses, fingerprints, and immutable identity facts by Registry root.
// New rows publish, changed rows rewrite, and omitted recipes retire. Other removals stay
// visible because their chain objects persist. One-shot airdrops and giftcards cannot be rewritten.

import type { Transaction } from '@mysten/sui/transactions'

import { canonical_json } from './canonical_json.ts'
import type { Resolvable } from './client.ts'
import {
  board_value,
  box_rewards,
  content_root_id_of,
  dungeon_data_value,
  game_type_of,
  item_cost,
  replace_item_facts,
  level_value,
  mob_cost,
  mob_data_value,
  package_id_of,
  recipe_door_args,
  recipe_input_args,
  recipe_job,
  seed_sdk,
  slice_chunks,
  spell_cost,
  world_content_values,
  type SeedSdk,
} from './seed.ts'
import {
  airdrop_id,
  board_catalog_id,
  dungeon_content_id,
  giftcard_id,
  item_template_id,
  mastery_offer_id,
  mob_template_id,
  recipe_id,
  spell_template_id,
  world_content_id,
  world_id,
} from './seed_ids.ts'
import type { SeedBoard, SeedContent } from './seed_types.ts'
import { retired_seed_row } from './seed_retirements.ts'

/** One ledger entry: the fingerprint of the row as last written, plus immutable identity facts. */
export type SeedLedger = Readonly<
  Record<
    string,
    Readonly<{
      hash: string
      label: string
      /** Every chain object address this authored identity owns. */
      addresses?: readonly string[]
      /** Chain revisions observed after the authored value was written. */
      revisions?: Readonly<Record<string, string>>
      domain?: string
      item?: Readonly<{ category: string }>
      spell?: Readonly<{ classe: string; unlock_level?: number }>
      world?: Readonly<{ cities: readonly string[] }>
    }>
  >
>

export type SeedSyncRow = Readonly<{
  /** ledger key — a chain object id for most rows, `board:N` for boards */
  key: string
  label: string
  hash: string
  kind: 'template' | 'board' | 'supply'
  domain: 'item' | 'spell' | 'mob' | 'recipe' | 'dungeon' | 'world' | 'board' | 'mastery_offer' | 'airdrop' | 'giftcard'
  item?: Readonly<{ category: string }>
  /** spell rows carry their immutable class so the ledger can refuse illegal rewrites */
  spell?: Readonly<{ classe: string; unlock_level: number }>
  world?: Readonly<{ cities: readonly string[] }>
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

export const created_seed_row_keys = (
  rows: readonly Pick<SeedSyncRow, 'key' | 'kind' | 'addresses'>[],
  ledger: SeedLedger,
  targets: ReadonlySet<string>,
  exists: (id: string) => boolean
): ReadonlySet<string> =>
  new Set(
    rows
      .filter(
        (row) =>
          row.kind !== 'board' &&
          !ledger[row.key] &&
          row.addresses.length > 0 &&
          row.addresses.every((address) => targets.has(address) && exists(address))
      )
      .map(({ key }) => key)
  )

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

export { canonical_json } from './canonical_json.ts'

// FNV-1a 64-bit over canonical JSON — collisions are ~impossible at this corpus size,
// and a collision's worst case is one missed rewrite caught by the next content edit.
const fingerprint = (value: unknown): string => {
  const text = canonical_json(value)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

type LedgerEntry = SeedLedger[string]

const item_identity_error = (row: SeedSyncRow, recorded: LedgerEntry | undefined): string | null =>
  row.domain === 'item' && row.item && recorded?.item && recorded.item.category !== row.item.category
    ? `${row.label} moved from category ${recorded.item.category} to ${row.item.category} — an item keeps its category forever`
    : null

const spell_identity_errors = (row: SeedSyncRow, recorded: LedgerEntry | undefined): readonly string[] => {
  if (row.domain !== 'spell' || !row.spell || !recorded?.spell) return []
  const errors: string[] = []
  if (recorded.spell.classe !== row.spell.classe)
    errors.push(
      `${row.label} moved from ${recorded.spell.classe} to ${row.spell.classe} — a written spell keeps its class forever`
    )
  if (recorded.spell.unlock_level !== undefined && recorded.spell.unlock_level !== row.spell.unlock_level)
    errors.push(
      `${row.label} moved from unlock level ${recorded.spell.unlock_level} to ${row.spell.unlock_level} — a written spell keeps its slot on the ladder`
    )
  return Object.freeze(errors)
}

const world_identity_errors = (row: SeedSyncRow, recorded: LedgerEntry | undefined): readonly string[] => {
  if (row.domain !== 'world' || !row.world || !recorded?.world) return []
  const removed = recorded.world.cities.filter((city) => !row.world!.cities.includes(city))
  return removed.length
    ? [
        `${row.label} removed or renamed stable city ${removed.join(', ')} — restore it and edit its mutable fields instead`,
      ]
    : []
}

const immutable_identity_errors = (row: SeedSyncRow, recorded: LedgerEntry | undefined): readonly string[] =>
  Object.freeze(
    [item_identity_error(row, recorded)]
      .filter((error): error is string => error !== null)
      .concat(spell_identity_errors(row, recorded), world_identity_errors(row, recorded))
  )

const removed_identity_errors = (ledger: SeedLedger, current: ReadonlySet<string>): readonly string[] =>
  Object.entries(ledger).flatMap(([key, entry]) => {
    if (current.has(key)) return []
    if (entry.domain === 'spell' || entry.label.startsWith('spell '))
      return [
        `${entry.label} was removed from the files, but a written spell stays in its class's kit forever — restore the row and rebalance it instead`,
      ]
    if (entry.domain === 'dungeon' || entry.label.startsWith('dungeon '))
      return [
        `${entry.label} was removed or renamed, but a published dungeon keeps its stable slug forever — restore the row and edit its rooms instead`,
      ]
    return []
  })

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

  const dungeons: SeedSyncRow[] = content.dungeons.map((dungeon) => {
    const id = dungeon_content_id(content_root, seed_original, dungeon.dungeon)
    return Object.freeze({
      key: id,
      label: `dungeon ${dungeon.dungeon}`,
      hash: fingerprint(dungeon),
      kind: 'template' as const,
      domain: 'dungeon' as const,
      chain_id: id,
      addresses: Object.freeze([id]),
      hydrate: [id],
      cost: 3 + dungeon.rooms.reduce((total, room) => total + room.length + 1, 0),
      update: (game_sdk, tx, cap, root) => {
        const data = dungeon_data_value(game_sdk, tx, dungeon)
        game_sdk.seed_doors.overwrite_dungeon(tx, { cap, root, dungeon: id, name: dungeon.dungeon, data })
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
      world: Object.freeze({ cities: Object.freeze(world.cities.map(({ city }) => city)) }),
      chain_id: id,
      addresses: Object.freeze([id, gameplay_id]),
      hydrate: [id, gameplay_id],
      cost: 9 + world.archis.length + (map ? 1 + Math.ceil(map.cells.length / 16_381) : 0),
      update: (game_sdk, tx, cap, root) => {
        game_sdk.seed_doors.set_entry_level(tx, { cap, root, world_content: id, entry_level: world.entry_level })
        const { cities, mob_rows, archi_rows, resource_rows } = world_content_values(
          game_sdk,
          tx,
          world,
          content_root,
          seed_original
        )
        game_sdk.seed_doors.set_cities(tx, { cap, root, world_content: id, cities })
        game_sdk.seed_doors.set_mobs(tx, { cap, root, world_content: id, rows: mob_rows })
        game_sdk.seed_doors.set_archi_rows(tx, { cap, root, world_content: id, rows: archi_rows })
        game_sdk.seed_doors.set_resources(tx, { cap, root, world_content: id, rows: resource_rows })
        if (map) {
          // setting the window RESETS the stored grid, so the rewrite is create-identical
          game_sdk.seed_doors.set_biome_window(tx, {
            cap,
            root,
            world_content: id,
            zone_x0: map.zone_x0,
            zone_z0: map.zone_z0,
            side: map.side,
          })
          for (const cells of slice_chunks(map.cells, 16_381))
            game_sdk.seed_doors.append_biome_cells(tx, { cap, root, world_content: id, cells })
        } else game_sdk.seed_doors.clear_biome_map(tx, { cap, root, world_content: id })
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
    ...content.mastery.offers.map((offer) => {
      const id = mastery_offer_id(content_root, game_type, offer.item_type)
      return Object.freeze({
        key: id,
        label: `mastery offer ${offer.item_type}`,
        hash: fingerprint(offer),
        kind: 'template' as const,
        domain: 'mastery_offer' as const,
        chain_id: id,
        addresses: Object.freeze([id]),
        hydrate: Object.freeze([id]),
        cost: 1,
        update: (game_sdk: SeedSdk, tx: Transaction, cap: Resolvable, root: Resolvable) =>
          game_sdk.seed_doors.set_mastery_offer(tx, {
            cap,
            root,
            offer: id,
            cost: offer.cost,
            enabled: offer.enabled ?? true,
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

  return Object.freeze([...items, ...spells, ...mobs, ...recipes, ...dungeons, ...worlds, ...boards, ...supply])
}

/** Sort every row into its bucket. `exists` answers from the hydrated cache. */
type RowState = 'new' | 'changed' | 'fixed' | 'unchanged'

const board_state = (
  row: SeedSyncRow,
  recorded: SeedLedger[string] | undefined,
  exists: (id: string) => boolean,
  board_len: number
): RowState => {
  if (!exists(row.chain_id)) return 'new'
  if (Number(row.key.slice('board:'.length)) >= board_len) return 'changed'
  return recorded?.hash === row.hash ? 'unchanged' : 'changed'
}

const revisions_match = (
  row: SeedSyncRow,
  recorded: SeedLedger[string] | undefined,
  revision: (id: string) => string | null
): boolean =>
  row.kind === 'supply' ||
  (recorded?.revisions !== undefined &&
    row.addresses.every((address) => recorded.revisions?.[address] === revision(address)))

const content_state = (
  row: SeedSyncRow,
  recorded: SeedLedger[string] | undefined,
  exists: (id: string) => boolean,
  revision: (id: string) => string | null
): RowState => {
  if (!exists(row.chain_id)) return 'new'
  if (recorded?.hash === row.hash && revisions_match(row, recorded, revision)) return 'unchanged'
  return row.kind === 'supply' ? 'fixed' : 'changed'
}

export const seed_sync_view = (
  rows: readonly SeedSyncRow[],
  ledger: SeedLedger,
  exists: (id: string) => boolean,
  board_len = 0,
  revision: (id: string) => string | null = () => null
): SeedSyncView => {
  const new_rows: SeedSyncRow[] = []
  const changed: SeedSyncRow[] = []
  const fixed: SeedSyncRow[] = []
  let unchanged = 0
  for (const row of rows) {
    const recorded = ledger[row.key]
    const state =
      row.kind === 'board'
        ? board_state(row, recorded, exists, board_len)
        : content_state(row, recorded, exists, revision)
    if (state === 'new') new_rows.push(row)
    else if (state === 'changed') changed.push(row)
    else if (state === 'fixed') fixed.push(row)
    else unchanged += 1
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
    const retirement = retired_seed_row(key, entry)
    if (retirement) changed.push(retirement)
  }
  const removed = Object.entries(ledger)
    .filter(
      ([key, entry]) =>
        !current.has(key) &&
        !key.startsWith('board:') &&
        !(entry.domain === 'sale' || entry.label.startsWith('sale ')) &&
        !(entry.domain === 'mastery_offer' || entry.label.startsWith('mastery offer ')) &&
        !(entry.domain === 'recipe' || entry.label.startsWith('recipe '))
    )
    .map(([key, { label }]) => Object.freeze({ key, label }))
  const errors = [...removed_identity_errors(ledger, current)]
  for (const row of changed) errors.push(...immutable_identity_errors(row, ledger[row.key]))
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

export { seed_ledger_after, seed_ledger_after_batch } from './seed_ledger.ts'
