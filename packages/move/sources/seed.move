// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE SEEDING — the whole one-time content publish in one file. Each batch transaction:
/// `begin_batch` (epoch-bound AdminCap hot potato) → N × (`new_template` → `set_stats` →
/// `set_damages` → `freeze`) → `destroy_seed_cap`. The final transaction calls `seal` — after
/// that, `begin_batch` aborts for eternity: the content set is a sealed artifact, zero admin
/// power over content remains on-chain. Any current AdminCap may finish the session it started.
module aresrpg::seed;

use aresrpg::{
  admin::AdminCap,
  consumable,
  crafting::{Self, Recipe},
  item::{Self, Item, ItemTemplate, TemplateRegistry},
  loot_box::{Self, LootRegistry},
  mob_template::{Self, MobTemplate},
  shop::{Self, Giftcard},
  spell_template::{Self, SpellTemplate},
  world::{Self, World},
};
use aresrpg_math::{
  item_damages::ItemDamages,
  item_stats::ItemStatistics,
  mob_data::{Self, LootEntry, MobSpell},
  spell_effect::SpellLevel,
  world_map::{Self, DungeonRoom, MobRow, ResourceRow},
};
use std::string::String;
use sui::derived_object;

const ESealed: u64 = 401;
const EIncompleteLootBox: u64 = 403;

/// The seeding key — a HOT POTATO (no abilities): born from `begin_batch`, it cannot be
/// stored, dropped, or transferred; the same transaction MUST end it with `destroy_seed_cap`.
public struct SeedCap {}

/// Deterministic receipts for the two seed operations whose results are writes to existing
/// objects. They make seeding progress chain-observable like every derived content object.
public struct WorldSeedKey(String) has copy, drop, store;
public struct SealKey(String) has copy, drop, store;
public struct WorldSeedMarker has key { id: UID }
public struct SealMarker has key { id: UID }

/// Open one seeding batch. Current-epoch temp caps support a local publishing session;
/// the permanent super cap works too. Both abort forever once content is sealed.
public fun begin_batch(admin: &AdminCap, registry: &mut TemplateRegistry, ctx: &TxContext): SeedCap {
  admin.verify(ctx);
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
  pet_foods: vector<String>,
): ItemTemplate {
  item::new_template(registry, name, item_type, category, level, pet_foods)
}

/// Author the stat ranges (gear only; every min ≤ max asserted before any freeze).
public fun set_stats(template: &mut ItemTemplate, min: ItemStatistics, max: ItemStatistics) {
  item::set_template_stats(template, min, max);
}

/// Author the damage lines (weapons).
public fun set_damages(template: &mut ItemTemplate, lines: vector<ItemDamages>) {
  item::set_template_damages(template, lines);
}

public fun set_consumable_heal(template: &mut ItemTemplate, amount: u32) { consumable::set_heal(template, amount); }
public fun set_consumable_reset_stats(template: &mut ItemTemplate) { consumable::set_reset_stats(template); }
public fun set_consumable_reset_spells(template: &mut ItemTemplate) { consumable::set_reset_spells(template); }
public fun set_consumable_recall(template: &mut ItemTemplate) { consumable::set_recall(template); }
public fun set_consumable_loot_box(template: &mut ItemTemplate) { consumable::set_loot_box(template); }

/// Seal one template forever — the chain rejects every future write, from anyone.
public fun freeze_item_template(template: ItemTemplate) {
  assert!(!consumable::is_loot_box(&template), EIncompleteLootBox);
  item::freeze_template(template);
}

