// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The live wire + the money analysis — events/object writes → pub/sub, sales, market. PURE.
//!
//! Per transaction: route every game event to its channel (`events.rs` owns the
//! table), then run the SALE ANALYSIS the graph never sees:
//!
//! * **Public sales use certified framework receipts.** Positive ItemPurchased events of our
//!   Item/Character types are exact, including calls through arbitrary Move wrappers. Protected
//!   custody extraction always pays zero. Item pre/post state enriches history, never eligibility.
//! * **Per-unit price (law 9).** The event price is the LOT price; the price store
//!   divides by the purchased stack's `amount`. Characters have no amount and
//!   never reach the market prices (kind-tagged in history instead).
//! * **Exclusive sales are event-invisible (law 8).** `purchase_with_cap`
//!   emits nothing — the sale is derived from the exclusive Listing DF deletion, the
//!   kiosk `profits` delta and the royalty our own policy collected in that tx. History rows
//!   for both parties, never a market price (an OTC price is not a market price).
//!
//! Sales rows are `{ckpt}:{tx}:{evt}|{json}` members (coordinate prefix =
//! replay-idempotent) scored by `ts_ms`, one row per party, capped + idle-TTL
//! at commit time (`pipeline.rs`).

use std::collections::{BTreeSet, HashMap, HashSet};

use serde_json::{json, Value};

use crate::analytics::{self, MoneyDelta};
use crate::decode::{self, Addr, Id};
use crate::events;
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
    pub digest: &'a str,
    pub sender: Addr,
    /// Every MoveCall target, canonical `0xpkg::module::function`.
    pub move_calls: &'a [String],
    pub events: &'a [EventView<'a>],
    /// This tx's INPUT (pre-state) and OUTPUT objects.
    pub inputs: &'a [ObjView<'a>],
    pub outputs: &'a [ObjView<'a>],
    /// Certified deletions, not inferred from the absence of an output for a read-only input.
    pub deleted: &'a [ObjView<'a>],
}

/// Everything one checkpoint's events produce.
#[derive(Debug, Default, PartialEq)]
pub struct Wire {
    ckpt: u64,
    ts_ms: u64,
    pub publications: Vec<Publication>,
    pub sales: Vec<SalesRow>,
    pub leaderboard: Vec<crate::leaderboards::Contribution>,
    pub money: Vec<MoneyDelta>,
    pub market_volume_mist: u128,
    pub market_prices: Vec<crate::market_prices::Sale>,
    /// Public sale cards for the Discord subscription.
    pub notifications: Vec<Value>,
}

impl Wire {
    /// One envelope, published on every given channel.
    pub(crate) fn publish(
        &mut self,
        channels: impl IntoIterator<Item = String>,
        tx: u64,
        evt: u64,
        kind: &str,
        data: Value,
    ) {
        let payload = json!({
            "ckpt": self.ckpt,
            "tx": tx,
            "evt": evt,
            "ts_ms": self.ts_ms,
            "type": kind,
            "data": data,
        })
        .to_string();
        self.publications
            .extend(channels.into_iter().map(|channel| Publication {
                channel,
                payload: payload.clone(),
            }));
    }
}

