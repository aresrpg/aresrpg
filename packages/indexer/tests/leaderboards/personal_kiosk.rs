use super::*;
use crate::decode::{Balance, Kiosk, KioskOwnerCap};
use crate::ownership::{self, Custody, TypeKey};

fn marker_type(package: &str) -> TypeKey {
    TypeKey {
        package: SUI_FRAMEWORK.into(),
        module: "dynamic_field".into(),
        name: "Field".into(),
        type_params: vec![
            format!("{package}::personal_kiosk::OwnerMarker"),
            "address".into(),
        ],
    }
}

#[test]
fn captured_owner_marker_decodes_the_immutable_address() {
    // Testnet owner marker 0xeb5a…a878, version 981006460, captured 2026-09-08 via gRPC.
    let bytes = hex::decode(concat!(
        "eb5ae9f66a12c2bbf7ae66dd17f0a46beb18ae86e38a5ceadf72c82b02b2a87800",
        "3d1342fb7de99c69ce821183bcfc5b6374d81453bf5ca9bf7e383e75b3722983",
    ))
    .unwrap();
    let kiosk = Id(
        hex::decode("77a7927ddf70d1642cd27cfe220c162383d9fdd891a56792d061aec6c878bb92")
            .unwrap()
            .try_into()
            .unwrap(),
    );
    let key = marker_type(PACKAGES[0]);
    let view = ObjView {
        id: Id(bytes[..32].try_into().unwrap()),
        version: 981006460,
        owner: OwnerKind::Object(kiosk),
        type_key: &key,
        bytes: &bytes,
    };
    assert_eq!(
        owner(std::slice::from_ref(&view), &[], kiosk)
            .unwrap()
            .unwrap()
            .hex(),
        "0x3d1342fb7de99c69ce821183bcfc5b6374d81453bf5ca9bf7e383e75b3722983"
    );
    let forged_key = marker_type("0xattacker");
    assert!(owner(
        &[ObjView {
            type_key: &forged_key,
            ..view
        }],
        &[],
        kiosk
    )
    .unwrap()
    .is_none());
}

#[test]
fn an_immutable_cap_input_owns_the_graph_even_when_cosmetic_owner_is_spoofed() {
    let key = TypeKey {
        package: PACKAGES[0].into(),
        module: "personal_kiosk".into(),
        name: "PersonalKioskCap".into(),
        type_params: vec![],
    };
    let bytes = bcs::to_bytes(&PersonalKioskCap {
        id: Id([4; 32]),
        cap: Some(KioskOwnerCap {
            id: Id([5; 32]),
            for_: Id([6; 32]),
        }),
    })
    .unwrap();
    let cap = ObjView {
        id: Id([4; 32]),
        version: 1,
        owner: OwnerKind::Address(Addr([7; 32])),
        type_key: &key,
        bytes: &bytes,
    };
    let kiosk_key = TypeKey {
        package: SUI_FRAMEWORK.into(),
        module: "kiosk".into(),
        name: "Kiosk".into(),
        type_params: vec![],
    };
    let kiosk_bytes = bcs::to_bytes(&Kiosk {
        id: Id([6; 32]),
        profits: Balance { value: 10 },
        owner: Addr([88; 32]),
        item_count: 0,
        allow_extensions: false,
    })
    .unwrap();
    let kiosk = ObjView {
        id: Id([6; 32]),
        version: 2,
        owner: OwnerKind::Shared,
        type_key: &kiosk_key,
        bytes: &kiosk_bytes,
    };
    let custody = ownership::resolve(&[cap.clone(), kiosk.clone()], "0xgame").unwrap();
    assert_eq!(
        custody,
        vec![Custody::KioskOwned {
            kiosk: Id([6; 32]),
            owner: Addr([7; 32]),
            personal_cap: Some(Id([4; 32]))
        }]
    );
    let query = crate::graph::project(
        &crate::graph::CheckpointView {
            lamport_version: 2,
            ckpt: 1,
            ts_ms: 1,
            outputs: &[kiosk],
            deleted: &[],
            custody: &custody,
            market: &[],
            fight_lifecycle: &[],
        },
        "0xgame",
    )
    .unwrap()
    .join("\n");
    assert!(query.contains(&Addr([7; 32]).hex()));
    assert!(!query.contains(&Addr([88; 32]).hex()));
    let marker_key = marker_type(PACKAGES[0]);
    let marker_bytes = bcs::to_bytes(&Field {
        id: Id([9; 32]),
        name: false,
        value: Addr([10; 32]),
    })
    .unwrap();
    let marker = ObjView {
        id: Id([9; 32]),
        version: 1,
        owner: OwnerKind::Object(Id([6; 32])),
        type_key: &marker_key,
        bytes: &marker_bytes,
    };
    assert!(owners([&cap, &marker]).is_err());
}
