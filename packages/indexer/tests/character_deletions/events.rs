// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

use super::*;
use crate::decode::{Addr, Id};
use crate::ownership::{OwnerKind, TypeKey};

#[test]
fn only_final_game_character_destruction_invalidates_its_roster() {
    let key = TypeKey {
        package: "game".into(),
        module: "character".into(),
        name: "Character".into(),
        type_params: vec![],
    };
    let foreign = TypeKey {
        package: "other".into(),
        ..key.clone()
    };
    let item = TypeKey {
        module: "item".into(),
        name: "Item".into(),
        ..key.clone()
    };
    let deleted = ObjView {
        id: Id([1; 32]),
        version: 2,
        owner: OwnerKind::Object(Id([2; 32])),
        type_key: &key,
        bytes: &[],
    };
    let tx = TxView {
        tx_index: 4,
        sender: Addr([3; 32]),
        move_calls: &[],
        events: &[],
        inputs: &[],
        outputs: &[],
    };
    let mut wire = Wire::default();
    route(
        &mut wire,
        100,
        1_000,
        &tx,
        std::slice::from_ref(&deleted),
        "game",
    );
    assert_eq!(wire.publications.len(), 1);
    assert_eq!(
        wire.publications[0].channel,
        format!("evt:character:{}", deleted.id.hex())
    );
    let payload: serde_json::Value = serde_json::from_str(&wire.publications[0].payload).unwrap();
    assert_eq!(payload["type"], "CharacterDeleted");
    assert_eq!(payload["data"]["character"], deleted.id.hex());
    for key in [&foreign, &item] {
        route(
            &mut wire,
            100,
            1_000,
            &tx,
            &[ObjView {
                type_key: key,
                ..deleted.clone()
            }],
            "game",
        );
    }
    route(
        &mut wire,
        100,
        1_000,
        &TxView {
            outputs: std::slice::from_ref(&deleted),
            ..tx
        },
        std::slice::from_ref(&deleted),
        "game",
    );
    assert_eq!(wire.publications.len(), 1);
}
