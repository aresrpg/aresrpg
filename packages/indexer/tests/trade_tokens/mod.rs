use super::*;
use crate::decode::{Addr, TradePhase, TradeState};
use crate::ownership::TypeKey;

const GAME: &str = "0x0000000000000000000000000000000000000000000000000000000000000009";
fn trade_bytes() -> Vec<u8> {
    bcs::to_bytes(&Trade {
        id: Id([1; 32]),
        state: TradeState {
            initiator: Addr([2; 32]),
            invitee: Addr([3; 32]),
            phase: TradePhase::Settling,
            offer_revision: 7,
            initiator_accepted: true,
            invitee_accepted: true,
        },
        sui_a: Balance { value: 0 },
        sui_b: Balance { value: 0 },
        kares_a: Balance { value: 99 },
        kares_b: Balance { value: 88 },
        caps_a: vec![],
        caps_b: vec![],
    })
    .unwrap()
}
fn tags() -> (TypeKey, TypeKey) {
    (
        TypeKey {
            package: GAME.into(),
            module: "trade".into(),
            name: "Trade".into(),
            type_params: vec![],
        },
        TypeKey {
            package: SUI_FRAMEWORK.into(),
            module: "dynamic_field".into(),
            name: "Field".into(),
            type_params: vec![
                "vector<u8>".into(),
                format!("vector<{SUI_FRAMEWORK}::balance::Balance<{GAME}::fixture::TOKEN>>"),
            ],
        },
    )
}
fn field_bytes(a: u64, b: u64) -> Vec<u8> {
    bcs::to_bytes(&Field {
        id: Id([4; 32]),
        name: b"kares".to_vec(),
        value: vec![Balance { value: a }, Balance { value: b }],
    })
    .unwrap()
}

#[test]
fn a_child_only_withdrawal_keeps_the_trade_and_notifies_both_parties() {
    let (parent_tag, child_tag) = tags();
    let parent_bytes = trade_bytes();
    let bytes = field_bytes(0, 10);
    let parent = ObjView {
        id: Id([1; 32]),
        version: 2,
        owner: OwnerKind::Shared,
        type_key: &parent_tag,
        bytes: &parent_bytes,
    };
    let child = ObjView {
        id: Id([4; 32]),
        version: 3,
        owner: OwnerKind::Object(parent.id),
        type_key: &child_tag,
        bytes: &bytes,
    };
    let tx = TxView {
        tx_index: 0,
        sender: Addr([2; 32]),
        move_calls: &[],
        events: &[],
        inputs: &[parent],
        outputs: &[child],
        deleted: &[],
    };
    let writes = project(&tx, GAME, 12).unwrap();
    assert!(writes[0].contains("v.token_a = '0', v.token_b = '10'"));
    let changes = changes(&tx, GAME).unwrap();
    assert_eq!(changes.len(), 1);
    assert!(!changes[0].1);
    let wire = crate::publish::analyze(12, 1000, &[tx], GAME, "seed").unwrap();
    assert_eq!(wire.publications.len(), 2);
    assert!(
        wire.publications
            .iter()
            .all(|row| row.payload.contains("TradeChanged")
                && !row.payload.contains("TradeDestroyed"))
    );
}

#[test]
fn a_read_only_trade_is_not_a_deletion_and_certified_closure_is() {
    let (tag, _) = tags();
    let bytes = trade_bytes();
    let parent = ObjView {
        id: Id([1; 32]),
        version: 2,
        owner: OwnerKind::Shared,
        type_key: &tag,
        bytes: &bytes,
    };
    let mut tx = TxView {
        tx_index: 0,
        sender: Addr([2; 32]),
        move_calls: &[],
        events: &[],
        inputs: std::slice::from_ref(&parent),
        outputs: &[],
        deleted: &[],
    };
    assert!(changes(&tx, GAME).unwrap().is_empty());
    tx.deleted = std::slice::from_ref(&parent);
    assert!(changes(&tx, GAME).unwrap()[0].1);
}

