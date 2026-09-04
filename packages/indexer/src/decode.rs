// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! BCS twins of every on-chain struct the projection reads.
//!
//! PURE: raw bytes in, typed struct out — no framework types, no store, so every
//! layout is offline-testable. Each twin mirrors its Move struct FIELD FOR FIELD
//! (BCS is positional; a reordered field is silent corruption). Layout notes:
//!
//! * `UID` / `ID` / `address` = 32 raw bytes ([`Id`] / [`Addr`]).
//! * A Move struct with NO fields carries one hidden `dummy_field: bool` byte —
//!   every marker DF key (`HpKey()`, `EquipmentKey()`, …) decodes as one `bool`.
//! * `Option<T>` = 1-byte some-flag + payload; enums = uleb128 variant + payload.
//! * `VecSet<T>` / `VecMap<K,V>` / `Balance<T>` are struct WRAPPERS ([`VecSet`],
//!   [`VecMap`], [`Balance`]) — never bare vectors/integers.
//! * A dynamic field is `Field { id, name: K, value: V }` ([`Field`]); dynamic
//!   OBJECT fields use `Field<Wrapper<K>, Id>` (the child rides at its own address).
//!
//! CONTENT TEMPLATES ARE ABSENT by design (README, "the content cut"): item /
//! mob / spell / recipe templates are frozen corpus the repo ships as JSON — the
//! indexer never decodes them. [`World`] survives only for the id → name map
//! zones and boot need.
//!
//! TESTS (L-D4): the layout-bearing twins are pinned against REAL captured
//! testnet object contents — a self-round-trip encodes with the same struct it
//! decodes with, so it can only prove internal consistency (the 2026-07-17 XP
//! incident). Round-trip survives only for the shapes no live object carries
//! yet (`Fight`, `Mastery`, the equipment `VecMap`); each captured test names its object
//! id, version, and capture date.

use serde::{Deserialize, Serialize};

// ╔════════════════ [ Primitives ] ═══════════════════════════════════════════ ]

/// A Sui object id / UID (32 bytes). Canonical form: `0x…` lowercase hex.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Id(pub [u8; 32]);

/// A Sui address (32 bytes). Same wire shape as [`Id`] — the distinction is
/// semantic: an `Addr` is a wallet/owner, an `Id` names an object. An equipped
/// item's owner address IS its character's id (the typed-resolver rule).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Addr(pub [u8; 32]);

impl Id {
    pub fn hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }
}

impl Addr {
    pub fn hex(&self) -> String {
        format!("0x{}", hex::encode(self.0))
    }
}

/// `sui::balance::Balance<T>` — a struct wrapping one u64.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Balance {
    pub value: u64,
}

/// `sui::vec_set::VecSet<T>` — a struct wrapping a vector.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VecSet<T> {
    pub contents: Vec<T>,
}

/// `sui::vec_map::VecMap<K, V>` — a struct wrapping entry pairs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VecMap<K, V> {
    pub contents: Vec<VecMapEntry<K, V>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VecMapEntry<K, V> {
    pub key: K,
    pub value: V,
}

/// `sui::dynamic_field::Field<K, V>` — the DF carrier object. A dynamic object
/// field is `Field<dynamic_object_field::Wrapper<K>, Id>`; the child lives at
/// its own address.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Field<K, V> {
    pub id: Id,
    pub name: K,
    pub value: V,
}

/// `sui::dynamic_object_field::Wrapper<Name>` — prevents key collisions with
/// ordinary dynamic fields while preserving the authored name.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicObjectFieldWrapper<Name> {
    pub name: Name,
}

/// The hidden byte a zero-field Move struct serializes as — every marker key.
pub type MarkerKey = bool;

/// Decode any twin from Move object contents. Fails on trailing bytes — a twin
/// that leaves bytes unread has the wrong layout, never "close enough".
pub fn from_bytes<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> anyhow::Result<T> {
    bcs::from_bytes(bytes).map_err(anyhow::Error::from)
}

// ╔════════════════ [ aresrpg_math — embedded value types ] ══════════════════ ]

/// `aresrpg_math::item_stats::ItemStatistics` — 15 × u16, centered at 32768.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemStatistics {
    pub vitality: u16,
    pub wisdom: u16,
    pub strength: u16,
    pub intelligence: u16,
    pub chance: u16,
    pub agility: u16,
    pub range: u16,
    pub movement: u16,
    pub action: u16,
    pub critical: u16,
    pub raw_damage: u16,
    pub earth_resistance: u16,
    pub fire_resistance: u16,
    pub water_resistance: u16,
    pub air_resistance: u16,
}

