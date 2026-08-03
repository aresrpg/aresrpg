// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Typed AresRPG (and native kiosk) event bodies — the BCS decode targets.
//!
//! Each struct mirrors an on-chain `event::emit` payload **field-for-field, in
//! order** — BCS is positional, so the field order here is load-bearing and must
//! track the Move source (`packages/move/*/sources/*.move`). Move type → Rust:
//! `ID`/`address` → [`ObjectID`]/[`SuiAddress`] (32 bytes in BCS, `0x…` hex in
//! JSON — exactly the dual we want: decode from checkpoint bytes, serialize into
//! Redis as strings), `String` → `String`, `Option<u64>` → `Option<u64>`, the
//! integer/bool primitives map directly.
//!
//! Only events that project into a read-model view are typed here; recognised-
//! but-deferred events (gathering activity, world-object mutations, item
//! merge/split, policies, catalog) are object/DF state and land with object-
//! snapshot indexing — see `project.rs` for the deliberate gaps. Per-job XP is one
//! such DF and IS now object-snapshotted ([`JobXpField`], `snapshot.rs`): no event
//! carries the absolute per-character total (the gather/forgemagie events carry a
//! DELTA and no character id), so it projects from the `JobXpKey` dynamic field.

use serde::{Deserialize, Serialize};
use sui_indexer_alt_framework::types::base_types::{ObjectID, SuiAddress};

// ── aresrpg_pools::pool ──────────────────────────────────────────────────────

/// `PoolBuy` and `PoolSell` both carry the **post-trade absolute** reserves
/// (`item_reserve`, `real_sui`), so the projection is an idempotent `JSON.SET`
/// of the new reserves — no relative accumulation, replay-safe.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolBuy {
    pub pool: ObjectID,
    pub template: ObjectID,
    pub buyer: SuiAddress,
    pub quantity: u64,
    pub sui_in: u64,
    pub item_reserve: u64,
    pub real_sui: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolSell {
    pub pool: ObjectID,
    pub template: ObjectID,
    pub seller: SuiAddress,
    pub quantity: u64,
    pub gross: u64,
    pub royalty: u64,
    pub net: u64,
    pub item_reserve: u64,
    pub real_sui: u64,
}

// ── aresrpg_items::shop ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleCreated {
    pub sale: ObjectID,
    pub template: ObjectID,
    pub price: u64,
    pub supply: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleBurned {
    pub sale: ObjectID,
    pub template: ObjectID,
    pub minted: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleBought {
    pub sale: ObjectID,
    pub template: ObjectID,
    pub buyer: SuiAddress,
    pub item: ObjectID,
    pub price: u64,
    pub amount: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalePaused {
    pub sale: ObjectID,
    pub paused: bool,
}

/// `aresrpg_items::shop::PriceChanged` — note the module: `creation` has its own
/// `PriceChanged` with a different shape, disambiguated by module in `map`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShopPriceChanged {
    pub sale: ObjectID,
    pub price: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowChanged {
    pub sale: ObjectID,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
}

// ── aresrpg_items::creation ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterCreated {
    pub character: ObjectID,
    pub name: String,
    pub class: String,
    pub price: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreationPriceChanged {
    pub price: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PausedSet {
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassName {
    pub class: String,
}

/// `SponsorSet { sponsor: Option<address> }` — the gas-station address that
/// sponsors free character creation (the publish ceremony sets it before enabling,
/// and asserts it back over the RPC). `None` = self-pay.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SponsorSet {
    pub sponsor: Option<SuiAddress>,
}

/// `FreeEnabledSet { enabled }` — whether creation is currently free (sponsor pays).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeEnabledSet {
    pub enabled: bool,
}

// ── aresrpg_items::character ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterMinted {
    pub character: ObjectID,
    pub class: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionAnchored {
    pub character: ObjectID,
    pub pos_x: u32,
    pub pos_z: u32,
    pub zone: String,
    pub anchored_at_ms: u64,
}

// ── aresrpg::stat_allocation ─────────────────────────────────────────────────

/// `StatRaised { character, stat, points, stat_total }` — the player spent `points`
/// stat points to raise stat index `stat` (0..6: vitality/wisdom/strength/
/// intelligence/agility/chance — character_link.move STAT_* constants), whose NEW
/// allocated total is `stat_total`. The projection stores the ABSOLUTE per-stat
/// total (`stat_total`, idempotent/replay-safe); the /v1/characters view derives
/// `available_points = max(0, (level−1)×5 − Σ allocations)` — the flat 1:1 cost
/// makes `Σ allocations == stat_points_spent` (stat_allocation.move charges the same
/// `points` to spent AND to the stat), so no separate spent counter is needed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatRaised {
    pub character: ObjectID,
    pub stat: u8,
    pub points: u64,
    pub stat_total: u64,
}

// ── aresrpg_items::item ──────────────────────────────────────────────────────

/// `TemplateCreated` and `TemplateBurned` share this shape (encyclopedia liveness).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub template: ObjectID,
    pub item_type: String,
}

/// `TemplateRenamed` carries the in-place template id plus its new display name.
/// Description remains object-snapshot truth because the event intentionally omits it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateRenamed {
    pub template: ObjectID,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemMinted {
    pub item: ObjectID,
    pub template: ObjectID,
    pub item_type: String,
    pub amount: u64,
}

// ── aresrpg_items::extract ───────────────────────────────────────────────────

/// `ItemEquipped` and `ItemUnequipped` share this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemEquip {
    pub character: ObjectID,
    pub item: ObjectID,
    pub template: ObjectID,
    pub amount: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemBurned {
    pub item: ObjectID,
    pub template: ObjectID,
    pub amount: u64,
}

// -- aresrpg::pet -------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetPowerAdvanced {
    pub pet: ObjectID,
    pub feeder: SuiAddress,
    pub feed_count: u64,
    pub next_feed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FoodPowerSet {
    pub food_template: ObjectID,
    pub power_per_unit: u64,
}

