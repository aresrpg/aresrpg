// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Event twins + the live-wire dispatch table.
//!
//! PURE: `(module, name, bcs bytes)` in → `(topic, json)` out. One macro row
//! per decoded Move event — the struct twin (BCS layout, field for field), its pub/sub
//! topic, and its JSON shape all live on that one line, and the gates compare every
//! row with the bytecode.
//!
//! JSON convention (the fullnode's `parsedJson`, kept so clients reuse their
//! receipt decoders): `ID`/`address` → `0x…` hex · u64 → STRING (2⁵³ law) ·
//! u8/u16/u32 → number · bool → bool · vectors → arrays · Option → value|null.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::decode::{Addr, Id, RolledDrop};

// ╔════════════════ [ JSON convention ] ══════════════════════════════════════ ]

/// One JSON shape per wire type — the convention above, mechanically.
pub trait ToJson {
    fn to_json(&self) -> Value;
}

impl ToJson for Id {
    fn to_json(&self) -> Value {
        json!(self.hex())
    }
}
impl ToJson for Addr {
    fn to_json(&self) -> Value {
        json!(self.hex())
    }
}
impl ToJson for String {
    fn to_json(&self) -> Value {
        json!(self)
    }
}
impl ToJson for bool {
    fn to_json(&self) -> Value {
        json!(self)
    }
}
impl ToJson for u8 {
    fn to_json(&self) -> Value {
        json!(self)
    }
}
impl ToJson for u16 {
    fn to_json(&self) -> Value {
        json!(self)
    }
}
impl ToJson for u32 {
    fn to_json(&self) -> Value {
        json!(self)
    }
}
impl ToJson for u64 {
    fn to_json(&self) -> Value {
        json!(self.to_string())
    }
}
impl<T: ToJson> ToJson for Vec<T> {
    fn to_json(&self) -> Value {
        Value::Array(self.iter().map(ToJson::to_json).collect())
    }
}
impl<T: ToJson> ToJson for Option<T> {
    fn to_json(&self) -> Value {
        self.as_ref().map_or(Value::Null, ToJson::to_json)
    }
}
impl ToJson for RolledDrop {
    fn to_json(&self) -> Value {
        json!({ "item_type": self.item_type, "qty": self.qty })
    }
}

// ╔════════════════ [ The table ] ════════════════════════════════════════════ ]

/// The zone twin of move-math's `zone_math::ZONE_SIZE` — one 512×512 block square. Rust cannot
/// import a Move constant, so this copy is PINNED against the compiled accessor by
/// `gates::the_indexer_zone_size_is_the_compiled_one`: a zone_math change reds it, same commit.
pub(crate) const ZONE_SIZE: u32 = 512;

/// The per-zone live wire: `evt:zone:{world}:{zx}:{zz}`. Zone-local facts (a fight's whole
/// lifecycle) ride ONLY this — world-global channels are for private/group lanes, never
/// presence spam (distributed law: a pod subscribes a zone when it tracks it).
pub(crate) fn zone_topic(world: &str, x: u32, z: u32) -> String {
    format!("evt:zone:{}:{}:{}", world, x / ZONE_SIZE, z / ZONE_SIZE)
}

/// One decoded event, routed: the pub/sub channel + the payload's `data`.
#[derive(Debug, Clone, PartialEq)]
pub struct Routed {
    pub kind: &'static str,
    pub topic: String,
    pub data: Value,
}