/// `aresrpg_math::item_damages::ItemDamages` — one authored weapon line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemDamages {
    pub from: u16,
    pub to: u16,
    pub damage_type: String,
    pub element: String,
}

/// `aresrpg_math::combat_grid::GridSpec` — the fight board.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridSpec {
    pub width: u64,
    pub height: u64,
    pub shape_mask: Vec<u64>,
    pub obstacles: Vec<u64>,
    pub holes: Vec<u64>,
    pub start_cells_a: Vec<u64>,
    pub start_cells_b: Vec<u64>,
}

/// `aresrpg_math::spell_effect::Effect` — one effect line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Effect {
    pub kind: u8,
    pub element: String,
    pub value: u32,
    pub value_max: u32,
    pub area_shape: u8,
    pub area_size: u8,
    pub target_filter: u8,
    pub chance_bp: u16,
    pub turns: u8,
    pub stat: u8,
}

/// `aresrpg_math::spell_effect::SpellLevel` — one castable spell level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpellLevel {
    pub ap_cost: u8,
    pub range_min: u8,
    pub range_max: u8,
    pub modifiable_range: bool,
    pub line_of_sight: bool,
    pub line_launch: bool,
    pub free_cell: bool,
    pub casts_per_turn: u8,
    pub casts_per_target: u8,
    pub cooldown_turns: u8,
    pub crit_1_in: u16,
    pub effects: Vec<Effect>,
    pub crit_effects: Vec<Effect>,
}

// ╔════════════════ [ aresrpg::character ] ═══════════════════════════════════ ]

/// `aresrpg::character::Character` — the base object (its DFs ride separately).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: Id,
    pub name: String,
    pub classe: String,
    pub sex: String,
    pub experience: u64,
    pub level: u16,
    pub color_1: u32,
    pub color_2: u32,
    pub color_3: u32,
    pub vitality: u16,
    pub wisdom: u16,
    pub strength: u16,
    pub intelligence: u16,
    pub chance: u16,
    pub agility: u16,
    pub available_points: u16,
    pub available_spell_points: u16,
}

// ╔════════════════ [ aresrpg::progression — Character DFs ] ═════════════════ ]

/// `progression::Hp` — value of `Field<HpKey, Hp>` on the character.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Hp {
    pub current: u64,
    pub last_ms: u64,
}

/// `progression::JobXpKey(String)` — positional key; value is a bare `u64`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobXpKey(pub String);

/// The spell book — value of `Field<SpellBookKey, VecMap<String, u8>>`.
pub type SpellBook = VecMap<String, u8>;

// ╔════════════════ [ aresrpg::world — Character DFs + the World object ] ════ ]

/// `world::CheckpointKey(String)` — one per visited world; positional key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckpointKey(pub String);

/// `world::Checkpoint` — the last proven position (the speed-check anchor).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Checkpoint {
    pub x: u32,
    pub z: u32,
    pub at_ms: u64,
    pub pet: bool,
}

// ╔════════════════ [ aresrpg::zone — independent shared object ] ════════════ ]

/// `zone::Zone` — independent mutable state for one discovered zone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Zone {
    pub id: Id,
    pub world: String,
    pub zone_x: u32,
    pub zone_z: u32,
    pub seed: u64,
    pub searched_at_ms: u64,
    pub mob_taken: u128,
    pub res_taken: Vec<u8>,
}

// ╔════════════════ [ aresrpg::equipment — Character DFs ] ═══════════════════ ]

/// `equipment::EquippedRecord` — what a slot remembers about its sent item.
/// The slot map is `Field<EquipmentKey, VecMap<String, EquippedRecord>>`; the
/// folded total is `Field<FoldedKey, ItemStatistics>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquippedRecord {
    pub item: Id,
    pub template: Id,
    pub category: String,
    pub stats: Option<ItemStatistics>,
    pub damages: Vec<ItemDamages>,
}

pub type EquipmentMap = VecMap<String, EquippedRecord>;

// ╔════════════════ [ aresrpg::dungeon / gathering — Character DFs ] ═════════ ]