/// `game` is the original package (type identity); `game_packages` is every certified version
/// (call targets name the version they call).
pub fn analyze(
    ckpt: u64,
    ts_ms: u64,
    txs: &[TxView<'_>],
    game: &str,
    game_packages: &std::collections::HashSet<String>,
) -> anyhow::Result<Wire> {
    let mut wire = Wire {
        ckpt,
        ts_ms,
        ..Wire::default()
    };
    for tx in txs {
        route_game_events(&mut wire, tx, game)?;
        for (index, character) in
            crate::character_changes::changed(tx.inputs, tx.outputs, tx.deleted, game)?
        {
            wire.publish(
                [format!("evt:character:{}", character.hex())],
                tx.tx_index,
                index as u64,
                "CharacterChanged",
                json!({ "character": character.hex() }),
            );
        }
        route_game_state(&mut wire, tx, game)?;
        route_friend_writes(&mut wire, tx, game)?;
        route_party_writes(&mut wire, tx, game)?;
        route_trade_writes(&mut wire, tx, game)?;
        route_dungeon_writes(&mut wire, tx, game)?;
        route_kolizeum_writes(&mut wire, tx, game)?;
        route_fight_writes(&mut wire, tx, game)?;
        route_item_writes(&mut wire, tx, game)?;
        route_giftcard_writes(&mut wire, tx, game);
        analyze_game_revenue(&mut wire, tx, game)?;
        analyze_kolizeum_revenue(&mut wire, tx, game, game_packages)?;
        analyze_kiosk_market(&mut wire, tx, game)?;
    }
    Ok(wire)
}

fn analyze_game_revenue(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    for event in tx.events.iter().filter(|event| event.package == game) {
        let delta = match (event.module, event.name) {
            ("character", "CharacterCreated") => MoneyDelta {
                character_creation_mist: analytics::CHARACTER_CREATION_MIST,
                ..MoneyDelta::default()
            },
            ("tournament", "EntryFeePaid") => MoneyDelta {
                tournament_mist: decode::from_bytes::<events::EntryFeePaid>(event.bytes)?
                    .treasury_mist,
                ..MoneyDelta::default()
            },
            _ => continue,
        };
        wire.money.push(delta);
    }
    Ok(())
}

fn analyze_kolizeum_revenue(
    wire: &mut Wire,
    tx: &TxView<'_>,
    game: &str,
    game_packages: &std::collections::HashSet<String>,
) -> anyhow::Result<()> {
    let start = tx
        .move_calls
        .iter()
        .filter_map(|call| crate::pipeline::game_target(call, game_packages))
        .any(|target| {
            matches!(
                target,
                "api::start_kolizeum" | "api::ready_and_start_kolizeum"
            )
        });
    if !start {
        return Ok(());
    }
    for output in tx
        .outputs
        .iter()
        .filter(|output| output.type_key.is(game, "kolizeum", "Kolizeum"))
    {
        let Some(input) = tx.inputs.iter().find(|input| input.id == output.id) else {
            continue;
        };
        let before = input.decode::<decode::Kolizeum>()?;
        let after = output.decode::<decode::Kolizeum>()?;
        let cut = before.pot.value.saturating_sub(after.pot.value);
        if cut > 0 {
            wire.money.push(MoneyDelta {
                kolizeum_mist: cut,
                ..MoneyDelta::default()
            });
        }
    }
    Ok(())
}

fn route_friend_writes(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        if !output.type_key.is(game, "friends", "FriendList") {
            continue;
        }
        let list = output.decode::<decode::FriendList>()?;
        wire.publish(
            [format!("evt:social:{}", list.owner.hex())],
            tx.tx_index,
            index as u64,
            "FriendListChanged",
            json!({}),
        );
    }
    Ok(())
}

/// Each party's members and pending invites, by id, on one side of the transaction.
type Rosters = HashMap<Id, (HashSet<Id>, HashSet<Id>)>;