macro_rules! events {
    ($(
        $module:ident :: $name:ident { $($field:ident : $ty:ty),+ $(,)? } $(=> $topic:expr)?
    ),+ $(,)?) => {
        $(
            #[derive(Debug, Deserialize)]
            #[allow(non_snake_case, dead_code)]
            pub struct $name { $(pub $field: $ty),+ }
        )+

        /// Every `(module, name)` the table decodes — the census gate's anchor.
        #[cfg(test)]
        pub const ROUTED: &[(&str, &str)] = &[
            $( (stringify!($module), stringify!($name)) ),+
        ];

        /// Each mirror's field order. BCS is positional; the gate compares it with the bytecode.
        #[cfg(test)]
        pub const ROUTED_FIELDS: &[(&str, &str, &[(&str, &str)])] = &[
            $( (stringify!($module), stringify!($name), &[$((stringify!($field), stringify!($ty))),+]) ),+
        ];

        /// Decode one game event by `(module, name)` and route it when its row has a topic.
        /// `None` = foreign or unpublished (never an error: foreign events are data).
        pub fn route(module: &str, name: &str, bytes: &[u8]) -> anyhow::Result<Option<Routed>> {
            Ok(match (module, name) {
                $(
                    (stringify!($module), stringify!($name)) => {
                        let e: $name = crate::decode::from_bytes(bytes)?;
                        events!(@publish e, $name { $($field),+ } $(, $topic)?)
                    }
                )+
                _ => None,
            })
        }
    };
    (@publish $e:ident, $name:ident { $($field:ident),+ }) => {{
        let _ = $e;
        None
    }};
    (@publish $e:ident, $name:ident { $($field:ident),+ }, $topic:expr) => {{
        #[allow(clippy::redundant_closure_call)]
        let topic: String = ($topic)(&$e);
        Some(Routed {
            kind: stringify!($name),
            topic,
            data: json!({ $(stringify!($field): $e.$field.to_json()),+ }),
        })
    }};
}

