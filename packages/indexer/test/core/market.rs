// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Money and market: sales, royalty proofs, revenue and gas facts.

use super::*;
use crate::decode::{self, Balance, KioskListingKey};
use crate::pipeline::OwnedObj;

fn item_type() -> String {
    format!("{GAME}::item::Item")
}

fn item(object: Id, owner: OwnerKind, amount: u32) -> OwnedObj {
    obj(
        object,
        owner,
        game("item", "Item"),
        &decode::Item {
            id: object,
            template: id(200),
            name: "n".into(),
            item_type: "wooling_wool".into(),
            category: "resource".into(),
            level: 1,
            amount,
        },
    )
}

fn kiosk(profits: u64) -> OwnedObj {
    obj(
        id(2),
        OwnerKind::Shared,
        ty(SUI_FRAMEWORK, "kiosk", "Kiosk", &[]),
        &decode::Kiosk {
            id: id(2),
            profits: Balance { value: profits },
            owner: addr(88),
            item_count: 1,
            allow_extensions: false,
        },
    )
}

/// The immutable personal-kiosk owner marker of kiosk 2: `addr(9)`.
pub fn owner_marker() -> OwnedObj {
    let marker = format!(
        "{}::personal_kiosk::OwnerMarker",
        crate::personal_kiosk::PACKAGES[0]
    );
    obj(
        id(61),
        OwnerKind::Object(id(2)),
        field(&marker, "address"),
        &decode::Field {
            id: id(61),
            name: false,
            value: addr(9),
        },
    )
}

fn seller_proved(owner: Addr) -> OwnedEvent {
    game_event("listing_rule", "SellerProved", &(id(2), owner))
}

fn exclusive_listing(object: Id) -> OwnedObj {
    obj(
        id(70),
        OwnerKind::Object(id(2)),
        field(&format!("{SUI_FRAMEWORK}::kiosk::Listing"), "u64"),
        &decode::Field {
            id: id(70),
            name: KioskListingKey {
                id: object,
                is_exclusive: true,
            },
            value: 500_u64,
        },
    )
}

/// Mainnet `TransferPolicy<Item>` before and after one real royalty payment (fixture provenance).
fn royalty_policy(of: &str) -> (OwnedObj, OwnedObj) {
    let fixture: Value =
        serde_json::from_str(include_str!("../fixtures/royalty_policy.mainnet.json")).unwrap();
    let state = |name: &str| OwnedObj {
        id: id(90),
        version: 1,
        owner: OwnerKind::Shared,
        type_key: ty(SUI_FRAMEWORK, "transfer_policy", "TransferPolicy", &[of]),
        bytes: hex::decode(fixture[name]["bcs"].as_str().unwrap()).unwrap(),
    };
    (state("before"), state("after"))
}

#[test]
fn captured_transfer_policy_decodes_its_royalty_balance() {
    let (before, after) = royalty_policy(&item_type());
    let decode = |object: &OwnedObj| decode::from_bytes::<decode::TransferPolicy>(&object.bytes);
    assert_eq!(decode(&before).unwrap().balance.value, 3_590_000_000);
    let after = decode(&after).unwrap();
    assert_eq!(after.balance.value, 3_600_000_000);
    assert_eq!(after.rules.contents.len(), 5);
    assert!(after.rules.contents[0].ends_with("::royalty_rule::Rule"));
}

