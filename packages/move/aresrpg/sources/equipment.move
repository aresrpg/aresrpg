// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// EQUIPMENT — the 17 combat + 3 cosmetic slots on a Character (SPEC §10), the ONLY home of slot bookkeeping.
/// It sits ON TOP of the items `extract` seam: an item is pulled out of the holder's kiosk (`extract_for_equip` →
/// `(Item, EquipPledge)`), this module enforces the SLOT RULES and folds its stats, then discharges the pledge
/// through `extract::confirm_equip` (which attaches the item as a DF on the character, keyed by item id). `unequip`
/// is the mirror: `extract::unequip` detaches the item + hands back a `LockPledge` that FORCES a personal-kiosk
/// re-lock, and this module reverses the slot bookkeeping. Placement-by-responsibility: the extract seam owns the
/// royalty-safe move + the item DF; THIS module owns which slot holds what, the class/relic/level rules, and the
/// gear-stat cache fold. It REPLACES the `character_link::EquipmentShim` (its tool/pet reads now read this map).
///
/// SLOT MODEL. 14 slot KINDS (weapon, 7 armor/amulet, ring, pet, relic, 3 cosmetic) cover the 20 physical slots:
/// ring×2 and relic×6 are the only multi-slots (SPEC: weapon·helmet·chestplate·belt·gauntlets·pants·boots·amulet·
/// 2 rings·pet·6 relics = 17 combat, + title·hat·cloak = 3 cosmetic). NO mount slot (cut from scope).
/// An item's `category` is the dispatcher (item.move law); `z57` maps it to a kind. The WEAPON slot is the
/// only shared one: it holds EITHER a weapon (any of the 11-family table below — UNIVERSAL: any class equips any
/// weapon per DECISIONS 07-12; its family is recorded so the fight can grant the +10% own-class affinity) OR a
/// gathering tool (`tool_farmer`/`_herbalist`/`_miner` — no dedicated tool slot in the 17, so a tool occupies the
/// weapon slot, Retro-style). Rules enforced HERE (placement law): relic-unique-per-type (by template id, ≤6), one
/// item per single slot, ≤2 rings, and the level gate (character level ≥ item level).
///
/// GEAR-STAT CACHE FOLD. `map.gear` remains the legacy-positive aggregate observed by existing readers. A sibling
/// character DF stores malus magnitudes, so below-center lines subtract without ever putting signed sentinels in
/// the published block. A per-item marker makes upgrade-safe unequip exact: old items whose maluses were discarded
/// never manufacture a positive stat, while their first re-equip enters the new two-block fold. Cosmetics/tools carry
/// no rolled stats ⇒ fold zero. The fight PTB reads `folded_stats` + `equipped_weapon`/`equipped_weapon_family` and
/// composes the §17.27 attack line (v1 TRUTH — advisor #7: the line is fight's per-FAMILY CONST table; per-item/template damage lines are AUTHORED (item_damages.move) but NOT yet read by combat — the wiring is a named S-02 seal input, upgrade-clean
/// data, not hardcoded here) — game never imports fight (the dependency arrow is fight → game).
module aresrpg::equipment;

