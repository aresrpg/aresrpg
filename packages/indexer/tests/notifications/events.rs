use super::*;
use crate::decode::{
    Addr, DungeonTag, DynamicObjectFieldWrapper, Field, Item, KioskItemKey, RolledDrop, RolledStats,
};
use crate::ownership::{OwnerKind, TypeKey, SUI_FRAMEWORK};

mod fixture;
use fixture::*;

#[test]
fn rare_gathering_is_one_confirmed_event_with_the_actual_finder() {
    let bytes =
        bcs::to_bytes(&("nauvis", 1u32, 2u32, Addr([7; 32]), "wheat", "golden_wheat")).unwrap();
    let events = [event("gathering", "RareGathered", &bytes)];
    let tx = TxView {
        tx_index: 0,
        sender: Addr([99; 32]),
        move_calls: &[],
        inputs: &[],
        outputs: &[],
        deleted: &[],
        events: &events,
    };
    let rows = extract(12, 1000, &tx, "digest", GAME).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["address"], Addr([7; 32]).hex());
    assert_eq!(rows[0]["item_type"], "golden_wheat");
    assert_eq!(rows[0]["id"], "12:0:0:event");
}

#[test]
fn boss_victory_is_one_party_card_and_never_a_defeat_or_ordinary_room() {
    let mut boss = fight(1, &[7, 7, 8, 9], 1);
    boss.dungeon = Some(DungeonTag {
        dungeon: "gilded_lorito".into(),
        room: 7,
    });
    boss.rewards.weight = 20;
    boss.combat.fighters[3].forfeited = true;
    let object = fight_object(&boss);
    let bytes = bcs::to_bytes(&(boss.id, "nauvis", 1u32, 2u32, Some(0u8))).unwrap();
    let events = [event("fight", "FightEnded", &bytes)];
    let views = [view(&object)];
    let tx = TxView {
        tx_index: 0,
        sender: Addr([7; 32]),
        move_calls: &[],
        inputs: &views,
        outputs: &views,
        deleted: &[],
        events: &events,
    };
    let rows = extract(12, 1000, &tx, "digest", GAME).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0]["winners"],
        json!([Addr([7; 32]).hex(), Addr([8; 32]).hex()])
    );
    assert!(victory(&tx, GAME, boss.id, Some(1)).unwrap().is_none());
    boss.rewards.weight = 0;
    let ordinary = fight_object(&boss);
    assert!(victory(
        &TxView {
            inputs: &[],
            outputs: &[view(&ordinary)],
            ..tx
        },
        GAME,
        boss.id,
        Some(0)
    )
    .unwrap()
    .is_none());
}