#[test]
fn native_lookalikes_are_ignored_before_decoding_foreign_parents() {
    let (mut tag, child_tag) = tags();
    tag.package = "0xforeign".into();
    let bytes = trade_bytes();
    let parent = ObjView {
        id: Id([1; 32]),
        version: 2,
        owner: OwnerKind::Shared,
        type_key: &tag,
        bytes: &bytes,
    };
    let child = ObjView {
        id: Id([4; 32]),
        version: 3,
        owner: OwnerKind::Object(parent.id),
        type_key: &child_tag,
        bytes: &[255],
    };
    let tx = TxView {
        tx_index: 0,
        sender: Addr([2; 32]),
        move_calls: &[],
        events: &[],
        inputs: &[parent],
        outputs: &[child],
        deleted: &[],
    };
    assert!(project(&tx, GAME, 1).unwrap().is_empty());
    assert!(changes(&tx, GAME).unwrap().is_empty());
}

#[test]
fn child_deletion_clears_only_active_token_balances() {
    let (tag, child_tag) = tags();
    let parent_bytes = trade_bytes();
    let bytes = field_bytes(0, 0);
    let parent = ObjView {
        id: Id([1; 32]),
        version: 2,
        owner: OwnerKind::Shared,
        type_key: &tag,
        bytes: &parent_bytes,
    };
    let child = ObjView {
        id: Id([4; 32]),
        version: 3,
        owner: OwnerKind::Object(parent.id),
        type_key: &child_tag,
        bytes: &bytes,
    };
    let tx = TxView {
        tx_index: 0,
        sender: Addr([2; 32]),
        move_calls: &[],
        events: &[],
        inputs: &[parent],
        outputs: &[],
        deleted: &[child],
    };
    assert!(project(&tx, GAME, 1).unwrap()[0].contains("v.token_a = '0', v.token_b = '0'"));
    assert!(!changes(&tx, GAME).unwrap()[0].1);
}

#[test]
fn captured_testnet_native_field_decodes_and_keeps_its_settling_parent() {
    // Real objects captured 2026-10-02; fixture pins each object ID, version and exact bytes.
    let capture: serde_json::Value =
        serde_json::from_str(include_str!("captured.testnet.json")).unwrap();
    let game = capture["game_original"].as_str().unwrap();
    let parent_row = &capture["objects"][0];
    let child_row = &capture["objects"][1];
    let parent_bytes = hex::decode(parent_row["bcs"].as_str().unwrap()).unwrap();
    let child_bytes = hex::decode(child_row["bcs"].as_str().unwrap()).unwrap();
    let parent: Trade = decode::from_bytes(&parent_bytes).unwrap();
    let field: Field<Vec<u8>, Vec<Balance>> = decode::from_bytes(&child_bytes).unwrap();
    assert_eq!(parent.id.hex(), parent_row["object_id"].as_str().unwrap());
    assert_eq!(field.id.hex(), child_row["object_id"].as_str().unwrap());
    assert_eq!(field.name, b"kares");
    assert_eq!(
        field
            .value
            .iter()
            .map(|balance| balance.value)
            .collect::<Vec<_>>(),
        vec![123_000_000_000, 0]
    );
    assert_eq!(parent.kares_a.value, 0);
    assert_eq!(parent.kares_b.value, 0);
    let parent_tag = TypeKey {
        package: game.into(),
        module: "trade".into(),
        name: "Trade".into(),
        type_params: vec![],
    };
    let field_type = child_row["type"].as_str().unwrap();
    let value_type = field_type
        .strip_prefix(&format!(
            "{SUI_FRAMEWORK}::dynamic_field::Field<vector<u8>,"
        ))
        .unwrap()
        .strip_suffix('>')
        .unwrap();
    let child_tag = TypeKey {
        package: SUI_FRAMEWORK.into(),
        module: "dynamic_field".into(),
        name: "Field".into(),
        type_params: vec!["vector<u8>".into(), value_type.into()],
    };
    let parent_view = ObjView {
        id: parent.id,
        version: parent_row["version"].as_str().unwrap().parse().unwrap(),
        owner: OwnerKind::Shared,
        type_key: &parent_tag,
        bytes: &parent_bytes,
    };
    let child_view = ObjView {
        id: field.id,
        version: child_row["version"].as_str().unwrap().parse().unwrap(),
        owner: OwnerKind::Object(parent.id),
        type_key: &child_tag,
        bytes: &child_bytes,
    };
    let tx = TxView {
        tx_index: 0,
        sender: parent.state.initiator,
        move_calls: &[],
        events: &[],
        inputs: &[parent_view],
        outputs: &[child_view],
        deleted: &[],
    };
    assert!(
        project(&tx, game, 1).unwrap()[0].contains("v.token_a = '123000000000', v.token_b = '0'")
    );
    assert!(!changes(&tx, game).unwrap()[0].1);
}
