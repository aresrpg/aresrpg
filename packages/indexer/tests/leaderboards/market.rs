use super::*;
use crate::leaderboards::Metric;

#[test]
fn public_sale_volume_uses_each_exact_receipt_despite_batches_and_profit_withdrawals() {
    let game = "0xgame";
    let kiosk_type = crate::ownership::TypeKey {
        package: SUI_FRAMEWORK.into(),
        module: "kiosk".into(),
        name: "Kiosk".into(),
        type_params: vec![],
    };
    let kiosk = |profits| {
        bcs::to_bytes(&decode::Kiosk {
            id: Id([2; 32]),
            profits: decode::Balance { value: profits },
            owner: Addr([88; 32]),
            item_count: 0,
            allow_extensions: false,
        })
        .unwrap()
    };
    let marker_type = super::tests::personal_marker_type();
    let marker_bytes = super::tests::personal_marker_bytes(9);
    let marker = ObjView {
        id: Id([61; 32]),
        version: 1,
        owner: OwnerKind::Object(Id([2; 32])),
        type_key: &marker_type,
        bytes: &marker_bytes,
    };
    let before = kiosk(100);
    let after = kiosk(0); // A withdrawal in the same PTB makes net profits useless for gross volume.
    let input = ObjView {
        id: Id([2; 32]),
        version: 1,
        owner: OwnerKind::Shared,
        type_key: &kiosk_type,
        bytes: &before,
    };
    let output = ObjView {
        bytes: &after,
        ..input.clone()
    };
    let a = bcs::to_bytes(&(Id([2; 32]), Id([3; 32]), 1000u64)).unwrap();
    let b = bcs::to_bytes(&(Id([2; 32]), Id([4; 32]), 3000u64)).unwrap();
    let phantom = vec![format!("{game}::item::Item")];
    let event = |bytes| EventView {
        package: SUI_FRAMEWORK,
        module: "kiosk",
        name: "ItemPurchased",
        type_params: &phantom,
        bytes,
        index: 0,
    };
    let proof_bytes = bcs::to_bytes(&(Id([2; 32]), Addr([9; 32]))).unwrap();
    let events = [
        event(&a),
        EventView {
            index: 1,
            ..event(&b)
        },
        EventView {
            package: game,
            module: "listing_rule",
            name: "SellerProved",
            type_params: &[],
            bytes: &proof_bytes,
            index: 2,
        },
    ];
    let tx = TxView {
        tx_index: 0,
        sender: Addr([7; 32]),
        move_calls: &[],
        events: &events,
        inputs: &[input, marker],
        outputs: &[output],
    };
    let wire = analyze(
        1,
        100,
        &[TxView {
            inputs: &tx.inputs[..1],
            ..tx.clone()
        }],
        game,
        "0xseed",
    )
    .unwrap();
    assert!(
        analyze(
            1,
            100,
            &[TxView {
                events: &events[..2],
                ..tx.clone()
            }],
            game,
            "0xseed"
        )
        .is_err(),
        "a cosmetic owner is not a seller proof"
    );
    for address in [Addr([7; 32]), Addr([9; 32])] {
        let total: u64 = wire
            .leaderboard
            .iter()
            .filter(|fact| fact.address == address && fact.metric == Metric::Marketplace)
            .map(|fact| fact.amount)
            .sum();
        assert_eq!(total, 4000);
    }
}
