// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Transaction-fixture coverage for marketplace history discrimination.

use std::sync::Arc;

use serde::Serialize;
use sui_indexer_alt_framework::pipeline::Processor;
use sui_indexer_alt_framework::types::{
    base_types::{ObjectID, SuiAddress},
    event::Event,
    parse_sui_struct_tag,
    test_checkpoint_data_builder::TestCheckpointBuilder,
};

use super::{
    model::{ItemEquip, KioskItemListed},
    AresHandler, RedisWrite,
};

const TS: u64 = 1_700_000_000_000;

fn oid(fill: u8) -> ObjectID {
    ObjectID::from_bytes([fill; 32]).unwrap()
}

fn saddr(fill: u8) -> SuiAddress {
    SuiAddress::from_bytes([fill; 32]).unwrap()
}

fn enc<T: Serialize>(value: &T) -> Vec<u8> {
    bcs::to_bytes(value).unwrap()
}

fn move_event(tag: &str, sender: SuiAddress, contents: Vec<u8>) -> Event {
    let type_ = parse_sui_struct_tag(tag).unwrap();
    Event {
        package_id: ObjectID::from(type_.address),
        transaction_module: type_.module.clone(),
        sender,
        type_,
        contents,
    }
}

async fn project_transaction(events: Vec<Event>, royalty_receipt: bool) -> Vec<RedisWrite> {
    let mut builder = TestCheckpointBuilder::new(7)
        .with_timestamp_ms(TS)
        .start_transaction(1);
    if royalty_receipt {
        builder = builder.add_move_call(oid(0xee), "royalty_rule", "pay");
    }
    builder = builder.with_events(events).finish_transaction();
    let checkpoint = Arc::new(builder.build_checkpoint());
    AresHandler::new(None).process(&checkpoint).await.unwrap()
}

fn purchase_event(
    name: &str,
    sender: SuiAddress,
    kiosk: ObjectID,
    item: ObjectID,
    price: u64,
) -> Event {
    move_event(
        &format!("0x2::kiosk::{name}<0xace::item::Item>"),
        sender,
        enc(&KioskItemListed {
            kiosk,
            id: item,
            price,
        }),
    )
}

#[tokio::test]
async fn kiosk_transaction_fixture_discriminates_equip_exit_and_real_zero_price_purchase() {
    let (sender, kiosk, item) = (saddr(0x44), oid(0xcc), oid(0xdd));
    let equip_events = vec![
        purchase_event("ItemListed", sender, kiosk, item, 0),
        purchase_event("ItemPurchased", sender, kiosk, item, 0),
        move_event(
            "0xace::extract::ItemEquipped",
            sender,
            enc(&ItemEquip {
                character: oid(0xaa),
                item,
                template: oid(0xbb),
                amount: 1,
            }),
        ),
    ];
    let equip_writes = project_transaction(equip_events.clone(), false).await;
    assert!(equip_writes
        .iter()
        .all(|write| !matches!(write, RedisWrite::ZAdd { .. })));
    assert!(equip_writes
        .iter()
        .any(|write| matches!(write, RedisWrite::ZRem { .. })));

    // A royalty payment for a different purchase in the same PTB must not turn
    // this item-id-confirmed equip exit back into a sale.
    let composed_writes = project_transaction(equip_events, true).await;
    assert!(composed_writes
        .iter()
        .all(|write| !matches!(write, RedisWrite::ZAdd { .. })));

    // A successful standalone ItemPurchased is the purchase receipt even at zero.
    let zero_purchase = project_transaction(
        vec![purchase_event("ItemPurchased", sender, kiosk, item, 0)],
        false,
    )
    .await;
    assert!(zero_purchase
        .iter()
        .any(|write| matches!(write, RedisWrite::ZAdd { .. })));

    // Atomic list+purchase remains genuine when the royalty receipt-producing
    // call proves it was a marketplace transfer rather than the extraction seam.
    let receipted_zero = project_transaction(
        vec![
            purchase_event("ItemListed", sender, kiosk, item, 0),
            purchase_event("ItemPurchased", sender, kiosk, item, 0),
        ],
        true,
    )
    .await;
    assert!(receipted_zero
        .iter()
        .any(|write| matches!(write, RedisWrite::ZAdd { .. })));
}

// OWNER: phantom "SOLD FOR 0 SUI" history rows appear when equipping. The extract seam's non-trade exit is
// NOT always a clean same-tx ItemListed(0) → ItemPurchased(0) pair — an equip flow can surface the native
// ItemPurchased(0) WITHOUT the paired ItemListed(0) in this transaction (the transient-listing correlation
// then misses). The ItemEquipped event for the SAME item id is the authoritative "this left the kiosk to be
// worn, not bought" signal and must independently exclude the sale, or the seller sees a fake zero-price sale.
#[tokio::test]
async fn item_confirmed_equip_exit_is_never_a_sale_without_the_transient_listing() {
    let (sender, kiosk, item) = (saddr(0x44), oid(0xcc), oid(0xdd));
    // No ItemListed(0) in this tx — only the native purchase + the equip proof for the same item id.
    let writes = project_transaction(
        vec![
            purchase_event("ItemPurchased", sender, kiosk, item, 0),
            move_event(
                "0xace::extract::ItemEquipped",
                sender,
                enc(&ItemEquip {
                    character: oid(0xaa),
                    item,
                    template: oid(0xbb),
                    amount: 1,
                }),
            ),
        ],
        false,
    )
    .await;
    assert!(
        writes
            .iter()
            .all(|write| !matches!(write, RedisWrite::ZAdd { .. })),
        "an item-id-confirmed equip exit must never write a sales-log row (phantom SOLD FOR 0 SUI)"
    );
}