use aresrpg_foundation::spell::{Self, Stats};
use aresrpg::{character_link, config, equipment_stats, progression, version::Version};
use aresrpg::{
  character::Character,
  extension,
  extract::{Self, EquipPledge},
  item::{Self, Item, ItemTemplate, LockPledge},
  item_stats::{Self, ItemStatistics},
  item_damages::{Self, ItemDamages},
  scribe::ScribeConfig
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use std::string::String;
use sui::kiosk::Kiosk;

// ╔════════════════ [ Errors (teach, don't reject — the frontend maps each to human copy) ] ═ ]

const ENotEquippable: u64 = 103; // the item's category maps to no equipment slot (a consumable/resource can't equip)
const ESlotOccupied: u64 = 104; // a single slot (weapon/pet/armor/cosmetic) already holds an item
const ERelicDuplicate: u64 = 106; // a relic of this exact type (template) is already equipped (unique-per-type)
const ERelicSlotsFull: u64 = 107; // all 6 relic slots are used
const ERingSlotsFull: u64 = 108; // both ring slots are used
const ELevelTooLow: u64 = 109; // the character's level is below the item template's required level
const ETemplateMismatch: u64 = 110; // the passed template is not the equipped item's template
const EUnknownClass: u64 = 111; // the character's class slug is not one of the 12 §3 classes

// Private namespaced DF keys, chosen from the AresRPG brand domain. They are additive storage: no frozen struct
// layout changes. `MALUS_CACHE_KEY` → Stats on Character; `SIGNED_ITEM_MARKER_KEY` → bool on rolled-stat Item.
const MALUS_CACHE_KEY: u64 = 0x415245535f4d414c;
const SIGNED_ITEM_MARKER_KEY: u64 = 0x415245535f534947;

// ╔════════════════ [ Slot-kind taxonomy (14 kinds → 20 physical slots; ring/relic are the multi-slots) ] ═ ]

const SK_WEAPON: u8 = 0; // holds a class weapon OR a gathering tool (no dedicated tool slot)
const SK_HELMET: u8 = 1;
const SK_CHESTPLATE: u8 = 2;
const SK_BELT: u8 = 3;
const SK_GAUNTLETS: u8 = 4;
const SK_PANTS: u8 = 5;
const SK_BOOTS: u8 = 6;
const SK_AMULET: u8 = 7;
const SK_RING: u8 = 8; // 2 physical slots
const SK_PET: u8 = 9;
const SK_RELIC: u8 = 10; // 6 physical slots, unique per type
const SK_TITLE: u8 = 11; // cosmetic (zero stats)
const SK_HAT: u8 = 12; // cosmetic
const SK_CLOAK: u8 = 13; // cosmetic

const RING_SLOTS: u8 = 2;
const RELIC_SLOTS: u64 = 6;

// ── the 12-class → weapon-family AFFINITY table (SPEC §3; DECISIONS 07-12: weapons are UNIVERSAL, and the wielder's
// OWN-class weapon gets +10% damage). A CONST table by ruling (shape-freeze, never a GameConfig dial). Index = the
// §3 class id from `config::class_id_of` (single home of the slug↔id map — we only add the families). TOKEI(4) and
// IYASHI(11) both wield STAFF. These slugs ARE the weapon `category` a template authors; `z14` feeds
// the fight-entry affinity check (equipped family == the wielder's designed family ⇒ the bonus).
const CLASS_FAMILIES: vector<vector<u8>> = vector[
  b"longsword", // 0 senshi
  b"daggers", // 1 yajin
  b"battleaxe", // 2 ikari
  b"spear", // 3 mori
  b"staff", // 4 tokei
  b"spellbook", // 5 shugo
  b"bow", // 6 yogen
  b"axe", // 7 rojin
  b"mace", // 8 shusen
  b"club", // 9 tomoda
  b"sword", // 10 asobi
  b"staff", // 11 iyashi
];
// The 11 distinct weapon-family categories (the set of CLASS_FAMILIES) — an item in one of these is a class weapon.
const WEAPON_FAMILIES: vector<vector<u8>> = vector[
  b"longsword", b"daggers", b"battleaxe", b"spear", b"staff",
  b"spellbook", b"bow", b"axe", b"mace", b"club", b"sword",
];
// Gathering-tool categories → job id (SPEC §6 order: 0 FARMER · 1 HERBALIST · 2 MINER — matches the gathering tests
// + the admin resource-authoring convention). A tool occupies the weapon slot and is NOT class-locked.
const TOOL_CATEGORIES: vector<vector<u8>> = vector[b"tool_farmer", b"tool_herbalist", b"tool_miner"];

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The per-character slot bookkeeping, stored as ONE DF under NS_CHARACTER_EQUIPMENT (the equipped ITEMS themselves
/// live as sibling DFs keyed by item id, attached by `extract::confirm_equip`). `singles` = occupied plain single
/// slot-kind ids (helmet…cloak); weapon/ring/pet/relic have dedicated fields. `gear` is the folded combat block.
public struct EquipmentMap has store {
  singles: vector<u8>,
  ring_count: u8,
  relic_templates: vector<ID>, // equipped relic template ids (unique-per-type, ≤ RELIC_SLOTS)
  gear: Stats, // legacy-positive aggregate; malus magnitudes live in the additive sibling character DF
  weapon_item: Option<ID>, // the item occupying the weapon slot (a class weapon OR a tool)
  weapon_family: Option<String>, // some(family) iff a CLASS WEAPON occupies the weapon slot
  tool_job: Option<u8>, // some(job) iff a gathering TOOL occupies the weapon slot
  pet: bool,
}

// The singleton DF key the map hangs under on the Character (NS_CHARACTER_EQUIPMENT).
public struct EquipmentKey has copy, drop, store {}

// ╔════════════════ [ EQUIP — pull-out already done by the caller (extract_for_equip); we place + fold + confirm ] ═ ]

/// Discharge an `EquipPledge` INTO a character slot: enforce the slot rules, fold the item's stats, then
/// `extract::confirm_equip` attaches it. `item` + `pledge` come from `extract_for_equip` (composed in the same PTB).
/// `template` is the item's own template (verified — it is the single home of the required level + drives nothing a
/// forged template could bypass). Owner-gated by the personal-kiosk cap (`kiosk.borrow_mut` proves the caller owns
/// the character). game-freeze gated. Writes go through the NS_CHARACTER_EQUIPMENT namespace (public(package)).
public fun equip(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  item: Item,
  pledge: EquipPledge,
  template: &ItemTemplate,
  version: &Version,
) {
  version.assert_enabled();
  let mut item = item; // §17.27 wave-2a — mutable to snapshot the weapon's authored lines onto the instance

  // read every item fact BEFORE confirm_equip consumes it
  let category = item::category(&item);
  let item_id = object::id(&item);
  let template_id = item::template(&item);
  assert!(template_id == item::template_id(template), ETemplateMismatch);
  let kind = z57(category);
  assert!(kind.is_some(), ENotEquippable);
  let kind = kind.destroy_some();

  // A direct sale rolls every ranged non-stackable from its template, including pets. Pet power supersedes that
  // purchase roll: normalize from the authenticated template + stored feed count before folding or attaching.
  if (category == b"pet".to_string() && item_stats::has_ranges(template)) {
    let current = item_stats::z43(template, character_link::pet_power(&item));
    item_stats::z42(&mut item, current);
  };
  let has_rolled_stats = item_stats::has_rolled_stats(&item);
  let (bonus, malus) = if (has_rolled_stats) {
    equipment_stats::deltas(item_stats::rolled_stats(&item))
  } else (spell::stats_zero(), spell::stats_zero());
  if (has_rolled_stats) z66(&mut item, version);

  // §17.27 wave-2a: snapshot the template's chain-verified authored damage lines onto the WEAPON instance (the
  // template↔item match is asserted above), so a fight seat reads them straight off the character — the exact
  // unforgeable path gear stats take. Guarded against re-attach (a re-equipped weapon already carries the copy).
  if (z58(category) && item_damages::has_damages(template) && !item_damages::has_item_lines(&item)) {
    item_damages::attach_to_item(&mut item, *item_damages::damages(template));
  };

  let owner_cap = personal_kiosk::borrow(pkcap);
  let character = kiosk.borrow_mut(owner_cap, character_id);

  // level gate (single home of the required level = the template)
  assert!(character_link::level(character) >= (item::template_level(template) as u64), ELevelTooLow);

  z68(character, version);
  {
    let map = z67(character, version);
    place(map, kind, category, item_id, template_id, &bonus);
  };
  if (has_rolled_stats) z508(character, &malus, version);
  extract::confirm_equip(pledge, item, character, version);
}

// ╔════════════════ [ UNEQUIP — detach (extract::unequip) + reverse the bookkeeping; caller re-locks the item ] ═ ]

/// Reverse of `equip`: `extract::unequip` detaches the item (returning it + a `LockPledge` that FORCES a personal
/// re-lock, discharged by the caller via `item::lock_in_kiosk` in the same PTB) and we UNDO the slot bookkeeping +
/// the fold. Owner-gated + game-freeze gated like `equip`.
public fun unequip(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  item_id: ID,
  version: &Version,
): (Item, LockPledge) {
  version.assert_enabled();
  let owner_cap = personal_kiosk::borrow(pkcap);
  let character = kiosk.borrow_mut(owner_cap, character_id);

  let (item, lock) = extract::unequip(character, item_id, version);
  let category = item::category(&item);
  let template_id = item::template(&item);
  let has_rolled_stats = item_stats::has_rolled_stats(&item);
  let signed_folded = z65(&item);
  let (bonus, malus) = if (has_rolled_stats) {
    equipment_stats::deltas(item_stats::rolled_stats(&item))
  } else (spell::stats_zero(), spell::stats_zero());
  {
    let map = z67(character, version);
    z902(map, category, template_id, &bonus);
  };
  if (has_rolled_stats) z64(character, &malus, signed_folded, version);
  (item, lock)
}

// ╔════════════════ [ Slot rule engine (pure over the map — placement-by-responsibility) ] ═ ]

/// Enforce the slot rule for `kind` and record the occupancy + fold. A weapon records its family for the fight-entry
/// affinity read; UNIVERSAL since DECISIONS 07-12 (any class equips any weapon — no class lock, tools stay untyped).
fun place(map: &mut EquipmentMap, kind: u8, category: String, item_id: ID, template_id: ID, bonus: &Stats) {
  if (kind == SK_WEAPON) {
    assert!(map.weapon_item.is_none(), ESlotOccupied);
    if (z903(category)) {
      map.tool_job = z59(category); // some (z903 ⇒ present)
    } else {
      map.weapon_family = option::some(category); // any weapon family — its own-class affinity is decided at fight entry
    };
    map.weapon_item = option::some(item_id);
  } else if (kind == SK_RING) {
    assert!(map.ring_count < RING_SLOTS, ERingSlotsFull);
    map.ring_count = map.ring_count + 1;
  } else if (kind == SK_PET) {
    assert!(!map.pet, ESlotOccupied);
    map.pet = true;
  } else if (kind == SK_RELIC) {
    assert!(map.relic_templates.length() < RELIC_SLOTS, ERelicSlotsFull);
    assert!(!map.relic_templates.contains(&template_id), ERelicDuplicate);
    map.relic_templates.push_back(template_id);
  } else {
    assert!(!map.singles.contains(&kind), ESlotOccupied);
    map.singles.push_back(kind);
  };
  map.gear = spell::stats_add(&map.gear, bonus);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Undo `place` for the item now coming off (its `category`/`template_id` derive the kind; the item was equipped so
/// its category is a known slot). Subtracts exactly the delta `place` added (never underflows).
fun z902(map: &mut EquipmentMap, category: String, template_id: ID, bonus: &Stats) {
  let kind = z57(category).destroy_some();
  if (kind == SK_WEAPON) {
    map.weapon_item = option::none();
    map.weapon_family = option::none();
    map.tool_job = option::none();
  } else if (kind == SK_RING) {
    map.ring_count = map.ring_count - 1;
  } else if (kind == SK_PET) {
    map.pet = false;
  } else if (kind == SK_RELIC) {
    let (found, i) = map.relic_templates.index_of(&template_id);
    if (found) { map.relic_templates.swap_remove(i); };
  } else {
    let (found, i) = map.singles.index_of(&kind);
    if (found) { map.singles.swap_remove(i); };
  };
  map.gear = spell::stats_sub(&map.gear, bonus);
}

// ╔════════════════ [ Category → slot taxonomy + the class-lock lookups ] ═════ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Map an item `category` to its slot kind, or `none` if it is not equippable (consumable/resource/…). Weapon
/// families AND gathering tools both route to the weapon slot (the tool/weapon split is resolved in `place`).
fun z57(category: String): Option<u8> {
  if (z58(category) || z903(category)) option::some(SK_WEAPON)
  else if (category == b"helmet".to_string()) option::some(SK_HELMET)
  else if (category == b"chestplate".to_string()) option::some(SK_CHESTPLATE)
  else if (category == b"belt".to_string()) option::some(SK_BELT)
  else if (category == b"gauntlets".to_string()) option::some(SK_GAUNTLETS)
  else if (category == b"pants".to_string()) option::some(SK_PANTS)
  else if (category == b"boots".to_string()) option::some(SK_BOOTS)
  else if (category == b"amulet".to_string()) option::some(SK_AMULET)
  else if (category == b"ring".to_string()) option::some(SK_RING)
  else if (category == b"pet".to_string()) option::some(SK_PET)
  else if (category == b"relic".to_string()) option::some(SK_RELIC)
  else if (category == b"title".to_string()) option::some(SK_TITLE)
  else if (category == b"hat".to_string()) option::some(SK_HAT)
  else if (category == b"cloak".to_string()) option::some(SK_CLOAK)
  else option::none()
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z58(category: String): bool { z60(WEAPON_FAMILIES, category) }
// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z903(category: String): bool { z60(TOOL_CATEGORIES, category) }

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The gathering job a tool serves (index in `TOOL_CATEGORIES` = SPEC §6 job id). `none` if not a tool category.
fun z59(category: String): Option<u8> {
  let tools = TOOL_CATEGORIES;
  let mut i = 0;
  while (i < tools.length()) {
    if (tools[i].to_string() == category) return option::some(i as u8);
    i = i + 1;
  };
  option::none()
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The DESIGNED weapon family for a class slug (single home of the slug↔id map is `config::class_id_of`) — the
/// fight-entry affinity check (`aresrpg::fight::combatant_of`) compares it to the equipped family for the +10%.
public(package) fun z14(class: String): Option<String> {
  let cid = config::class_id_of(class);
  if (cid.is_none()) return option::none();
  let families = CLASS_FAMILIES;
  option::some(families[cid.destroy_some()].to_string())
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z60(slugs: vector<vector<u8>>, category: String): bool {
  let mut i = 0;
  while (i < slugs.length()) {
    if (slugs[i].to_string() == category) return true;
    i = i + 1;
  };
  false
}

// ╔════════════════ [ Reads (FREE — on-chain state is public; the migrated shim reads + the fight seam) ] ═ ]

/// Does the character have an equipment map yet? (The old shim's `equipment_attached` — gather refuses without it.)
public fun equipment_attached(character: &Character): bool { z904(character) }

/// Is a gathering tool for `job` equipped? (Weapon slot holds a tool whose job == `job`.) Migrated shim read.
public fun tool_equipped_for(character: &Character, job: u8): bool {
  z904(character) && z905(character).tool_job == option::some(job)
}

/// Is a pet equipped? Feeds the checkpoint pet-equipped snapshot (§17.2 mount ×1.5). Migrated shim read.
public fun pet_equipped(character: &Character): bool {
  z904(character) && z905(character).pet
}

/// TRUE iff at least ONE item occupies any slot — weapon/tool, an armor single, a ring, a pet, or a relic.
/// THE authoritative equipped-state read (the map IS the module's occupancy truth; the item DFs it points at
/// are un-enumerable on-chain). Reads OCCUPANCY, never mere map presence: a fully-unequipped character whose
/// map still exists (emptied, not removed) reads FALSE. The character-delete door guards on this — a delete
/// with anything equipped would orphan the kiosk-locked Items attached under NS_CHARACTER_EQUIPMENT.
public fun any_equipped(character: &Character): bool {
  if (!z904(character)) return false;
  let map = z905(character);
  !map.singles.is_empty() || map.ring_count > 0 || !map.relic_templates.is_empty()
    || map.weapon_item.is_some() || map.pet
}

/// The folded gear stats — allocated base plus positive equipment aggregate minus maluses, floored per field.
public fun folded_stats(character: &Character): Stats {
  // §3 stat-allocation rider (2026-07-11): the character's ALLOCATED stats are the BASE the gear fold adds onto.
  // Vitality flows to `z506`'s max-HP recompute; strength/intelligence/agility/chance to the §17.27 damage
  // lines — via the SAME consumer gear already uses (no new formula). Un-allocated ⇒ all-zero ⇒ no behavior change.
  let allocated = z61(character);
  if (!z904(character)) allocated
  else if (z63(character)) {
    equipment_stats::z18(&allocated, &z905(character).gear, z507(character))
  } else spell::stats_add(&allocated, &z905(character).gear)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The character's ALLOCATED §3 stats (read from `character_link`) as a combat `Stats` block. The player-allocatable
/// set is strength/intelligence/chance/agility (core damage) + wisdom + vitality (ext); raw_damage/crit/range/
/// resistances are GEAR-ONLY, so they stay 0 here. One home: the stat DF lives on `character_link`; this maps it
/// into the combat block `folded_stats` sums with gear.
fun z61(character: &Character): Stats {
  let mut s = spell::new_stats(
    character_link::stat_allocated(character, character_link::stat_strength()),
    character_link::stat_allocated(character, character_link::stat_intelligence()),
    character_link::stat_allocated(character, character_link::stat_chance()),
    character_link::stat_allocated(character, character_link::stat_agility()),
    0, 0, 0, 0, 0, 0, 0,
  );
  spell::set_ext_gear(&mut s, character_link::stat_allocated(character, character_link::stat_wisdom()), 0, 0, character_link::stat_allocated(character, character_link::stat_vitality()));
  s
}

/// The equipped WEAPON item id (none if the weapon slot is empty or holds a tool). The fight reads the item's
/// template damage lines to build the §17.27 attack line.
public fun equipped_weapon(character: &Character): Option<ID> {
  if (!z904(character)) return option::none();
  let map = z905(character);
  if (map.weapon_family.is_some()) map.weapon_item else option::none()
}

/// The equipped weapon's family category (none if empty/tool) — the fight keys AP-cost/reach/crit tuning off it.
public fun equipped_weapon_family(character: &Character): Option<String> {
  if (!z904(character)) return option::none();
  z905(character).weapon_family
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// §17.27 wave-2a — the equipped WEAPON's authored damage lines (snapshotted onto the instance at equip). Empty
/// when: no class weapon is equipped (tool/bare), the weapon predates this upgrade (re-equip migrates it), or the
/// template authored no lines. The fight seat reads these through the ownership-proven character borrow and threads
/// them into combat — the SAME unforgeable trust path as gear vitality; the client supplies no numbers. The
/// `to`/`from` range + string element convert to combat values via `item_damages::midpoint`/`element_id`.
public(package) fun z15(character: &Character): vector<ItemDamages> {
  if (!z904(character)) return vector[];
  let wid = {
    let map = z905(character);
    if (map.weapon_family.is_none() || map.weapon_item.is_none()) return vector[]; // tool or empty slot ⇒ no lines
    *map.weapon_item.borrow()
  };
  let item: &Item = extension::z30<ID, Item>(character, extension::z32(), wid);
  if (item_damages::has_item_lines(item)) *item_damages::item_lines(item) else vector[]
}

/// The GEARED combat snapshot — `character_link::combat_stats` with the equipment fold applied: max-HP is
/// RECOMPUTED through `progression::max_hp` with the folded VITALITY (a vit line on gear must actually raise the
/// pool — the gear-rules law), current HP is clamped to the geared max (paranoia: un-equipping vit gear between
/// fights can strand a stored HP above the new max). Returns
/// `(class, level, hp, max_hp, base_ap, base_mp, folded Stats)` — everything a fight seat needs except the
/// §17.27 weapon line (keyed off `equipped_weapon_family` by the fight). Lives HERE (not character_link — the
/// import arrow is equipment → character_link; not fight — game owns what "geared" means). Pure read. Folded
/// `action`/`movement` adjust the returned base AP/MP scalars, which are the fight's turn-refill budgets.
public fun geared_combat_stats(character: &Character, config: &config::GameConfig): (String, u64, u64, u64, u64, u64, Stats) {
  let (class, level, hp, base_max_hp, base_ap, base_mp) = character_link::combat_stats(character, config);
  z506(character, config, class, level, hp, base_max_hp, base_ap, base_mp)
}

/// `geared_combat_stats` with current HP regen-SETTLED at `now_ms` (ANNEX §5.4) — the FIGHT-ENTRY variant every
/// door snapshot uses (S-69: the raw read seated a stored post-defeat hp=0 forever). Same fold, same clamp; only
/// the hp input is the virtually-settled `character_link::combat_stats_settled` read.
public fun geared_combat_stats_settled(character: &Character, config: &config::GameConfig, now_ms: u64): (String, u64, u64, u64, u64, u64, Stats) {
  let (class, level, hp, base_max_hp, base_ap, base_mp) = character_link::combat_stats_settled(character, config, now_ms);
  z506(character, config, class, level, hp, base_max_hp, base_ap, base_mp)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// The shared equipment FOLD over the character scalars (raw or settled): vit-aware max-HP recompute + the
/// stranded-hp clamp — one home for what "geared" means.
fun z506(character: &Character, config: &config::GameConfig, class: String, level: u64, hp: u64, base_max_hp: u64, base_ap: u64, base_mp: u64): (String, u64, u64, u64, u64, u64, Stats) {
  let stats = folded_stats(character);
  let vit = spell::stat_vitality(&stats);
  let max_hp = if (z904(character)) {
    let cid = config::class_id_of(class);
    assert!(cid.is_some(), EUnknownClass);
    progression::max_hp(config::class_row(config, cid.destroy_some()), level, vit)
  } else base_max_hp;
  let (folded_ap, folded_mp) = if (!z904(character)) (base_ap, base_mp)
    else if (z63(character)) {
      z62(base_ap, base_mp, &z905(character).gear, z507(character))
    } else {
      let zero = spell::stats_zero();
      z62(base_ap, base_mp, &z905(character).gear, &zero)
    };
  let hp_clamped = if (hp > max_hp) max_hp else hp;
  (class, level, hp_clamped, max_hp, folded_ap, folded_mp, stats)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Fold the signed item `action`/`movement` cache into the class scalars. The fight stores and refills these exact
/// values; keeping the pair here gives the production handoff and its golden vector one implementation.
fun z62(base_ap: u64, base_mp: u64, bonus: &Stats, malus: &Stats): (u64, u64) {
  (
    equipment_stats::z19(base_ap, spell::stat_ap_bonus(bonus), spell::stat_ap_bonus(malus)),
    equipment_stats::z19(base_mp, spell::stat_mp_bonus(bonus), spell::stat_mp_bonus(malus)),
  )
}

// ╔════════════════ [ In-place mutation of an EQUIPPED item (pet-feed / rune-scribe reach the item HERE) ] ═ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Package-internal: borrow an EQUIPPED item MUTABLY by its id, through the custodied NS_EQUIPMENT cap. The item
/// was attached by `extract::confirm_equip` under NS_EQUIPMENT keyed by its own id; a non-equipped id aborts. The
/// pet-feed lane grows pet power through this borrow; the returned reference borrows `character` for its lifetime.
public(package) fun z16(character: &mut Character, item_id: ID, version: &Version): &mut Item {
  extension::z24<ID, Item>(extension::z32(), character, item_id, version)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
/// Replace an equipped item's effective stats and refresh both signed cache blocks atomically. Pet power uses this
/// after deriving the current block from its template; combat therefore observes the same block stored on the item.
public(package) fun z17(character: &mut Character, item_id: ID, stats: ItemStatistics, version: &Version) {
  let (new_bonus, new_malus) = equipment_stats::deltas(&stats);
  let (old_bonus, old_malus, signed_folded) = {
    let item = z16(character, item_id, version);
    let signed_folded = z65(item);
    let (old_bonus, old_malus) = if (item_stats::has_rolled_stats(item)) {
      equipment_stats::deltas(item_stats::rolled_stats(item))
    } else (spell::stats_zero(), spell::stats_zero());
    item_stats::z42(item, stats);
    z66(item, version);
    (old_bonus, old_malus, signed_folded)
  };
  {
    let map = z67(character, version);
    map.gear = spell::stats_add(&spell::stats_sub(&map.gear, &old_bonus), &new_bonus);
  };
  z64(character, &old_malus, signed_folded, version);
  z508(character, &new_malus, version);
}



// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z904(character: &Character): bool {
  extension::z29(character, extension::z32(), EquipmentKey {})
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z905(character: &Character): &EquipmentMap {
  extension::z30<EquipmentKey, EquipmentMap>(character, extension::z32(), EquipmentKey {})
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z63(character: &Character): bool {
  extension::z29(character, extension::z32(), MALUS_CACHE_KEY)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z507(character: &Character): &Stats {
  extension::z30<u64, Stats>(character, extension::z32(), MALUS_CACHE_KEY)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z508(character: &mut Character, delta: &Stats, version: &Version) {
  let ns = extension::z32();
  if (extension::z29(character, ns, MALUS_CACHE_KEY)) {
    let cache: &mut Stats = extension::z24(ns, character, MALUS_CACHE_KEY, version);
    *cache = spell::stats_add(cache, delta);
  } else {
    extension::z23(ns, character, MALUS_CACHE_KEY, *delta, version);
  };
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z64(character: &mut Character, delta: &Stats, signed_folded: bool, version: &Version) {
  let ns = extension::z32();
  if (extension::z29(character, ns, MALUS_CACHE_KEY)) {
    let cache: &mut Stats = extension::z24(ns, character, MALUS_CACHE_KEY, version);
    *cache = equipment_stats::z501(cache, delta, signed_folded);
  };
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z65(item: &Item): bool {
  extension::z27(item, extension::ns_item(), SIGNED_ITEM_MARKER_KEY)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z66(item: &mut Item, version: &Version) {
  let ns = extension::ns_item();
  if (!extension::z27(item, ns, SIGNED_ITEM_MARKER_KEY)) {
    extension::z21(ns, item, SIGNED_ITEM_MARKER_KEY, true, version);
  };
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z67(character: &mut Character, version: &Version): &mut EquipmentMap {
  extension::z24<EquipmentKey, EquipmentMap>(extension::z32(), character, EquipmentKey {}, version)
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z68(character: &mut Character, version: &Version) {
  if (!extension::z29(character, extension::z32(), EquipmentKey {})) {
    extension::z23(extension::z32(), character, EquipmentKey {}, z509(), version);
  };
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (ceremony leg-2); see the growth row
fun z509(): EquipmentMap {
  EquipmentMap {
    singles: vector[],
    ring_count: 0,
    relic_templates: vector[],
    gear: spell::stats_zero(),
    weapon_item: option::none(),
    weapon_family: option::none(),
    tool_job: option::none(),
    pet: false,
  }
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

// ── fold-math surface (statful items need `shop::buy` cross-package; these unit-test the fold on hand-built stats) ──
#[test_only]
public fun test_gear_delta(is: &ItemStatistics): Stats { let (bonus, _) = equipment_stats::deltas(is); bonus }
#[test_only]
public fun test_stats_add(a: &Stats, b: &Stats): Stats { spell::stats_add(a, b) }
#[test_only]
public fun test_stats_sub(a: &Stats, b: &Stats): Stats { spell::stats_sub(a, b) }
#[test_only]
public fun test_zero_stats(): Stats { spell::stats_zero() }
#[test_only]
public fun test_fold_action_movement(base_ap: u64, base_mp: u64, bonus: &Stats, malus: &Stats): (u64, u64) {
  z62(base_ap, base_mp, bonus, malus)
}

#[test_only]
/// Attach a map directly (bypassing the extract flow) so the gather suite can set the tool/pet gates cheaply — the
/// replacement for the old `character_link::attach_equipment_shim`. `tool_jobs` (≤1 in practice, one weapon slot)
/// seeds `tool_job`; `pet` seeds the pet flag. Uses a fresh NS_EQUIPMENT test cap, returned for the caller to sink.
public fun attach_map_for_testing(character: &mut Character, tool_jobs: vector<u8>, pet: bool, version: &Version) {
  let mut map = z509();
  if (!tool_jobs.is_empty()) { map.tool_job = option::some(*tool_jobs.borrow(0)); };
  map.pet = pet;
  extension::z23(extension::z32(), character, EquipmentKey {}, map, version);
}

#[test_only]
/// Attach `item` onto `character` as an EQUIPPED item DF (keyed by its id, under NS_EQUIPMENT) and ensure a map
/// exists — bypasses the real extract→equip ceremony so the pet-feed / scribe suites drive the in-place mutators
/// cheaply. The map starts at ZERO gear (the item's stats are NOT pre-folded), so a scribe test asserts exactly
/// the delta the rewrite folds in. Uses a fresh NS_EQUIPMENT test cap, returned for the caller to sink.
public fun attach_item_for_testing(character: &mut Character, item: Item, version: &Version) {
  z68(character, version);
  let item_id = object::id(&item);
  extension::z23(extension::z32(), character, item_id, item, version);
}
