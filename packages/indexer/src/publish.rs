// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The live wire + the money analysis — events → pub/sub, sales, market. PURE.
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
//!   emits nothing — the sale is derived from the PurchaseCap DELETION plus
//!   the kiosk `profits` delta in that tx. History rows for both parties,
//!   NEVER a market stamp (an OTC price is not a market price).
//!
//! Sales rows are `{ckpt}:{tx}:{evt}|{json}` members (coordinate prefix =
//! replay-idempotent) scored by `ts_ms`, one row per party, capped + idle-TTL
//! at commit time (`pipeline.rs`).

use serde_json::json;

use crate::decode::{self, Addr, Id};
use crate::events;
use crate::graph::MarketStamp;
use crate::ownership::{Custody, ObjView, OwnerKind, SUI_FRAMEWORK};

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
    pub market: Vec<MarketStamp>,
}

pub fn analyze(ckpt: u64, ts_ms: u64, txs: &[TxView<'_>], game: &str) -> anyhow::Result<Wire> {
    let mut wire = Wire::default();
    for tx in txs {
        route_game_events(&mut wire, ckpt, ts_ms, tx, game)?;
        route_game_state(&mut wire, ckpt, ts_ms, tx, game)?;
        route_fight_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        route_item_writes(&mut wire, ckpt, ts_ms, tx, game)?;
        analyze_kiosk_market(&mut wire, ckpt, ts_ms, tx, game)?;

        analyze_shop_sales(&mut wire, ckpt, ts_ms, tx, game)?;
    }
    Ok(wire)
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
        if !fight.ended {
            continue;
        }
        for fighter in &fight.fighters {
            let decode::FighterKind::Player { character, .. } = &fighter.kind else {
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

/// Every game Item OUTPUT reaches its holder as a STREAM, never a client pull:
/// a mint's receipt cannot carry the rolled contents, and a client request
/// would race the projection — so the projection itself is the trigger (the
/// `route_game_state` precedent: object outputs, no Move event required).
/// `holder` is the owning parent (a kiosk for inventory, a character when
/// equipped); the server scopes delivery to the players whose kiosk it is.
fn route_item_writes(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    for (index, output) in tx.outputs.iter().enumerate() {
        if output.type_key.package != game
            || output.type_key.module != "item"
            || output.type_key.name != "Item"
        {
            continue;
        }
        let OwnerKind::Object(holder) = output.owner else {
            continue;
        };
        wire.publications.push(Publication {
            channel: "evt:economy".into(),
            payload: envelope(
                ckpt,
                tx.tx_index,
                index as u64,
                ts_ms,
                "ItemWritten",
                json!({ "item": output.id.hex(), "holder": holder.hex() }),
            ),
        });
    }
    Ok(())
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
        let (character, kind, data) = match fact {
            Custody::FightSeats {
                fight,
                seat,
                character,
            } => (
                character,
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
                ..
            } => (
                object,
                "CharacterHeld",
                json!({ "character": object.hex(), "kiosk": kiosk.hex() }),
            ),
            _ => continue,
        };
        wire.publications.push(Publication {
            channel: format!("evt:character:{}", character.hex()),
            payload: envelope(ckpt, 0, index as u64, ts_ms, kind, data),
        });
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
) -> anyhow::Result<()> {
    for event in tx.events {
        if event.package != game {
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
        // party membership MIRROR: joins/leaves route to the party channel for the
        // members, but the AFFECTED character's own realtime connection watches only
        // its character channel (it cannot watch a party it doesn't know it joined) —
        // so the same envelope lands on both.
        if routed.kind == "PartyJoined" || routed.kind == "PartyLeft" {
            if let Some(character) = routed.data["character"].as_str() {
                wire.publications.push(Publication {
                    channel: format!("evt:character:{character}"),
                    payload: payload.clone(),
                });
            }
        }
        // trade-birth MIRROR: the route lands on the counterparty's social channel;
        // the CREATOR's connection must arm the same watch — same envelope, both doors.
        if routed.kind == "TradeCreated" {
            if let Some(creator) = routed.data["a"].as_str() {
                wire.publications.push(Publication {
                    channel: format!("evt:social:{creator}"),
                    payload: payload.clone(),
                });
            }
        }
        // fight-phase MIRROR: the roster's watchers hear starts/ends on the fight channel,
        // but the ZONE's bystanders (sword markers) need the same facts — the events carry
        // their anchor precisely for this fan-out.
        if matches!(routed.kind, "FightStarted" | "FightEnded") {
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
        wire.publications.push(Publication {
            channel: routed.topic,
            payload,
        });
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
    let royalty_pay = format!("{SUI_FRAMEWORK}::royalty_rule::pay");
    tx.move_calls.iter().any(|call| call == &royalty_pay)
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

/// One realised sale → two history rows (+ a market stamp for public item
/// sales). `kind` is `"item"` / `"character"`; `evt` disambiguates coordinates.
#[allow(clippy::too_many_arguments)]
fn push_sale(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: u64,
    evt: u64,
    sold: &ObjView<'_>,
    price: u64,
    seller: Option<Addr>,
    buyer: Addr,
    exclusive: bool,
) -> anyhow::Result<()> {
    // the KIND is the object's TYPE — an Item that fails decode is layout
    // drift and errors the checkpoint, never a silent "character" fallback.
    let item = if sold.type_key.name == "Item" {
        Some(decode::from_bytes::<decode::Item>(sold.bytes).map_err(|e| {
            anyhow::anyhow!(
                "layout drift: item::Item {} failed decode: {e}",
                sold.id.hex()
            )
        })?)
    } else {
        None
    };
    let (kind, item_type, amount) = match &item {
        Some(i) => ("item", Some(i.item_type.clone()), i.amount.max(1) as u64),
        None => ("character", None, 1),
    };
    let coordinate = format!("{ckpt}:{tx}:{evt}");
    let base = json!({
        "object": sold.id.hex(),
        "kind": kind,
        "item_type": item_type,
        "amount": amount,
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
    // the market stamp: PUBLIC ITEM sales only, per-unit, never zero.
    if !exclusive && price > 0 {
        if let Some(i) = &item {
            wire.market.push(MarketStamp {
                item_type: i.item_type.clone(),
                price_per_unit_mist: price / amount.max(1),
                ts_ms,
            });
        }
    }
    Ok(())
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
                let Some(sold) = is_game_obj(tx.outputs, e.id, game) else {
                    continue;
                };
                let seller = match kiosk_view(tx.outputs, e.kiosk)? {
                    Some(k) => Some(k.owner),
                    None => kiosk_view(tx.inputs, e.kiosk)?.map(|k| k.owner),
                };
                push_sale(
                    wire,
                    ckpt,
                    ts_ms,
                    tx.tx_index,
                    event.index,
                    sold,
                    e.price,
                    seller,
                    tx.sender,
                    false,
                )?;
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
                            "buyer": tx.sender.hex(),
                            "kind": if sold.type_key.name == "Character" { "character" } else { "item" },
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
    Ok(())
}

// ╔════════════════ [ Shop — the primary market ] ════════════════════════════ ]

fn analyze_shop_sales(
    wire: &mut Wire,
    ckpt: u64,
    ts_ms: u64,
    tx: &TxView<'_>,
    game: &str,
) -> anyhow::Result<()> {
    for event in tx.events {
        if event.package != game || event.module != "shop" || event.name != "SaleBought" {
            continue;
        }
        let e: events::SaleBought = decode::from_bytes(event.bytes)?;
        // the minted stack (or the stack it merged into) is an output of the
        // same tx; the mutated Sale names the template that ties them.
        // A type-matched output that will not decode is LAYOUT DRIFT, never noise: it errors
        // the checkpoint like every other decode here, instead of quietly dropping the row.
        let template = tx
            .outputs
            .iter()
            .find(|o| o.type_key.package == game && o.type_key.name == "Sale" && o.id == e.sale)
            .map(|o| {
                decode::from_bytes::<decode::Sale>(o.bytes).map_err(|error| {
                    anyhow::anyhow!(
                        "layout drift: shop::Sale {} failed decode: {error}",
                        o.id.hex()
                    )
                })
            })
            .transpose()?
            .map(|sale| sale.template);
        let Some(template) = template else {
            continue;
        };
        let bought = tx
            .outputs
            .iter()
            .filter(|o| o.type_key.package == game && o.type_key.name == "Item")
            .map(|o| {
                decode::from_bytes::<decode::Item>(o.bytes).map_err(|error| {
                    anyhow::anyhow!(
                        "layout drift: item::Item {} failed decode: {error}",
                        o.id.hex()
                    )
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?
            .into_iter()
            .find(|i| i.template == template);
        let Some(item) = bought else {
            continue;
        };
        let quantity = e.quantity.max(1);
        let coordinate = format!("{ckpt}:{}:{}", tx.tx_index, event.index);
        let data = json!({
            "object": item.id.hex(),
            "kind": "item",
            "item_type": item.item_type,
            "amount": quantity,
            "price_mist": e.paid.to_string(),
            "exclusive": false,
            "side": "bought",
            "counterparty": null,
            "ts_ms": ts_ms,
        });
        wire.sales.push(SalesRow {
            address: e.buyer,
            ts_ms,
            member: format!("{coordinate}|{data}"),
        });
        // zero never stamps the market (law 9) — a free promo sale is honest
        // history but not a market price.
        if e.paid > 0 {
            wire.market.push(MarketStamp {
                item_type: item.item_type,
                price_per_unit_mist: e.paid / quantity,
                ts_ms,
            });
        }
    }
    Ok(())
}

// ╔════════════════ [ Tests ] ════════════════════════════════════════════════ ]

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ownership::{OwnerKind, TypeKey};

    const GAME: &str = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    fn game_item_param() -> Vec<String> {
        vec![format!("{GAME}::item::Item")]
    }

    #[test]
    fn royalty_target_requires_the_framework_package() {
        let exact = format!("{SUI_FRAMEWORK}::royalty_rule::pay");
        let spoofed = format!("0x{}::royalty_rule::pay", "ee".repeat(32));
        let base = TxView {
            tx_index: 0,
            sender: Addr([7; 32]),
            move_calls: std::slice::from_ref(&exact),
            events: &[],
            inputs: &[],
            outputs: &[],
        };
        assert!(pays_royalty(&base));
        assert!(!pays_royalty(&TxView {
            move_calls: std::slice::from_ref(&spoofed),
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

        let wire = analyze(60, 4_000, &[tx], GAME).unwrap();

        assert_eq!(wire.publications.len(), 1);
        assert_eq!(wire.publications[0].channel, "evt:economy");
        let payload: serde_json::Value =
            serde_json::from_str(&wire.publications[0].payload).unwrap();
        assert_eq!(payload["type"], "ItemWritten");
        assert_eq!(payload["data"]["item"], Id([3; 32]).hex());
        assert_eq!(payload["data"]["holder"], Id([77; 32]).hex());
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

        let wire = analyze(60, 4_000, &[tx], GAME).unwrap();

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

        let wire = analyze(55, 9_000, &[tx], GAME).unwrap();

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
        let wire = analyze(100, 1_000, &[tx], GAME).unwrap();
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
        let wire = analyze(100, 1_000, std::slice::from_ref(&tx), GAME).unwrap();
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
        assert_eq!(purchased["data"]["kind"], "item");
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
        let wire = analyze(100, 1_000, &[plumbing], GAME).unwrap();
        assert!(wire.sales.is_empty() && wire.market.is_empty());
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
        let wire = analyze(100, 1_000, &[tx], GAME).unwrap();
        assert!(wire.sales.is_empty() && wire.market.is_empty());
    }

    #[test]
    fn shop_sale_stamps_per_unit_and_rows_the_buyer() {
        let sale_type = ty(GAME, "shop", "Sale");
        let item_type = ty(GAME, "item", "Item");
        let sale = bcs::to_bytes(&crate::decode::Sale {
            id: Id([30; 32]),
            item_type: "health_potion".to_string(),
            template: Id([200; 32]),
            price: 100,
            supply: 90,
        })
        .unwrap();
        let minted = item_bytes(5, "health_potion", 10);
        let outputs = [
            ObjView {
                id: Id([30; 32]),
                owner: OwnerKind::Shared,
                type_key: &sale_type,
                bytes: &sale,
            },
            ObjView {
                id: Id([5; 32]),
                owner: OwnerKind::Object(Id([50; 32])),
                type_key: &item_type,
                bytes: &minted,
            },
        ];
        #[derive(serde::Serialize)]
        struct Wire {
            sale: [u8; 32],
            item_type: String,
            buyer: [u8; 32],
            quantity: u64,
            paid: u64,
            supply: u64,
        }
        let bought = bcs::to_bytes(&Wire {
            sale: [30; 32],
            item_type: "health_potion".to_string(),
            buyer: [7; 32],
            quantity: 10,
            paid: 1_000,
            supply: 90,
        })
        .unwrap();
        let events = [EventView {
            package: GAME,
            module: "shop",
            name: "SaleBought",
            type_params: &[],
            bytes: &bought,
            index: 2,
        }];
        let tx = TxView {
            tx_index: 0,
            sender: Addr([7; 32]),
            move_calls: &[],
            events: &events,
            inputs: &[],
            outputs: &outputs,
        };
        let wire = analyze(55, 9_000, &[tx], GAME).unwrap();
        // SaleBought is a game event AND the minted item streams → 2 publications
        assert_eq!(wire.publications.len(), 2);
        assert!(wire
            .publications
            .iter()
            .any(|p| p.payload.contains("ItemWritten")));
        assert_eq!(wire.sales.len(), 1);
        assert!(wire.sales[0].member.starts_with("55:0:2|"));
        assert_eq!(wire.market[0].price_per_unit_mist, 100);
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
        let wire = analyze(100, 1_000, &[tx], GAME).unwrap();
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
        let wire = analyze(1, 1, &[tx], GAME).unwrap();
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
        let wire = analyze(1, 1, &[tx], GAME).unwrap();
        assert!(wire.publications.is_empty());
        assert!(wire.sales.is_empty());
        assert!(wire.market.is_empty());
    }

    #[test]
    fn trade_created_lands_on_both_parties_social_doors() {
        #[derive(serde::Serialize)]
        struct Wire {
            trade: [u8; 32],
            a: [u8; 32],
            b: [u8; 32],
        }
        let bytes = bcs::to_bytes(&Wire {
            trade: [1; 32],
            a: [7; 32],
            b: [9; 32],
        })
        .unwrap();
        let events = [EventView {
            package: GAME,
            module: "trade",
            name: "TradeCreated",
            type_params: &[],
            bytes: &bytes,
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
        let wire = analyze(1, 1, &[tx], GAME).unwrap();
        let channels: Vec<_> = wire
            .publications
            .iter()
            .map(|p| p.channel.as_str())
            .collect();
        assert!(channels.contains(&format!("evt:social:0x{}", "09".repeat(32)).as_str()));
        assert!(channels.contains(&format!("evt:social:0x{}", "07".repeat(32)).as_str()));
        assert_eq!(wire.publications.len(), 2);
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
        let wire = analyze(1, 1, &[tx], GAME).unwrap();
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