// ── aresrpg_game::world ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldCreated {
    pub world: ObjectID,
    pub seed: u64,
    pub biome: String,
}

// §6 golden-gather authored links (base resource template → its rare variant). The
// gather roll reads the on-chain DF; these events let the read-model expose which
// resources have a jackpot variant (and which id to present as the gather param).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RareLinkSet {
    pub world: ObjectID,
    pub template: ObjectID,
    pub rare_template: ObjectID,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RareLinkCleared {
    pub world: ObjectID,
    pub template: ObjectID,
}

// ── aresrpg_game::zones ──────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldJoined {
    pub world: ObjectID,
    pub character: ObjectID,
    pub x: u32,
    pub z: u32,
    pub first_join: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneSearched {
    pub world: ObjectID,
    pub zx: u32,
    pub zy: u32,
    pub at_ms: u64,
    pub mob_groups: u64,
    pub resource_nodes: u64,
}

// `MobGroupClaimed` carries (x,z)+spawn_id but NOT the zone grid (zx,zy), so it still cannot
// target a zone doc (live depletion stays the Zone-DF snapshot's job — `mob_groups` reflects the
// last ZoneSearched). It IS projected, though, for one fact it uniquely carries at the world-fight
// door: `template` — the mob-group's homogeneous `MobTemplate` id. The GroupTicket provenance hands
// this identical id to `fight::create` as `content_template` → `fight.group.template` (zones.move
// emits the event + the ticket with the SAME `template_id` in the SAME PTB), so it is the id the
// /v1/fights view joins by (world, spawn_id) to NAME a fight's mobs. Field order mirrors zones.move.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobGroupClaimed {
    pub world: ObjectID,
    pub character: ObjectID,
    pub spawn_id: u64,
    pub template: ObjectID,
    pub x: u32,
    pub z: u32,
    pub group_size: u16,
}

// ── aresrpg::gathering ───────────────────────────────────────────────────────

/// `ProtectorTriggered { world, gatherer, template, x, z, spawn_id }` — a gather roll
/// spawned a resource-protector ambush fight (§17.22). `spawn_id` is the ambush fight's
/// per-world handle (`0` = SKIPPED — the gatherer was already in a fight, so no ambush).
/// The gatherer is auto-seated in the fight (fight::create_protector_fight → engine::
/// create emits FightJoined for the creator), so the fight itself is already discoverable
/// via `/v1/fights?character=`; this projection keys the SIGNAL by gatherer ADDRESS so
/// the gatherer's client can react ("your gather triggered an ambush at (x,z)") + carries
/// the spawn_id/template/where context. Latest-wins per gatherer (the newest trigger).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectorTriggered {
    pub world: ObjectID,
    pub gatherer: SuiAddress,
    pub template: ObjectID,
    pub x: u32,
    pub z: u32,
    pub spawn_id: u64,
}

// ── aresrpg_game::config ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigEnabledSet {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialChanged {
    pub dial: String,
    pub value: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassRowSet {
    pub class_id: u64,
    pub base_hp: u64,
    pub base_ap: u64,
    pub base_mp: u64,
}

// ── aresrpg::dungeon_events ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunActivated {
    pub pass: ObjectID,
    pub world: ObjectID,
    pub player: SuiAddress,
    pub character: ObjectID,
}

/// `PassEnteredFight` links a run to the `aresrpg_fight::Fight` its current room
/// latched (NEXT-FIGHT or party-join) — the edge the RPC groups a dungeon's live
/// fights through.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassEnteredFight {
    pub pass: ObjectID,
    pub fight: ObjectID,
    pub world: ObjectID,
    pub player: SuiAddress,
    pub room: u16,
    pub character: ObjectID,
}

/// `RunAdvanced` — a room victory bumped the pass to a new (1-based) room; the
/// pass lives on and its prior fight is settled.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunAdvanced {
    pub pass: ObjectID,
    pub world: ObjectID,
    pub player: SuiAddress,
    pub room: u16,
    pub character: ObjectID,
}

/// `RunEnded` — the run's pass was consumed (abandon/defeat/completion) and the
/// on-chain RunPass object DELETED. `player` (the bound owner) rides the event, so
/// the per-owner index is cleanable with no monotonic wart (unlike the fight indexes).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunEnded {
    pub pass: ObjectID,
    pub world: ObjectID,
    pub player: SuiAddress,
    pub reason: u8,
    pub return_x: u32,
    pub return_z: u32,
    pub character: ObjectID,
}

// ── aresrpg_kolizeum::kolizeum_events ─────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KolizeumCreated {
    pub kolizeum: ObjectID,
    pub creator: SuiAddress,
    pub format_slots: u64,
    pub pledge_amount: u64,
    pub is_public: bool,
}

// `KolizeumJoined` / `KolizeumExited` are recognised-but-deferred: partial-fill
// roster / live join counts are object state (an exit carries no side, so a fold
// cannot stay consistent) — the lobby view serves the lifecycle status instead.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KolizeumCancelled {
    pub kolizeum: ObjectID,
    pub refunded_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KolizeumStarted {
    pub kolizeum: ObjectID,
    pub side_a: u64,
    pub side_b: u64,
}

/// Field order mirrors `aresrpg_kolizeum::kolizeum_events::KolizeumSettled { kolizeum,
/// winning_side, pot, fee, winners }` byte-for-byte — `fee` (the 10% platform cut) was
/// INSERTED between `pot` and `winners` by the 2026-07-12 fresh publish (a ratified treasury
/// split). BCS is positional: omitting `fee` desyncs `winners` and every decode fails outright
/// (trailing bytes) — settled lobbies would be silently dropped and stuck on "started" forever.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KolizeumSettled {
    pub kolizeum: ObjectID,
    pub winning_side: u8,
    pub pot: u64,
    pub fee: u64,
    pub winners: u64,
}