// A row without a topic is decoded and gated, never published: another module reads it.
events! {
    // ── character lifecycle + progression surface ──
    // CharacterCreated routes to the OWNER's social channel: the receipt cannot carry the
    // full row, so the server streams it — nobody can watch a brand-new character id yet.
    character::CharacterCreated { character: Id, owner: Addr, name: String, classe: String }
        => |e: &CharacterCreated| format!("evt:social:{}", e.owner.hex()),
    equipment::ItemEquipped { character: Id, slot: String, item: Id }
        => |e: &ItemEquipped| format!("evt:character:{}", e.character.hex()),
    equipment::ItemUnequipped { character: Id, slot: String, item: Id }
        => |e: &ItemUnequipped| format!("evt:character:{}", e.character.hex()),
    world::WorldJoined { character: Id, world: String, x: u32, z: u32, first_join: bool }
        => |e: &WorldJoined| format!("evt:character:{}", e.character.hex()),
    world::CharacterTeleported { character: Id, world: String, x: u32, z: u32 }
        => |event: &CharacterTeleported| format!("evt:character:{}", event.character.hex()),

    // ── dungeons (a character's own run) ──
    dungeon::DungeonEntered { character: Id, world: String, x: u32, z: u32 }
        => |e: &DungeonEntered| format!("evt:character:{}", e.character.hex()),
    dungeon::DungeonRoomCleared { character: Id, world: String, room: u64 }
        => |e: &DungeonRoomCleared| format!("evt:character:{}", e.character.hex()),
    dungeon::DungeonEnded { character: Id, world: String, room: u64, won: bool }
        => |e: &DungeonEnded| format!("evt:character:{}", e.character.hex()),

    // ── fights (object-state-first; these are the lifecycle beacons) ──
    // a fight's birth is ZONE-LOCAL presence: only bystanders standing in its zone need it
    fight::FightCreated { fight: Id, world: String, x: u32, z: u32, placement_ms: u64 }
        => |e: &FightCreated| zone_topic(&e.world, e.x, e.z),
    // routed to the FIGHT's channel — it tells the roster's existing watchers (a duel's
    // opener, teammates in placement) that a seat filled. It does NOT arm the joiner's own
    // watch: a seat is custody, and `publish::route_character_custody` witnesses every seat,
    // including the creator's, which no join ever announces.
    fight::FighterJoined { fight: Id, character: Id, team: u8 }
        => |e: &FighterJoined| format!("evt:fight:{}", e.fight.hex()),
    // a walk-out reaches the survivors' fight channel: it is the ONLY witness of a forfeit
    // that leaves the fight running, and their screens replay it as the seat's death
    fight::FighterForfeited { fight: Id, fighter: u64 }
        => |e: &FighterForfeited| format!("evt:fight:{}", e.fight.hex()),
    fight::FightStarted { fight: Id, world: String, x: u32, z: u32, queue: Vec<u64> }
        => |e: &FightStarted| format!("evt:fight:{}", e.fight.hex()),
    fight::TurnSeedUsed { fight: Id, seat: u64, seed: u64 }
        => |e: &TurnSeedUsed| format!("evt:fight:{}", e.fight.hex()),
    fight::FightEnded { fight: Id, world: String, x: u32, z: u32, winner: Option<u8> }
        => |e: &FightEnded| format!("evt:fight:{}", e.fight.hex()),
    fight::FightClosed { fight: Id }
        => |e: &FightClosed| format!("evt:fight:{}", e.fight.hex()),
    fight::DropsRolled { fight: Id, fighter: u64, drops: Vec<RolledDrop>, kares: u64 }
        => |e: &DropsRolled| format!("evt:fight:{}", e.fight.hex()),

    // ── world surface (zone-local presence — NOTHING rides a world-global channel) ──
    zone::ZoneSearched { world: String, zone_x: u32, zone_z: u32, seed: u64, fresh: bool }
        => |event: &ZoneSearched| format!("evt:zone:{}:{}:{}", event.world, event.zone_x, event.zone_z),
    gathering::ResourceGathered { world: String, x: u32, z: u32, gatherer: Addr, item_type: String, tier: u8, quantity: u64, job_xp_gained: u64, protector: bool }
        => |e: &ResourceGathered| zone_topic(&e.world, e.x, e.z),
    gathering::RareGathered { world: String, x: u32, z: u32, gatherer: Addr, item_type: String, rare_item_type: String },

    // Friends, parties, and trades publish from object writes in publish.rs. Their full
    // objects already carry the state needed to invalidate every relevant projection.

    tournament::EntryFeePaid { treasury_mist: u64 },
    tournament::TournamentUpdated { tournament: Id }
        => |_: &TournamentUpdated| "evt:tournament".to_string(),
    // The kolizeum directory publishes one coalesced invalidation from object writes.
    kolizeum::KolizeumPaid { kolizeum: Id, winner: Addr, amount: u64 },

    listing_rule::SellerProved { kiosk: Id, owner: Addr },

    // ── economy ──
    crafting::Crafted {
        recipe: Id,
        character: Id,
        crafter: Addr,
        output_template: Id,
        attempts: u16,
        successes: u16,
        job_xp_gained: u64,
    },
    forgemagie::GearCrushed { crusher: Addr, items: u64 }
        => |_: &GearCrushed| "evt:economy".to_string(),
    pet::PetFed { pet: Id, feeder: Addr, power: u64 },

    // ── loot boxes ──
    loot_box::LootBoxOpened { box_template: Id, rolled_template: Id, amount: u32, opener: Addr }
        => |_: &LootBoxOpened| "evt:economy".to_string(),
    loot_box::LootClaimed { box_template: Id, rolled_template: Id, amount: u32, opener: Addr }
        => |_: &LootClaimed| "evt:economy".to_string(),
}

// ╔════════════════ [ Native kiosk events (0x2 — sale analysis inputs) ] ═════ ]

/// `0x2::kiosk::ItemListed<T>` / `ItemPurchased<T>` — the phantom `T` is NOT
/// in the BCS body (the old contract's proven lesson), so one twin serves
/// items and characters both. `ItemDelisted<T>` drops the price field.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct KioskItemListed {
    pub kiosk: Id,
    pub id: Id,
    pub price: u64,
}
pub type KioskItemPurchased = KioskItemListed;

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct KioskItemDelisted {
    pub kiosk: Id,
    pub id: Id,
}
