// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE SEEDING — the whole one-time content publish in one file. Each batch transaction:
/// `begin_batch` (Publisher-gated hot potato) → N × (`new_template` → `set_stats` →
/// `set_damages` → `freeze`) → `destroy_seed_cap`. The final transaction calls `seal` — after
/// that, `begin_batch` aborts for eternity: the content set is a sealed artifact, zero admin
/// power over content remains on-chain. Admin doors are Publisher-gated, never version-gated.
module aresrpg::seed;

use aresrpg::{
  crafting::{Self, Recipe},
  item::{Self, Item, ItemTemplate, TemplateRegistry},
  loot_box::{Self, LootRegistry},
  mob_template::{Self, LootEntry, MobSpell, MobTemplate},
  shop::{Self, Giftcard},
  spell_template::{Self, SpellTemplate},
  world::{Self, DungeonRoom, MobRow, ResourceRow, World},
};
use aresrpg_math::{item_damages::ItemDamages, item_stats::ItemStatistics, spell_effect::SpellLevel};
use std::string::String;
use sui::package::Publisher;

const ESealed: u64 = 401;
const ENotPublisher: u64 = 402;

/// The seeding key — a HOT POTATO (no abilities): born from `begin_batch`, it cannot be
/// stored, dropped, or transferred; the same transaction MUST end it with `destroy_seed_cap`.
public struct SeedCap {}

/// Open one seeding batch. Publisher-gated; aborts forever once sealed.
public fun begin_batch(publisher: &Publisher, registry: &TemplateRegistry): SeedCap {
  assert!(publisher.from_package<Item>(), ENotPublisher);
  assert!(!item::is_sealed(registry), ESealed);
  SeedCap {}
}

/// Mint a template at its `item_type`-derived address. Key-only (no store): the transaction
/// cannot end while it lives — attach, then `freeze_template` is its single exit.
public fun new_item_template(
  _: &SeedCap,
  registry: &mut TemplateRegistry,
  name: String,
  item_type: String,
  category: String,
  level: u8,
): ItemTemplate {
  item::new_template(registry, name, item_type, category, level)
}

/// Author the stat ranges (gear only; every min ≤ max asserted before any freeze).
public fun set_stats(template: &mut ItemTemplate, min: ItemStatistics, max: ItemStatistics) {
  item::set_template_stats(template, min, max);
}

/// Author the damage lines (weapons).
public fun set_damages(template: &mut ItemTemplate, lines: vector<ItemDamages>) {
  item::set_template_damages(template, lines);
}

/// Author a consumable's effect (kind 0..3, power). Consumable-category templates only.
public fun set_consumable(template: &mut ItemTemplate, kind: u8, power: u32) {
  item::set_template_consumable(template, kind, power);
}

/// Seal one template forever — the chain rejects every future write, from anyone.
public fun freeze_item_template(template: ItemTemplate) {
  item::freeze_template(template);
}

/// Mint a mob template at its `mob_type`-derived address — key-only like the item template:
/// `freeze_mob_template` is its single exit.
public fun new_mob_template(
  _: &SeedCap,
  registry: &mut TemplateRegistry,
  name: String,
  mob_type: String,
  element: String,
  level_min: u8,
  level_max: u8,
  hp: u64,
  ap: u8,
  mp: u8,
  agility: u16,
  wisdom: u16,
  earth_resistance: u16,
  fire_resistance: u16,
  water_resistance: u16,
  air_resistance: u16,
  spells: vector<MobSpell>, // rows via `mob_template::new_mob_spell` — the kit freezes here
  loot: vector<LootEntry>,
  xp: u64,
): MobTemplate {
  mob_template::new(
    registry, name, mob_type, element, level_min, level_max, hp, ap, mp, agility, wisdom,
    earth_resistance, fire_resistance, water_resistance, air_resistance, spells, loot, xp,
  )
}

public fun freeze_mob_template(template: MobTemplate) {
  mob_template::freeze_template(template);
}