/// `KolizeumDrawn { kolizeum, refunded_total }` — a mutual-wipe draw (§17.9) that
/// refunds every pledge; a distinct terminal from Settled (a winner took the pot)
/// and Cancelled (never fought). Same shape as `KolizeumCancelled`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KolizeumDrawn {
    pub kolizeum: ObjectID,
    pub refunded_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KolizeumSwept {
    pub kolizeum: ObjectID,
}

// `KolizeumOutcomeOpened { fight, character }` (added with the aresrpg_kolizeum
// split) is recognised-but-deferred: it fires when a seat's arena `FightOutcome`
// is consumed at `open` (zero xp/loot §17.9). Both durable effects are already
// projected elsewhere — the consumed FightOutcome object's DELETE rides the
// `ares_snapshot` pipeline (`remove_pending_outcome` → `/v1/pending-outcomes`),
// and the arena `Fight` is destroyed at engine settle (`fight_events::Settled`/
// `Swept` → fight-doc delete). The event carries no `outcome_id`/`owner` to key
// `/v1/pending-outcomes`, and clearing `char_fight` would race a late `open`
// after a new fight-join (a pure `map` cannot compare-and-clear) — so no view
// consumes it (see HANDLERS.md deferred).

// ── aresrpg_fight::fight_events (+ aresrpg::results) ──────────────────────────
// Fight lifecycle + ResultMinted are Move module `fight_events` in the ENGINE
// package `aresrpg_fight`; ResultOpened/ResultBurned are emitted by the CORE
// package's `aresrpg::results` claim door (module `results`) — both matched by
// (module, name) in `map`. Only events projected into a view are typed; the
// granular board/turn events (Placed/Ready/Moved/Cast/Hit/TurnEnded) and
// LootMinted are deferred — the live board rides the presence layer + the
// client's sim replay (see HANDLERS.md).

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightCreated {
    pub fight: ObjectID,
    pub world: ObjectID,
    pub spawn_id: u64,
    pub anchor_x: u32,
    pub anchor_z: u32,
    pub public_fight: bool,
    pub aged_bp: u64,
    pub mob_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightJoined {
    pub fight: ObjectID,
    pub character: ObjectID,
    pub seat: u64,
}

/// Field order mirrors `aresrpg_fight::fight_events::TurnStarted { fight, is_mob, idx,
/// deadline_ms, turn_entropy, turn_ordinal }` byte-for-byte. The trailing `turn_entropy`/
/// `turn_ordinal` pair publishes the inputs `fight::turn_seed` hangs on (the client derives
/// this turn's rolls the instant the turn opens); it was APPENDED on chain while this mirror
/// stayed 4 fields wide. BCS refuses trailing input, so every `TurnStarted` ever emitted failed
/// to decode — and `TurnStarted` is the ONLY writer of `$.status = "active"`, so every fight in
/// the read layer stayed `placement` forever while the chain had already started it (#1579).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnStarted {
    pub fight: ObjectID,
    pub is_mob: bool,
    pub idx: u64,
    pub deadline_ms: u64,
    pub turn_entropy: u64,
    pub turn_ordinal: u64,
}

/// `MobMoved { fight, idx, to_cell }` — a MOB repositioned during its turn (keyed by
/// `idx`, the mob's slot, since mobs have no standalone object). Unlike the player
/// `Moved` (deferred — the mover's own client broadcasts its motion over the presence
/// layer), a mob has NO p2p broadcaster, so its reposition is observable ONLY via this
/// chain event; the fight_events.move doc names the indexer as the intended consumer.
/// Projected as the mob's LATEST cell on the fight doc (`$.mob_positions[idx]`) — a
/// snapshot on the resync primitive, NOT a new event-stream (none exists; the granular
/// board rides the presence layer + client sim replay — SPEC §14). Idempotent absolute set.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobMoved {
    pub fight: ObjectID,
    pub idx: u64,
    pub to_cell: u64,
}

