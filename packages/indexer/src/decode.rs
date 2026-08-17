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
//!   OBJECT fields wrap `Field<K, Id>` (the child rides at its own address).
//!
//! CONTENT TEMPLATES ARE ABSENT by design (README, "the content cut"): item /
//! mob / spell / recipe templates are frozen corpus the repo ships as JSON — the
//! indexer never decodes them. [`World`] survives only for the id → name map
//! zones and boot need.
//!
//! Roundtrip tests prove self-consistency; byte-for-byte pins against LIVE
//! testnet captures land once the package publishes (the old indexer's law).

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

/// `sui::dynamic_field::Field<K, V>` — the DF carrier object. A dynamic OBJECT
/// field is `Field<K, Id>` (the wrapper; the child lives at its own address).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Field<K, V> {
    pub id: Id,
    pub name: K,
    pub value: V,
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

/// `world::World` — decoded ONLY for the id → name map (content is corpus).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct World {
    pub id: Id,
    pub name: String,
    pub content: WorldContent,
}

/// `world_map::WorldContent` — the immutable authored payload embedded by `world::World`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldContent {
    pub mobs: Vec<MobRow>,
    pub resources: Vec<ResourceRow>,
    pub dungeon_key: Option<String>,
    pub dungeon_rooms: Vec<DungeonRoom>,
    pub biome_map: BiomeMap,
}

/// `world_map::BiomeMap` — one biome id per zone; the spawn filter's ground truth.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiomeMap {
    pub zone_x0: u32,
    pub zone_z0: u32,
    pub side: u16,
    pub cells: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobRow {
    pub mob_type: String,
    pub weight_bp: u16,
    pub biomes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceRow {
    pub item_type: String,
    pub job: String,
    pub tier: u8,
    pub protector: String,
    pub rare_item_type: String,
    pub biomes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DungeonRoom {
    pub mobs: Vec<RoomMob>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomMob {
    pub mob_type: String,
    pub level_scalar: u8,
}

// ╔════════════════ [ aresrpg::zone — World DF ] ═════════════════════════════ ]

/// `zone::ZoneKey { zx, zz }` — the DF key on the World UID.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ZoneKey {
    pub zx: u32,
    pub zz: u32,
}

/// `zone::Zone` — the whole cost of a discovered zone.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Zone {
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
    pub world: String,
    pub room: u64,
    pub x: u32,
    pub z: u32,
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
    pub board: GridSpec,
    pub closed: Vec<u64>,
    pub access_a: u8,
    pub access_b: u8,
    pub opener_a: Option<Id>,
    pub opener_b: Option<Id>,
    pub fighters: Vec<Fighter>,
    pub zones: Vec<BoardZone>,
    pub queue: Vec<u64>,
    pub turn_ptr: u64,
    pub round: u64,
    pub ended: bool,
    pub winner: Option<u8>,
    pub dungeon: Option<u64>,
    pub managed: bool,
    pub wagered: bool,
    pub drops_rolled: bool,
    pub turn_seed: u64,
    pub turn_slot: u64,
    pub turn_casts: Vec<TurnCast>,
    pub placement_ms: u64,
    pub turn_started_ms: u64,
}

/// `fight::FighterKind` — Player holds custody refs; Mob is a value snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FighterKind {
    Player { character: Id, owner: Addr },
    Mob(MobSnapshot),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fighter {
    pub team: u8,
    pub kind: FighterKind,
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
pub struct MobSnapshot {
    pub mob_type: String,
    pub level: u64,
    pub max_hp: u64,
    pub ap: u64,
    pub mp: u64,
    pub agility: u64,
    pub wisdom: u64,
    pub earth_res: u64,
    pub fire_res: u64,
    pub water_res: u64,
    pub air_res: u64,
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
/// The wrapper is `Field<FighterKey, Id>`; the child is the seated Character.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FighterKey(pub u64);

// ╔════════════════ [ aresrpg::party / friends ] ═════════════════════════════ ]

/// `party::Party` — `members[0]` is the leader (derived, never stored).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Party {
    pub id: Id,
    pub members: Vec<Member>,
    pub pending: Vec<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Member {
    pub character: Id,
    pub owner: Addr,
}

/// `friends::FriendList` — a soulbound, DIRECTED whitelist.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendList {
    pub id: Id,
    pub owner: Addr,
    pub friends: VecSet<Addr>,
}

// ╔════════════════ [ aresrpg::kolizeum / shop / version ] ═══════════════════ ]

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

/// `shop::Sale` — the vending machine; `supply` is the only field that moves.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sale {
    pub id: Id,
    pub item_type: String,
    pub template: Id,
    pub price: u64,
    pub supply: u64,
}

/// `shop::Airdrop` — the whitelist IS the claim state (shrinks per claim).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Airdrop {
    pub id: Id,
    pub drop_id: String,
    pub template: Id,
    pub amount_each: u32,
    pub whitelist: VecSet<Addr>,
}

/// `shop::Giftcard` — the zksend-portable voucher.
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: Id,
    pub a: Addr,
    pub b: Addr,
    pub version: u64,
    pub accept_a: bool,
    pub accept_b: bool,
    pub locked: bool,
    pub sui_a: Balance,
    pub sui_b: Balance,
    pub caps_a: Vec<Id>,
    pub caps_b: Vec<Id>,
}