/// `dungeon::DungeonRun` — value of `Field<DungeonRunKey, DungeonRun>`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DungeonRun {
    pub dungeon: String,
    pub room: u64,
    /// Committed at ENTER (key-gated) — each room's board derives from it.
    pub seed: u64,
}

/// `gathering::PendingAmbush` — value of `Field<AmbushKey, PendingAmbush>`.
/// Written on EVERY gather (gas-uniform); only `fires == true` projects.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingAmbush {
    pub fires: bool,
    pub protector: String,
    pub x: u32,
    pub z: u32,
    pub scalar: u8,
    pub board_seed: u64,
    pub hp: u64,
}

// ╔════════════════ [ aresrpg::item — the object + its DFs ] ═════════════════ ]

/// `item::Item` — a minted item (stats/damages/forge/feed ride as DFs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Item {
    pub id: Id,
    pub template: Id,
    pub name: String,
    pub item_type: String,
    pub category: String,
    pub level: u8,
    pub amount: u32,
}

/// `forgemagie::ForgeState` — value of `Field<ForgeKey, ForgeState>` on gear.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForgeState {
    pub puits: u64,
    pub apps: Vec<u8>,
}

/// `pet::FeedState` — value of `Field<FeedKey, FeedState>` on a pet item.
/// `count` IS the pet's power (0..=60).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FeedState {
    pub count: u64,
    pub last_day: u64,
}

// ╔════════════════ [ aresrpg::fight — the shared object + custody ] ═════════ ]

/// `fight::Fight` — the whole machine. Projected as one latest-wins blob plus
/// thin `FIGHTER` edges built from the `FighterKey` custody wrappers (README).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fight {
    pub id: Id,
    pub world: String,
    pub x: u32,
    pub z: u32,
    pub access_a: u8,
    pub access_b: u8,
    pub opener_a: Option<Id>,
    pub opener_b: Option<Id>,
    pub authorities: Vec<FighterAuthority>,
    pub combat: CombatState,
    pub dungeon: Option<DungeonTag>,
    pub door_policy: u64,
    pub drops_rolled: bool,
    pub next_turn_entropy: u64,
    pub loot_entropy_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FighterAuthority {
    Player { character: Id, owner: Addr },
    Mob,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DungeonTag {
    pub dungeon: String,
    pub room: u64,
}

/// `aresrpg_combat::combat::State` — nested value state, never an independently owned object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombatState {
    pub board: GridSpec,
    pub closed: Vec<u64>,
    pub fighters: Vec<Fighter>,
    pub zones: Vec<BoardZone>,
    pub queue: Vec<u64>,
    pub turn_pointer: u64,
    pub round: u64,
    pub ended: bool,
    pub winner: Option<u8>,
    pub turn_seed: u64,
    pub turn_cast_index: u64,
    pub turn_casts: Vec<TurnCast>,
    pub placement_started_ms: u64,
    pub turn_started_ms: u64,
}