/// `Victory { fight, aged_bp }` — aged_bp is already on the doc; only the status flips.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightVictory {
    pub fight: ObjectID,
    pub aged_bp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightSettled {
    pub fight: ObjectID,
    pub outcome: u8,
    pub results: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultMinted {
    pub result: ObjectID,
    pub fight: ObjectID,
    pub character: ObjectID,
    pub owner: SuiAddress,
    pub outcome: u8,
    pub xp_share: u64,
    pub final_hp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultOpened {
    pub result: ObjectID,
    pub character: ObjectID,
    pub xp_share: u64,
    pub loot_units: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightDefeat {
    pub fight: ObjectID,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightSwept {
    pub fight: ObjectID,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultBurned {
    pub result: ObjectID,
}

// ── fight board/turn events → the per-fight ORDERED JOURNAL (`journal.rs`, #216) ──
// The granular timeline the observer replays: Placed/Ready/Moved/MobMoved/Displaced/
// Cast/Hit/Drain/Tackled/Revealed/StanceChanged/CriticalFailure/TurnEnded/Abandoned,
// plus the lifecycle anchors (FightCreated/FightJoined/TurnStarted/Victory/Defeat/
// Settled/Swept — reused from the fight-doc structs above). These were the deferred
// board/turn family (see the deferred note); the journal now serves them as an ordered
// event log WITHOUT re-deriving board state. Every struct's FIRST field is `fight: ID`
// (the journal key) and mirrors `fight_events.move` field-for-field, in order (BCS is
// positional). The action-envelope triple (`ActionStarted`/`ActionEffect`/
// `ActionResolved`) is DEFERRED from the journal: `ActionEffect`/`ActionResolved` carry
// nested `Effect`/`SpellLevel`/`WeaponLine` vectors (the modelling liability `snapshot.rs`
// avoids), the client consumes none of the triple today (SDK `FIGHT_EVENT_NAMES`), and per
// the pipeline-v2 amendment they ENRICH beats, never trigger them — so they ride a later
// milestone as one unit. Only these flat scalar structs are journalled here.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Placed {
    pub fight: ObjectID,
    pub character: ObjectID,
    pub cell: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ready {
    pub fight: ObjectID,
    pub character: ObjectID,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Moved {
    pub fight: ObjectID,
    pub character: ObjectID,
    pub to_cell: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cast {
    pub fight: ObjectID,
    pub caster_is_mob: bool,
    pub caster_idx: u64,
    pub target_cell: u64,
}

/// A spell/trap PUSH/PULL or caster TELEPORT — `kind` is the mechanics code (push/pull/
/// teleport), distinct from the event-struct name the journal stores as `kind` alongside.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Displaced {
    pub fight: ObjectID,
    pub target_is_mob: bool,
    pub target_idx: u64,
    pub kind: u8,
    pub from_cell: u64,
    pub to_cell: u64,
    pub requested: u64,
    pub blocked: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriticalFailure {
    pub fight: ObjectID,
    pub caster_is_mob: bool,
    pub caster_idx: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StanceChanged {
    pub fight: ObjectID,
    pub fighter_is_mob: bool,
    pub fighter_idx: u64,
    pub stance: u64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Revealed {
    pub fight: ObjectID,
    pub is_mob: bool,
    pub idx: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hit {
    pub fight: ObjectID,
    pub victim_is_mob: bool,
    pub victim_idx: u64,
    pub amount: u64,
    pub remaining_hp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Drain {
    pub fight: ObjectID,
    pub target_is_mob: bool,
    pub target_idx: u64,
    pub point_kind: u8,
    pub removed: u64,
    pub requested: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tackled {
    pub fight: ObjectID,
    pub runner_is_mob: bool,
    pub runner_idx: u64,
    pub ap_lost: u64,
    pub mp_lost: u64,
    pub num: u64,
    pub den: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnEnded {
    pub fight: ObjectID,
    pub is_mob: bool,
    pub idx: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Abandoned {
    pub fight: ObjectID,
    pub character: ObjectID,
    pub seat: u64,
}

// ── aresrpg::commission (v2 artisan-commission flow) ──────────────────────────
// commission.move v2 (as of 2026-07-11/12): the CUSTOMER brings the RESOURCES
// + an OPTIONAL payment; the ARTISAN brings the KNOWLEDGE. `request` opens a shared
// CraftRequest (the ingredients stay kiosk-locked in the customer's kiosk, never
// escrowed); `accept` records the artisan's proven job level + character; `execute`
// runs the craft on the customer's kiosk (rolls the crafting success chance, mints-on-
// success, releases the escrow to the artisan) and DELETES the request; `cancel`
// refunds the customer. Field order mirrors each `event::emit` payload byte-for-byte
// (BCS is positional). `CraftExecuted`/`CraftCancelled` BOTH carry customer AND
// artisan, so the two directory indexes clean EXACTLY (the v1 cancel's artisan-index
// wart is gone). The separate `CraftXpRedeemed` (the artisan banks their XP voucher)
// is activity → object/DF state (job xp) and is DEFERRED like the other craft-activity
// events (no /v1 view keys it) — see the project.rs deferred note.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CraftRequested {
    pub request: ObjectID,
    pub customer: SuiAddress,
    pub artisan: SuiAddress,
    pub recipe: ObjectID,
    pub amount: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CraftAccepted {
    pub request: ObjectID,
    pub artisan: SuiAddress,
    pub artisan_level: u64,
    pub artisan_character: ObjectID,
}

/// Field order mirrors `aresrpg::commission::CraftExecuted { request, customer, artisan, recipe,
/// amount, fee, success, artisan_xp }` byte-for-byte — `fee` (the 10% platform cut) was INSERTED
/// between `amount` and `success` by the 2026-07-12 fresh publish (a ratified treasury split).
/// BCS is positional: omitting `fee` desyncs `success`/`artisan_xp` and the decode fails outright
/// (trailing bytes) — completed commissions would be silently dropped and never clear from the
/// /v1 pending lists.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CraftExecuted {
    pub request: ObjectID,
    pub customer: SuiAddress,
    pub artisan: SuiAddress,
    pub recipe: ObjectID,
    pub amount: u64,
    pub fee: u64,
    pub success: bool,
    pub artisan_xp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CraftCancelled {
    pub request: ObjectID,
    pub customer: SuiAddress,
    pub artisan: SuiAddress,
    pub amount: u64,
}

// ── native Sui kiosk (0x2::kiosk) — the marketplace-listing feed ─────────────

/// `0x2::kiosk::ItemListed<T>` / `ItemPurchased<T>` — the phantom `T` is not in
/// the serialized body, so this decodes any kiosk list/purchase.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KioskItemListed {
    pub kiosk: ObjectID,
    pub id: ObjectID,
    pub price: u64,
}

/// `0x2::kiosk::ItemDelisted<T>` — no price.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KioskItemDelisted {
    pub kiosk: ObjectID,
    pub id: ObjectID,
}

// ── OBJECT-SNAPSHOT decode targets (S-15c) ───────────────────────────────────
// Not events: these mirror the on-chain OBJECT contents (`MoveObject::contents()`)
// field-for-field, in order — the snapshot pipeline BCS-decodes a live object's
// bytes. A Move `UID` serializes as its bare 32-byte ObjectID (nested structs are
// flattened, no length prefix), so the leading `id: ObjectID` consumes exactly the
// UID. Verified byte-for-byte against a live testnet Character (94 bytes).

/// `aresrpg::character::Character` object contents. Carries the chain-ratified base
/// fields — the cosmetics (`male` + `customization` colours) and base `experience`
/// live ONLY here (no event carries them), which is why presence rendering needs
/// the object snapshot (HANDLERS.md). `anchor`/`created_at_ms` are decoded to
/// consume the trailing bytes but not projected (position rides `zones` events).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterObject {
    pub id: ObjectID,
    pub name: String,
    pub class: String,
    pub male: bool,
    pub customization: Customization,
    pub experience: u64,
    pub created_at_ms: u64,
    pub anchor: PositionAnchor,
}

/// The three cosmetic colours (24-bit RGB each) — `aresrpg::character::Customization`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Customization {
    pub color_1: u32,
    pub color_2: u32,
    pub color_3: u32,
}

/// `aresrpg::character::PositionAnchor` — the last-anchored world position (empty
/// zone + zeros = never anchored). Decoded for byte-completeness only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionAnchor {
    pub pos_x: u32,
    pub pos_z: u32,
    pub zone: String,
    pub anchored_at_ms: u64,
}

/// The contents of one per-job XP dynamic field —
/// `0x2::dynamic_field::Field<extension::NsKey<character_link::JobXpKey>, u64>`, attached
/// DIRECTLY to a Character's UID (so the Field's checkpoint `ObjectOwner` IS the character).
/// `value` is the ABSOLUTE running job-xp total `character_link::add_job_xp` banks on every
/// gather / craft / forgemagie (§6/§8) — the snapshot reads the total straight off the object
/// (no event carries it: the gather `ResourceGathered` / forgemagie `RuneScribed` events carry
/// a DELTA and no character id, so they cannot drive a replay-safe per-character projection).
/// BCS is positional and flattens nested one-field structs with NO framing, so the wire is
/// `id: UID(32) | namespace: u8 | job: u8 | value: u64` (42 bytes): the `NsKey { namespace, key:
/// JobXpKey { job } }` envelope decodes as the two leading `u8`s. `namespace` is the reserved
/// `NS_CHARACTER_WORLD` byte (2); the projection keys `$.jobs` by `job`. The key TYPE PARAMETER
/// (`snapshot::is_job_xp_key`) — not these bytes — discriminates this from the byte-identical
/// `StatAllocKey` field (same namespace, same `{u8} -> u64` shape).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobXpField {
    pub id: ObjectID,
    pub namespace: u8,
    pub job: u8,
    pub value: u64,
}

/// The contents of a character's LIVE progression dynamic field —
/// `0x2::dynamic_field::Field<extension::NsKey<character_link::ProgressionKey>,
/// character_link::Progression>`, attached DIRECTLY to a Character's UID (so the Field's checkpoint
/// `ObjectOwner` IS the character, exactly like [`JobXpField`]). Born on the first fight xp/hp write.
/// `hp` is the RAW stored current HP (write-back after a fight; §17.23) and `hp_updated_ms` the lazy-
/// regen last-touch stamp (ANNEX §5.4) — both projected RAW (`$.current_hp` / `$.hp_updated_ms`) so
/// the CLIENT owns the natural-regen math; the indexer NEVER pre-computes regen (re-stamping without
/// the remainder carry is the banked lazy-accrual bug class — it just serves the raw fields). `xp` /
/// `level` are projected as the latest absolute `$.experience` / `$.level`, superseding the base-object
/// values after a fight mutation. `ProgressionKey {}` is declared zero-field, but an EMPTY Move struct
/// serializes as ONE hidden `dummy_field: bool` byte (proven against the live wire — P1
/// xp-reset-on-refresh, 2026-07-17: the model without it failed `bcs::from_bytes` on EVERY real DF, so
/// `/v1` never carried XP/HP). The `NsKey { namespace, key }` envelope therefore contributes TWO bytes;
/// the wire is `id: UID(32) | namespace: u8 | dummy_field: bool | xp: u64 | level: u16 | hp: u64 |
/// hp_updated_ms: u64` = 60 bytes (no trailing bytes — `Progression` terminates the Field).
/// Discriminated from every other Character DF by the key TYPE parameter
/// (`snapshot::is_progression_key`), never the bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressionField {
    pub id: ObjectID,
    pub namespace: u8,
    pub dummy_field: bool, // ProgressionKey {} — empty Move structs are one bool on the wire
    pub xp: u64,
    pub level: u16,
    pub hp: u64,
    pub hp_updated_ms: u64,
}

/// One equipped Item sibling attached directly to a Character under the equipment namespace:
/// `0x2::dynamic_field::Field<extension::NsKey<0x2::object::ID>, item::Item>`. The key is the
/// equipped item's own ID and the value is the complete Item. BCS flattens the nested structs, so
/// the wire is `Field UID(32) | namespace u8 | key ID(32) | Item { id UID, template ID, name,
/// item_type, description, category, amount }`. The snapshot filters `namespace == 1`, matching
/// `equipment::NS_CHARACTER_EQUIPMENT`, and `category == "pet"` before projection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EquippedItemField {
    pub field_id: ObjectID,
    pub namespace: u8,
    pub key: ObjectID,
    pub value: ItemObject,
}

// ── aresrpg_game::zones::Zone DYNAMIC FIELD (the zone's seed + consumed-bitmaps) ──────
// The Zone is a PLAIN dynamic field on the World's UID (`df::add(world.uid, ZoneKey { zx, zy },
// Zone { … })`), so the `Field`'s checkpoint `ObjectOwner` IS the World — exactly as the Character
// DFs' owner IS the character. `snapshot.rs` decodes it off the SAME per-checkpoint
// `dynamic_field::Field` output objects, discriminated by the KEY TYPE parameter (`is_zone_key`).

/// One discovered `aresrpg::zones::Zone` — SEARCH-COST REWORK (2026-07-13): the DF stores ONLY the
/// composition `seed` + the consumed-BITMAPS (bit i of byte i/8 = derivation-stream entry i consumed);
/// the spawn lists DERIVE from the seed CLIENT-SIDE (`@aresrpg/sim` zone_derive.js — the byte-exact
/// mirror of the chain's `zone_comp`/`zone_gen`), so `/v1` serves the raw state, never rows.
/// BCS is positional and flattens the `Field { id: UID, name: Name, value: Value }` envelope with
/// NO framing, so the wire is `id: UID(32) | zx: u32 | zy: u32 | discovered_at_ms: u64 | seed: u64 |
/// mob_bitmap: Vec<u8> | res_bitmap: Vec<u8>`: the leading `id` consumes the UID, then the two
/// `u32`s ARE the `ZoneKey`. Field ORDER mirrors `zones.move` byte-for-byte. Discriminated from every
/// other World DF by the key TYPE parameter (`snapshot::is_zone_key`), never the bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneField {
    pub id: ObjectID,
    pub zx: u32,
    pub zy: u32,
    pub discovered_at_ms: u64,
    pub seed: u64,
    pub mob_bitmap: Vec<u8>,
    pub res_bitmap: Vec<u8>,
}

/// One zone's mob-group COMMITMENT — the fight-create compute diet (2026-07-17): `zones::search_zone`
/// derives the mob groups ONCE and upserts a Blake2b-256 duplicate-last Merkle root over them as a
/// SECOND plain DF on the World's UID (`df::add(world.uid, ZoneGroupRootKey { zx, zy },
/// ZoneGroupCommitment { root, count })`, zones.move:50-51,245-268). A claim then verifies a ≤6-level
/// witness against this root (`claim_mob_group_*_with_proof`) instead of re-deriving — 577.8M → 7.32M
/// MIST computation at G=64. The client COMPOSES the witness (`@aresrpg/sdk` `compose_mob_group_proof`,
/// fail-shut) from the zone state + THIS root/count, so the snapshot merges both fields onto the SAME
/// `rpc:zone:{world}:{zx}:{zy}` doc. Same flattened-`Field` wire as [`ZoneField`]: `id: UID(32) |
/// zx: u32 | zy: u32 | root: Vec<u8> | count: u64`, discriminated by the key TYPE parameter
/// (`snapshot::is_group_root_key`), never the bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneGroupRootField {
    pub id: ObjectID,
    pub zx: u32,
    pub zy: u32,
    pub root: Vec<u8>,
    pub count: u64,
}

/// `aresrpg::item::ItemTemplate` object contents (§14 encyclopedia enrichment). The
/// `item::TemplateCreated` event carries only `{ template, item_type }`, but `name`,
/// `category` and `level` live ONLY in the object — so the encyclopedia's name/level
/// come from an OBJECT SNAPSHOT, exactly like the Character cosmetics. The struct is
/// all scalars (String/u16 after the UID) so the whole body decodes with
/// `bcs::from_bytes` (no trailing bytes to skip, unlike MobTemplate). Field order
/// mirrors `ItemTemplate { id, name, description, item_type, category, level }`
/// byte-for-byte — `description` was INSERTED (not appended) between `name` and
/// `item_type` by the 2026-07-12 fresh publish. Because BCS is positional, omitting it
/// mis-parses every later field and the whole body fails to decode (silent `None` → the
/// encyclopedia's name/level/category never land, only the event arm's item_type does).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemTemplateObject {
    pub id: ObjectID,
    pub name: String,
    pub description: String,
    pub item_type: String,
    pub category: String,
    pub level: u16,
}

/// The contents of ONE half (min or max) of an ItemTemplate's authored stat-range dynamic
/// field — `0x2::dynamic_field::Field<item_stats::StatsMinKey, item_stats::ItemStatistics>`
/// (or the sibling `StatsMaxKey`; only the KEY TYPE distinguishes which bound it is — see
/// `snapshot::is_stats_min_key`/`is_stats_max_key`). Attached DIRECTLY to the ItemTemplate's
/// UID by `item_stats::attach_ranges`/`set_ranges` (issue #219), so the Field's checkpoint
/// `ObjectOwner` IS the template — the same first-party-DF shape as the zone DFs on a World's
/// UID. `StatsMinKey {}`/`StatsMaxKey {}` are declared zero-field, and BCS gives every empty
/// Move struct a hidden `dummy_field: bool` (the SAME P1 xp-reset-on-refresh lesson as
/// [`ProgressionField`]) — PROVEN here against a LIVE testnet capture
/// (`snapshot_tests.rs::item_stats_min_field_bcs_decodes_the_real_onchain_wire`), not just a
/// self-encoded round trip. Wire: `id: UID(32) | dummy_field: bool(1) | 17 × u16` = 67 bytes;
/// the 17 fields mirror `item_stats::ItemStatistics` byte-for-byte (catalog id order — BCS is
/// positional, so this order is load-bearing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemStatsField {
    pub id: ObjectID,
    pub dummy_field: bool, // StatsMinKey {} / StatsMaxKey {} — empty Move structs are one bool on the wire
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
    pub critical_chance: u16,
    pub critical_outcomes: u16,
    pub earth_resistance: u16,
    pub fire_resistance: u16,
    pub water_resistance: u16,
    pub air_resistance: u16,
}

/// The contents of an ItemTemplate's authored weapon damage lines — `0x2::dynamic_field::Field<
/// item_damages::DamagesKey, vector<item_damages::ItemDamages>>` (issue #619 leg 3). A PLAIN struct
/// key (NOT `NsKey`-wrapped), attached DIRECTLY to the ItemTemplate's UID by `item_damages::attach`
/// — the SAME first-party-DF shape as `ItemStatsField` above (Field UID | dummy_field bool for the
/// empty `DamagesKey {}` | the value). Unlike stats' fixed 17×u16, the value here is a
/// `vector<ItemDamages>` with variable-length `String` fields — plain serde `Vec<T>`/`String`
/// decode handles that natively (no manual ByteReader needed, unlike the MobTemplate tail below).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDamagesField {
    pub id: ObjectID,
    pub dummy_field: bool, // DamagesKey {} — empty Move struct is one bool on the wire
    pub lines: Vec<ItemDamagesLine>,
}

/// One `aresrpg::item_damages::ItemDamages` line: an authored `[from, to]` roll range (BOTH
/// halves live in this ONE struct — unlike item_stats' min/max split across two DFs, so there is
/// no cross-DF desync to tolerate here) plus the free-form `damage_type`/`element` slugs. Field
/// order mirrors the Move struct byte-for-byte (BCS is positional). Served verbatim as
/// `{element, from, to, damage_type}` — the EXACT shape `@aresrpg/sdk`'s own direct-chain
/// `decode_damages` already produces (`packages/sdk/src/sui/read/items.js`), so `/v1` is a
/// drop-in match for every frontend surface already built against that shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDamagesLine {
    pub from: u16,
    pub to: u16,
    pub damage_type: String,
    pub element: String,
}

