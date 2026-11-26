// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The indexer's one core suite. Each case drives a whole scenario through a public door:
//! the pure checkpoint core (`AresHandler::writes`), a store's commit, a decoder, or boot.
//! Captured wire payloads carry their provenance beside the bytes.

use serde::Serialize;
use serde_json::Value;

use crate::decode::{Addr, Id};
use crate::ownership::{OwnerKind, TypeKey, SUI_FRAMEWORK};
use crate::pipeline::{AresHandler, OwnedEvent, OwnedObj, OwnedTx, Write};

#[path = "core/boot.rs"]
mod boot;
#[path = "core/captured.rs"]
mod captured;
#[path = "core/leaderboards.rs"]
mod leaderboards;
#[path = "core/market.rs"]
mod market;
#[path = "core/notifications.rs"]
mod notifications;
#[path = "core/projection.rs"]
mod projection;
#[path = "core/stores.rs"]
mod stores;
#[path = "core/wire.rs"]
mod wire;

pub const GAME: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
pub const CKPT: u64 = 100;
pub const TS: u64 = 1_000;

pub fn id(byte: u8) -> Id {
    Id([byte; 32])
}

pub fn addr(byte: u8) -> Addr {
    Addr([byte; 32])
}

pub fn ty(package: &str, module: &str, name: &str, params: &[&str]) -> TypeKey {
    TypeKey {
        package: package.into(),
        module: module.into(),
        name: name.into(),
        type_params: params.iter().map(|param| param.to_string()).collect(),
    }
}

/// A game type of the projected original package.
pub fn game(module: &str, name: &str) -> TypeKey {
    ty(GAME, module, name, &[])
}

/// `0x2::dynamic_field::Field<key, value>`.
pub fn field(key: &str, value: &str) -> TypeKey {
    ty(SUI_FRAMEWORK, "dynamic_field", "Field", &[key, value])
}

/// A dynamic field keyed by a game type.
pub fn game_field(key: &str) -> TypeKey {
    field(&format!("{GAME}::{key}"), "value")
}

pub fn bcs(value: &impl Serialize) -> Vec<u8> {
    bcs::to_bytes(value).unwrap()
}

/// A version-1 object whose contents are `value`'s BCS.
pub fn obj(id: Id, owner: OwnerKind, type_key: TypeKey, value: &impl Serialize) -> OwnedObj {
    OwnedObj {
        id,
        version: 1,
        owner,
        type_key,
        bytes: bcs(value),
    }
}

pub fn event(package: &str, module: &str, name: &str, value: &impl Serialize) -> OwnedEvent {
    OwnedEvent {
        package: package.into(),
        module: module.into(),
        name: name.into(),
        type_params: vec![],
        bytes: bcs(value),
        index: 0,
    }
}

pub fn game_event(module: &str, name: &str, value: &impl Serialize) -> OwnedEvent {
    event(GAME, module, name, value)
}

/// A `0x2::kiosk::{name}<T>` market event for a game type.
pub fn kiosk_event(
    name: &str,
    item: &str,
    kiosk: Id,
    object: Id,
    price: Option<u64>,
) -> OwnedEvent {
    let bytes = match price {
        Some(price) => bcs(&(kiosk, object, price)),
        None => bcs(&(kiosk, object)),
    };
    OwnedEvent {
        type_params: vec![item.to_string()],
        bytes,
        ..event(SUI_FRAMEWORK, "kiosk", name, &())
    }
}

/// A successful transaction from `addr(7)` with nothing in it.
pub fn tx() -> OwnedTx {
    OwnedTx {
        lamport_version: 1,
        sender: addr(7),
        digest: "digest".into(),
        successful: true,
        gas_mist: 0,
        move_calls: vec![],
        events: vec![],
        inputs: vec![],
        outputs: vec![],
        deleted: vec![],
        fee_income: vec![],
    }
}

/// Number every event in checkpoint order, as lifting does.
fn ordered(txs: &[OwnedTx]) -> Vec<OwnedTx> {
    let mut index = 0;
    txs.iter()
        .map(|tx| OwnedTx {
            events: tx
                .events
                .iter()
                .map(|event| {
                    index += 1;
                    OwnedEvent {
                        index: index - 1,
                        ..event.clone()
                    }
                })
                .collect(),
            ..tx.clone()
        })
        .collect()
}