/// `aresrpg_combat::combat::FighterKind` — authority identities stay in core.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FighterKind {
    Player,
    Mob(MobSnapshot),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fighter {
    pub team: u8,
    pub kind: FighterKind,
    pub stats: FighterStats,
    pub cell: u64,
    pub ready: bool,
    pub dead: bool,
    pub settled: bool,
    pub forfeited: bool,
    pub hp: u64,
    pub ap: u64,
    pub mp: u64,
    pub drops: Vec<RolledDrop>,
    pub effects: Vec<ActiveEffect>,
    pub cooldowns: Vec<Cooldown>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FighterStats {
    pub sheet: Sheet,
    pub max_hp: u64,
    pub base_ap: u64,
    pub base_mp: u64,
    pub earth_resistance: u64,
    pub fire_resistance: u64,
    pub water_resistance: u64,
    pub air_resistance: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sheet {
    pub strength: u64,
    pub intelligence: u64,
    pub chance: u64,
    pub agility: u64,
    pub wisdom: u64,
    pub raw_damage: u64,
    pub critical: u64,
    pub range_bonus: u64,
    pub level: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobSnapshot {
    pub mob_type: String,
    pub level: u64,
    pub kit: Vec<KitSpell>,
    pub xp: u64,
    pub loot: Vec<LootEntry>,
}

/// `mob_data::LootEntry` — embedded in the mob snapshot's table copy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LootEntry {
    pub item_type: String,
    pub chance_bp: u16,
    pub min_qty: u8,
    pub max_qty: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KitSpell {
    pub name: String,
    pub ordinal: u8,
    pub level: SpellLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnCast {
    pub spell: String,
    pub target: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveEffect {
    pub kind: u8,
    pub element: String,
    pub value: u64,
    pub turns_left: u64,
    pub source: u64,
    pub stat: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cooldown {
    pub spell: String,
    pub left: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardZone {
    pub owner_fighter: u64,
    pub trap: bool,
    pub shape: u8,
    pub size: u8,
    pub anchor: u64,
    pub turns_left: u64,
    pub effects: Vec<Effect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolledDrop {
    pub item_type: String,
    pub qty: u32,
}

/// `fight::FighterKey(u64)` — the custody dof key; the payload IS the seat.
/// The wrapper is `Field<Wrapper<FighterKey>, Id>`; the child is the seated Character.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FighterKey(pub u64);

// ╔════════════════ [ aresrpg::party / friends ] ═════════════════════════════ ]

/// `party::Party` — `members[0]` is the leader (derived, never stored).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Party {
    pub id: Id,
    pub members: Vec<Id>,
    pub pending: Vec<Id>,
}

/// `friends::FriendList` — a soulbound, DIRECTED whitelist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendList {
    pub id: Id,
    pub owner: Addr,
    pub friends: VecSet<Addr>,
}

/// `mastery::Mastery` — one soulbound daily progression row per address.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mastery {
    pub id: Id,
    pub owner: Addr,
    pub points: u64,
    pub last_completed_epoch: Option<u64>,
    pub quest_epoch: u64,
    pub quest_started_ms: u64,
    pub quest_world: String,
    pub quest_dungeon: Id,
    pub quest_reward: u8,
    pub quest_completed: bool,
}

/// `mastery::MasteryOffer` — living cost/enabled state for one seeded statless item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MasteryOffer {
    pub id: Id,
    pub item_type: String,
    pub template: Id,
    pub cost: u64,
    pub enabled: bool,
}

// ╔═══════════ [ aresrpg::kolizeum / distribution / version ] ═══════════════ ]

/// `kolizeum::Kolizeum` — the lobby + escrow (pot value is MIST → string prop).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kolizeum {
    pub id: Id,
    pub pot: Balance,
    pub pledge: u64,
    pub fight: Id,
    pub format: u64,
    pub level_min: u16,
    pub level_max: u16,
    pub allowed: Option<VecSet<Addr>>,
}

/// `distribution::Airdrop` — the whitelist IS the claim state (shrinks per claim).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Airdrop {
    pub id: Id,
    pub drop_id: String,
    pub template: Id,
    pub amount_each: u32,
    pub whitelist: VecSet<Addr>,
}

/// `distribution::Giftcard` — the zksend-portable voucher.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Giftcard {
    pub id: Id,
    pub template: Id,
    pub amount: u32,
}

/// `loot_box::BoxClaim` — the soulbound gacha claim (`open_box` mints it,
/// `claim_loot` burns it). AddressOwner = the opener.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BoxClaim {
    pub id: Id,
    pub box_template: Id,
    pub rolled_template: Id,
    pub amount: u32,
}

/// `forgemagie::CrushClaim` — the soulbound crush commitment: the committed
/// seed + the burned gear's raw stat blocks; `owed` reveals deterministically
/// on the first redeem/discard. AddressOwner = the crusher.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrushClaim {
    pub id: Id,
    pub seed: u64,
    pub raws: Vec<u64>,
    pub revealed: bool,
    pub owed: Vec<u64>,
}

/// `version::Version` — the live-code gate (→ `:Meta.version`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub id: Id,
    pub version: u64,
}

// ╔════════════════ [ 0x2 natives — kiosk / purchase caps ] ══════════════════ ]

/// `sui::kiosk::Kiosk` — custody root; `owner` sources the `OWNS` edge (the
/// KioskOwnerCap is wrapped inside the PersonalKioskCap, never visible).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kiosk {
    pub id: Id,
    pub profits: Balance,
    pub owner: Addr,
    pub item_count: u32,
    pub allow_extensions: bool,
}

/// Mysten's `personal_kiosk::PersonalKioskCap` — the owned wrapper holding the kiosk's
/// KioskOwnerCap (`cap` is None only mid-transaction while borrowed). Projected as
/// `Kiosk.personal_cap` so the wire can hand the client its custody cap id — the client
/// never discovers kiosks over RPC (owner 2026-08-21).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonalKioskCap {
    pub id: Id,
    pub cap: Option<KioskOwnerCap>,
}