/// `aresrpg::item::Item` object contents (the loose-bag `/v1/owner-items` view). `name`,
/// `category` and `amount` live ONLY in the object — the `ItemMinted` event carries just
/// `{ item, template, item_type, amount }` and NO name/category — so the bag's display
/// fields come from an OBJECT SNAPSHOT, exactly like the Character cosmetics. An item's
/// rolled stats / scribe level ride as DYNAMIC FIELDS (separate objects), NOT inline in
/// the object's own BCS contents, so the body is all-scalar after the two leading ids and
/// decodes whole with `bcs::from_bytes` (no trailing bytes). Field order mirrors
/// `Item { id, template, name, item_type, description, category, amount }` byte-for-byte
/// — `description` was INSERTED (not appended) between `item_type` and `category` by the
/// 2026-07-12 fresh publish; because BCS is positional, omitting it mis-parses
/// `category`/`amount` and fails the decode (silent `None` → the bag row never enriches).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemObject {
    pub id: ObjectID,
    pub template: ObjectID,
    pub name: String,
    pub item_type: String,
    pub description: String,
    pub category: String,
    pub amount: u64,
}

/// `aresrpg::crafting::Recipe` object contents (§14 encyclopedia crafting truth — the standing law
/// "if it's in the encyclopedia, players are 100% sure it's in game" needs every recipe number to
/// be the chain's own). The `RecipeCreated` event carries only counts (`input_count`, no ingredient
/// list), and the shared Recipe object is never mutated after `create_recipe` shares it (crafting.move
/// has no update/burn door) — so the FULL ingredient list + output + job/level/xp come from an OBJECT
/// SNAPSHOT, exactly like the ItemTemplate enrichment. `Vec<RecipeIngredient>` is the only variable-
/// width field; everything after it is fixed-width scalars, so the whole body decodes with
/// `bcs::from_bytes` (no trailing bytes to skip). Field order mirrors `Recipe { id, inputs,
/// output_template, output_quantity, required_job, required_level, craft_xp }` byte-for-byte —
/// pinned against a live 170-byte localnet Recipe in `snapshot_tests.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipeObject {
    pub id: ObjectID,
    pub inputs: Vec<RecipeIngredient>,
    pub output_template: ObjectID,
    pub output_quantity: u64,
    pub required_job: u8,
    pub required_level: u64,
    pub craft_xp: u64,
}