fn party_rosters(views: &[ObjView<'_>], game: &str) -> anyhow::Result<Rosters> {
    views
        .iter()
        .filter(|view| view.type_key.is(game, "party", "Party"))
        .map(|view| {
            let party = view.decode::<decode::Party>()?;
            Ok((
                view.id,
                (
                    party.members.into_iter().collect(),
                    party.pending.into_iter().collect(),
                ),
            ))
        })
        .collect()
}

fn route_party_writes(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    let before = party_rosters(tx.inputs, game)?;
    let after = party_rosters(tx.outputs, game)?;
    let ids = before
        .keys()
        .chain(after.keys())
        .map(|id| (id.hex(), *id))
        .collect::<std::collections::BTreeMap<_, _>>();
    let empty = (HashSet::new(), HashSet::new());
    for (index, id) in ids.into_values().enumerate() {
        let (members_before, pending_before) = before.get(&id).unwrap_or(&empty);
        let (members_after, pending_after) = after.get(&id).unwrap_or(&empty);
        let mut invites = pending_before
            .symmetric_difference(pending_after)
            .copied()
            .collect::<HashSet<_>>();
        if members_before != members_after {
            invites.extend(pending_after.iter().copied());
        }
        let changes = members_after
            .difference(members_before)
            .map(|character| ("PartyJoined", *character))
            .chain(
                members_before
                    .difference(members_after)
                    .map(|character| ("PartyLeft", *character)),
            )
            .chain(
                invites
                    .into_iter()
                    .map(|character| ("PartyInvitesChanged", character)),
            )
            .collect::<Vec<_>>();
        for (kind, character) in changes {
            wire.publish(
                [
                    format!("evt:party:{}", id.hex()),
                    format!("evt:character:{}", character.hex()),
                ],
                tx.tx_index,
                index as u64,
                kind,
                json!({ "party": id.hex(), "character": character.hex() }),
            );
        }
    }
    Ok(())
}

fn route_trade_writes(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    for (index, (trade, deleted)) in crate::trade_tokens::changes(tx, game)?
        .into_iter()
        .enumerate()
    {
        let parties = BTreeSet::from([trade.state.initiator.hex(), trade.state.invitee.hex()]);
        wire.publish(
            parties
                .into_iter()
                .map(|address| format!("evt:social:{address}")),
            tx.tx_index,
            index as u64,
            if deleted {
                "TradeDestroyed"
            } else {
                "TradeChanged"
            },
            json!({ "trade": trade.id.hex() }),
        );
    }
    Ok(())
}

/// The War Table is a live directory. Refresh only when its structural facts change: a
/// lobby write/delete, a wagered fight ending, or a wagered fighter leaving.
fn route_kolizeum_writes(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    let is_lobby = |view: &&ObjView<'_>| view.type_key.is(game, "kolizeum", "Kolizeum");
    let lobby_changed = tx.outputs.iter().any(|output| is_lobby(&output))
        || tx
            .inputs
            .iter()
            .filter(is_lobby)
            .any(|input| !tx.outputs.iter().any(|output| output.id == input.id));
    let fight_event = |names: &[&str]| {
        tx.events.iter().any(|event| {
            event.package == game && event.module == "fight" && names.contains(&event.name)
        })
    };
    let forfeited = fight_event(&["FighterForfeited"]);
    let structural = fight_event(&[
        "FightStarted",
        "FightEnded",
        "FighterJoined",
        "FighterForfeited",
    ]);
    let fights = tx
        .outputs
        .iter()
        .filter(|output| output.type_key.is(game, "fight", "Fight"))
        .map(|output| output.decode::<decode::Fight>())
        .collect::<anyhow::Result<Vec<_>>>()?;
    let fight_changed = fights
        .iter()
        .any(|fight| fight.door_policy == 31 && (fight.combat.ended || forfeited));
    let tournament_fight = structural && fights.iter().any(|fight| fight.door_policy == 63);
    let tournament_changed = tx
        .outputs
        .iter()
        .any(|output| output.type_key.is(game, "tournament", "Tournament"));
    if tournament_changed || tournament_fight {
        let channel = "evt:tournament".to_string();
        wire.publish([channel], tx.tx_index, 0, "TournamentChanged", json!({}));
    }
    if lobby_changed || fight_changed {
        let channel = "evt:kolizeum".to_string();
        wire.publish([channel], tx.tx_index, 0, "KolizeumChanged", json!({}));
    }
    Ok(())
}

/// Every Fight write reconciles the optimistic live stream. Turn events carry animation
/// witnesses; this trailing projection event tells watchers to load the final AP/MP/HP/cells.
/// Ended writes additionally wake each participant's durable settlement recovery.
fn route_fight_writes(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        if !output.type_key.is(game, "fight", "Fight") {
            continue;
        }
        let evt = index as u64;
        wire.publish(
            [format!("evt:fight:{}", output.id.hex())],
            tx.tx_index,
            evt,
            "FightProjected",
            json!({ "fight": output.id.hex() }),
        );
        let fight = output.decode::<decode::Fight>()?;
        if let Some(dungeon) = &fight.dungeon {
            route_dungeon_lobby(wire, tx, evt, &dungeon.dungeon);
        }
        if !fight.combat.ended {
            continue;
        }
        for authority in &fight.authorities {
            let decode::FighterAuthority::Player { character, .. } = authority else {
                continue;
            };
            wire.publish(
                [format!("evt:character:{}", character.hex())],
                tx.tx_index,
                evt,
                "FightResolutionChanged",
                json!({ "fight": fight.id.hex(), "character": character.hex() }),
            );
        }
    }
    Ok(())
}