/// `sui::kiosk::KioskOwnerCap { id, for }` — the inner cap naming its kiosk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KioskOwnerCap {
    pub id: Id,
    pub for_: Id,
}

/// `sui::kiosk::Listing { id, is_exclusive }` — DF key on the kiosk; the DF
/// value is the price (u64 MIST). `is_exclusive` = a PurchaseCap exists.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct KioskListingKey {
    pub id: Id,
    pub is_exclusive: bool,
}

/// `sui::kiosk::Item { id }` — the dof wrapper key for a kiosk-held object.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct KioskItemKey {
    pub id: Id,
}

/// `aresrpg::trade::Trade` — the p2p escrow that replaced transferred PurchaseCaps
/// (owner 2026-08-12): caps park as dof children; these fields are the negotiation state.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum TradePhase {
    Requested,
    Negotiating,
    Settling,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TradeState {
    pub initiator: Addr,
    pub invitee: Addr,
    pub phase: TradePhase,
    pub offer_revision: u64,
    pub initiator_accepted: bool,
    pub invitee_accepted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: Id,
    pub state: TradeState,
    pub sui_a: Balance,
    pub sui_b: Balance,
    pub caps_a: Vec<Id>,
    pub caps_b: Vec<Id>,
}

// ╔════════════════ [ Tests — captured-byte layout pins ] ════════════════════ ]

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip<T: Serialize + for<'a> Deserialize<'a> + std::fmt::Debug>(value: &T) -> T {
        let bytes = bcs::to_bytes(value).expect("encode");
        from_bytes(&bytes).expect("decode")
    }

    fn stats() -> ItemStatistics {
        ItemStatistics {
            vitality: 32768 + 50,
            wisdom: 32768,
            strength: 32768 - 10,
            intelligence: 32768,
            chance: 32768,
            agility: 32900,
            range: 32768,
            movement: 32768,
            action: 32769,
            critical: 32768,
            raw_damage: 32768,
            earth_resistance: 32768,
            fire_resistance: 32768,
            water_resistance: 32768,
            air_resistance: 32768,
        }
    }

    fn fighter_stats(
        level: u64,
        max_hp: u64,
        base_ap: u64,
        base_mp: u64,
        agility: u64,
        wisdom: u64,
    ) -> FighterStats {
        FighterStats {
            sheet: Sheet {
                strength: 0,
                intelligence: 0,
                chance: 0,
                agility,
                wisdom,
                raw_damage: 0,
                critical: 0,
                range_bonus: 0,
                level,
            },
            max_hp,
            base_ap,
            base_mp,
            earth_resistance: 32768,
            fire_resistance: 32768,
            water_resistance: 32768,
            air_resistance: 32768,
        }
    }

    /// Every capture below is `sui client object <id> --bcs`' `contents` — the
    /// raw Move object payload, taken from testnet package
    /// `0xfed435d0e2eb89ccd94cf5f68112ae4e3eebf7bbab74e9cf227589f6dd45a09c`.
    fn captured(hex_lines: &[&str]) -> Vec<u8> {
        hex::decode(hex_lines.concat()).expect("captured hex")
    }

    #[test]
    fn captured_character_decodes_field_for_field() {
        // Live testnet capture: character 0x1c493b…7d69 @ version 981006460,
        // transaction EDhfar…Kaq6, captured 2026-08-19.
        let bytes = captured(&[
            "1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69",
            "0573636561740579616a696e046d616c6500000000000000000100fd8e4900ff",
            "7d1a003de5ff0000000000000000000000000000000000",
        ]);
        let chr: Character = from_bytes(&bytes).expect("decode");
        assert_eq!(
            chr.id.hex(),
            "0x1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69"
        );
        assert_eq!(chr.name, "sceat");
        assert_eq!(chr.classe, "yajin");
        assert_eq!(chr.sex, "male");
        assert_eq!(chr.experience, 0);
        assert_eq!(chr.level, 1);
        // The three colours are the only non-zero numerics — a field-order slip
        // between them and the stat block reads as garbage here, not as a pass.
        assert_eq!(
            (chr.color_1, chr.color_2, chr.color_3),
            (4_820_733, 1_736_191, 16_770_365)
        );
        assert_eq!(
            (
                chr.vitality,
                chr.wisdom,
                chr.strength,
                chr.intelligence,
                chr.chance,
                chr.agility,
                chr.available_points,
                chr.available_spell_points
            ),
            (0, 0, 0, 0, 0, 0, 0, 0)
        );
    }

    #[test]
    fn captured_marker_key_field_decodes_the_hidden_byte() {
        // Live testnet capture: Field<progression::HpKey, progression::Hp>
        // 0xe3c352…d722 @ version 981006460, a dynamic field of character
        // 0x1c493b…7d69, captured 2026-08-19. `HpKey()` has no Move fields, so
        // the wire carries one hidden `dummy_field: bool` between id and value —
        // a twin that omits it shifts the whole payload by a byte.
        let bytes = captured(&[
            "e3c35270cf3c66c5af75fbc7d2241aed272bf10f4c7ca11f8cc2db4b1897d722",
            "00",
            "3700000000000000",
            "70dde70ea0010000",
        ]);
        let field: Field<MarkerKey, Hp> = from_bytes(&bytes).expect("decode");
        assert_eq!(
            field.id.hex(),
            "0xe3c35270cf3c66c5af75fbc7d2241aed272bf10f4c7ca11f8cc2db4b1897d722"
        );
        assert!(!field.name);
        assert_eq!(field.value.current, 55);
        assert_eq!(field.value.last_ms, 1_786_956_471_664);
    }

    #[test]
    fn captured_positional_key_field_decodes_its_wrapped_string() {
        // Live testnet capture: Field<world::CheckpointKey, world::Checkpoint>
        // 0xa75ea0…f46a @ version 981006460, a dynamic field of character
        // 0x1c493b…7d69, captured 2026-08-19. `CheckpointKey(String)` is a
        // positional single-field struct: BCS gives it NO extra framing, so the
        // key is the bare string — the layout a newtype twin must mirror.
        let bytes = captured(&[
            "a75ea0140fd96747a34866269e67d55496baf09cabcff5d7d140176f240bf46a",
            "0e30315f66697273745f73686f7265",
            "50c3000050c3000070dde70ea001000000",
        ]);
        let field: Field<CheckpointKey, Checkpoint> = from_bytes(&bytes).expect("decode");
        assert_eq!(field.name.0, "01_first_shore");
        assert_eq!((field.value.x, field.value.z), (50_000, 50_000));
        assert_eq!(field.value.at_ms, 1_786_956_471_664);
        assert!(!field.value.pet);
    }

    #[test]
    /// SELF-ROUND-TRIP, deliberately: no live testnet object carries an
    /// equipment `VecMap` yet (checked 2026-08-19 — the type has zero instances
    /// on chain), so there are no bytes to pin. This proves internal
    /// consistency only; it becomes a captured pin the first time a character
    /// equips on the published lineage.
    fn equipment_map_roundtrips() {
        let map: EquipmentMap = VecMap {
            contents: vec![VecMapEntry {
                key: "weapon".into(),
                value: EquippedRecord {
                    item: Id([5; 32]),
                    template: Id([6; 32]),
                    category: "sword".into(),
                    stats: Some(stats()),
                    damages: vec![ItemDamages {
                        from: 5,
                        to: 9,
                        damage_type: "damage".into(),
                        element: "earth".into(),
                    }],
                },
            }],
        };
        let field = Field {
            id: Id([7; 32]),
            name: false as MarkerKey,
            value: map,
        };
        let back: Field<MarkerKey, EquipmentMap> = roundtrip(&field);
        assert_eq!(back.value.contents[0].key, "weapon");
        assert_eq!(back.value.contents[0].value.damages[0].to, 9);
    }

    #[test]
    /// SELF-ROUND-TRIP, deliberately: no `Fight` has ever existed on chain
    /// (checked 2026-08-19 — zero instances, zero `fight` events on every
    /// published lineage), so the enum-variant layout has no bytes to pin yet.
    /// It becomes a captured pin the first fight the published lineage opens.
    fn fight_roundtrips_both_fighter_kinds() {
        let fight = Fight {
            id: Id([8; 32]),
            world: "01_first_shore".into(),
            x: 250_000,
            z: 250_100,
            access_a: 0,
            access_b: 255,
            opener_a: Some(Id([9; 32])),
            opener_b: None,
            authorities: vec![
                FighterAuthority::Player {
                    character: Id([9; 32]),
                    owner: Addr([10; 32]),
                },
                FighterAuthority::Mob,
            ],
            combat: CombatState {
                board: GridSpec {
                    width: 14,
                    height: 14,
                    shape_mask: vec![u64::MAX, 7],
                    obstacles: vec![17, 18],
                    holes: vec![40],
                    start_cells_a: vec![1, 2, 3, 4, 5, 6],
                    start_cells_b: vec![190, 191, 192, 193, 194, 195],
                },
                closed: vec![0, u64::MAX],
                fighters: vec![
                    Fighter {
                        team: 0,
                        kind: FighterKind::Player,
                        stats: fighter_stats(10, 200, 6, 3, 20, 10),
                        cell: 3,
                        ready: true,
                        dead: false,
                        settled: false,
                        forfeited: false,
                        hp: 200,
                        ap: 6,
                        mp: 3,
                        drops: vec![RolledDrop {
                            item_type: "wooling_wool".into(),
                            qty: 2,
                        }],
                        effects: vec![],
                        cooldowns: vec![Cooldown {
                            spell: "invisibility".into(),
                            left: 2,
                        }],
                    },
                    Fighter {
                        team: 1,
                        kind: FighterKind::Mob(MobSnapshot {
                            mob_type: "wooling".into(),
                            level: 5,
                            kit: vec![KitSpell {
                                name: "croc".into(),
                                ordinal: 2,
                                level: SpellLevel {
                                    ap_cost: 3,
                                    range_min: 1,
                                    range_max: 1,
                                    modifiable_range: false,
                                    line_of_sight: true,
                                    line_launch: false,
                                    free_cell: false,
                                    casts_per_turn: 2,
                                    casts_per_target: 0,
                                    cooldown_turns: 0,
                                    crit_1_in: 20,
                                    effects: vec![Effect {
                                        kind: 0,
                                        element: "earth".into(),
                                        value: 4,
                                        value_max: 7,
                                        area_shape: 0,
                                        area_size: 0,
                                        target_filter: 0,
                                        chance_bp: 10_000,
                                        turns: 0,
                                        stat: 0,
                                    }],
                                    crit_effects: vec![],
                                },
                            }],
                            xp: 25,
                            loot: vec![LootEntry {
                                item_type: "wooling_wool".into(),
                                chance_bp: 5_000,
                                min_qty: 1,
                                max_qty: 3,
                            }],
                        }),
                        stats: fighter_stats(5, 60, 4, 3, 12, 3),
                        cell: 190,
                        ready: true,
                        dead: false,
                        settled: true,
                        forfeited: false,
                        hp: 60,
                        ap: 4,
                        mp: 3,
                        drops: vec![],
                        effects: vec![],
                        cooldowns: vec![],
                    },
                ],
                zones: vec![BoardZone {
                    owner_fighter: 0,
                    trap: true,
                    shape: 1,
                    size: 2,
                    anchor: 77,
                    turns_left: 0,
                    effects: vec![],
                }],
                queue: vec![0, 1],
                turn_pointer: 0,
                round: 3,
                ended: false,
                winner: None,
                turn_seed: u64::MAX,
                turn_cast_index: 1,
                turn_casts: vec![TurnCast {
                    spell: "croc".into(),
                    target: 0xFFFF_FFFF,
                }],
                placement_started_ms: 1_700_000_000_000,
                turn_started_ms: 1_700_000_060_000,
            },
            dungeon: Some(DungeonTag {
                dungeon: "tangled_aftermath".into(),
                room: 2,
            }),
            door_policy: 13,
            drops_rolled: false,
            next_turn_entropy: 42,
            loot_entropy_ready: true,
        };
        let back = roundtrip(&fight);
        let FighterAuthority::Player { .. } = &back.authorities[0] else {
            panic!("expected player");
        };
        assert_eq!(back.combat.fighters[0].stats.sheet.level, 10);
        let FighterKind::Mob(snapshot) = &back.combat.fighters[1].kind else {
            panic!("expected mob");
        };
        assert_eq!(snapshot.kit[0].level.crit_1_in, 20);
        assert_eq!(back.combat.winner, None);
        assert_eq!(back.dungeon.as_ref().map(|tag| tag.room), Some(2));
    }

    #[test]
    fn trailing_bytes_are_refused() {
        let mut bytes = bcs::to_bytes(&Hp {
            current: 1,
            last_ms: 2,
        })
        .unwrap();
        bytes.push(0xFF);
        assert!(from_bytes::<Hp>(&bytes).is_err());
    }
}
