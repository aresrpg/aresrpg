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
//! TESTS (L-D4): `test/core/captured.rs` pins the layout-bearing twins against captured
//! payloads with their provenance. A self-round-trip proves only internal consistency.

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

/// `item::Item` — a minted item (rolled stats/damages/feed ride as DFs).
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

/// `item::RolledStats` — one value of `Field<StatsKey, RolledStats>` on a rolled item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolledStats {
    pub statistics: ItemStatistics,
    pub puits: u64,
    pub revision: u64,
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
    pub rewards: FightRewards,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightRewards {
    pub weight: u64,
    pub paid: Option<u64>,
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

/// `version::Version` — the live-code gate (→ `:Meta.version`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Version {
    pub id: Id,
    pub version: u64,
}

// ╔════════════════ [ 0x2 natives — kiosk / purchase caps ] ══════════════════ ]

/// `sui::kiosk::Kiosk` — `owner` is cosmetic. Personal caps and markers own custody.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Kiosk {
    pub id: Id,
    pub profits: Balance,
    pub owner: Addr,
    pub item_count: u32,
    pub allow_extensions: bool,
}

/// `sui::transfer_policy::TransferPolicy<T>` — `balance` holds what its installed rules collected;
/// `rules` are the installed rule type names.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferPolicy {
    pub id: Id,
    pub balance: Balance,
    pub rules: VecSet<String>,
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
    pub kares_a: Balance,
    pub kares_b: Balance,
    pub caps_a: Vec<Id>,
    pub caps_b: Vec<Id>,
}

// ╔════════════════ [ Tests — captured-byte layout pins ] ════════════════════ ]

/// SUI custody is native; an optional separate pool holds Economy-bound KARES.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tournament {
    pub id: Id,
    pub name: String,
    pub status: String,
    pub organizer: Addr,
    pub format: u64,
    pub start_before_ms: u64,
    pub sui_bps: Vec<u64>,
    pub token_bps: Vec<u64>,
    pub rewards: Vec<TournamentReward>,
    pub sui: Balance,
    pub sui_total: u64,
    pub kares_pool: Option<Id>,
    pub teams: Vec<TournamentTeam>,
    pub matches: Vec<TournamentMatch>,
    pub fights: Vec<Option<Id>>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentRules {
    pub entry_fee_mist: u64,
    pub max_level: Option<u16>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentReward {
    pub place: u8,
    pub template: Id,
    pub amount: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentSeat {
    pub character: Id,
    pub owner: Addr,
    pub sui_claimed: bool,
    pub items_claimed: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentTeam {
    pub name: String,
    pub revision: u64,
    pub allowed: Vec<Id>,
    pub seats: Vec<TournamentSeat>,
    pub place: u8,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentMatch {
    pub a: Option<u64>,
    pub b: Option<u64>,
    pub available_ms: u64,
    pub state: u8,
    pub winner: Option<u64>,
    pub loser: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentKaresPool {
    pub id: Id,
    pub funds: TournamentFunds,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TournamentFunds {
    pub balance: Balance,
    pub paid: u64,
    pub claimed: VecSet<Id>,
    pub refunded: bool,
}