public fun freeze_loot_box_template(template: ItemTemplate, loot_registry: &mut LootRegistry) {
  assert!(consumable::is_loot_box(&template) && loot_box::has_valid_table(loot_registry, &template), EIncompleteLootBox);
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
  spells: vector<MobSpell>, // rows via `mob_data::new_mob_spell` — the kit freezes here
  loot: vector<LootEntry>,
  xp: u64,
): MobTemplate {
  mob_template::new(registry, mob_data::new_mob_data(
    name, mob_type, element, level_min, level_max, hp, ap, mp, agility, wisdom,
    earth_resistance, fire_resistance, water_resistance, air_resistance, spells, loot, xp,
  ))
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
/// Knowledge and XP derive from the slot count inside crafting; success always mints one output.
public fun new_recipe(
  _: &SeedCap,
  registry: &mut TemplateRegistry,
  output_type: String,
  output_template: ID,
  input_templates: vector<ID>,
  input_quantities: vector<u64>,
  job: String,
): Recipe {
  crafting::new_recipe(
    registry, output_type, output_template, input_templates, input_quantities, job,
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

/// Add one loot-box reward. Object references prove both templates exist; the loot module checks
/// box identity, positive quantity, and stackability before the box can be frozen.
public fun add_loot_reward(
  _: &SeedCap,
  registry: &mut LootRegistry,
  box_template: &ItemTemplate,
  reward_template: &ItemTemplate,
  weight: u64,
  amount: u32,
) {
  loot_box::add_loot_reward(registry, box_template, reward_template, weight, amount);
}

/// Open an airdrop over its snapshotted whitelist — supply introduction, so it seals with
/// the seeding like every other mint door.
public fun new_airdrop(
  _: &SeedCap,
  registry: &mut TemplateRegistry,
  drop_id: String,
  template: &ItemTemplate,
  amount_each: u32,
  whitelist: vector<address>,
) {
  shop::new_airdrop(registry, drop_id, item::template_id(template), amount_each, whitelist);
}

/// Mint a giftcard voucher (returned — the seeding PTB holds it for later zksend links).
public fun new_giftcard(
  _: &SeedCap,
  registry: &mut TemplateRegistry,
  card_id: String,
  template: &ItemTemplate,
  amount: u32,
): Giftcard {
  shop::new_giftcard(registry, card_id, item::template_id(template), amount)
}

/// Author a world's mob families (rows via `world_map::new_mob_row`). Overwrite legal until the seal.
public fun set_world_mobs(_: &SeedCap, world: &mut World, rows: vector<MobRow>) {
  world_map::set_mobs(world::content_mut(world), rows);
}

/// Author a world's biome map — one biome id per zone, derived from the terrain recipe by
/// the engine's own sampler. The full map exceeds the pure-argument cap, so the seeding
/// declares the window, then appends ≤16,384-byte cell slices — ALL IN ONE PTB (reads abort
/// on a half-filled map). Overwrite legal until the seal: re-declaring the window restarts.
public fun set_world_biome_window(_: &SeedCap, world: &mut World, zone_x0: u32, zone_z0: u32, side: u16) {
  world_map::set_biome_map_window(world::content_mut(world), zone_x0, zone_z0, side);
}

public fun append_world_biome_cells(_: &SeedCap, world: &mut World, cells: vector<u8>) {
  world_map::append_biome_map_cells(world::content_mut(world), cells);
}

/// Author a world's resources (rows via `world_map::new_resource_row`).
public fun set_world_resources(_: &SeedCap, world: &mut World, rows: vector<ResourceRow>) {
  world_map::set_resources(world::content_mut(world), rows);
}

/// Tie the world's dungeon key item (the dungeon system reads it later).
public fun set_world_dungeon_key(_: &SeedCap, world: &mut World, item_type: String) {
  world_map::set_dungeon_key(world::content_mut(world), item_type);
}

/// Author the world's dungeon room sequence (rows via `world_map::new_dungeon_room` /
/// `new_room_mob`; the last room carries the boss). Overwrite legal until the seal.
public fun set_world_dungeon_rooms(_: &SeedCap, world: &mut World, rooms: vector<DungeonRoom>) {
  world_map::set_dungeon_rooms(world::content_mut(world), rooms);
}

/// Commit the world's deterministic receipt in the same PTB as its content writes.
public fun mark_world_seeded(_: &SeedCap, registry: &mut TemplateRegistry, world_name: String) {
  transfer::freeze_object(WorldSeedMarker {
    id: derived_object::claim(item::registry_uid_mut(registry), WorldSeedKey(world_name)),
  });
}

/// End the batch — the hot potato's only exit.
public fun destroy_seed_cap(cap: SeedCap) {
  let SeedCap {} = cap;
}

/// The seeding's final command: after this, `begin_batch` aborts for eternity.
public fun seal(admin: &AdminCap, registry: &mut TemplateRegistry, ctx: &TxContext) {
  admin.verify(ctx);
  transfer::freeze_object(SealMarker {
    id: derived_object::claim(item::registry_uid_mut(registry), SealKey(b"sealed".to_string())),
  });
  item::seal(registry);
}