// ╔════════════════ [ Tests — roundtrip self-consistency ] ═══════════════════ ]

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

    #[test]
    fn character_roundtrips() {
        let chr = Character {
            id: Id([1; 32]),
            name: "aiden".into(),
            classe: "sram".into(),
            sex: "male".into(),
            experience: 12_345,
            level: 42,
            color_1: 0xFFFFFF,
            color_2: 0,
            color_3: 0x8B0000,
            vitality: 10,
            wisdom: 0,
            strength: 100,
            intelligence: 0,
            chance: 0,
            agility: 55,
            available_points: 5,
            available_spell_points: 3,
        };
        let back = roundtrip(&chr);
        assert_eq!(back.name, "aiden");
        assert_eq!(back.level, 42);
        assert_eq!(back.id.hex(), format!("0x{}", "01".repeat(32)));
    }

    #[test]
    fn marker_key_field_roundtrips() {
        // Field<HpKey, Hp> — the marker key is one hidden bool byte.
        let field = Field {
            id: Id([2; 32]),
            name: false as MarkerKey,
            value: Hp {
                current: 137,
                last_ms: 1_700_000_000_000,
            },
        };
        let back: Field<MarkerKey, Hp> = roundtrip(&field);
        assert_eq!(back.value.current, 137);
    }

    #[test]
    fn job_xp_field_roundtrips() {
        let field = Field {
            id: Id([3; 32]),
            name: JobXpKey("tool_miner".into()),
            value: 4_242u64,
        };
        let back: Field<JobXpKey, u64> = roundtrip(&field);
        assert_eq!(back.name.0, "tool_miner");
        assert_eq!(back.value, 4_242);
    }

    #[test]
    fn zone_field_roundtrips_with_u128_bitmap() {
        let field = Field {
            id: Id([4; 32]),
            name: ZoneKey { zx: 488, zz: 511 },
            value: Zone {
                seed: u32::MAX as u64,
                searched_at_ms: 1_700_000_000_000,
                mob_taken: (1u128 << 127) | 0b101,
                res_taken: vec![0, 3, 1],
            },
        };
        let back: Field<ZoneKey, Zone> = roundtrip(&field);
        assert_eq!(back.value.mob_taken, (1u128 << 127) | 0b101);
        assert_eq!(back.name.zx, 488);
    }

    #[test]
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
    fn fight_roundtrips_both_fighter_kinds() {
        let fight = Fight {
            id: Id([8; 32]),
            world: "01_first_shore".into(),
            x: 250_000,
            z: 250_100,
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
            access_a: 0,
            access_b: 255,
            opener_a: Some(Id([9; 32])),
            opener_b: None,
            fighters: vec![
                Fighter {
                    team: 0,
                    kind: FighterKind::Player {
                        character: Id([9; 32]),
                        owner: Addr([10; 32]),
                    },
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
                        max_hp: 60,
                        ap: 4,
                        mp: 3,
                        agility: 12,
                        wisdom: 3,
                        earth_res: 32768,
                        fire_res: 32768,
                        water_res: 32700,
                        air_res: 32768,
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
            turn_ptr: 0,
            round: 3,
            ended: false,
            winner: None,
            dungeon: Some(2),
            managed: true,
            wagered: false,
            drops_rolled: false,
            turn_seed: u64::MAX,
            turn_slot: 1,
            turn_casts: vec![TurnCast {
                spell: "croc".into(),
                target: 0xFFFF_FFFF,
            }],
            placement_ms: 1_700_000_000_000,
            turn_started_ms: 1_700_000_060_000,
        };
        let back = roundtrip(&fight);
        assert!(matches!(back.fighters[0].kind, FighterKind::Player { .. }));
        let FighterKind::Mob(snapshot) = &back.fighters[1].kind else {
            panic!("expected mob");
        };
        assert_eq!(snapshot.kit[0].level.crit_1_in, 20);
        assert_eq!(back.winner, None);
        assert_eq!(back.dungeon, Some(2));
    }

    #[test]
    fn fighter_custody_wrapper_roundtrips() {
        // Field<FighterKey(seat), Id> — the dof wrapper naming the seat.
        let field = Field {
            id: Id([11; 32]),
            name: FighterKey(4),
            value: Id([9; 32]),
        };
        let back: Field<FighterKey, Id> = roundtrip(&field);
        assert_eq!(back.name.0, 4);
    }

    #[test]
    fn kiosk_listing_field_roundtrips() {
        // Field<Listing{id, is_exclusive}, u64-price>.
        let field = Field {
            id: Id([12; 32]),
            name: KioskListingKey {
                id: Id([5; 32]),
                is_exclusive: true,
            },
            value: 1_500_000_000u64,
        };
        let back: Field<KioskListingKey, u64> = roundtrip(&field);
        assert!(back.name.is_exclusive);
        assert_eq!(back.value, 1_500_000_000);
    }

    #[test]
    fn kolizeum_roundtrips_with_friends_snapshot() {
        let lobby = Kolizeum {
            id: Id([13; 32]),
            pot: Balance {
                value: 2_000_000_000,
            },
            pledge: 1_000_000_000,
            fight: Id([8; 32]),
            format: 3,
            level_min: 20,
            level_max: 60,
            allowed: Some(VecSet {
                contents: vec![Addr([10; 32]), Addr([14; 32])],
            }),
        };
        let back = roundtrip(&lobby);
        assert_eq!(back.pot.value, 2_000_000_000);
        assert_eq!(back.allowed.unwrap().contents.len(), 2);
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
