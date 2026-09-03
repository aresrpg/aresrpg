// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Event twins + the live-wire dispatch table.
//!
//! PURE: `(module, name, bcs bytes)` in → `(topic, json)` out. One macro row
//! per Move event — the struct twin (BCS layout, field for field), its pub/sub
//! topic, and its JSON shape all live on that one line, so an event cannot
//! exist without a route and a route cannot drift from its layout.
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
        $module:ident :: $name:ident { $($field:ident : $ty:ty),+ $(,)? } => $topic:expr
    ),+ $(,)?) => {
        $(
            #[derive(Debug, Deserialize)]
            #[allow(non_snake_case, dead_code)]
            pub struct $name { $(pub $field: $ty),+ }
        )+

        /// Every `(module, name)` the table routes — the census gate's anchor
        /// (test-only: the gate is its one consumer).
        #[cfg(test)]
        pub const ROUTED: &[(&str, &str)] = &[
            $( (stringify!($module), stringify!($name)) ),+
        ];

        /// Each mirror's FIELD ORDER — BCS is positional, so a mirror that skips a Move field
        /// decodes the next field's bytes and poisons the whole checkpoint (the 2026-08-22
        /// wedge: `FightEnded` missed `world/x/z` and every fight that ended stopped the
        /// pipeline dead). The gate compares this against the compiled bytecode.
        #[cfg(test)]
        pub const ROUTED_FIELDS: &[(&str, &str, &[(&str, &str)])] = &[
            $( (stringify!($module), stringify!($name), &[$((stringify!($field), stringify!($ty))),+]) ),+
        ];

        /// Decode + route one game event by `(module, name)`. `None` = not a
        /// game event we forward (never an error — foreign events are data).
        pub fn route(module: &str, name: &str, bytes: &[u8]) -> anyhow::Result<Option<Routed>> {
            Ok(match (module, name) {
                $(
                    (stringify!($module), stringify!($name)) => {
                        let e: $name = crate::decode::from_bytes(bytes)?;
                        #[allow(clippy::redundant_closure_call)]
                        let topic: String = ($topic)(&e);
                        Some(Routed {
                            kind: stringify!($name),
                            topic,
                            data: json!({ $(stringify!($field): e.$field.to_json()),+ }),
                        })
                    }
                )+
                _ => None,
            })
        }
    };
}

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
    fight::FightClosable { fight: Id }
        => |e: &FightClosable| format!("evt:fight:{}", e.fight.hex()),
    fight::FightClosed { fight: Id }
        => |e: &FightClosed| format!("evt:fight:{}", e.fight.hex()),
    fight::DropsRolled { fight: Id, fighter: u64, drops: Vec<RolledDrop> }
        => |e: &DropsRolled| format!("evt:fight:{}", e.fight.hex()),

    // ── world surface (zone-local presence — NOTHING rides a world-global channel) ──
    zone::ZoneSearched { world: String, zone_x: u32, zone_z: u32, seed: u64, fresh: bool }
        => |event: &ZoneSearched| format!("evt:zone:{}:{}:{}", event.world, event.zone_x, event.zone_z),
    gathering::ResourceGathered { world: String, x: u32, z: u32, gatherer: Addr, item_type: String, tier: u8, quantity: u64, job_xp_gained: u64, protector: bool }
        => |e: &ResourceGathered| zone_topic(&e.world, e.x, e.z),
    gathering::RareGathered { world: String, x: u32, z: u32, gatherer: Addr, item_type: String, rare_item_type: String }
        => |e: &RareGathered| zone_topic(&e.world, e.x, e.z),

    // Friends, parties, and trades publish from object writes in publish.rs. Their full
    // objects already carry the state needed to invalidate every relevant projection.

    // ── kolizeum ──
    kolizeum::KolizeumCreated { kolizeum: Id, fight: Id, pledge: u64, format: u64 }
        => |_: &KolizeumCreated| "evt:kolizeum".to_string(),
    kolizeum::KolizeumPaid { kolizeum: Id, winner: Addr, amount: u64 }
        => |_: &KolizeumPaid| "evt:kolizeum".to_string(),

    // ── economy ──
    distribution::AirdropCreated { airdrop: Id, template: Id, addresses: u64 }
        => |_: &AirdropCreated| "evt:economy".to_string(),
    distribution::AirdropClaimed {
        airdrop: Id,
        drop_id: String,
        claimer: Addr,
        recipient: Addr,
        giftcard: Id,
        remaining: u64,
    }
        => |_: &AirdropClaimed| "evt:economy".to_string(),
    distribution::GiftcardMinted { giftcard: Id, template: Id, amount: u32 }
        => |_: &GiftcardMinted| "evt:economy".to_string(),
    distribution::GiftcardRedeemed { giftcard: Id, redeemer: Addr }
        => |_: &GiftcardRedeemed| "evt:economy".to_string(),
    crafting::Crafted {
        recipe: Id,
        character: Id,
        crafter: Addr,
        output_template: Id,
        attempts: u16,
        successes: u16,
        job_xp_gained: u64,
    }
        => |_: &Crafted| "evt:economy".to_string(),
    forgemagie::RuneScribed { item: Id, stat: u8, tier: u8, outcome: u8, applied_value: u64, lost_stat: u8, lost_amount: u64, new_puits: u64, xp: u64 }
        => |_: &RuneScribed| "evt:economy".to_string(),
    forgemagie::GearCrushed { crusher: Addr, items: u64 }
        => |_: &GearCrushed| "evt:economy".to_string(),
    pet::PetFed { pet: Id, feeder: Addr, power: u64 }
        => |_: &PetFed| "evt:economy".to_string(),

    // ── loot boxes (grind-safe gacha, ruling 2026-08-11) ──
    loot_box::LootBoxOpened { box_template: Id, rolled_template: Id, amount: u32, opener: Addr }
        => |_: &LootBoxOpened| "evt:economy".to_string(),
    loot_box::LootClaimed { box_template: Id, rolled_template: Id, amount: u32, opener: Addr }
        => |_: &LootClaimed| "evt:economy".to_string(),

    // ── living content ──
    item_rows::TemplateCreated { template: Id, item_type: String }
        => |_: &TemplateCreated| "evt:content".to_string(),
    mob_rows::MobTemplateCreated { template: Id, mob_type: String }
        => |_: &MobTemplateCreated| "evt:content".to_string(),
    spell_rows::SpellCreated { template: Id, name: String, classe: String }
        => |_: &SpellCreated| "evt:content".to_string(),
    recipe_rows::RecipeCreated { recipe: Id, output_template: Id, input_count: u64, job: String, required_level: u64 }
        => |_: &RecipeCreated| "evt:content".to_string(),
    registry::ContentWritten { domain: String, key: String, revision: u64 }
        => |_: &ContentWritten| "evt:content".to_string(),
    loot_box::LootTableSet { box_template: Id, rows: u64, weight_sum: u64 }
        => |_: &LootTableSet| "evt:content".to_string(),
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

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_a_character_event_with_hex_ids() {
        #[derive(serde::Serialize)]
        struct Wire {
            character: [u8; 32],
            owner: [u8; 32],
            name: String,
            classe: String,
        }
        let bytes = bcs::to_bytes(&Wire {
            character: [1; 32],
            owner: [7; 32],
            name: "aiden".into(),
            classe: "yajin".into(),
        })
        .unwrap();
        let routed = route("character", "CharacterCreated", &bytes)
            .unwrap()
            .unwrap();
        assert_eq!(routed.kind, "CharacterCreated");
        assert_eq!(routed.topic, format!("evt:social:0x{}", "07".repeat(32)));
        assert_eq!(routed.data["name"], "aiden");
        assert_eq!(routed.data["character"], format!("0x{}", "01".repeat(32)));
    }

    #[test]
    fn option_winner_serializes_value_or_null() {
        // THE WIRE IS `fight, world, x, z, winner` (fight.move) — a hand-built fixture that
        // skips a field proves only that the mirror agrees with itself, and this one did while
        // the real event wedged the pipeline (2026-08-22). The field ORDER is pinned against
        // the compiled bytecode by `gates::every_event_mirror_matches_the_compiled_field_order`.
        #[derive(serde::Serialize)]
        struct Wire {
            fight: [u8; 32],
            world: String,
            x: u32,
            z: u32,
            winner: Option<u8>,
        }
        let wire = |winner: Option<u8>| Wire {
            fight: [4; 32],
            world: "01_first_shore".to_string(),
            x: 49_986,
            z: 49_998,
            winner,
        };
        let with = bcs::to_bytes(&wire(Some(1))).unwrap();
        let routed = route("fight", "FightEnded", &with).unwrap().unwrap();
        assert_eq!(routed.data["winner"], 1);

        let without = bcs::to_bytes(&wire(None)).unwrap();
        let routed = route("fight", "FightEnded", &without).unwrap().unwrap();
        assert!(routed.data["winner"].is_null());
        assert_eq!(routed.topic, format!("evt:fight:0x{}", "04".repeat(32)));
    }

    #[test]
    fn unknown_events_are_data_not_errors() {
        assert!(route("evil", "Injected", &[1, 2, 3]).unwrap().is_none());
    }

    #[test]
    fn wrong_bytes_for_a_known_event_error_loudly() {
        assert!(route("character", "CharacterCreated", &[0xFF]).is_err());
    }
}
