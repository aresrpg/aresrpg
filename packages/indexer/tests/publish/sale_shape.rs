#[test]
fn buyer_mutations_do_not_change_the_sold_lot() {
    let item_type = ty(GAME, "item", "Item");
    let sold = item_bytes(5, "wooling_wool", 10);
    let merged = item_bytes(5, "wooling_wool", 100);
    let input = ObjView {
        id: Id([5; 32]), version: 1, owner: OwnerKind::Object(Id([2; 32])),
        type_key: &item_type, bytes: &sold,
    };
    let output = ObjView { version: 2, bytes: &merged, owner: OwnerKind::Object(Id([50; 32])), ..input.clone() };
    let purchase = purchased_bytes(2, 5, 2_500_000_000);
    let phantom = game_item_param();
    let proof = bcs::to_bytes(&(Id([2; 32]), Addr([9; 32]))).unwrap();
    let events = [
        EventView { package: SUI_FRAMEWORK, module: "kiosk", name: "ItemPurchased", type_params: &phantom, bytes: &purchase, index: 0 },
        EventView { package: GAME, module: "listing_rule", name: "SellerProved", type_params: &[], bytes: &proof, index: 1 },
    ];
    let tx = TxView { deleted: &[], tx_index: 0, sender: Addr([7; 32]), move_calls: &[], events: &events, inputs: &[input], outputs: &[output] };
    let wire = analyze(100, 1000, &[tx], GAME, SEED).unwrap();
    let feed = crate::notification_sales::extract(&wire.sales, &["1".repeat(44)]).unwrap();
    assert_eq!(feed[0]["amount"], 10);
    assert_eq!(wire.market_prices[0].units, 10);
}
