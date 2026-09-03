// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The live wire + the money analysis — events/object writes → pub/sub, sales, market. PURE.
//!
//! Per transaction: route every game event to its channel (`events.rs` owns the
//! table), then run the SALE ANALYSIS the graph never sees:
//!
//! * **The royalty discriminator (README law 7).** The ceremony installs the
//!   royalty rule (10% + 0.01 SUI floor) on BOTH real policies, so every
//!   genuine kiosk sale calls `royalty_rule::pay`; the game's internal extract
//!   (equip / burn / fight custody) buys through the RULELESS protected policy
//!   and never does. No `pay` call in the tx = plumbing: no row, no stamp, no
//!   forwarded market event.
//! * **Ours-only.** A purchased object always changes hands, so it is an
//!   output of the same tx — a purchase whose id is no game Character/Item
//!   output is another collection's trade: ignored entirely.
//! * **Per-unit price (law 9).** The event price is the LOT price; the stamp
//!   divides by the purchased stack's `amount`. Characters have no amount and
//!   never stamp the market (kind-tagged in history instead).
//! * **Exclusive sales are event-invisible (law 8).** `purchase_with_cap`
//!   emits nothing — the sale is derived from the exclusive Listing DF deletion plus
//!   the kiosk `profits` delta in that tx. History rows for both parties,
//!   NEVER a market stamp (an OTC price is not a market price).
//!
//! Sales rows are `{ckpt}:{tx}:{evt}|{json}` members (coordinate prefix =
//! replay-idempotent) scored by `ts_ms`, one row per party, capped + idle-TTL
//! at commit time (`pipeline.rs`).

use serde_json::json;

use crate::analytics::{self, MoneyDelta, MoneyFact};
use crate::decode::{self, Addr, Id};
use crate::events;
use crate::graph::{FightLifecycleStamp, MarketStamp};
use crate::ownership::{self, Custody, ObjView, OwnerKind, SUI_FRAMEWORK};

/// One `PUBLISH channel payload`.
#[derive(Debug, Clone, PartialEq)]
pub struct Publication {
    pub channel: String,
    pub payload: String,
}

/// One sales-history row for one address's zset.
#[derive(Debug, Clone, PartialEq)]
pub struct SalesRow {
    pub address: Addr,
    pub ts_ms: u64,
    pub member: String,
}

/// One event as the analyzer sees it. `index` is the event's ordinal within
/// the CHECKPOINT (the pub/sub gap/order coordinate).
#[derive(Debug, Clone)]
pub struct EventView<'a> {
    pub package: &'a str,
    pub module: &'a str,
    pub name: &'a str,
    /// Fully-qualified type parameters of the EVENT type (canonical) — the
    /// phantom `T` of `kiosk::ItemListed<T>` lives HERE, not in the BCS body.
    pub type_params: &'a [String],
    pub bytes: &'a [u8],
    pub index: u64,
}

/// One transaction as the analyzer sees it.
#[derive(Debug, Clone)]
pub struct TxView<'a> {
    pub tx_index: u64,
    pub sender: Addr,
    /// Every MoveCall target, canonical `0xpkg::module::function`.
    pub move_calls: &'a [String],
    pub events: &'a [EventView<'a>],
    /// This tx's INPUT (pre-state) and OUTPUT objects.
    pub inputs: &'a [ObjView<'a>],
    pub outputs: &'a [ObjView<'a>],
}

/// Everything one checkpoint's events produce.
#[derive(Debug, Default, PartialEq)]
pub struct Wire {
    pub publications: Vec<Publication>,
    pub sales: Vec<SalesRow>,
    pub money: Vec<MoneyFact>,
    pub market: Vec<MarketStamp>,
    pub fight_lifecycle: Vec<FightLifecycleStamp>,
}