#[test]
fn gear_requires_settlement_budget_new_identity_natural_stats_and_personal_custody() {
    let mut before = fight(1, &[7], 1);
    before.drops_rolled = true;
    before.combat.fighters[0].drops = vec![RolledDrop {
        item_type: "lorito_hat__golden".into(),
        qty: 1,
    }];
    let mut after = before.clone();
    after.combat.fighters[0].settled = true;
    after.combat.fighters[0].drops.clear();
    let before = fight_object(&before);
    let after = fight_object(&after);
    let item = Item {
        id: Id([20; 32]),
        template: Id([21; 32]),
        name: "Golden Lorito Hood".into(),
        item_type: "lorito_hat__golden".into(),
        category: "hat".into(),
        level: 16,
        amount: 1,
    };
    let item_object = object(item.id, "item", "Item", &item);
    let wrapper = object(
        Id([22; 32]),
        "dynamic_field",
        "Field",
        &Field {
            id: Id([22; 32]),
            name: DynamicObjectFieldWrapper {
                name: KioskItemKey { id: item.id },
            },
            value: item.id,
        },
    );
    let wrapper_type = TypeKey {
        package: SUI_FRAMEWORK.into(),
        module: "dynamic_field".into(),
        name: "Field".into(),
        type_params: vec![
            format!("{SUI_FRAMEWORK}::dynamic_object_field::Wrapper<{SUI_FRAMEWORK}::kiosk::Item>"),
            "0x2::object::ID".into(),
        ],
    };
    let owner = object(
        Id([23; 32]),
        "dynamic_field",
        "Field",
        &Field {
            id: Id([23; 32]),
            name: false,
            value: Addr([7; 32]),
        },
    );
    let owner_type = TypeKey {
        package: SUI_FRAMEWORK.into(),
        module: "dynamic_field".into(),
        name: "Field".into(),
        type_params: vec![
            format!(
                "{}::personal_kiosk::OwnerMarker",
                crate::personal_kiosk::PACKAGES[0]
            ),
            "address".into(),
        ],
    };
    let statistics = serde_json::from_value(json!({ "vitality": 32817, "wisdom":32768,"strength":32768,"intelligence":32816,"chance":32768,"agility":32768,"range":32768,"movement":32768,"action":32768,"critical":32770,"raw_damage":32768,"earth_resistance":32768,"fire_resistance":32768,"water_resistance":32768,"air_resistance":32768 })).unwrap();
    let stats = object(
        Id([24; 32]),
        "dynamic_field",
        "Field",
        &Field {
            id: Id([24; 32]),
            name: false,
            value: RolledStats {
                statistics,
                puits: 0,
                revision: 0,
            },
        },
    );
    let stats_type = TypeKey {
        package: SUI_FRAMEWORK.into(),
        module: "dynamic_field".into(),
        name: "Field".into(),
        type_params: vec![
            format!("{GAME}::item::StatsKey"),
            format!("{GAME}::item::RolledStats"),
        ],
    };
    let inputs = [
        view(&before),
        ObjView {
            type_key: &owner_type,
            owner: OwnerKind::Object(Id([25; 32])),
            ..view(&owner)
        },
    ];
    let outputs = [
        view(&after),
        ObjView {
            owner: OwnerKind::Object(wrapper.id),
            ..view(&item_object)
        },
        ObjView {
            type_key: &wrapper_type,
            owner: OwnerKind::Object(Id([25; 32])),
            ..view(&wrapper)
        },
        ObjView {
            type_key: &stats_type,
            owner: OwnerKind::Object(item.id),
            ..view(&stats)
        },
    ];
    let tx = TxView {
        tx_index: 0,
        sender: Addr([7; 32]),
        move_calls: &[],
        inputs: &inputs,
        outputs: &outputs,
        deleted: &[],
        events: &[],
    };
    let rows = crate::notification_loot::extract(12, &tx, GAME).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["stats"]["vitality"], 49);
    assert_eq!(rows[0]["address"], Addr([7; 32]).hex());
    assert!(crate::notification_loot::extract(
        12,
        &TxView {
            sender: Addr([8; 32]),
            ..tx.clone()
        },
        GAME
    )
    .unwrap()
    .is_empty());
    assert!(crate::notification_loot::extract(
        12,
        &TxView {
            inputs: &inputs[..1],
            ..tx.clone()
        },
        GAME
    )
    .unwrap()
    .is_empty());
    // First settlement carries the budget in DropsRolled rather than pre-state.
    let mut first: Fight = decode::from_bytes(&before.bytes).unwrap();
    first.drops_rolled = false;
    first.combat.fighters[0].drops.clear();
    let first = fight_object(&first);
    let first_inputs = [view(&first), inputs[1].clone()];
    let rolled = bcs::to_bytes(&(
        Id([1; 32]),
        0u64,
        vec![RolledDrop {
            item_type: item.item_type.clone(),
            qty: 1,
        }],
        0u64,
    ))
    .unwrap();
    let rolled_event = [event("fight", "DropsRolled", &rolled)];
    assert_eq!(
        crate::notification_loot::extract(
            12,
            &TxView {
                inputs: &first_inputs,
                events: &rolled_event,
                ..tx.clone()
            },
            GAME
        )
        .unwrap()
        .len(),
        1
    );
    assert!(crate::notification_loot::extract(
        12,
        &TxView {
            inputs: &first_inputs,
            ..tx.clone()
        },
        GAME
    )
    .unwrap()
    .is_empty());
    // A last settlement retires the Fight and returns its Character; an untouched Fight is not a claim.
    let character = object(Id([10; 32]), "character", "Character", &());
    let mut retired = outputs[1..].to_vec();
    retired.push(view(&character));
    assert_eq!(
        crate::notification_loot::extract(
            12,
            &TxView {
                outputs: &retired,
                ..tx.clone()
            },
            GAME
        )
        .unwrap()
        .len(),
        1
    );
    assert!(crate::notification_loot::extract(
        12,
        &TxView {
            outputs: &outputs[1..],
            ..tx.clone()
        },
        GAME
    )
    .unwrap()
    .is_empty());
    // Forging in the same transaction is not a natural loot roll.
    let mut forged: Field<bool, RolledStats> = decode::from_bytes(&stats.bytes).unwrap();
    forged.value.revision = 1;
    let forged = object(stats.id, "dynamic_field", "Field", &forged);
    let mut modified = outputs.to_vec();
    modified[3].bytes = &forged.bytes;
    assert!(crate::notification_loot::extract(
        12,
        &TxView {
            outputs: &modified,
            ..tx.clone()
        },
        GAME
    )
    .unwrap()
    .is_empty());
    let mut existing = inputs.to_vec();
    existing.push(outputs[1].clone());
    assert!(crate::notification_loot::extract(
        12,
        &TxView {
            inputs: &existing,
            ..tx.clone()
        },
        GAME
    )
    .unwrap()
    .is_empty());
    let mut extra = item.clone();
    extra.id = Id([26; 32]);
    let extra_object = object(extra.id, "item", "Item", &extra);
    // An unowned extra mint does not make it the player's loot.
    let mut more = outputs.to_vec();
    more.push(view(&extra_object));
    assert_eq!(
        crate::notification_loot::extract(
            12,
            &TxView {
                outputs: &more,
                ..tx
            },
            GAME
        )
        .unwrap()
        .len(),
        1
    );
}