/// One `aresrpg::crafting::Ingredient` (`ID` + `u64` = 40 bytes): `quantity` units of `template`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipeIngredient {
    pub template: ObjectID,
    pub quantity: u64,
}

/// `kiosk::personal_kiosk::PersonalKioskCap` object contents — the wallet↔kiosk edge the
/// owner-items read starts from. The cap is NON-transferable (`key`-only), so its checkpoint
/// `AddressOwner` IS the wallet, and its own object id IS the `kiosk_cap_id` the client
/// threads onto every row. It wraps the `KioskOwnerCap` whose `for` field names the kiosk.
/// `Option<KioskOwnerCap>` = a 1-byte BCS tag + the inner struct; at a checkpoint boundary
/// the cap is ALWAYS present (a `borrow` is returned in-PTB via the `Borrow` hot potato), so
/// `cap` decodes as `Some`. Pinned byte-for-byte against a live 97-byte testnet cap
/// (`0x13c0a3…eb29`) in `snapshot_tests.rs`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonalKioskCapObject {
    pub id: ObjectID,
    pub cap: Option<KioskOwnerCapInner>,
}

/// The wrapped `0x2::kiosk::KioskOwnerCap { id: UID, for: ID }`. `for` is a Move keyword —
/// renamed `for_kiosk` here, harmless because BCS is POSITIONAL (the field name never rides
/// the wire). `for_kiosk` is the id of the kiosk this cap controls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KioskOwnerCapInner {
    pub id: ObjectID,
    pub for_kiosk: ObjectID,
}