/// The pure checkpoint core, exactly as the pipeline drives it.
pub fn try_run(txs: &[OwnedTx]) -> anyhow::Result<Vec<Write>> {
    AresHandler::new(GAME, GAME, &[GAME.to_string()])?.writes(CKPT, 9, TS, &ordered(txs))
}

pub fn run(txs: &[OwnedTx]) -> Vec<Write> {
    try_run(txs).unwrap()
}

pub fn cypher(writes: &[Write]) -> Vec<&str> {
    writes
        .iter()
        .filter_map(|write| match write {
            Write::Graph(statement) => Some(statement.as_str()),
            _ => None,
        })
        .collect()
}

/// Every published `(channel, payload)` pair, the Discord feed included.
pub fn published(writes: &[Write]) -> Vec<(String, Value)> {
    writes
        .iter()
        .filter_map(|write| match write {
            Write::Publish { channel, payload } => {
                Some((channel.clone(), serde_json::from_str(payload).unwrap()))
            }
            _ => None,
        })
        .collect()
}

/// The payload kinds published on one channel, in order.
pub fn kinds_on(writes: &[Write], channel: &str) -> Vec<String> {
    published(writes)
        .into_iter()
        .filter(|(published, _)| published == channel)
        .map(|(_, payload)| payload["type"].as_str().unwrap_or_default().to_string())
        .collect()
}

pub fn notifications(writes: &[Write]) -> Vec<Value> {
    let channel = format!("evt:notifications:{GAME}");
    published(writes)
        .into_iter()
        .filter(|(published, _)| *published == channel)
        .map(|(_, payload)| payload)
        .collect()
}

/// `(sales key, member)` rows.
pub fn sales(writes: &[Write]) -> Vec<(String, String)> {
    writes
        .iter()
        .filter_map(|write| match write {
            Write::Sale { key, member, .. } => Some((key.clone(), member.clone())),
            _ => None,
        })
        .collect()
}

pub fn totals(writes: &[Write]) -> Option<crate::analytics_totals::Totals> {
    writes.iter().find_map(|write| match write {
        Write::Numeric { totals, .. } => Some(totals.clone()),
        _ => None,
    })
}

pub fn leaderboard(writes: &[Write]) -> Vec<crate::leaderboards::Contribution> {
    writes
        .iter()
        .find_map(|write| match write {
            Write::Leaderboard { facts, .. } => Some(facts.clone()),
            _ => None,
        })
        .unwrap_or_default()
}

pub fn market_prices(writes: &[Write]) -> Vec<crate::market_prices::Sale> {
    writes
        .iter()
        .find_map(|write| match write {
            Write::MarketPrices { sales, .. } => Some(sales.clone()),
            _ => None,
        })
        .unwrap_or_default()
}

pub fn market_volume(writes: &[Write]) -> u128 {
    writes
        .iter()
        .find_map(|write| match write {
            Write::MarketVolume { mist, .. } => Some(*mist),
            _ => None,
        })
        .unwrap_or_default()
}

/// Hex lines of a captured payload, joined.
pub fn captured(hex_lines: &[&str]) -> Vec<u8> {
    hex::decode(hex_lines.concat()).unwrap()
}

/// A JSON fixture under `test/fixtures`, with its `bcs_hex` payload decoded.
pub fn fixture(json: &str) -> (Value, Vec<u8>) {
    let fixture: Value = serde_json::from_str(json).unwrap();
    let bytes = hex::decode(fixture["bcs_hex"].as_str().unwrap_or_default()).unwrap();
    (fixture, bytes)
}

/// A level-1 game Character object.
pub fn character(object: Id, owner: OwnerKind) -> OwnedObj {
    obj(
        object,
        owner,
        game("character", "Character"),
        &crate::decode::Character {
            id: object,
            name: "aiden".into(),
            classe: "yajin".into(),
            sex: "male".into(),
            experience: 0,
            level: 1,
            color_1: 1,
            color_2: 2,
            color_3: 3,
            vitality: 0,
            wisdom: 0,
            strength: 0,
            intelligence: 0,
            chance: 0,
            agility: 0,
            available_points: 0,
            available_spell_points: 0,
        },
    )
}