fn route_dungeon_lobby(wire: &mut Wire, tx: &TxView<'_>, evt: u64, dungeon: &str) {
    wire.publish(
        [format!("evt:dungeon:{dungeon}")],
        tx.tx_index,
        evt,
        "DungeonLobbyChanged",
        json!({ "dungeon": dungeon }),
    );
}

fn dungeon_run(view: &ObjView<'_>, game: &str) -> anyhow::Result<Option<decode::DungeonRun>> {
    let key = format!("{game}::dungeon::DungeonRunKey");
    if view.type_key.field_key() != Some(key.as_str()) {
        return Ok(None);
    }
    let field = view.decode::<decode::Field<decode::MarkerKey, decode::DungeonRun>>()?;
    Ok(Some(field.value))
}

/// Dungeon lobby invalidation follows projected run state, including DF deletion, so every
/// entrant/advance/exit reaches peers without a world-zone subscription or a duplicate event.
fn route_dungeon_writes(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        if let Some(run) = dungeon_run(output, game)? {
            route_dungeon_lobby(wire, tx, index as u64, &run.dungeon);
        }
    }
    for (index, input) in tx.inputs.iter().enumerate() {
        if tx.outputs.iter().any(|output| output.id == input.id) {
            continue;
        }
        if let Some(run) = dungeon_run(input, game)? {
            route_dungeon_lobby(wire, tx, index as u64, &run.dungeon);
        }
    }
    Ok(())
}

/// The shared Version object is the emergency-brake truth. Unlike ordinary
/// gameplay events, this state must reach every server process after its graph
/// projection commits, including transitions authored without a Move event.
fn route_game_state(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        if !output.type_key.is(game, "version", "Version") {
            continue;
        }
        let version = output.decode::<decode::Version>()?;
        wire.publish(
            ["evt:game".to_string()],
            tx.tx_index,
            index as u64,
            "GameStateChanged",
            json!({ "frozen": version.version == 0 }),
        );
    }
    Ok(())
}