// ── aresrpg_fight::settlement::FightOutcome (pending unopened outcomes) ───────
// The soulbound (`key` only) per-seat outcome minted at `settle_and_destroy` and
// DELETED by `results::open`. ADDRESS-owned by the seat's owner (no event links the
// outcome id to the later FightResult id — HANDLERS.md), so the pending-outcomes
// projection derives the owning address from the object's `AddressOwner` and its create/delete
// from checkpoint object create/delete (snapshot.rs). Full serde decode (field-for-
// field, in order) — pinned byte-for-byte against the live 265-byte testnet object
// `0x4fd5a7…b079`. Only `{id, character, fight, world, outcome, aged_bp, pvp}` feed the
// view, but the whole body (incl. the VARIABLE `loot` vector that precedes `pvp`) must
// decode to reach `pvp`. `brand` is `0x1::type_name::TypeName { name: String }`, which
// is String-shaped in BCS (a one-field struct has no extra framing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FightOutcomeObject {
    pub id: ObjectID,
    pub brand: String,
    pub fight: ObjectID,
    pub world: ObjectID,
    pub character: ObjectID,
    pub outcome: u8,
    pub final_hp: u64,
    pub xp_share: u64,
    pub aged_bp: u64,
    pub chance: u64,
    pub mob_count: u64,
    pub loot: Vec<MobLootEntryBcs>,
    pub pvp: bool,
    pub team: u8,
    pub winner_team: Option<u8>,
    pub loot_mult: u64,
}