#[test]
fn public_purchase_uses_receipt_through_wrappers() {
    let purchase = |price| kiosk_event("ItemPurchased", &item_type(), id(2), id(5), Some(price));
    // No royalty call is visible: a Move wrapper may pay it. The sealed receipt counts.
    let (policy_before, policy_after) = royalty_policy(&item_type());
    let sale = OwnedTx {
        events: vec![purchase(1_000), seller_proved(addr(9))],
        inputs: vec![owner_marker(), policy_before],
        outputs: vec![
            item(id(5), OwnerKind::Object(id(50)), 10),
            kiosk(0),
            policy_after,
        ],
        ..tx()
    };
    let writes = run(std::slice::from_ref(&sale));
    let rows = sales(&writes);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].0, format!("sales:{}", addr(7).hex()));
    assert!(rows[0].1.starts_with("100:0:0|") && rows[0].1.contains("\"side\":\"bought\""));
    assert_eq!(rows[1].0, format!("sales:{}", addr(9).hex()));
    let (_, purchased) = published(&writes)
        .into_iter()
        .find(|(_, payload)| payload["type"] == "MarketPurchased")
        .unwrap();
    assert_eq!(purchased["data"]["buyer"], addr(7).hex());
    assert_eq!(purchased["data"]["seller"], addr(9).hex());
    assert_eq!(purchased["data"]["kind"], "item");
    assert_eq!(purchased["data"]["item_type"], "wooling_wool");
    assert_eq!(purchased["data"]["amount"], 10);
    assert_eq!(market_volume(&writes), 1_000);
    let prices = market_prices(&writes);
    assert_eq!((prices[0].mist, prices[0].units), (1_000, 10));
    // Royalty revenue is what our Item policy collected (the captured 0.01 SUI), never a copy
    // of the rate.
    assert_eq!(totals(&writes).unwrap().item_royalty_mist, 10_000_000);
    let card = &notifications(&writes)[0];
    assert_eq!(card["id"], "100:0:0:sale");
    assert_eq!(card["kind"], "sale");
    assert_eq!(card["asset_kind"], "item");
    assert_eq!(card["seller"], addr(9).hex());
    assert_eq!(card["digest"], "digest");

    // Two receipts in one PTB, while a withdrawal empties the kiosk's profits.
    let batch = OwnedTx {
        events: vec![
            kiosk_event("ItemPurchased", &item_type(), id(2), id(3), Some(1_000)),
            kiosk_event("ItemPurchased", &item_type(), id(2), id(4), Some(3_000)),
            seller_proved(addr(9)),
        ],
        inputs: vec![kiosk(100), owner_marker()],
        outputs: vec![kiosk(0)],
        ..tx()
    };
    let writes = run(std::slice::from_ref(&batch));
    for address in [addr(7), addr(9)] {
        let total: u64 = leaderboard(&writes)
            .iter()
            .filter(|fact| {
                fact.address == address && fact.metric == crate::leaderboards::Metric::Marketplace
            })
            .map(|fact| fact.amount)
            .sum();
        assert_eq!(total, 4_000);
    }
    // A cosmetic kiosk owner is never a seller proof; disagreeing proofs refuse the checkpoint.
    let unproved = OwnedTx {
        events: batch.events[..2].to_vec(),
        ..batch.clone()
    };
    assert!(try_run(&[unproved]).is_err());
    let disagreeing = OwnedTx {
        events: [batch.events.clone(), vec![seller_proved(addr(8))]].concat(),
        ..batch
    };
    assert!(try_run(&[disagreeing]).is_err());
}

#[test]
fn sold_lot_quantity_comes_from_the_input_lot() {
    // The buyer merges 90 more units into the bought stack in the same PTB.
    let input = item(id(5), OwnerKind::Object(id(2)), 10);
    let merged = OwnedObj {
        version: 2,
        ..item(id(5), OwnerKind::Object(id(50)), 100)
    };
    let purchase = kiosk_event("ItemPurchased", &item_type(), id(2), id(5), Some(2_500));
    let sale = OwnedTx {
        events: vec![purchase, seller_proved(addr(9))],
        inputs: vec![input.clone(), owner_marker()],
        outputs: vec![merged],
        ..tx()
    };
    let writes = run(std::slice::from_ref(&sale));
    assert_eq!(notifications(&writes)[0]["amount"], 10);
    assert_eq!(market_prices(&writes)[0].units, 10);
    // The stack merged away entirely still writes the seller's history.
    let merged_away = OwnedTx {
        outputs: vec![kiosk(1_000)],
        inputs: vec![owner_marker(), input, kiosk(1_000)],
        ..sale
    };
    let writes = run(&[merged_away]);
    assert!(sales(&writes)
        .iter()
        .any(|(key, _)| *key == format!("sales:{}", addr(9).hex())));
    assert_eq!(kinds_on(&writes, "evt:economy"), ["MarketPurchased"]);
}

