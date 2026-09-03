// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Transaction } from '@mysten/sui/transactions'
import type {
  CharacterConsumableType,
  ClassName,
  ElementName,
  ItemCategory,
  JobSlug,
  StatName,
} from '@aresrpg/immutable'

import type { Resolvable, Sdk } from './client.ts'

export type SeedEffect = Readonly<{
  kind: number
  element: ElementName | ''
  value: number
  value_max: number
  area_shape: number
  area_size: number
  target_filter: number
  chance_bp: number
  turns: number
  stat: number
}>

export type SeedSpellLevel = Readonly<{
  ap_cost: number
  range_min: number
  range_max: number
  modifiable_range: boolean
  line_of_sight: boolean
  line_launch: boolean
  free_cell: boolean
  casts_per_turn: number
  casts_per_target: number
  cooldown_turns: number
  crit_1_in: number
  effects: readonly SeedEffect[]
  crit_effects: readonly SeedEffect[]
}>

export type SeedConsumable =
  | Readonly<{ type: 'heal'; amount: number }>
  | Readonly<{ type: Exclude<CharacterConsumableType, 'heal' | 'city'> }>
  | Readonly<{ type: 'city'; city: string }>
  | Readonly<{
      type: 'loot_box'
      rewards: readonly Readonly<{ item_type: string; weight: number; amount: number }>[]
    }>

export type SeedItem = Readonly<{
  item_type: string
  name: string
  category: ItemCategory
  level: number
  pet_foods?: readonly string[]
  pet_movement?: 'walk' | 'swim' | 'fly'
  stats?: Readonly<{ min: Readonly<Record<StatName, number>>; max: Readonly<Record<StatName, number>> }>
  damages?: readonly Readonly<{ from: number; to: number; damage_type: string; element: ElementName }>[]
  consumable?: SeedConsumable
}>

export type SeedSpell = Readonly<{
  name: string
  classe: ClassName
  unlock_level: number
  levels: readonly SeedSpellLevel[]
}>

export type SeedMob = Readonly<{
  mob_type: string
  name: string
  /** Authored taxonomy only; family placement and filters derive from seed content, not chain state. */
  family: string
  element: ElementName
  role: string
  level_min: number
  level_max: number
  hp: number
  ap: number
  mp: number
  agility: number
  wisdom: number
  resistances: Readonly<Record<string, number>>
  spells: readonly Readonly<{ name: string; levels: readonly SeedSpellLevel[] }>[]
  loot: readonly Readonly<{ item_type: string; chance_bp: number; min_qty: number; max_qty: number }>[]
  xp: number
}>

export type SeedRecipe = Readonly<{
  output_type: string
  inputs: Readonly<Record<string, number>>
  job?: JobSlug
}>

export type SeedWorld = Readonly<{
  world: string
  entry_level: number
  archis: readonly Readonly<{ ordinary_type: string; archi_type: string }>[]
  cities: readonly Readonly<{ city: string; x: number; z: number; dungeon: string }>[]
  terrain?: Readonly<{ biomes: readonly Readonly<{ name: string }>[] }>
  mobs:
    | readonly Readonly<{
        mob_type: string
        weight_bp: number
        biomes: readonly string[]
        cities?: readonly string[]
      }>[]
    | Readonly<Record<string, number>>
  resources: readonly Readonly<{
    item_type: string
    job: JobSlug
    tier: number
    protector: string
    rare_item_type: string
    biomes?: readonly string[]
    cities?: readonly string[]
  }>[]
}>

export type SeedDungeon = Readonly<{
  dungeon: string
  key: string
  rooms: readonly (readonly Readonly<{ mob_type: string }>[])[]
}>

/** One authored fight board — a row of seed/content/fight_boards.json. Boards live at an
 * INDEX in the shared catalog (no per-board object), so the sync ledger is their identity. */
export type SeedBoard = Readonly<{
  width: number
  height: number
  shape_mask: readonly string[]
  obstacles: readonly number[]
  holes: readonly number[]
  start_cells_a: readonly number[]
  start_cells_b: readonly number[]
}>

export type SeedBiomeMap = Readonly<{
  world: string
  zone_x0: number
  zone_z0: number
  side: number
  cells: readonly number[]
}>

export type SeedContent = Readonly<{
  items: readonly SeedItem[]
  spells: readonly SeedSpell[]
  mobs: readonly SeedMob[]
  recipes: readonly SeedRecipe[]
  dungeons: readonly SeedDungeon[]
  worlds: readonly SeedWorld[]
  mastery: Readonly<{
    offers: readonly Readonly<{ item_type: string; cost: number; enabled?: boolean }>[]
  }>
  airdrop: Readonly<{
    drops: readonly Readonly<{ id: string; item_type: string; amount_each: number; whitelist: readonly string[] }>[]
    giftcards: readonly Readonly<{ id: string; item_type: string; amount: number; custody: string }>[]
  }>
  biome_maps: readonly SeedBiomeMap[]
  boards: readonly SeedBoard[]
}>

export type SeedPhase =
  | 'items'
  | 'loot_boxes'
  | 'spells'
  | 'mobs'
  | 'recipes'
  | 'mastery_offers'
  | 'dungeons'
  | 'worlds'
  | 'boards'
  | 'supply'

export type SeedBuildContext = Readonly<{
  /** the control package's one AdminCap — every content door writes through it */
  admin_cap: Resolvable
  /** the seed package's Registry root (revision + freeze + derivation parent) */
  content_root: Resolvable
}>

export type SeedBatch = Readonly<{
  id: string
  phase: SeedPhase
  target_ids: readonly string[]
  dependencies: readonly string[]
  build: (context: SeedBuildContext, existing: ReadonlySet<string>) => Transaction | null
}>

export type SeedPlan = Readonly<{
  batches: readonly SeedBatch[]
}>