/// A dynamic-object-field wrapper `wrapper` under `parent`, keyed `key`, holding `child`.
pub fn wrapper<K: Serialize>(
    wrapper: Id,
    parent: Id,
    key_type: &str,
    key: K,
    child: Id,
) -> OwnedObj {
    obj(
        wrapper,
        OwnerKind::Object(parent),
        field(
            &format!("{SUI_FRAMEWORK}::dynamic_object_field::Wrapper<{key_type}>"),
            &format!("{SUI_FRAMEWORK}::object::ID"),
        ),
        &crate::decode::Field {
            id: wrapper,
            name: crate::decode::DynamicObjectFieldWrapper { name: key },
            value: child,
        },
    )
}

/// `object` held by kiosk `kiosk` through wrapper `via`.
pub fn kiosk_wrapper(via: Id, kiosk: Id, object: Id) -> OwnedObj {
    let key = crate::decode::KioskItemKey { id: object };
    wrapper(
        via,
        kiosk,
        &format!("{SUI_FRAMEWORK}::kiosk::Item"),
        key,
        object,
    )
}

/// `character` seated at `seat` of fight `fight` through wrapper `via`.
pub fn seat_wrapper(via: Id, fight: Id, seat: u64, character: Id) -> OwnedObj {
    let key = crate::decode::FighterKey(seat);
    wrapper(
        via,
        fight,
        &format!("{GAME}::fight::FighterKey"),
        key,
        character,
    )
}

pub fn fighter(team: u8, mob: bool) -> crate::decode::Fighter {
    use crate::decode::*;
    Fighter {
        team,
        kind: if mob {
            FighterKind::Mob(MobSnapshot {
                mob_type: "wooling".into(),
                level: 1,
                kit: vec![],
                xp: 10,
                loot: vec![],
            })
        } else {
            FighterKind::Player
        },
        stats: FighterStats {
            sheet: Sheet {
                strength: 0,
                intelligence: 0,
                chance: 0,
                agility: 0,
                wisdom: 0,
                raw_damage: 0,
                critical: 0,
                range_bonus: 0,
                level: 1,
            },
            max_hp: 100,
            base_ap: 6,
            base_mp: 3,
            earth_resistance: 0,
            fire_resistance: 0,
            water_resistance: 0,
            air_resistance: 0,
        },
        cell: 0,
        ready: true,
        dead: false,
        settled: false,
        forfeited: false,
        hp: 100,
        ap: 6,
        mp: 3,
        drops: vec![],
        effects: vec![],
        cooldowns: vec![],
    }
}

/// An ended fight `fight` won by team 0: player seats for `owners` (characters `10 + seat`),
/// then `mobs` mob seats on team 1.
pub fn fight(fight: u8, owners: &[u8], mobs: usize) -> crate::decode::Fight {
    use crate::decode::*;
    let authorities = owners
        .iter()
        .enumerate()
        .map(|(seat, owner)| FighterAuthority::Player {
            character: id(seat as u8 + 10),
            owner: addr(*owner),
        })
        .chain((0..mobs).map(|_| FighterAuthority::Mob))
        .collect();
    Fight {
        id: id(fight),
        world: "world".into(),
        x: 1,
        z: 2,
        access_a: 0,
        access_b: 255,
        opener_a: None,
        opener_b: None,
        authorities,
        combat: CombatState {
            board: GridSpec {
                width: 2,
                height: 2,
                shape_mask: vec![15],
                obstacles: vec![],
                holes: vec![],
                start_cells_a: vec![0],
                start_cells_b: vec![3],
            },
            closed: vec![],
            fighters: owners
                .iter()
                .map(|_| fighter(0, false))
                .chain((0..mobs).map(|_| fighter(1, true)))
                .collect(),
            zones: vec![],
            queue: vec![],
            turn_pointer: 0,
            round: 1,
            ended: true,
            winner: Some(0),
            turn_seed: 0,
            turn_cast_index: 0,
            turn_casts: vec![],
            placement_started_ms: 0,
            turn_started_ms: 0,
        },
        dungeon: None,
        door_policy: 0,
        drops_rolled: false,
        next_turn_entropy: 0,
        loot_entropy_ready: true,
        rewards: FightRewards {
            weight: 0,
            paid: None,
        },
    }
}

pub fn fight_obj(fight: &crate::decode::Fight) -> OwnedObj {
    obj(fight.id, OwnerKind::Shared, game("fight", "Fight"), fight)
}