/// One `aresrpg_fight::mob::MobLootEntry` (`ID` + 3×`u16` = 38 bytes) — decoded only to
/// walk the `loot` vector past to `pvp` (the outcome view serves no loot).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MobLootEntryBcs {
    pub item_template: ObjectID,
    pub chance_bp: u16,
    pub min_qty: u16,
    pub max_qty: u16,
}

// `aresrpg::mob_template::MobTemplate` is NOT a serde struct: `snapshot::MobTemplatePrefix`
// hand-parses it because the tail is the full mob ABI — `stats` (Stats — 22 u64s), `spells`
// (vector<SpellLevel> — each a 17-field record with nested Effect vectors) and `loot`
// (vector<MobLootEntry>). The §14 bestiary serves the SCALAR PREFIX (name/min_level/
// max_level/base_hp/element) AND the `loot` table (drops view), but never the resistances
// or spell kit — so the walk SKIPS `stats`+`spells` (positional byte widths pinned to the
// Move sources) and DECODES only `loot`. Full serde-decoding the spell/effect structs (and
// pinning their layout forever) stays deliberate liability we skip. See `snapshot.rs`.

// ── aresrpg::loot_box::PetBoxClaim (soulbound pending pet-box claim) ─────────
// The SOULBOUND (address-owned, `key`-only — no `store`) claim `open_box` mints (recording
// which pet template the roll picked) and `claim_pet` consumes + `object::delete`s
// (loot_box.move). Neither `LootBoxOpened` nor `PetClaimed` is a durable "still-pending"
// registry (both are one-shot signals), and the object itself is the ONLY handle back to
// "which pet did my open roll + is it still waiting to be collected" — so create AND delete
// are OBJECT-SNAPSHOTTED here (mirrors `FightOutcomeObject`/`map_fight_outcome_object`
// above), never event-projected. Field order mirrors `loot_box.move`'s `PetBoxClaim { id,
// opener, box_template, rolled_template }` byte-for-byte (BCS is positional); `opener` is
// decoded to stay byte-aligned but unused — the trusted owner is the object's checkpoint
// `AddressOwner` (the same convention `map_fight_outcome_object` follows).

/// `aresrpg::loot_box::PetBoxClaim` object contents — see the module note above.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetBoxClaimObject {
    pub id: ObjectID,
    pub opener: SuiAddress,
    pub box_template: ObjectID,
    pub rolled_template: ObjectID,
}

// ── aresrpg_forgemagie::forgemagie (taux inflation economy — event-derivable by design) ─
// The CrushBoard's taux/pressure rows are `Table` dynamic fields (NOT inline in the
// object's own contents), and these events are designed so "coefficients must
// be derivable from events alone" (forgemagie.move `Crushed` doc). So taux is
// EVENT-projected in the snapshot pipeline, not object-snapshotted.

/// `BoardCreated { board, neutral_milli, bracket_size }` — the taux defaults every
/// fresh template prices at (100% = 100_000 milli) + the bracket width.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardCreated {
    pub board: ObjectID,
    pub neutral_milli: u64,
    pub bracket_size: u16,
}

/// `Crushed { template, items, total_weight, coeff_after, bracket, pressure_after }`
/// — carries the FULL post-crush taux state: `coeff_after` = the template's
/// settled+decayed coefficient, `pressure_after` = its bracket counter after this tx
/// (the template's new snapshot). Enough to serve the effective coefficient (bracket
/// drift = `(pressure_now − snapshot) × 3/5`) at read time. The `receipt` field died
/// with the 2026-07-11 single-tx crush (runes mint inside the crush; no receipt object).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Crushed {
    pub template: ObjectID,
    pub items: u64,
    pub total_weight: u64,
    pub coeff_after: u64,
    pub bracket: u64,
    pub pressure_after: u64,
}

/// `RecipelessSet { gear_template, recipe_less }` — a drop/quest-only template whose
/// taux is floored at min(coeff, 50%) (the anti boss-loot-fodder cap).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecipelessSet {
    pub gear_template: ObjectID,
    pub recipe_less: bool,
}

/// One `aresrpg::config::ClassRow` (three `u64` = 24 bytes): a class's base combat constants.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassRow {
    pub base_hp: u64,
    pub base_ap: u64,
    pub base_mp: u64,
}

/// `aresrpg::config::GameConfig` object contents — snapshotted for the `classes` vector ALONE
/// (#1886). The rows are BORN in `config.move`'s `init` (`y86()`), which emits nothing, and
/// `ClassRowSet` fires only from the three admin setters — so an event-only projection serves
/// `classes:{}` on any lineage nobody has re-tuned. The object is the only place the birth state
/// exists. The scalar dials stay EVENT-projected on purpose (an unset dial must remain ABSENT,
/// never a stale zero — the `/v1/config` contract its consumers read defensively).
///
/// Field order mirrors the Move struct byte-for-byte; `classes` is last, so every field before it
/// must be walked. `Option<TypeName>` encodes exactly like `Option<String>` (a single-field struct
/// is its field in BCS), which is why the three brand pins are typed as strings here — they are
/// consumed, never projected. Pinned against the LIVE testnet object in `snapshot_tests.rs`, so a
/// new dial inserted before `classes` fails that test instead of silently shifting offsets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameConfigObject {
    pub id: ObjectID,
    pub enabled: bool,
    pub xp_multiplier: u64,
    pub loot_multiplier: u64,
    pub max_reachable_level: u64,
    pub turn_duration_ms: u64,
    pub placement_ms: u64,
    pub claim_window_epochs: u64,
    pub archimob_bp: u64,
    pub aging_bp_per_hour: u64,
    pub aging_cap_bp: u64,
    pub reclaim_cooldown_ms: u64,
    pub pvp_level_gate: u64,
    pub listing_level_gate: u64,
    pub team_size_bound: u64,
    pub domain_enabled: u16,
    pub forge_brand: Option<String>,
    pub gifting_brand: Option<String>,
    pub dungeon_brand: Option<String>,
    pub classes: Vec<ClassRow>,
}