#[test]
fn exclusive_purchase_uses_listing_deletion_profit_delta_and_our_royalty() {
    let (policy_before, policy_after) = royalty_policy(&item_type());
    let sale = OwnedTx {
        inputs: vec![
            owner_marker(),
            kiosk(0),
            exclusive_listing(id(5)),
            policy_before,
        ],
        outputs: vec![
            kiosk(1_000),
            item(id(5), OwnerKind::Object(id(50)), 10),
            policy_after.clone(),
        ],
        ..tx()
    };
    let writes = run(std::slice::from_ref(&sale));
    let rows = sales(&writes);
    assert_eq!(rows.len(), 2);
    assert!(rows[0].1.contains("\"exclusive\":true"));
    assert_eq!(market_volume(&writes), 0);
    assert!(market_prices(&writes).is_empty());
    assert!(notifications(&writes).is_empty());
    assert_eq!(totals(&writes).unwrap().item_royalty_mist, 10_000_000);

    // Royalty paid into the Character policy proves nothing for an Item sale.
    let character_policy = OwnedObj {
        type_key: ty(
            SUI_FRAMEWORK,
            "transfer_policy",
            "TransferPolicy",
            &[&format!("{GAME}::character::Character")],
        ),
        ..policy_after
    };
    let wrong_policy = OwnedTx {
        outputs: vec![
            kiosk(1_000),
            item(id(5), OwnerKind::Object(id(50)), 10),
            character_policy,
        ],
        ..sale.clone()
    };
    let writes = run(&[wrong_policy]);
    assert!(sales(&writes).is_empty());
    // ...yet the royalty the Character policy collected is still Character revenue.
    let collected = totals(&writes).unwrap();
    assert_eq!(
        (
            collected.item_royalty_mist,
            collected.character_royalty_mist
        ),
        (0, 10_000_000)
    );

    // SECURITY: any package can export a `royalty_rule::pay`. The attacker's call plus a
    // foreign sale's profit in the same kiosk never forges a game sale or royalty revenue.
    let foreign_pay = OwnedTx {
        move_calls: vec![format!("0x{}::royalty_rule::pay", "ee".repeat(32))],
        inputs: sale.inputs[..3].to_vec(),
        outputs: sale.outputs[..2].to_vec(),
        ..sale
    };
    let writes = run(&[foreign_pay]);
    assert!(sales(&writes).is_empty());
    assert!(totals(&writes).is_none());
}

#[test]
fn zero_price_extracts_and_foreign_lookalikes_never_count() {
    let listed = |object, price| kiosk_event("ItemListed", &item_type(), id(2), object, price);
    // A protected-policy extract (0-price list + buy) beside a real delist and a real listing:
    // only the extract's own pair is suppressed.
    let merge = OwnedTx {
        events: vec![
            kiosk_event("ItemPurchased", &item_type(), id(2), id(5), Some(0)),
            kiosk_event("ItemDelisted", &item_type(), id(2), id(5), None),
            listed(id(5), Some(0)),
            listed(id(6), Some(700)),
        ],
        ..tx()
    };
    let writes = run(&[merge]);
    assert_eq!(
        kinds_on(&writes, "evt:economy"),
        ["MarketDelisted", "MarketListed"]
    );
    assert!(sales(&writes).is_empty());

    // An attacker's own `royalty_rule::pay` cannot launder a zero-price extract into a sale.
    let spoof = OwnedTx {
        move_calls: vec![format!("0x{}::royalty_rule::pay", "ee".repeat(32))],
        events: vec![kiosk_event(
            "ItemPurchased",
            &item_type(),
            id(2),
            id(5),
            Some(0),
        )],
        outputs: vec![item(id(5), OwnerKind::Object(id(50)), 1)],
        ..tx()
    };
    let writes = run(&[spoof]);
    assert!(sales(&writes).is_empty() && market_prices(&writes).is_empty());
    assert_eq!(kinds_on(&writes, "evt:economy"), ["ItemWritten"]);

    // Another collection's trades: same module and names, a foreign phantom type.
    let foreign = format!("0x{}::nft::Nft", "dd".repeat(32));
    let foreign_trade = OwnedTx {
        events: vec![
            kiosk_event("ItemPurchased", &foreign, id(2), id(5), Some(1_000)),
            kiosk_event("ItemListed", &foreign, id(2), id(5), Some(777)),
        ],
        ..tx()
    };
    let writes = run(&[foreign_trade]);
    assert!(published(&writes).is_empty());
    assert!(sales(&writes).is_empty() && leaderboard(&writes).is_empty());

    // Only the framework's own zero-price purchase marks an extract: a lookalike
    // `kiosk::ItemPurchased` from another package never hides a real listing.
    let lookalike = OwnedEvent {
        package: format!("0x{}", "ee".repeat(32)),
        ..kiosk_event("ItemPurchased", &item_type(), id(2), id(5), Some(0))
    };
    let listing = OwnedTx {
        events: vec![lookalike, listed(id(5), Some(0))],
        ..tx()
    };
    assert_eq!(kinds_on(&run(&[listing]), "evt:economy"), ["MarketListed"]);
}

/// A Kolizeum lobby whose pot holds `pot` MIST.
fn lobby(pot: u64) -> OwnedObj {
    obj(
        id(42),
        OwnerKind::Shared,
        game("kolizeum", "Kolizeum"),
        &decode::Kolizeum {
            id: id(42),
            pot: Balance { value: pot },
            pledge: 1_000_000_000,
            fight: id(43),
            format: 1,
            level_min: 1,
            level_max: 200,
            allowed: None,
        },
    )
}