#[cfg(test)]
pub fn analyze(
    ckpt: u64,
    ts_ms: u64,
    txs: &[TxView<'_>],
    game: &str,
    seed: &str,
) -> anyhow::Result<Wire> {
    analyze_with_digests(ckpt, ts_ms, txs, &[], game, seed)
}

pub fn analyze_with_digests(
    ckpt: u64,
    ts_ms: u64,
    txs: &[TxView<'_>],
    _digests: &[String],
    game: &str,
    seed: &str,
) -> anyhow::Result<Wire> {
    let mut wire = Wire::default();
    for tx in txs {
        route_game_events(&mut wire, ckpt, ts_ms, tx, game, seed)?;
        route_game_state(&mut wire, ckpt, ts_ms, tx, game)?;
        route_friend_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        route_party_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        route_trade_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        route_dungeon_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        route_kolizeum_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        route_fight_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        route_item_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        analyze_game_revenue(&mut wire, ckpt, ts_ms, tx, game)?;
        analyze_kolizeum_revenue(&mut wire, ckpt, ts_ms, tx, game)?;
        analyze_kiosk_market(&mut wire, ckpt, ts_ms, tx, game)?;
    }
    Ok(wire)
}

fn analyze_game_revenue(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    for event in tx.events.iter().filter(|event| event.package == game) {
        let delta = match (event.module, event.name) {
            ("character", "CharacterCreated") => MoneyDelta {
                character_creation_mist: analytics::CHARACTER_CREATION_MIST,
                ..MoneyDelta::default()
            },
            _ => continue,
        };
        wire.money.push(MoneyFact {
            coordinate: format!("{ckpt}:{}:{}", tx.tx_index, event.index),
            ts_ms,
            delta,
        });
    }
    Ok(())
}

fn analyze_kolizeum_revenue(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    let start = tx.move_calls.iter().any(|call| {
        call.ends_with("::api::start_kolizeum") || call.ends_with("::api::ready_and_start_kolizeum")
    });
    if !start {
        return Ok(());
    }
    for output in tx
        .outputs
        .iter()
        .filter(|output| is_core(output, game, "kolizeum", "Kolizeum"))
    {
        let Some(input) = tx.inputs.iter().find(|input| input.id == output.id) else {
            continue;
        };
        let before = decode::from_bytes::<decode::Kolizeum>(input.bytes)?;
        let after = decode::from_bytes::<decode::Kolizeum>(output.bytes)?;
        let cut = before.pot.value.saturating_sub(after.pot.value);
        if cut == 0 {
            continue;
        }
        wire.money.push(MoneyFact {
            coordinate: format!("{ckpt}:{}:kolizeum:{}", tx.tx_index, output.id.hex()),
            ts_ms,
            delta: MoneyDelta {
                kolizeum_mist: cut,
                ..MoneyDelta::default()
            },
        });
    }
    Ok(())
}

fn is_core(view: &ObjView<'_>, game: &str, module: &str, name: &str) -> bool {
    view.type_key.package == game && view.type_key.module == module && view.type_key.name == name
}

fn route_friend_writes(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        if !is_core(output, game, "friends", "FriendList") {
            continue;
        }
        let list = decode::from_bytes::<decode::FriendList>(output.bytes).map_err(|error| {
            anyhow::anyhow!(
                "layout drift: friends::FriendList {} failed decode: {error}",
                output.id.hex()
            )
        })?;
        wire.publications.push(Publication {
            channel: format!("evt:social:{}", list.owner.hex()),
            payload: envelope(
                ckpt,
                tx.tx_index,
                index as u64,
                ts_ms,
                "FriendListChanged",
                json!({}),
            ),
        });
    }
    Ok(())
}

fn route_party_writes(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    let outputs = tx
        .outputs
        .iter()
        .filter(|view| is_core(view, game, "party", "Party"))
        .map(|view| (view.id, view))
        .collect::<std::collections::HashMap<_, _>>();
    let inputs = tx
        .inputs
        .iter()
        .filter(|view| is_core(view, game, "party", "Party"))
        .map(|view| (view.id, view))
        .collect::<std::collections::HashMap<_, _>>();
    let mut ids = inputs
        .keys()
        .chain(outputs.keys())
        .copied()
        .collect::<Vec<_>>();
    ids.sort_by_key(Id::hex);
    ids.dedup();
    for (index, id) in ids.into_iter().enumerate() {
        let before = inputs
            .get(&id)
            .map(|view| decode::from_bytes::<decode::Party>(view.bytes))
            .transpose()
            .map_err(|error| {
                anyhow::anyhow!(
                    "layout drift: party::Party {} failed decode: {error}",
                    id.hex()
                )
            })?;
        let after = outputs
            .get(&id)
            .map(|view| decode::from_bytes::<decode::Party>(view.bytes))
            .transpose()
            .map_err(|error| {
                anyhow::anyhow!(
                    "layout drift: party::Party {} failed decode: {error}",
                    id.hex()
                )
            })?;
        let before_members = before
            .as_ref()
            .map(|party| {
                party
                    .members
                    .iter()
                    .copied()
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        let after_members = after
            .as_ref()
            .map(|party| {
                party
                    .members
                    .iter()
                    .copied()
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        let before_pending = before
            .as_ref()
            .map(|party| {
                party
                    .pending
                    .iter()
                    .copied()
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        let after_pending = after
            .as_ref()
            .map(|party| {
                party
                    .pending
                    .iter()
                    .copied()
                    .collect::<std::collections::HashSet<_>>()
            })
            .unwrap_or_default();
        let publish = |wire: &mut Wire, kind: &str, character: Id| {
            let payload = envelope(
                ckpt,
                tx.tx_index,
                index as u64,
                ts_ms,
                kind,
                json!({ "party": id.hex(), "character": character.hex() }),
            );
            wire.publications.push(Publication {
                channel: format!("evt:party:{}", id.hex()),
                payload: payload.clone(),
            });
            wire.publications.push(Publication {
                channel: format!("evt:character:{}", character.hex()),
                payload,
            });
        };
        for character in after_members.difference(&before_members) {
            publish(wire, "PartyJoined", *character);
        }
        for character in before_members.difference(&after_members) {
            publish(wire, "PartyLeft", *character);
        }
        let mut invite_notifications = before_pending
            .symmetric_difference(&after_pending)
            .copied()
            .collect::<std::collections::HashSet<_>>();
        if before_members != after_members {
            invite_notifications.extend(after_pending.iter().copied());
        }
        for character in invite_notifications {
            publish(wire, "PartyInvitesChanged", character);
        }
    }
    Ok(())
}

fn route_trade_writes(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    let output_ids = tx
        .outputs
        .iter()
        .filter(|output| is_core(output, game, "trade", "Trade"))
        .map(|output| output.id)
        .collect::<std::collections::HashSet<_>>();
    for (index, output) in tx.outputs.iter().enumerate() {
        if !is_core(output, game, "trade", "Trade") {
            continue;
        }
        let trade = decode::from_bytes::<decode::Trade>(output.bytes).map_err(|error| {
            anyhow::anyhow!(
                "layout drift: trade::Trade {} failed decode: {error}",
                output.id.hex()
            )
        })?;
        let payload = envelope(
            ckpt,
            tx.tx_index,
            index as u64,
            ts_ms,
            "TradeChanged",
            json!({ "trade": output.id.hex() }),
        );
        for address in std::collections::HashSet::from([trade.state.initiator, trade.state.invitee])
        {
            wire.publications.push(Publication {
                channel: format!("evt:social:{}", address.hex()),
                payload: payload.clone(),
            });
        }
    }
    for (index, input) in tx.inputs.iter().enumerate() {
        if !is_core(input, game, "trade", "Trade") || output_ids.contains(&input.id) {
            continue;
        }
        let trade = decode::from_bytes::<decode::Trade>(input.bytes).map_err(|error| {
            anyhow::anyhow!(
                "layout drift: trade::Trade {} failed decode: {error}",
                input.id.hex()
            )
        })?;
        let payload = envelope(
            ckpt,
            tx.tx_index,
            index as u64,
            ts_ms,
            "TradeDestroyed",
            json!({ "trade": input.id.hex() }),
        );
        for address in std::collections::HashSet::from([trade.state.initiator, trade.state.invitee])
        {
            wire.publications.push(Publication {
                channel: format!("evt:social:{}", address.hex()),
                payload: payload.clone(),
            });
        }
    }
    Ok(())
}

/// The War Table is a live directory. Refresh only when its structural facts change: a
/// lobby write/delete, a wagered fight ending, or a wagered fighter leaving.
fn route_kolizeum_writes(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    let output_ids = tx
        .outputs
        .iter()
        .map(|output| output.id)
        .collect::<std::collections::HashSet<_>>();
    let lobby_changed = tx.outputs.iter().any(|output| {
        output.type_key.package == game
            && output.type_key.module == "kolizeum"
            && output.type_key.name == "Kolizeum"
    }) || tx.inputs.iter().any(|input| {
        input.type_key.package == game
            && input.type_key.module == "kolizeum"
            && input.type_key.name == "Kolizeum"
            && !output_ids.contains(&input.id)
    });
    let forfeited = tx.events.iter().any(|event| {
        event.package == game && event.module == "fight" && event.name == "FighterForfeited"
    });
    let fight_changed =
        tx.outputs
            .iter()
            .try_fold(false, |changed, output| -> anyhow::Result<bool> {
                if changed
                    || output.type_key.package != game
                    || output.type_key.module != "fight"
                    || output.type_key.name != "Fight"
                {
                    return Ok(changed);
                }
                let fight = decode::from_bytes::<decode::Fight>(output.bytes).map_err(|error| {
                    anyhow::anyhow!(
                        "layout drift: fight::Fight {} failed decode: {error}",
                        output.id.hex()
                    )
                })?;
                Ok(fight.door_policy == 31 && (fight.combat.ended || forfeited))
            })?;
    if lobby_changed || fight_changed {
        wire.publications.push(Publication {
            channel: "evt:kolizeum".to_string(),
            payload: envelope(ckpt, tx.tx_index, 0, ts_ms, "KolizeumChanged", json!({})),
        });
    }
    Ok(())
}

/// Every Fight write reconciles the optimistic live stream. Turn events carry animation
/// witnesses; this trailing projection event tells watchers to load the final AP/MP/HP/cells.
/// Ended writes additionally wake each participant's durable settlement recovery.
fn route_fight_writes(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        if output.type_key.package != game
            || output.type_key.module != "fight"
            || output.type_key.name != "Fight"
        {
            continue;
        }
        wire.publications.push(Publication {
            channel: format!("evt:fight:{}", output.id.hex()),
            payload: envelope(
                ckpt,
                tx.tx_index,
                index as u64,
                ts_ms,
                "FightProjected",
                json!({ "fight": output.id.hex() }),
            ),
        });
        let fight = decode::from_bytes::<decode::Fight>(output.bytes).map_err(|error| {
            anyhow::anyhow!(
                "layout drift: fight::Fight {} failed decode: {error}",
                output.id.hex()
            )
        })?;
        if let Some(dungeon) = &fight.dungeon {
            wire.publications.push(Publication {
                channel: dungeon_topic(&dungeon.dungeon),
                payload: envelope(
                    ckpt,
                    tx.tx_index,
                    index as u64,
                    ts_ms,
                    "DungeonLobbyChanged",
                    json!({ "dungeon": dungeon.dungeon }),
                ),
            });
        }
        if !fight.combat.ended {
            continue;
        }
        for authority in &fight.authorities {
            let decode::FighterAuthority::Player { character, .. } = authority else {
                continue;
            };
            wire.publications.push(Publication {
                channel: format!("evt:character:{}", character.hex()),
                payload: envelope(
                    ckpt,
                    tx.tx_index,
                    index as u64,
                    ts_ms,
                    "FightResolutionChanged",
                    json!({ "fight": fight.id.hex(), "character": character.hex() }),
                ),
            });
        }
    }
    Ok(())
}

fn dungeon_topic(dungeon: &str) -> String {
    format!("evt:dungeon:{dungeon}")
}

fn decode_dungeon_run(
    view: &ObjView<'_>,
    game: &str,
) -> anyhow::Result<Option<decode::DungeonRun>> {
    let expected = format!("{game}::dungeon::DungeonRunKey");
    if view.type_key.package != SUI_FRAMEWORK
        || view.type_key.module != "dynamic_field"
        || view.type_key.name != "Field"
        || view.type_key.type_params.first() != Some(&expected)
    {
        return Ok(None);
    }
    let field =
        decode::from_bytes::<decode::Field<decode::MarkerKey, decode::DungeonRun>>(view.bytes)
            .map_err(|error| {
                anyhow::anyhow!(
                    "layout drift: dungeon run {} failed decode: {error}",
                    view.id.hex()
                )
            })?;
    Ok(Some(field.value))
}

/// Dungeon lobby invalidation follows projected run state, including DF deletion, so every
/// entrant/advance/exit reaches peers without a world-zone subscription or a duplicate event.
fn route_dungeon_writes(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        let Some(run) = decode_dungeon_run(output, game)? else {
            continue;
        };
        wire.publications.push(Publication {
            channel: dungeon_topic(&run.dungeon),
            payload: envelope(
                ckpt,
                tx.tx_index,
                index as u64,
                ts_ms,
                "DungeonLobbyChanged",
                json!({ "dungeon": run.dungeon }),
            ),
        });
    }
    for (index, input) in tx.inputs.iter().enumerate() {
        if tx.outputs.iter().any(|output| output.id == input.id) {
            continue;
        }
        let Some(run) = decode_dungeon_run(input, game)? else {
            continue;
        };
        wire.publications.push(Publication {
            channel: dungeon_topic(&run.dungeon),
            payload: envelope(
                ckpt,
                tx.tx_index,
                index as u64,
                ts_ms,
                "DungeonLobbyChanged",
                json!({ "dungeon": run.dungeon }),
            ),
        });
    }
    Ok(())
}

/// The shared Version object is the emergency-brake truth. Unlike ordinary
/// gameplay events, this state must reach every server process after its graph
/// projection commits, including transitions authored without a Move event.
fn route_game_state(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        if output.type_key.package != game
            || output.type_key.module != "version"
            || output.type_key.name != "Version"
        {
            continue;
        }
        let version = decode::from_bytes::<decode::Version>(output.bytes).map_err(|error| {
            anyhow::anyhow!(
                "layout drift: version::Version {} failed decode: {error}",
                output.id.hex()
            )
        })?;
        wire.publications.push(Publication {
            channel: "evt:game".into(),
            payload: envelope(
                ckpt,
                tx.tx_index,
                index as u64,
                ts_ms,
                "GameStateChanged",
                json!({ "frozen": version.version == 0 }),
            ),
        });
    }
    Ok(())
}

/// Every game Item write reaches its current holder, and every departure reaches its previous
/// holder as a removal — always as a stream, never a client pull:
/// a mint's receipt cannot carry the rolled contents, and a client request
/// would race the projection — so the projection itself is the trigger (the
/// `route_game_state` precedent: object outputs, no Move event required).
/// The two-hop custody resolver turns wrapper ownership into the kiosk identity used for scope.
fn route_item_writes(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    let previous_holders = item_kiosk_holders(tx.inputs, game)?;
    let current_holders = item_kiosk_holders(tx.outputs, game)?;
    let output_ids = tx
        .outputs
        .iter()
        .filter(|output| is_core(output, game, "item", "Item"))
        .map(|output| output.id)
        .collect::<std::collections::HashSet<_>>();
    for (index, output) in tx.outputs.iter().enumerate() {
        if output.type_key.package != game
            || output.type_key.module != "item"
            || output.type_key.name != "Item"
        {
            continue;
        }
        let previous_holder = previous_holders.get(&output.id).copied();
        let holder = match output.owner {
            OwnerKind::Object(parent) => {
                Some(current_holders.get(&output.id).copied().unwrap_or(parent))
            }
            _ => None,
        };
        if holder.is_none() && previous_holder.is_none() {
            continue;
        }
        wire.publications.push(Publication {
            channel: "evt:economy".into(),
            payload: envelope(
                ckpt,
                tx.tx_index,
                index as u64,
                ts_ms,
                "ItemWritten",
                json!({
                    "item": output.id.hex(),
                    "holder": holder.map(|id| id.hex()),
                    "previous_holder": previous_holder.map(|id| id.hex()),
                }),
            ),
        });
    }
    for (index, input) in tx.inputs.iter().enumerate() {
        if !is_core(input, game, "item", "Item") || output_ids.contains(&input.id) {
            continue;
        }
        let Some(holder) = previous_holders.get(&input.id) else {
            continue;
        };
        wire.publications.push(Publication {
            channel: "evt:economy".into(),
            payload: envelope(
                ckpt,
                tx.tx_index,
                (tx.outputs.len() + index) as u64,
                ts_ms,
                "ItemRemoved",
                json!({ "item": input.id.hex(), "holder": holder.hex() }),
            ),
        });
    }
    Ok(())
}

fn item_kiosk_holders(
    views: &[ObjView<'_>],
    game: &str,
) -> anyhow::Result<std::collections::HashMap<Id, Id>> {
    Ok(ownership::resolve(views, game)?
        .into_iter()
        .filter_map(|fact| match fact {
            Custody::KioskHolds {
                kiosk,
                object,
                label: "Item",
                ..
            } => Some((object, kiosk)),
            _ => None,
        })
        .collect())
}

/// A CHARACTER'S CUSTODY, BOTH WAYS, on its own channel — custody is state, not an event.
/// `FighterJoined` witnesses only the seats taken by a join; a fight's creator (a duel
/// challenge, a mob engage, a gathering ambush) takes seat 0 at BIRTH with no join at all,
/// so the player whose character sits in it heard nothing and never entered the fight.
/// The RETURN needs the same witness: a forfeit or a settle re-locks the character into its
/// kiosk, and a client whose roster still names the old seat refuses every next action
/// ("already in a fight", 2026-08-22). The projection is the trigger (the `route_item_writes`
/// precedent): one mechanism for every custody move, whichever door caused it.
pub fn route_character_custody(wire: &mut Wire, ckpt: u64, ts_ms: u64, custody: &[Custody]) {
    for (index, fact) in custody.iter().enumerate() {
        let (character, owner, kind, data) = match fact {
            Custody::FightSeats {
                fight,
                seat,
                character,
            } => (
                character,
                None,
                "CharacterSeated",
                json!({
                    "fight": fight.hex(),
                    "character": character.hex(),
                    "seat": seat,
                }),
            ),
            Custody::KioskHolds {
                kiosk,
                object,
                label: "Character",
                owner,
            } => (
                object,
                *owner,
                "CharacterHeld",
                json!({ "character": object.hex(), "kiosk": kiosk.hex() }),
            ),
            _ => continue,
        };
        let payload = envelope(ckpt, 0, index as u64, ts_ms, kind, data);
        wire.publications.push(Publication {
            channel: format!("evt:character:{}", character.hex()),
            payload: payload.clone(),
        });
        if let Some(owner) = owner {
            wire.publications.push(Publication {
                channel: format!("evt:social:{}", owner.hex()),
                payload,
            });
        }
    }
}

fn envelope(
    ckpt: u64,
    tx: u64,
    evt: u64,
    ts_ms: u64,
    kind: &str,
    data: serde_json::Value,
) -> String {
    json!({
        "ckpt": ckpt,
        "tx": tx,
        "evt": evt,
        "ts_ms": ts_ms,
        "type": kind,
        "data": data,
    })
    .to_string()
}

// ╔════════════════ [ Game events → channels ] ═══════════════════════════════ ]

fn route_game_events(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
    seed: &str,
) -> anyhow::Result<()> {
    for event in tx.events {
        // TWO origins since the living-content split (2026-08-23): gameplay events come
        // from core, content events (template creations, ContentWritten) from the seed
        // package — both are ours.
        if event.package != game && event.package != seed {
            continue;
        }
        let Some(routed) = events::route(event.module, event.name, event.bytes)? else {
            continue;
        };
        let payload = envelope(
            ckpt,
            tx.tx_index,
            event.index,
            ts_ms,
            routed.kind,
            routed.data.clone(),
        );
        // fight-phase MIRROR: the roster's watchers hear starts/ends on the fight channel,
        // but the ZONE's bystanders (sword markers) need the same facts — the events carry
        // their anchor precisely for this fan-out.
        if matches!(routed.kind, "FightStarted" | "FightEnded") {
            if let Some(fight) = routed.data["fight"].as_str() {
                wire.fight_lifecycle.push(FightLifecycleStamp {
                    fight: fight.to_string(),
                    started: routed.kind == "FightStarted",
                    ts_ms,
                });
            }
            if let (Some(world), Some(x), Some(z)) = (
                routed.data["world"].as_str(),
                routed.data["x"].as_u64(),
                routed.data["z"].as_u64(),
            ) {
                // the MIRROR is best-effort; the fight's own channel below is not. An anchor
                // this fan-out cannot read must never cost the participants their event.
                if let (Ok(x), Ok(z)) = (u32::try_from(x), u32::try_from(z)) {
                    wire.publications.push(Publication {
                        channel: crate::events::zone_topic(world, x, z),
                        payload: payload.clone(),
                    });
                }
            }
        }
        // Kolizeum events are receipt facts. The directory publishes one coalesced invalidation
        // from object/fight writes below instead of rereading once per event plus once per write.
        if routed.topic != "evt:kolizeum" {
            wire.publications.push(Publication {
                channel: routed.topic,
                payload,
            });
        }
    }
    Ok(())
}

// ╔════════════════ [ Kiosk marketplace — the discriminator ] ════════════════ ]

fn is_game_obj<'a>(outputs: &'a [ObjView<'a>], id: Id, game: &str) -> Option<&'a ObjView<'a>> {
    outputs.iter().find(|o| {
        o.id == id
            && o.type_key.package == game
            && (o.type_key.name == "Item" || o.type_key.name == "Character")
    })
}

fn pays_royalty(tx: &TxView<'_>) -> bool {
    tx.move_calls
        .iter()
        .any(|call| call.ends_with("::royalty_rule::pay"))
}

/// Is a kiosk event's phantom `T` one of OUR types? The event TYPE carries it
/// (`ItemListed<T>`), so foreign collections' market noise filters here — the
/// body cannot tell (the old contract's proven lesson), the type can.
fn is_game_market_event(event: &EventView<'_>, game: &str) -> bool {
    event.type_params.first().is_some_and(|t| {
        t == &format!("{game}::item::Item") || t == &format!("{game}::character::Character")
    })
}

/// Decode the co-present Kiosk, loudly — a type-matched `0x2::kiosk::Kiosk`
/// failing decode is layout drift, never noise (no-silent-failures law).
fn kiosk_view<'a>(views: &'a [ObjView<'a>], kiosk: Id) -> anyhow::Result<Option<decode::Kiosk>> {
    let Some(o) = views.iter().find(|o| {
        o.id == kiosk && o.type_key.package == SUI_FRAMEWORK && o.type_key.name == "Kiosk"
    }) else {
        return Ok(None);
    };
    decode::from_bytes::<decode::Kiosk>(o.bytes)
        .map(Some)
        .map_err(|e| {
            anyhow::anyhow!(
                "layout drift: kiosk::Kiosk {} failed decode: {e}",
                kiosk.hex()
            )
        })
}

struct SaleShape {
    kind: &'static str,
    item_type: Option<String>,
    name: String,
    amount: u64,
}

fn sale_shape(sold: &ObjView<'_>) -> anyhow::Result<SaleShape> {
    if sold.type_key.name == "Item" {
        let item = decode::from_bytes::<decode::Item>(sold.bytes).map_err(|e| {
            anyhow::anyhow!(
                "layout drift: item::Item {} failed decode: {e}",
                sold.id.hex()
            )
        })?;
        return Ok(SaleShape {
            kind: "item",
            item_type: Some(item.item_type),
            name: item.name,
            amount: item.amount.max(1) as u64,
        });
    }
    let character = decode::from_bytes::<decode::Character>(sold.bytes).map_err(|e| {
        anyhow::anyhow!(
            "layout drift: character::Character {} failed decode: {e}",
            sold.id.hex()
        )
    })?;
    Ok(SaleShape {
        kind: "character",
        item_type: None,
        name: character.name,
        amount: 1,
    })
}

/// One realised sale → two history rows (+ a market stamp for public item sales).
#[allow(clippy::too_many_arguments)]
fn push_sale(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: u64,
    evt: u64,
    sold_id: Id,
    shape: &SaleShape,
    price: u64,
    seller: Option<Addr>,
    buyer: Addr,
    exclusive: bool,
) {
    let coordinate = format!("{ckpt}:{tx}:{evt}");
    let base = json!({
        "object": sold_id.hex(),
        "kind": shape.kind,
        "name": shape.name,
        "item_type": shape.item_type,
        "amount": shape.amount,
        "price_mist": price.to_string(),
        "exclusive": exclusive,
        "ts_ms": ts_ms,
    });
    let mut row = |address: Addr, side: &str, counterparty: Option<Addr>| {
        let mut data = base.clone();
        data["side"] = json!(side);
        data["counterparty"] = json!(counterparty.map(|a| a.hex()));
        wire.sales.push(SalesRow {
            address,
            ts_ms,
            member: format!("{coordinate}|{data}"),
        });
    };
    row(buyer, "bought", seller);
    if let Some(seller) = seller {
        row(seller, "sold", Some(buyer));
    }
    if price > 0 {
        let delta = if shape.kind == "item" {
            MoneyDelta {
                item_royalty_mist: analytics::royalty_mist(price),
                ..MoneyDelta::default()
            }
        } else {
            MoneyDelta {
                character_royalty_mist: analytics::royalty_mist(price),
                ..MoneyDelta::default()
            }
        };
        wire.money.push(MoneyFact {
            coordinate: coordinate.clone(),
            ts_ms,
            delta,
        });
    }
    // the market stamp: PUBLIC ITEM sales only, per-unit, never zero.
    if !exclusive && price > 0 {
        if let Some(item_type) = &shape.item_type {
            wire.market.push(MarketStamp {
                item_type: item_type.clone(),
                price_per_unit_mist: price / shape.amount.max(1),
                ts_ms,
            });
        }
    }
}

fn analyze_kiosk_market(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    let royalty = pays_royalty(tx);
    for event in tx.events {
        if event.package != SUI_FRAMEWORK || event.module != "kiosk" {
            continue;
        }
        match event.name {
            "ItemPurchased" => {
                // a foreign collection's trade — the phantom T names it (M4)
                if !is_game_market_event(event, game) {
                    continue;
                }
                let e = decode::from_bytes::<events::KioskItemPurchased>(event.bytes)
                    .map_err(|err| anyhow::anyhow!("layout drift: kiosk::ItemPurchased: {err}"))?;
                // THREE independent gates, all required (defense in depth):
                //   price > 0 — the 0.01 SUI royalty floor makes a genuine
                //     0-price sale impossible, and every protected-policy
                //     extract is 0-price, so a spoofed `royalty_rule::pay` in
                //     the same PTB can no longer launder plumbing into sales;
                //   royalty present — our real policies always collect;
                //   ours-output — the object changed hands in THIS tx.
                if e.price == 0 || !royalty {
                    continue;
                }
                // A purchase may merge the bought stack into an existing destination stack in
                // the SAME PTB. The bought object is then deleted, so its authoritative sale
                // shape survives only in pre-state.
                let Some(sold) = is_game_obj(tx.outputs, e.id, game)
                    .or_else(|| is_game_obj(tx.inputs, e.id, game))
                else {
                    continue;
                };
                let seller = match kiosk_view(tx.outputs, e.kiosk)? {
                    Some(k) => Some(k.owner),
                    None => kiosk_view(tx.inputs, e.kiosk)?.map(|k| k.owner),
                };
                let shape = sale_shape(sold)?;
                push_sale(
                    wire,
                    ckpt,
                    ts_ms,
                    tx.tx_index,
                    event.index,
                    sold.id,
                    &shape,
                    e.price,
                    seller,
                    tx.sender,
                    false,
                );
                wire.publications.push(Publication {
                    channel: "evt:economy".into(),
                    payload: envelope(
                        ckpt,
                        tx.tx_index,
                        event.index,
                        ts_ms,
                        "MarketPurchased",
                        json!({
                            "kiosk": e.kiosk.hex(),
                            "object": e.id.hex(),
                            "seller": seller.map(|address| address.hex()),
                            "buyer": tx.sender.hex(),
                            "kind": shape.kind,
                            "name": shape.name,
                            "item_type": shape.item_type,
                            "amount": shape.amount,
                            "price_mist": e.price.to_string(),
                        }),
                    ),
                });
            }
            "ItemListed" | "ItemDelisted" => {
                // foreign collections never reach the game channel (M4)
                if !is_game_market_event(event, game) {
                    continue;
                }
                let (id, kiosk, price) = if event.name == "ItemListed" {
                    let e = decode::from_bytes::<events::KioskItemListed>(event.bytes)
                        .map_err(|err| anyhow::anyhow!("layout drift: kiosk::ItemListed: {err}"))?;
                    (e.id, e.kiosk, Some(e.price))
                } else {
                    let e = decode::from_bytes::<events::KioskItemDelisted>(event.bytes).map_err(
                        |err| anyhow::anyhow!("layout drift: kiosk::ItemDelisted: {err}"),
                    )?;
                    (e.id, e.kiosk, None)
                };
                // Suppress only THIS object's protected-policy extract pair. Another stack may
                // legitimately list/delist in the same PTB while a merge consumes a 0-price
                // source; transaction-wide suppression made that real market delta disappear.
                let plumbing = price == Some(0)
                    && tx.events.iter().any(|other| {
                        other.module == "kiosk"
                            && other.name == "ItemPurchased"
                            && decode::from_bytes::<events::KioskItemPurchased>(other.bytes)
                                .map(|purchase| purchase.price == 0 && purchase.id == id)
                                .unwrap_or(false)
                    });
                if plumbing {
                    continue;
                }
                let kind = if event.name == "ItemListed" {
                    "MarketListed"
                } else {
                    "MarketDelisted"
                };
                wire.publications.push(Publication {
                    channel: "evt:economy".into(),
                    payload: envelope(
                        ckpt,
                        tx.tx_index,
                        event.index,
                        ts_ms,
                        kind,
                        json!({
                            "kiosk": kiosk.hex(),
                            "object": id.hex(),
                            "price_mist": price.map(|p| p.to_string()),
                        }),
                    ),
                });
            }
            _ => {}
        }
    }
    analyze_exclusive_market(wire, ckpt, ts_ms, tx, game, royalty)?;
    Ok(())
}

fn exclusive_listing(
    view: &ObjView<'_>,
) -> anyhow::Result<Option<decode::Field<decode::KioskListingKey, u64>>> {
    let listing = format!("{SUI_FRAMEWORK}::kiosk::Listing");
    if view.type_key.package != SUI_FRAMEWORK
        || view.type_key.module != "dynamic_field"
        || view.type_key.name != "Field"
        || view.type_key.type_params.first() != Some(&listing)
    {
        return Ok(None);
    }
    decode::from_bytes(view.bytes).map(Some).map_err(|error| {
        anyhow::anyhow!(
            "layout drift: exclusive kiosk listing {}: {error}",
            view.id.hex()
        )
    })
}

fn analyze_exclusive_market(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
    royalty: bool,
) -> anyhow::Result<()> {
    if !royalty {
        return Ok(());
    }
    for (index, input) in tx.inputs.iter().enumerate() {
        let Some(listing) = exclusive_listing(input)? else {
            continue;
        };
        if !listing.name.is_exclusive || tx.outputs.iter().any(|output| output.id == input.id) {
            continue;
        }
        let OwnerKind::Object(kiosk_id) = input.owner else {
            continue;
        };
        let same_kiosk = tx
            .inputs
            .iter()
            .filter(|candidate| matches!(candidate.owner, OwnerKind::Object(owner) if owner == kiosk_id))
            .map(exclusive_listing)
            .collect::<anyhow::Result<Vec<_>>>()?;
        if same_kiosk
            .iter()
            .flatten()
            .filter(|field| field.name.is_exclusive)
            .count()
            != 1
        {
            continue;
        }
        let (Some(before), Some(after), Some(sold)) = (
            kiosk_view(tx.inputs, kiosk_id)?,
            kiosk_view(tx.outputs, kiosk_id)?,
            is_game_obj(tx.outputs, listing.name.id, game),
        ) else {
            continue;
        };
        let Some(price) = after
            .profits
            .value
            .checked_sub(before.profits.value)
            .filter(|price| *price > 0)
        else {
            continue;
        };
        let shape = sale_shape(sold)?;
        push_sale(
            wire,
            ckpt,
            ts_ms,
            tx.tx_index,
            index as u64,
            sold.id,
            &shape,
            price,
            Some(after.owner),
            tx.sender,
            true,
        );
    }
    Ok(())
}

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ownership::{OwnerKind, TypeKey};

    const GAME: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const SEED: &str = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn game_item_param() -> Vec<String> {
        vec![format!("{GAME}::item::Item")]
    }

    #[test]
    fn royalty_target_accepts_the_configured_kiosk_extension_package() {
        let exact = format!("{SUI_FRAMEWORK}::royalty_rule::pay");
        let extension = format!("0x{}::royalty_rule::pay", "ee".repeat(32));
        let unrelated = format!("0x{}::other_rule::pay", "dd".repeat(32));
        let base = TxView {
            tx_index: 0,
            sender: Addr([7; 32]),
            move_calls: std::slice::from_ref(&exact),
            events: &[],
            inputs: &[],
            outputs: &[],
        };
        assert!(pays_royalty(&base));
        assert!(pays_royalty(&TxView {
            move_calls: std::slice::from_ref(&extension),
            ..base.clone()
        }));
        assert!(!pays_royalty(&TxView {
            move_calls: std::slice::from_ref(&unrelated),
            ..base
        }));
    }

    fn ty(package: &str, module: &str, name: &str) -> TypeKey {
        TypeKey {
            package: package.into(),
            module: module.into(),
            name: name.into(),
            type_params: vec![],
        }
    }

    fn item_bytes(id: u8, item_type: &str, amount: u32) -> Vec<u8> {
        bcs::to_bytes(&crate::decode::Item {
            id: Id([id; 32]),
            template: Id([200; 32]),
            name: "n".into(),
            item_type: item_type.into(),
            category: "resource".into(),
            level: 1,
            amount,
        })
        .unwrap()
    }

    fn kiosk_item_wrapper_type() -> TypeKey {
        TypeKey {
            package: SUI_FRAMEWORK.into(),
            module: "dynamic_field".into(),
            name: "Field".into(),
            type_params: vec![
                format!(
                    "{SUI_FRAMEWORK}::dynamic_object_field::Wrapper<{SUI_FRAMEWORK}::kiosk::Item>"
                ),
                format!("{SUI_FRAMEWORK}::object::ID"),
            ],
        }
    }

    fn kiosk_item_wrapper_bytes(wrapper: Id, item: Id) -> Vec<u8> {
        bcs::to_bytes(&crate::decode::Field {
            id: wrapper,
            name: crate::decode::DynamicObjectFieldWrapper {
                name: crate::decode::KioskItemKey { id: item },
            },
            value: item,
        })
        .unwrap()
    }

    fn dungeon_run_type() -> TypeKey {
        TypeKey {
            package: SUI_FRAMEWORK.into(),
            module: "dynamic_field".into(),
            name: "Field".into(),
            type_params: vec![format!("{GAME}::dungeon::DungeonRunKey")],
        }
    }

    fn dungeon_run_bytes(id: u8) -> Vec<u8> {
        bcs::to_bytes(&crate::decode::Field {
            id: Id([id; 32]),
            name: false,
            value: crate::decode::DungeonRun {
                dungeon: "tangled_aftermath".into(),
                room: 2,
                seed: 88,
            },
        })
        .unwrap()
    }

    #[test]
    fn a_kolizeum_write_and_its_receipt_event_emit_one_directory_invalidation() {
        #[derive(serde::Serialize)]
        struct Created {
            kolizeum: Id,
            fight: Id,
            pledge: u64,
            format: u64,
        }
        let lobby_type = ty(GAME, "kolizeum", "Kolizeum");
        let lobby_bytes = bcs::to_bytes(&crate::decode::Kolizeum {
            id: Id([31; 32]),
            pot: crate::decode::Balance { value: 10 },
            pledge: 10,
            fight: Id([32; 32]),
            format: 3,
            level_min: 1,
            level_max: 50,
            allowed: None,
        })
        .unwrap();
        let lobby = ObjView {
            id: Id([31; 32]),
            owner: OwnerKind::Shared,
            type_key: &lobby_type,
            bytes: &lobby_bytes,
        };
        let event_bytes = bcs::to_bytes(&Created {
            kolizeum: Id([31; 32]),
            fight: Id([32; 32]),
            pledge: 10,
            format: 3,
        })
        .unwrap();
        let event = EventView {
            package: GAME,
            module: "kolizeum",
            name: "KolizeumCreated",
            type_params: &[],
            bytes: &event_bytes,
            index: 0,
        };
        let tx = TxView {
            tx_index: 2,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: std::slice::from_ref(&event),
            inputs: &[],
            outputs: std::slice::from_ref(&lobby),
        };

        let wire = analyze(60, 4_000, &[tx], GAME, SEED).unwrap();
        let directory = wire
            .publications
            .iter()
            .filter(|publication| publication.channel == "evt:kolizeum")
            .collect::<Vec<_>>();
        assert_eq!(directory.len(), 1);
        let payload: serde_json::Value = serde_json::from_str(&directory[0].payload).unwrap();
        assert_eq!(payload["type"], "KolizeumChanged");
    }

    #[test]
    fn character_creation_and_kolizeum_cut_are_exact_revenue_facts() {
        #[derive(serde::Serialize)]
        struct CharacterCreated {
            character: Id,
            owner: Addr,
            name: String,
            classe: String,
        }
        let lobby_type = ty(GAME, "kolizeum", "Kolizeum");
        let character = bcs::to_bytes(&CharacterCreated {
            character: Id([41; 32]),
            owner: Addr([7; 32]),
            name: "aiden".into(),
            classe: "yajin".into(),
        })
        .unwrap();
        let events = [EventView {
            package: GAME,
            module: "character",
            name: "CharacterCreated",
            type_params: &[],
            bytes: &character,
            index: 2,
        }];
        let before = bcs::to_bytes(&crate::decode::Kolizeum {
            id: Id([42; 32]),
            pot: crate::decode::Balance {
                value: 2_000_000_000,
            },
            pledge: 1_000_000_000,
            fight: Id([43; 32]),
            format: 1,
            level_min: 1,
            level_max: 200,
            allowed: None,
        })
        .unwrap();
        let after = bcs::to_bytes(&crate::decode::Kolizeum {
            id: Id([42; 32]),
            pot: crate::decode::Balance {
                value: 1_800_000_000,
            },
            pledge: 1_000_000_000,
            fight: Id([43; 32]),
            format: 1,
            level_min: 1,
            level_max: 200,
            allowed: None,
        })
        .unwrap();
        let input = ObjView {
            id: Id([42; 32]),
            owner: OwnerKind::Shared,
            type_key: &lobby_type,
            bytes: &before,
        };
        let output = ObjView {
            id: Id([42; 32]),
            owner: OwnerKind::Shared,
            type_key: &lobby_type,
            bytes: &after,
        };
        let start_call = "0x99::api::start_kolizeum".to_string();
        let tx = TxView {
            tx_index: 4,
            sender: Addr([7; 32]),
            move_calls: std::slice::from_ref(&start_call),
            events: &events,
            inputs: std::slice::from_ref(&input),
            outputs: std::slice::from_ref(&output),
        };

        let wire = analyze(60, 4_000, &[tx], GAME, SEED).unwrap();

        assert_eq!(wire.money.len(), 2);
        assert_eq!(wire.money[0].coordinate, "60:4:2");
        assert_eq!(wire.money[0].delta.character_creation_mist, 1_000_000_000);
        assert_eq!(
            wire.money[1].coordinate,
            format!("60:4:kolizeum:{}", Id([42; 32]).hex())
        );
        assert_eq!(wire.money[1].delta.kolizeum_mist, 200_000_000);
    }

    #[test]
    fn dungeon_run_writes_and_deletion_invalidate_only_the_portal_lobby() {
        let run_type = dungeon_run_type();
        let bytes = dungeon_run_bytes(44);
        let run = ObjView {
            id: Id([44; 32]),
            owner: OwnerKind::Object(Id([5; 32])),
            type_key: &run_type,
            bytes: &bytes,
        };
        let output_tx = TxView {
            tx_index: 2,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &[],
            inputs: &[],
            outputs: std::slice::from_ref(&run),
        };
        let deleted_tx = TxView {
            tx_index: 3,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &[],
            inputs: std::slice::from_ref(&run),
            outputs: &[],
        };

        for tx in [output_tx, deleted_tx] {
            let wire = analyze(60, 4_000, &[tx], GAME, SEED).unwrap();
            assert_eq!(wire.publications.len(), 1);
            assert_eq!(
                wire.publications[0].channel,
                "evt:dungeon:tangled_aftermath"
            );
            let payload: serde_json::Value =
                serde_json::from_str(&wire.publications[0].payload).unwrap();
            assert_eq!(payload["type"], "DungeonLobbyChanged");
        }
    }

    #[test]
    fn a_projected_item_output_streams_to_its_holder() {
        let item_type = ty(GAME, "item", "Item");
        let bytes = item_bytes(3, "wool", 1);
        let outputs = [ObjView {
            id: Id([3; 32]),
            owner: OwnerKind::Object(Id([77; 32])),
            type_key: &item_type,
            bytes: &bytes,
        }];
        let tx = TxView {
            tx_index: 2,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &[],
            inputs: &[],
            outputs: &outputs,
        };

        let wire = analyze(60, 4_000, &[tx], GAME, SEED).unwrap();

        assert_eq!(wire.publications.len(), 1);
        assert_eq!(wire.publications[0].channel, "evt:economy");
        let payload: serde_json::Value =
            serde_json::from_str(&wire.publications[0].payload).unwrap();
        assert_eq!(payload["type"], "ItemWritten");
        assert_eq!(payload["data"]["item"], Id([3; 32]).hex());
        assert_eq!(payload["data"]["holder"], Id([77; 32]).hex());
    }

    #[test]
    fn a_destroyed_kiosk_item_streams_an_authoritative_removal() {
        let item_type = ty(GAME, "item", "Item");
        let wrapper_type = kiosk_item_wrapper_type();
        let item = Id([3; 32]);
        let wrapper = Id([4; 32]);
        let kiosk = Id([5; 32]);
        let item_bytes = item_bytes(3, "wool", 1);
        let wrapper_bytes = kiosk_item_wrapper_bytes(wrapper, item);
        let inputs = [
            ObjView {
                id: item,
                owner: OwnerKind::Object(wrapper),
                type_key: &item_type,
                bytes: &item_bytes,
            },
            ObjView {
                id: wrapper,
                owner: OwnerKind::Object(kiosk),
                type_key: &wrapper_type,
                bytes: &wrapper_bytes,
            },
        ];
        let tx = TxView {
            tx_index: 2,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &[],
            inputs: &inputs,
            outputs: &[],
        };

        let wire = analyze(60, 4_000, &[tx], GAME, SEED).unwrap();
        let payload: serde_json::Value =
            serde_json::from_str(&wire.publications[0].payload).unwrap();
        assert_eq!(payload["type"], "ItemRemoved");
        assert_eq!(payload["data"]["item"], item.hex());
        assert_eq!(payload["data"]["holder"], kiosk.hex());
    }

    #[test]
    fn an_address_owned_item_output_stays_silent() {
        // only PARENTED items stream (kiosk inventory / character equipment) — an
        // address-owned Item is outside game custody and has no holder to scope to
        let item_type = ty(GAME, "item", "Item");
        let bytes = item_bytes(4, "wool", 1);
        let outputs = [ObjView {
            id: Id([4; 32]),
            owner: OwnerKind::Address(Addr([8; 32])),
            type_key: &item_type,
            bytes: &bytes,
        }];
        let tx = TxView {
            tx_index: 2,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &[],
            inputs: &[],
            outputs: &outputs,
        };

        let wire = analyze(60, 4_000, &[tx], GAME, SEED).unwrap();

        assert!(wire.publications.is_empty());
    }

    #[test]
    fn version_output_publishes_the_global_freeze_state() {
        let version_type = ty(GAME, "version", "Version");
        let version = bcs::to_bytes(&crate::decode::Version {
            id: Id([9; 32]),
            version: 0,
        })
        .unwrap();
        let outputs = [ObjView {
            id: Id([9; 32]),
            owner: OwnerKind::Shared,
            type_key: &version_type,
            bytes: &version,
        }];
        let tx = TxView {
            tx_index: 3,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &[],
            inputs: &[],
            outputs: &outputs,
        };

        let wire =
            analyze_with_digests(55, 9_000, &[tx], &["tx-digest".into()], GAME, SEED).unwrap();

        assert_eq!(wire.publications.len(), 1);
        assert_eq!(wire.publications[0].channel, "evt:game");
        let payload: serde_json::Value =
            serde_json::from_str(&wire.publications[0].payload).unwrap();
        assert_eq!(payload["type"], "GameStateChanged");
        assert_eq!(payload["data"]["frozen"], true);
        assert_eq!(payload["ckpt"], 55);
    }

    fn kiosk_bytes(id: u8, owner: u8, profits: u64) -> Vec<u8> {
        bcs::to_bytes(&crate::decode::Kiosk {
            id: Id([id; 32]),
            profits: crate::decode::Balance { value: profits },
            owner: Addr([owner; 32]),
            item_count: 1,
            allow_extensions: false,
        })
        .unwrap()
    }

    fn purchased_bytes(kiosk: u8, id: u8, price: u64) -> Vec<u8> {
        #[derive(serde::Serialize)]
        struct Wire {
            kiosk: [u8; 32],
            id: [u8; 32],
            price: u64,
        }
        bcs::to_bytes(&Wire {
            kiosk: [kiosk; 32],
            id: [id; 32],
            price,
        })
        .unwrap()
    }

    fn listed_bytes(kiosk: u8, id: u8, price: u64) -> Vec<u8> {
        #[derive(serde::Serialize)]
        struct Wire {
            kiosk: [u8; 32],
            id: [u8; 32],
            price: u64,
        }
        bcs::to_bytes(&Wire {
            kiosk: [kiosk; 32],
            id: [id; 32],
            price,
        })
        .unwrap()
    }

    fn delisted_bytes(kiosk: u8, id: u8) -> Vec<u8> {
        #[derive(serde::Serialize)]
        struct Wire {
            kiosk: [u8; 32],
            id: [u8; 32],
        }
        bcs::to_bytes(&Wire {
            kiosk: [kiosk; 32],
            id: [id; 32],
        })
        .unwrap()
    }

    #[test]
    fn zero_price_merge_suppresses_only_its_own_listing_pair() {
        let purchase = purchased_bytes(2, 5, 0);
        let extracted_listing = listed_bytes(2, 5, 0);
        let real_delist = delisted_bytes(2, 5);
        let real_listing = listed_bytes(2, 6, 700);
        let phantom = game_item_param();
        let events = [
            EventView {
                package: SUI_FRAMEWORK,
                module: "kiosk",
                name: "ItemPurchased",
                type_params: &phantom,
                bytes: &purchase,
                index: 0,
            },
            EventView {
                package: SUI_FRAMEWORK,
                module: "kiosk",
                name: "ItemDelisted",
                type_params: &phantom,
                bytes: &real_delist,
                index: 1,
            },
            EventView {
                package: SUI_FRAMEWORK,
                module: "kiosk",
                name: "ItemListed",
                type_params: &phantom,
                bytes: &extracted_listing,
                index: 2,
            },
            EventView {
                package: SUI_FRAMEWORK,
                module: "kiosk",
                name: "ItemListed",
                type_params: &phantom,
                bytes: &real_listing,
                index: 3,
            },
        ];
        let tx = TxView {
            tx_index: 1,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &events,
            inputs: &[],
            outputs: &[],
        };
        let wire = analyze(100, 1_000, &[tx], GAME, SEED).unwrap();
        assert_eq!(wire.publications.len(), 2);
        assert!(wire
            .publications
            .iter()
            .any(|row| row.payload.contains("MarketDelisted")
                && row.payload.contains(&Id([5; 32]).hex())));
        assert!(wire
            .publications
            .iter()
            .any(|row| row.payload.contains("MarketListed")
                && row.payload.contains(&Id([6; 32]).hex())));
    }

    #[test]
    fn genuine_purchase_needs_royalty_and_our_output() {
        let item_type = ty(GAME, "item", "Item");
        let kiosk_type = ty(SUI_FRAMEWORK, "kiosk", "Kiosk");
        let sold = item_bytes(5, "wooling_wool", 10);
        let kiosk = kiosk_bytes(2, 9, 0);
        let outputs = [
            ObjView {
                id: Id([5; 32]),
                owner: OwnerKind::Object(Id([50; 32])),
                type_key: &item_type,
                bytes: &sold,
            },
            ObjView {
                id: Id([2; 32]),
                owner: OwnerKind::Shared,
                type_key: &kiosk_type,
                bytes: &kiosk,
            },
        ];
        let purchase = purchased_bytes(2, 5, 1_000);
        let phantom = game_item_param();
        let events = [EventView {
            package: SUI_FRAMEWORK,
            module: "kiosk",
            name: "ItemPurchased",
            type_params: &phantom,
            bytes: &purchase,
            index: 0,
        }];
        let pay_call = format!("{SUI_FRAMEWORK}::royalty_rule::pay");

        // WITH the royalty proof → two rows + a per-unit stamp (1000 / 10)
        let tx = TxView {
            tx_index: 1,
            sender: Addr([7; 32]),
            move_calls: std::slice::from_ref(&pay_call),
            events: &events,
            inputs: &[],
            outputs: &outputs,
        };
        let wire = analyze(100, 1_000, std::slice::from_ref(&tx), GAME, SEED).unwrap();
        assert_eq!(wire.sales.len(), 2);
        assert!(wire.sales[0].member.starts_with("100:1:0|"));
        let purchased: serde_json::Value = serde_json::from_str(
            &wire
                .publications
                .iter()
                .find(|row| row.payload.contains("MarketPurchased"))
                .expect("the purchase reaches the economy stream")
                .payload,
        )
        .unwrap();
        assert_eq!(purchased["data"]["buyer"], Addr([7; 32]).hex());
        assert_eq!(purchased["data"]["seller"], Addr([9; 32]).hex());
        assert_eq!(purchased["data"]["kind"], "item");
        assert_eq!(purchased["data"]["name"], "n");
        assert_eq!(purchased["data"]["item_type"], "wooling_wool");
        assert_eq!(purchased["data"]["amount"], 10);
        assert_eq!(wire.money.len(), 1);
        assert_eq!(wire.money[0].delta.item_royalty_mist, 10_000_000);
        assert_eq!(wire.money[0].delta.character_royalty_mist, 0);
        assert_eq!(
            wire.market,
            vec![MarketStamp {
                item_type: "wooling_wool".into(),
                price_per_unit_mist: 100,
                ts_ms: 1_000
            }]
        );

        // WITHOUT it → plumbing: nothing at all
        let plumbing = TxView {
            move_calls: &[],
            ..tx.clone()
        };
        let wire = analyze(100, 1_000, &[plumbing], GAME, SEED).unwrap();
        assert!(wire.sales.is_empty() && wire.market.is_empty() && wire.money.is_empty());
    }

    #[test]
    fn purchased_stack_merged_away_still_writes_seller_history() {
        let item_type = ty(GAME, "item", "Item");
        let kiosk_type = ty(SUI_FRAMEWORK, "kiosk", "Kiosk");
        let sold = item_bytes(5, "wooling_wool", 10);
        let kiosk = kiosk_bytes(2, 9, 1_000);
        let inputs = [
            ObjView {
                id: Id([5; 32]),
                owner: OwnerKind::Object(Id([2; 32])),
                type_key: &item_type,
                bytes: &sold,
            },
            ObjView {
                id: Id([2; 32]),
                owner: OwnerKind::Shared,
                type_key: &kiosk_type,
                bytes: &kiosk,
            },
        ];
        let outputs = [ObjView {
            id: Id([2; 32]),
            owner: OwnerKind::Shared,
            type_key: &kiosk_type,
            bytes: &kiosk,
        }];
        let purchase = purchased_bytes(2, 5, 1_000);
        let phantom = game_item_param();
        let events = [EventView {
            package: SUI_FRAMEWORK,
            module: "kiosk",
            name: "ItemPurchased",
            type_params: &phantom,
            bytes: &purchase,
            index: 0,
        }];
        let pay_call = format!("{SUI_FRAMEWORK}::royalty_rule::pay");
        let tx = TxView {
            tx_index: 1,
            sender: Addr([7; 32]),
            move_calls: std::slice::from_ref(&pay_call),
            events: &events,
            inputs: &inputs,
            outputs: &outputs,
        };

        let wire = analyze(100, 1_000, &[tx], GAME, SEED).unwrap();

        assert_eq!(wire.sales.len(), 2);
        assert!(wire.sales.iter().any(|row| row.address == Addr([9; 32])));
        assert!(wire
            .publications
            .iter()
            .any(|row| row.payload.contains("MarketPurchased")
                && row.payload.contains("wooling_wool")));
    }

    #[test]
    fn exclusive_purchase_uses_the_deleted_listing_and_kiosk_profit_delta() {
        let item_type = ty(GAME, "item", "Item");
        let kiosk_type = ty(SUI_FRAMEWORK, "kiosk", "Kiosk");
        let mut listing_type = ty(SUI_FRAMEWORK, "dynamic_field", "Field");
        listing_type.type_params = vec![format!("{SUI_FRAMEWORK}::kiosk::Listing"), "u64".into()];
        let sold = item_bytes(5, "wooling_wool", 10);
        let before = kiosk_bytes(2, 9, 0);
        let after = kiosk_bytes(2, 9, 1_000);
        let listing = bcs::to_bytes(&crate::decode::Field {
            id: Id([70; 32]),
            name: crate::decode::KioskListingKey {
                id: Id([5; 32]),
                is_exclusive: true,
            },
            value: 500_u64,
        })
        .unwrap();
        let inputs = [
            ObjView {
                id: Id([2; 32]),
                owner: OwnerKind::Shared,
                type_key: &kiosk_type,
                bytes: &before,
            },
            ObjView {
                id: Id([70; 32]),
                owner: OwnerKind::Object(Id([2; 32])),
                type_key: &listing_type,
                bytes: &listing,
            },
        ];
        let outputs = [
            ObjView {
                id: Id([2; 32]),
                owner: OwnerKind::Shared,
                type_key: &kiosk_type,
                bytes: &after,
            },
            ObjView {
                id: Id([5; 32]),
                owner: OwnerKind::Object(Id([50; 32])),
                type_key: &item_type,
                bytes: &sold,
            },
        ];
        let extension_pay = format!("0x{}::royalty_rule::pay", "ee".repeat(32));
        let tx = TxView {
            tx_index: 3,
            sender: Addr([7; 32]),
            move_calls: std::slice::from_ref(&extension_pay),
            events: &[],
            inputs: &inputs,
            outputs: &outputs,
        };
        let wire = analyze(100, 1_000, &[tx], GAME, SEED).unwrap();
        assert_eq!(wire.sales.len(), 2);
        assert!(wire.sales[0].member.contains("\"exclusive\":true"));
        assert_eq!(wire.money[0].delta.item_royalty_mist, 10_000_000);
        assert!(wire.market.is_empty());
    }

    #[test]
    fn foreign_collection_purchase_is_ignored() {
        let purchase = purchased_bytes(2, 5, 1_000);
        let phantom = game_item_param();
        let events = [EventView {
            package: SUI_FRAMEWORK,
            module: "kiosk",
            name: "ItemPurchased",
            type_params: &phantom,
            bytes: &purchase,
            index: 0,
        }];
        let pay_call = format!("{SUI_FRAMEWORK}::royalty_rule::pay");
        let tx = TxView {
            tx_index: 1,
            sender: Addr([7; 32]),
            move_calls: std::slice::from_ref(&pay_call),
            events: &events,
            inputs: &[],
            outputs: &[], // no game object changed hands
        };
        let wire = analyze(100, 1_000, &[tx], GAME, SEED).unwrap();
        assert!(wire.sales.is_empty() && wire.market.is_empty());
    }

    #[test]
    fn spoofed_royalty_cannot_launder_a_zero_price_extract() {
        // attacker PTB: their own `royalty_rule::pay` + a game equip (which
        // runs a 0-price list+purchase through the protected policy). The
        // price gate must keep it out of sales regardless of the pay call.
        let item_type = ty(GAME, "item", "Item");
        let sold = item_bytes(5, "wooling_wool", 1);
        let outputs = [ObjView {
            id: Id([5; 32]),
            owner: OwnerKind::Object(Id([50; 32])),
            type_key: &item_type,
            bytes: &sold,
        }];
        let purchase = purchased_bytes(2, 5, 0); // the extract's 0-price buy
        let phantom = game_item_param();
        let events = [EventView {
            package: SUI_FRAMEWORK,
            module: "kiosk",
            name: "ItemPurchased",
            type_params: &phantom,
            bytes: &purchase,
            index: 0,
        }];
        let spoofed_pay = format!("0x{}::royalty_rule::pay", "ee".repeat(32));
        let tx = TxView {
            tx_index: 1,
            sender: Addr([7; 32]),
            move_calls: std::slice::from_ref(&spoofed_pay),
            events: &events,
            inputs: &[],
            outputs: &outputs,
        };
        let wire = analyze(100, 1_000, &[tx], GAME, SEED).unwrap();
        assert!(wire.sales.is_empty() && wire.market.is_empty());
        // the item WRITE itself still streams (its custody moved) — but nothing money-shaped
        assert!(wire
            .publications
            .iter()
            .all(|p| p.payload.contains("ItemWritten")));
    }

    #[test]
    fn foreign_phantom_type_never_reaches_the_game_channel() {
        // another collection's kiosk listing — same module, same event name,
        // but the event type's phantom T is not ours.
        let listed = purchased_bytes(2, 5, 777);
        let foreign = vec![format!("0x{}::nft::Nft", "dd".repeat(32))];
        let events = [EventView {
            package: SUI_FRAMEWORK,
            module: "kiosk",
            name: "ItemListed",
            type_params: &foreign,
            bytes: &listed,
            index: 0,
        }];
        let tx = TxView {
            tx_index: 0,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &events,
            inputs: &[],
            outputs: &[],
        };
        let wire = analyze(1, 1, &[tx], GAME, SEED).unwrap();
        assert!(wire.publications.is_empty());
    }

    #[test]
    fn extract_pair_forwards_no_market_events() {
        let listed = purchased_bytes(2, 5, 0);
        let purchased = purchased_bytes(2, 5, 0);
        let phantom = game_item_param();
        let events = [
            EventView {
                package: SUI_FRAMEWORK,
                module: "kiosk",
                name: "ItemListed",
                type_params: &phantom,
                bytes: &listed,
                index: 0,
            },
            EventView {
                package: SUI_FRAMEWORK,
                module: "kiosk",
                name: "ItemPurchased",
                type_params: &phantom,
                bytes: &purchased,
                index: 1,
            },
        ];
        let tx = TxView {
            tx_index: 0,
            sender: Addr([7; 32]),
            move_calls: &[], // the ruleless protected policy — no royalty call
            events: &events,
            inputs: &[],
            outputs: &[],
        };
        let wire = analyze(1, 1, &[tx], GAME, SEED).unwrap();
        assert!(wire.publications.is_empty());
        assert!(wire.sales.is_empty());
        assert!(wire.market.is_empty());
    }

    #[test]
    fn every_trade_write_lands_on_both_parties_social_doors() {
        let bytes = bcs::to_bytes(&crate::decode::Trade {
            id: Id([1; 32]),
            state: crate::decode::TradeState {
                initiator: Addr([7; 32]),
                invitee: Addr([9; 32]),
                phase: crate::decode::TradePhase::Requested,
                offer_revision: 0,
                initiator_accepted: false,
                invitee_accepted: false,
            },
            sui_a: crate::decode::Balance { value: 0 },
            sui_b: crate::decode::Balance { value: 0 },
            caps_a: vec![],
            caps_b: vec![],
        })
        .unwrap();
        let trade_type = ty(GAME, "trade", "Trade");
        let outputs = [ObjView {
            id: Id([1; 32]),
            owner: OwnerKind::Shared,
            type_key: &trade_type,
            bytes: &bytes,
        }];
        let tx = TxView {
            tx_index: 0,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &[],
            inputs: &[],
            outputs: &outputs,
        };
        let wire = analyze(1, 1, &[tx], GAME, SEED).unwrap();
        let channels: Vec<_> = wire
            .publications
            .iter()
            .map(|p| p.channel.as_str())
            .collect();
        assert!(channels.contains(&format!("evt:social:0x{}", "09".repeat(32)).as_str()));
        assert!(channels.contains(&format!("evt:social:0x{}", "07".repeat(32)).as_str()));
        assert_eq!(wire.publications.len(), 2);
        assert!(wire
            .publications
            .iter()
            .all(|row| row.payload.contains("TradeChanged")));
    }

    #[test]
    fn social_object_writes_publish_full_state_invalidations() {
        let friend_type = ty(GAME, "friends", "FriendList");
        let friend_bytes = bcs::to_bytes(&crate::decode::FriendList {
            id: Id([2; 32]),
            owner: Addr([7; 32]),
            friends: crate::decode::VecSet {
                contents: vec![Addr([9; 32])],
            },
        })
        .unwrap();
        let friend = ObjView {
            id: Id([2; 32]),
            owner: OwnerKind::Address(Addr([7; 32])),
            type_key: &friend_type,
            bytes: &friend_bytes,
        };
        let party_type = ty(GAME, "party", "Party");
        let party_bytes = bcs::to_bytes(&crate::decode::Party {
            id: Id([3; 32]),
            members: vec![Id([4; 32])],
            pending: vec![Id([5; 32])],
        })
        .unwrap();
        let party = ObjView {
            id: Id([3; 32]),
            owner: OwnerKind::Shared,
            type_key: &party_type,
            bytes: &party_bytes,
        };
        let outputs = [friend, party];
        let tx = TxView {
            tx_index: 0,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &[],
            inputs: &[],
            outputs: &outputs,
        };
        let wire = analyze(1, 1, &[tx], GAME, SEED).unwrap();
        let channels = wire
            .publications
            .iter()
            .map(|row| row.channel.as_str())
            .collect::<Vec<_>>();
        assert!(channels.contains(&format!("evt:social:0x{}", "07".repeat(32)).as_str()));
        assert!(channels.contains(&format!("evt:character:0x{}", "04".repeat(32)).as_str()));
        assert!(channels.contains(&format!("evt:character:0x{}", "05".repeat(32)).as_str()));
        let kinds = wire
            .publications
            .iter()
            .map(|row| {
                serde_json::from_str::<serde_json::Value>(&row.payload).unwrap()["type"].clone()
            })
            .collect::<Vec<_>>();
        assert!(kinds.contains(&json!("FriendListChanged")));
        assert!(kinds.contains(&json!("PartyJoined")));
        assert!(kinds.contains(&json!("PartyInvitesChanged")));
    }

    #[test]
    fn fighter_joined_lands_on_the_fight_door_alone() {
        #[derive(serde::Serialize)]
        struct Wire {
            fight: [u8; 32],
            character: [u8; 32],
            team: u8,
        }
        let bytes = bcs::to_bytes(&Wire {
            fight: [1; 32],
            character: [5; 32],
            team: 1,
        })
        .unwrap();
        let events = [EventView {
            package: GAME,
            module: "fight",
            name: "FighterJoined",
            type_params: &[],
            bytes: &bytes,
            index: 0,
        }];
        let tx = TxView {
            tx_index: 0,
            sender: Addr([5; 32]),
            move_calls: &[],
            events: &events,
            inputs: &[],
            outputs: &[],
        };
        let wire = analyze(1, 1, &[tx], GAME, SEED).unwrap();
        let channels: Vec<_> = wire
            .publications
            .iter()
            .map(|p| p.channel.as_str())
            .collect();
        // the fight door only — the roster watchers (a duel's opener, teammates in placement)
        // see the seat fill. The joiner's OWN watch arms from the custody fact instead, the
        // one witness that also covers the creator's seat 0.
        assert_eq!(channels, vec![format!("evt:fight:0x{}", "01".repeat(32))]);
    }

    #[test]
    fn fight_start_persists_its_checkpoint_timestamp() {
        #[derive(serde::Serialize)]
        struct Wire {
            fight: [u8; 32],
            world: String,
            x: u32,
            z: u32,
            queue: Vec<u64>,
        }
        let bytes = bcs::to_bytes(&Wire {
            fight: [1; 32],
            world: "01_first_shore".into(),
            x: 50_000,
            z: 50_000,
            queue: vec![0, 1],
        })
        .unwrap();
        let events = [EventView {
            package: GAME,
            module: "fight",
            name: "FightStarted",
            type_params: &[],
            bytes: &bytes,
            index: 0,
        }];
        let tx = TxView {
            tx_index: 0,
            sender: Addr([5; 32]),
            move_calls: &[],
            events: &events,
            inputs: &[],
            outputs: &[],
        };

        let wire = analyze(7, 123_456, &[tx], GAME, SEED).unwrap();
        assert_eq!(
            wire.fight_lifecycle,
            vec![FightLifecycleStamp {
                fight: format!("0x{}", "01".repeat(32)),
                started: true,
                ts_ms: 123_456,
            }]
        );
    }

    #[test]
    fn a_seat_taken_at_fight_birth_reaches_its_own_character_door() {
        // THE DUEL INCIDENT (2026-08-21): a challenger's transaction created the fight and
        // sealed his character in seat 0, emitting FightCreated and nothing else. His client
        // arms its fight stream on the OWN-CHARACTER door alone, so he stayed in the
        // overworld with an empty roster while his character sat on a board he could not
        // see. A birth carries NO FighterJoined — only the custody fact witnesses seat 0.
        let custody = [Custody::FightSeats {
            fight: Id([1; 32]),
            seat: 0,
            character: Id([5; 32]),
        }];
        let mut wire = Wire::default();
        route_character_custody(&mut wire, 7, 42, &custody);
        assert_eq!(wire.publications.len(), 1);
        assert_eq!(
            wire.publications[0].channel,
            format!("evt:character:0x{}", "05".repeat(32))
        );
        let payload: serde_json::Value =
            serde_json::from_str(&wire.publications[0].payload).unwrap();
        assert_eq!(payload["type"], "CharacterSeated");
        assert_eq!(payload["data"]["fight"], format!("0x{}", "01".repeat(32)));
        assert_eq!(payload["data"]["seat"], 0);
    }

    #[test]
    fn a_character_locked_back_into_its_kiosk_witnesses_its_return() {
        // THE OTHER HALF (2026-08-22): a forfeit or a settle re-locks the character, and the
        // client that still reads the old seat off its roster refuses the next duel it is
        // offered. The return is custody too — the same door, a different word.
        let custody = [Custody::KioskHolds {
            kiosk: Id([2; 32]),
            object: Id([5; 32]),
            label: "Character",
            owner: None,
        }];
        let mut wire = Wire::default();
        route_character_custody(&mut wire, 7, 42, &custody);
        assert_eq!(wire.publications.len(), 1);
        assert_eq!(
            wire.publications[0].channel,
            format!("evt:character:0x{}", "05".repeat(32))
        );
        let payload: serde_json::Value =
            serde_json::from_str(&wire.publications[0].payload).unwrap();
        assert_eq!(payload["type"], "CharacterHeld");
        assert_eq!(payload["data"]["kiosk"], format!("0x{}", "02".repeat(32)));
    }

    #[test]
    fn a_character_transfer_reaches_the_new_kiosk_owner() {
        let custody = [Custody::KioskHolds {
            kiosk: Id([2; 32]),
            object: Id([5; 32]),
            label: "Character",
            owner: Some(Addr([8; 32])),
        }];
        let mut wire = Wire::default();
        route_character_custody(&mut wire, 7, 42, &custody);
        assert_eq!(wire.publications.len(), 2);
        assert_eq!(
            wire.publications[1].channel,
            format!("evt:social:0x{}", "08".repeat(32))
        );
        assert!(wire.publications[1].payload.contains("CharacterHeld"));
    }

    #[test]
    fn an_item_moving_between_kiosks_stays_off_the_character_doors() {
        // custody carries every kiosk write of the checkpoint — only a CHARACTER's own
        // custody is a character-door fact; an item's is inventory, and rides its own path.
        let custody = [Custody::KioskHolds {
            kiosk: Id([2; 32]),
            object: Id([9; 32]),
            label: "Item",
            owner: None,
        }];
        let mut wire = Wire::default();
        route_character_custody(&mut wire, 7, 42, &custody);
        assert!(wire.publications.is_empty());
    }
}