/// Every game Item write reaches its current holder, and every departure reaches its previous
/// holder as a removal — always as a stream, never a client pull: a mint's receipt cannot carry
/// the rolled contents, and a client request would race the projection. The two-hop custody
/// resolver turns wrapper ownership into the kiosk identity used for scope.
fn route_item_writes(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    let previous_holders = item_kiosk_holders(tx.inputs, game)?;
    let current_holders = item_kiosk_holders(tx.outputs, game)?;
    let is_item = |view: &&ObjView<'_>| view.type_key.is(game, "item", "Item");
    for (index, output) in tx.outputs.iter().enumerate() {
        if !is_item(&output) {
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
        wire.publish(
            ["evt:economy".to_string()],
            tx.tx_index,
            index as u64,
            "ItemWritten",
            json!({
                "item": output.id.hex(),
                "version": output.version.to_string(),
                "holder": holder.map(|id| id.hex()),
                "previous_holder": previous_holder.map(|id| id.hex()),
            }),
        );
    }
    for (index, input) in tx.inputs.iter().enumerate() {
        if !is_item(&input) || tx.outputs.iter().any(|output| output.id == input.id) {
            continue;
        }
        let Some(holder) = previous_holders.get(&input.id) else {
            continue;
        };
        wire.publish(
            ["evt:economy".to_string()],
            tx.tx_index,
            (tx.outputs.len() + index) as u64,
            "ItemRemoved",
            json!({ "item": input.id.hex(), "holder": holder.hex(), "version": input.version.to_string() }),
        );
    }
    Ok(())
}

fn item_kiosk_holders(views: &[ObjView<'_>], game: &str) -> anyhow::Result<HashMap<Id, Id>> {
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

/// A character's custody, both ways, on its own channel: custody is state, not an event. A
/// fight's creator takes seat 0 at birth with no join event, and a forfeit or settle re-locks
/// the character with none either; the projection is the one trigger for every custody move.
pub fn route_character_custody(wire: &mut Wire, custody: &[Custody]) {
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
        let channels = std::iter::once(format!("evt:character:{}", character.hex()))
            .chain(owner.map(|owner| format!("evt:social:{}", owner.hex())));
        wire.publish(channels, 0, index as u64, kind, data);
    }
}

// ╔════════════════ [ Game events → channels ] ═══════════════════════════════ ]

fn route_game_events(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    for event in tx.events.iter().filter(|event| event.package == game) {
        let Some(routed) = events::route(event.module, event.name, event.bytes)? else {
            continue;
        };
        // The zone's bystanders (sword markers) hear fight starts and ends too; the events
        // carry their anchor for this fan-out. An unreadable anchor never costs the fight channel.
        let zone = matches!(routed.kind, "FightStarted" | "FightEnded")
            .then(|| {
                let world = routed.data["world"].as_str()?;
                let x = u32::try_from(routed.data["x"].as_u64()?).ok()?;
                let z = u32::try_from(routed.data["z"].as_u64()?).ok()?;
                Some(events::zone_topic(world, x, z))
            })
            .flatten();
        wire.publish(
            zone.into_iter().chain([routed.topic]),
            tx.tx_index,
            event.index,
            routed.kind,
            routed.data,
        );
    }
    Ok(())
}

// ╔════════════════ [ Kiosk marketplace — the discriminator ] ════════════════ ]

fn is_game_obj<'a>(views: &'a [ObjView<'a>], id: Id, game: &str) -> Option<&'a ObjView<'a>> {
    views.iter().find(|view| {
        view.id == id
            && (view.type_key.is(game, "item", "Item")
                || view.type_key.is(game, "character", "Character"))
    })
}

/// Is a kiosk type's phantom `T` (`ItemListed<T>`, `TransferPolicy<T>`) one of OUR types? Only
/// the type tells foreign collections apart; the body cannot.
fn is_game_asset(t: Option<&String>, game: &str) -> bool {
    t.is_some_and(|t| {
        t == &format!("{game}::item::Item") || t == &format!("{game}::character::Character")
    })
}

/// The royalty each game type's own `TransferPolicy<T>` collected in this transaction, as
/// `(T, MIST)`. Only a rule installed on that policy can add to its balance, and of our rules
/// only the kiosk royalty rule pays, so the delta is the exact royalty: the chain owns the rate.
/// A `royalty_rule::pay` call proves nothing: any package can export one.
fn royalties_collected(tx: &TxView<'_>, game: &str) -> anyhow::Result<Vec<(String, u64)>> {
    let balance = |view: &ObjView<'_>| {
        view.decode::<decode::TransferPolicy>()
            .map(|policy| policy.balance.value)
    };
    let mut paid = vec![];
    for output in tx.outputs.iter().filter(|view| {
        view.type_key
            .is(SUI_FRAMEWORK, "transfer_policy", "TransferPolicy")
            && is_game_asset(view.type_key.type_params.first(), game)
    }) {
        let Some(input) = tx.inputs.iter().find(|input| input.id == output.id) else {
            continue;
        };
        let collected = balance(output)?.saturating_sub(balance(input)?);
        if collected > 0 {
            paid.push((output.type_key.type_params[0].clone(), collected));
        }
    }
    Ok(paid)
}

fn kiosk_view(views: &[ObjView<'_>], kiosk: Id) -> anyhow::Result<Option<decode::Kiosk>> {
    views
        .iter()
        .find(|view| view.id == kiosk && view.type_key.is(SUI_FRAMEWORK, "kiosk", "Kiosk"))
        .map(|view| view.decode::<decode::Kiosk>())
        .transpose()
}

struct SaleShape {
    stackable: bool,
    kind: &'static str,
    category: Option<String>,
    item_type: Option<String>,
    name: String,
    amount: u64,
}

fn sale_shape(sold: &ObjView<'_>) -> anyhow::Result<SaleShape> {
    if sold.type_key.name == "Item" {
        let item = sold.decode::<decode::Item>()?;
        return Ok(SaleShape {
            stackable: matches!(
                item.category.as_str(),
                "resource" | "consumable" | "rune" | "key"
            ),
            kind: "item",
            category: Some(item.category),
            item_type: Some(item.item_type),
            name: item.name,
            amount: item.amount.max(1) as u64,
        });
    }
    let character = sold.decode::<decode::Character>()?;
    Ok(SaleShape {
        stackable: false,
        kind: "character",
        category: None,
        item_type: None,
        name: character.name,
        amount: 1,
    })
}

/// One realised sale → two history rows and, for public sales, market facts plus the seller's
/// Discord card. Royalty revenue is what our policies collected (`royalties_collected`).
#[allow(clippy::too_many_arguments)]
fn push_sale(
    wire: &mut Wire,
    tx: &TxView<'_>,
    evt: u64,
    sold_id: Id,
    shape: &SaleShape,
    price: u64,
    seller: Option<Addr>,
    exclusive: bool,
) {
    let coordinate = format!("{}:{}:{evt}", wire.ckpt, tx.tx_index);
    let base = json!({
        "object": sold_id.hex(),
        "kind": shape.kind,
        "name": shape.name,
        "item_type": shape.item_type,
        "amount": shape.amount,
        "price_mist": price.to_string(),
        "exclusive": exclusive,
        "ts_ms": wire.ts_ms,
    });
    let ts_ms = wire.ts_ms;
    let mut row = |address: Addr, side: &str, counterparty: Option<Addr>| {
        let mut data = base.clone();
        data["side"] = json!(side);
        data["counterparty"] = json!(counterparty.map(|a| a.hex()));
        wire.sales.push(SalesRow {
            address,
            ts_ms,
            member: format!("{coordinate}|{data}"),
        });
        data
    };
    row(tx.sender, "bought", seller);
    if let Some(seller) = seller {
        let mut card = row(seller, "sold", Some(tx.sender));
        if !exclusive && price > 0 {
            card["id"] = json!(format!("{coordinate}:sale"));
            card["asset_kind"] = card["kind"].clone();
            card["kind"] = json!("sale");
            card["seller"] = json!(seller.hex());
            card["digest"] = json!(tx.digest);
            wire.notifications.push(card);
        }
    }
    // Market facts: public sales only.
    if exclusive || price == 0 {
        return;
    }
    wire.market_volume_mist += u128::from(price);
    if let Some(item_type) = shape.item_type.as_ref().filter(|_| shape.stackable) {
        wire.market_prices.push(crate::market_prices::Sale {
            item_type: item_type.clone(),
            mist: price,
            units: shape.amount,
        });
    }
}

fn proved_seller(tx: &TxView<'_>, game: &str, kiosk: Id) -> anyhow::Result<Addr> {
    let mut owner = None;
    for event in tx.events.iter().filter(|event| {
        event.package == game && event.module == "listing_rule" && event.name == "SellerProved"
    }) {
        let proof: events::SellerProved = decode::from_bytes(event.bytes)?;
        if proof.kiosk != kiosk {
            continue;
        }
        anyhow::ensure!(
            owner.is_none_or(|previous| previous == proof.owner),
            "seller proofs disagree"
        );
        owner = Some(proof.owner);
    }
    let owner = owner.ok_or_else(|| {
        anyhow::anyhow!(
            "public sale lacks a verified seller witness: {}",
            kiosk.hex()
        )
    })?;
    if let Some(observed) = crate::personal_kiosk::owner(tx.inputs, tx.outputs, kiosk)? {
        anyhow::ensure!(
            observed == owner,
            "seller witness disagrees with personal custody"
        );
    }
    Ok(owner)
}

fn analyze_public_purchase(
    wire: &mut Wire,
    tx: &TxView<'_>,
    game: &str,
    event: &EventView<'_>,
) -> anyhow::Result<()> {
    let e = decode::from_bytes::<events::KioskItemPurchased>(event.bytes)
        .map_err(|err| anyhow::anyhow!("layout drift: kiosk::ItemPurchased: {err}"))?;
    // The sealed framework event is the receipt, even when a Move wrapper
    // pays royalties internally. Every protected-policy extract has price zero.
    if e.price == 0 {
        return Ok(());
    }
    let seller = proved_seller(tx, game, e.kiosk)?;
    wire.leaderboard.extend([tx.sender, seller].map(|address| {
        crate::leaderboards::Contribution::new(
            crate::leaderboards::Metric::Marketplace,
            address,
            e.price,
        )
    }));
    // Buyer commands may consume the bought stack OR merge more units into it.
    // The input lot owns the sale quantity; final output is only a fallback for
    // objects created within this PTB, never a replacement for an observed lot.
    let Some(sold) =
        is_game_obj(tx.inputs, e.id, game).or_else(|| is_game_obj(tx.outputs, e.id, game))
    else {
        return Ok(());
    };
    let shape = sale_shape(sold)?;
    push_sale(
        wire,
        tx,
        event.index,
        sold.id,
        &shape,
        e.price,
        Some(seller),
        false,
    );
    wire.publish(
        ["evt:economy".to_string()],
        tx.tx_index,
        event.index,
        "MarketPurchased",
        json!({
            "kiosk": e.kiosk.hex(),
            "object": e.id.hex(),
            "seller": seller.hex(),
            "buyer": tx.sender.hex(),
            "kind": shape.kind,
            "category": shape.category,
            "name": shape.name,
            "item_type": shape.item_type,
            "amount": shape.amount,
            "price_mist": e.price.to_string(),
        }),
    );
    Ok(())
}

fn analyze_listing(
    wire: &mut Wire,
    tx: &TxView<'_>,
    game: &str,
    event: &EventView<'_>,
) -> anyhow::Result<()> {
    // A listing carries its price; a delisting has none. One decode decides both.
    let (kind, id, kiosk, price) = if event.name == "ItemListed" {
        let e = decode::from_bytes::<events::KioskItemListed>(event.bytes)
            .map_err(|err| anyhow::anyhow!("layout drift: kiosk::ItemListed: {err}"))?;
        ("MarketListed", e.id, e.kiosk, Some(e.price))
    } else {
        let e = decode::from_bytes::<events::KioskItemDelisted>(event.bytes)
            .map_err(|err| anyhow::anyhow!("layout drift: kiosk::ItemDelisted: {err}"))?;
        ("MarketDelisted", e.id, e.kiosk, None)
    };
    // Suppress only THIS object's protected-policy extract pair. Another stack may
    // legitimately list/delist in the same PTB while a merge consumes a 0-price source.
    let plumbing = price == Some(0)
        && tx.events.iter().any(|other| {
            other.package == SUI_FRAMEWORK
                && other.module == "kiosk"
                && other.name == "ItemPurchased"
                && decode::from_bytes::<events::KioskItemPurchased>(other.bytes)
                    .map(|purchase| purchase.price == 0 && purchase.id == id)
                    .unwrap_or(false)
        });
    if plumbing {
        return Ok(());
    }
    let item = event.type_params.first() == Some(&format!("{game}::item::Item"));
    wire.publish(
        ["evt:economy".to_string()],
        tx.tx_index,
        event.index,
        kind,
        json!({
            "kiosk": kiosk.hex(),
            "object": id.hex(),
            "seller": crate::personal_kiosk::owner(tx.inputs, tx.outputs, kiosk)?.map(|owner| owner.hex()),
            "price_mist": price.map(|p| p.to_string()),
            "kind": if item { "item" } else { "character" },
        }),
    );
    Ok(())
}

fn analyze_kiosk_market(wire: &mut Wire, tx: &TxView<'_>, game: &str) -> anyhow::Result<()> {
    for event in tx.events {
        // a foreign collection's trade — the phantom T names it (M4)
        if event.package != SUI_FRAMEWORK
            || event.module != "kiosk"
            || !is_game_asset(event.type_params.first(), game)
        {
            continue;
        }
        match event.name {
            "ItemPurchased" => analyze_public_purchase(wire, tx, game, event)?,
            "ItemListed" | "ItemDelisted" => analyze_listing(wire, tx, game, event)?,
            _ => {}
        }
    }
    let royalties = royalties_collected(tx, game)?;
    for (policy, mist) in &royalties {
        wire.money
            .push(if *policy == format!("{game}::item::Item") {
                MoneyDelta {
                    item_royalty_mist: *mist,
                    ..MoneyDelta::default()
                }
            } else {
                MoneyDelta {
                    character_royalty_mist: *mist,
                    ..MoneyDelta::default()
                }
            });
    }
    analyze_exclusive_market(wire, tx, game, &royalties)
}

fn exclusive_listing(
    view: &ObjView<'_>,
) -> anyhow::Result<Option<decode::Field<decode::KioskListingKey, u64>>> {
    let key = format!("{SUI_FRAMEWORK}::kiosk::Listing");
    if view.type_key.field_key() != Some(key.as_str()) {
        return Ok(None);
    }
    view.decode().map(Some)
}

fn analyze_exclusive_market(
    wire: &mut Wire,
    tx: &TxView<'_>,
    game: &str,
    royalties: &[(String, u64)],
) -> anyhow::Result<()> {
    if royalties.is_empty() {
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
        let sold_type = format!(
            "{}::{}::{}",
            sold.type_key.package, sold.type_key.module, sold.type_key.name
        );
        if !royalties.iter().any(|(policy, _)| *policy == sold_type) {
            continue;
        }
        let Some(price) = after
            .profits
            .value
            .checked_sub(before.profits.value)
            .filter(|price| *price > 0)
        else {
            continue;
        };
        let shape = sale_shape(sold)?;
        let seller = crate::personal_kiosk::owner(tx.inputs, tx.outputs, kiosk_id)?;
        push_sale(wire, tx, index as u64, sold.id, &shape, price, seller, true);
    }
    Ok(())
}

/// Plain transfers emit no game event. Invalidate both custodians from object pre/post-state.
fn route_giftcard_writes(wire: &mut Wire, tx: &TxView<'_>, game: &str) {
    let holders = tx
        .inputs
        .iter()
        .chain(tx.outputs)
        .filter(|object| object.type_key.is(game, "distribution", "Giftcard"))
        .filter_map(|object| match object.owner {
            OwnerKind::Address(owner) => Some(owner.hex()),
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    for (index, holder) in holders.into_iter().enumerate() {
        wire.publish(
            [format!("evt:social:{holder}")],
            tx.tx_index,
            index as u64,
            "GiftcardsChanged",
            json!({ "holder": holder }),
        );
    }
}