#[test]
fn foreign_calls_never_claim_our_revenue() {
    // SECURITY: a pledge refund (`exit_kolizeum`) lowers the pot. An attacker's own package
    // exporting `api::start_kolizeum` must not turn that refund into Kolizeum revenue.
    let refund = OwnedTx {
        move_calls: vec![format!("0x{}::api::start_kolizeum", "ee".repeat(32))],
        inputs: vec![lobby(2_000_000_000)],
        outputs: vec![lobby(1_000_000_000)],
        ..tx()
    };
    let writes = run(&[refund]);
    assert!(totals(&writes).is_none_or(|totals| totals.kolizeum_mist == 0));
}

#[test]
fn revenue_and_gas_facts_are_exact() {
    let original = GAME;
    let upgrade = format!("0x{}", "bb".repeat(32));
    let created = game_event(
        "character",
        "CharacterCreated",
        &(id(41), addr(7), "aiden".to_string(), "yajin".to_string()),
    );
    let call = |package: &str, target: &str| format!("{package}::{target}");
    let txs = [
        // one PTB, many game calls through an older certified version: one transaction
        OwnedTx {
            move_calls: vec![
                call(&upgrade, "kiosk::borrow"),
                call(&upgrade, "api::start_kolizeum"),
            ],
            events: vec![created],
            inputs: vec![lobby(2_000_000_000)],
            outputs: vec![lobby(1_800_000_000)],
            gas_mist: 5,
            ..tx()
        },
        // a failed game call pays gas but is no activity
        OwnedTx {
            sender: addr(8),
            successful: false,
            move_calls: vec![call(original, "api::redeem_giftcard")],
            gas_mist: -2,
            ..tx()
        },
        // a deployment door beside a game call still counts
        OwnedTx {
            sender: addr(9),
            move_calls: vec![
                call(original, "version::admin_update"),
                call(original, "api::redeem_giftcard"),
            ],
            gas_mist: 1,
            ..tx()
        },
        // deployment-only, framework and foreign calls never count
        OwnedTx {
            sender: addr(10),
            move_calls: vec![
                call(original, "version::admin_update"),
                call(original, "mastery::set_offer"),
                call(SUI_FRAMEWORK, "package::commit_upgrade"),
                call(&format!("0x{}", "cc".repeat(32)), "registry::write_item"),
            ],
            gas_mist: 1_000,
            ..tx()
        },
    ];
    let handler = AresHandler::new(GAME, &upgrade, &[GAME.to_string(), upgrade.clone()]).unwrap();
    let writes = handler.writes(CKPT, 9, TS, &ordered(&txs)).unwrap();
    let totals = totals(&writes).unwrap();
    assert_eq!(totals.character_creation_mist, 10_000_000_000);
    assert_eq!(totals.kolizeum_mist, 200_000_000);
    assert_eq!(totals.transactions, 2);
    // negative net gas (storage rebates) stays exact: 5 - 2 + 1
    assert_eq!(totals.gas_mist, 4);
    let active = writes
        .iter()
        .filter_map(|write| match write {
            Write::Activity(fact) => Some(fact.address),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(active, [addr(7), addr(9)]);
}

#[test]
fn captured_tournament_fee_counts_treasury_cut_only() {
    // Captured from sui move test, tournament_fee_tests::successful_registration_splits_exactly_
    // and_leave_does_not_refund, 2026-11-03. Local Move VM scenario (not a mainnet transaction):
    // tournament object 0xdba72804cc9504a82bbaa13ed4a83a0e2c6219d7e45125cf57fd10cbab957a97,
    // initial scenario registration, fee 5 MIST -> treasury 2 MIST. No chain object version exists.
    let capture = captured(&["0200000000000000"]);
    let fee = |package: &str, bytes: &[u8]| OwnedEvent {
        bytes: bytes.to_vec(),
        ..event(package, "tournament", "EntryFeePaid", &())
    };
    let updated = game_event("tournament", "TournamentUpdated", &id(1));
    let revenue = |events: Vec<OwnedEvent>| {
        try_run(&[OwnedTx { events, ..tx() }]).map(|writes| totals(&writes))
    };
    // Two registrations, even through wrappers: each counts its treasury cut.
    let paid = revenue(vec![
        fee(GAME, &capture),
        updated.clone(),
        fee(GAME, &capture),
    ])
    .unwrap();
    let paid = paid.unwrap();
    assert_eq!(paid.tournament_mist, 4);
    assert_eq!((paid.kolizeum_mist, paid.item_royalty_mist), (0, 0));
    // Donations, withdrawals, cancellations and foreign fee events infer nothing.
    assert!(revenue(vec![updated, fee("0xforeign", &capture)])
        .unwrap()
        .is_none());
    // A free registration has no platform revenue; a truncated capture refuses the checkpoint.
    let free = revenue(vec![fee(GAME, &[0; 8])]).unwrap().unwrap();
    assert_eq!(free.tournament_mist, 0);
    assert!(revenue(vec![fee(GAME, &capture[..7])]).is_err());
}