/// Mint a spell at its name-derived address — key-only: `freeze_spell` is its single exit.
/// Levels compose from `spell_effect::new_effect` / `new_spell_level` in the seeding PTB.
public fun new_spell(
  _: &SeedCap,
  registry: &mut TemplateRegistry,
  name: String,
  classe: String,
  unlock_level: u8,
  levels: vector<SpellLevel>,
): SpellTemplate {
  spell_template::new(registry, name, classe, unlock_level, levels)
}

public fun freeze_spell(template: SpellTemplate) {
  spell_template::freeze_template(template);
}

/// Mint a recipe at its output-type-derived address — key-only like every template:
/// `freeze_recipe` is its single exit; the seal closes this door with the rest.
/// `required_level` derives from the slot count inside crafting — never authored.
public fun new_recipe(
  _: &SeedCap,
  registry: &mut TemplateRegistry,
  output_type: String,
  output_template: ID,
  output_quantity: u32,
  input_templates: vector<ID>,
  input_quantities: vector<u64>,
  job: String,
  craft_xp: u64,
): Recipe {
  crafting::new_recipe(
    registry, output_type, output_template, output_quantity, input_templates,
    input_quantities, job, craft_xp,
  )
}

public fun freeze_recipe(recipe: Recipe) {
  crafting::freeze_recipe(recipe);
}

/// Mint + share a SALE at its item-type-derived address — sales are frozen content: no
/// admin door ever touches one after this seeding call; only its supply counts down.
public fun new_sale(
  _: &SeedCap,
  registry: &mut TemplateRegistry,
  item_type: String,
  template: ID,
  price: u64,
  supply: u64,
) {
  shop::new_sale(registry, item_type, template, price, supply);
}

/// Author a gacha box's weighted item pool (any item types). SeedCap-gated, so it's seeding-only
/// and frozen once sealed — no live admin door.
public fun set_loot_table(
  _: &SeedCap,
  registry: &mut LootRegistry,
  box_template: ID,
  item_templates: vector<ID>,
  weights: vector<u64>,
) {
  loot_box::set_loot_table(registry, box_template, item_templates, weights);
}

/// Open an airdrop over its snapshotted whitelist — supply introduction, so it seals with
/// the seeding like every other mint door.
public fun new_airdrop(
  _: &SeedCap,
  template: ID,
  amount_each: u32,
  whitelist: vector<address>,
  ctx: &mut TxContext,
) {
  shop::new_airdrop(template, amount_each, whitelist, ctx);
}

/// Mint a giftcard voucher (returned — the seeding PTB holds it for later zksend links).
public fun new_giftcard(_: &SeedCap, template: ID, amount: u32, ctx: &mut TxContext): Giftcard {
  shop::new_giftcard(template, amount, ctx)
}

/// Author a world's mob families (rows via `world::new_mob_row`). Overwrite legal until the seal.
public fun set_world_mobs(_: &SeedCap, world: &mut World, rows: vector<MobRow>) {
  world::set_mobs(world, rows);
}

/// Author a world's resources (rows via `world::new_resource_row`).
public fun set_world_resources(_: &SeedCap, world: &mut World, rows: vector<ResourceRow>) {
  world::set_resources(world, rows);
}

/// Tie the world's dungeon key item (the dungeon system reads it later).
public fun set_world_dungeon_key(_: &SeedCap, world: &mut World, item_type: String) {
  world::set_dungeon_key(world, item_type);
}

/// Author the world's dungeon room sequence (rows via `world::new_dungeon_room` /
/// `new_room_mob`; the last room carries the boss). Overwrite legal until the seal.
public fun set_world_dungeon_rooms(_: &SeedCap, world: &mut World, rooms: vector<DungeonRoom>) {
  world::set_dungeon_rooms(world, rooms);
}

/// End the batch — the hot potato's only exit.
public fun destroy_seed_cap(cap: SeedCap) {
  let SeedCap {} = cap;
}

/// The seeding's final command: after this, `begin_batch` aborts for eternity.
public fun seal(publisher: &Publisher, registry: &mut TemplateRegistry) {
  assert!(publisher.from_package<Item>(), ENotPublisher);
  item::seal(registry);
}
