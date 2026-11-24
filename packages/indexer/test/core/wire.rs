// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The live wire: every invalidation door, from object writes and certified events.

use super::*;
use crate::decode::{self, Balance};
use crate::pipeline::OwnedObj;

fn character_door(character: Id) -> String {
    format!("evt:character:{}", character.hex())
}

fn social_door(address: Addr) -> String {
    format!("evt:social:{}", address.hex())
}

fn item(object: Id, owner: OwnerKind) -> OwnedObj {
    obj(
        object,
        owner,
        game("item", "Item"),
        &decode::Item {
            id: object,
            template: id(200),
            name: "wool".into(),
            item_type: "wool".into(),
            category: "resource".into(),
            level: 1,
            amount: 1,
        },
    )
}

#[test]
fn object_writes_reach_their_holders_doors() {
    // An item under a holder streams; a destroyed kiosk item streams its removal.
    let writes = run(&[OwnedTx {
        outputs: vec![item(id(3), OwnerKind::Object(id(77)))],
        ..tx()
    }]);
    let (channel, written) = published(&writes).remove(0);
    assert_eq!(channel, "evt:economy");
    assert_eq!(written["type"], "ItemWritten");
    assert_eq!(written["data"]["version"], "1");
    assert_eq!(written["data"]["holder"], id(77).hex());
    let destroyed = OwnedTx {
        inputs: vec![
            item(id(3), OwnerKind::Object(id(4))),
            kiosk_wrapper(id(4), id(5), id(3)),
        ],
        ..tx()
    };
    let (_, removed) = published(&run(&[destroyed])).remove(0);
    assert_eq!(removed["type"], "ItemRemoved");
    assert_eq!(removed["data"]["holder"], id(5).hex());
    // An address-owned item is outside game custody: no holder, no stream.
    let loose = OwnedTx {
        outputs: vec![item(id(4), OwnerKind::Address(addr(8)))],
        ..tx()
    };
    assert!(published(&run(&[loose])).is_empty());

    // The Version object is the emergency brake: every process hears it.
    let frozen = OwnedTx {
        outputs: vec![obj(
            id(9),
            OwnerKind::Shared,
            game("version", "Version"),
            &decode::Version {
                id: id(9),
                version: 0,
            },
        )],
        ..tx()
    };
    let (channel, state) = published(&run(&[frozen])).remove(0);
    assert_eq!(channel, "evt:game");
    assert_eq!(state["type"], "GameStateChanged");
    assert_eq!(state["data"]["frozen"], true);
    assert_eq!(state["ckpt"], 100);

    // Plain giftcard transfers emit no event: both custodians hear it, a burn reaches one.
    let card = |owner| {
        obj(
            id(9),
            OwnerKind::Address(owner),
            game("distribution", "Giftcard"),
            &decode::Giftcard {
                id: id(9),
                template: id(1),
                amount: 1,
            },
        )
    };
    let transfer = OwnedTx {
        inputs: vec![card(addr(1))],
        outputs: vec![card(addr(2))],
        ..tx()
    };
    let writes = run(std::slice::from_ref(&transfer));
    assert_eq!(
        kinds_on(&writes, &social_door(addr(1))),
        ["GiftcardsChanged"]
    );
    assert_eq!(
        kinds_on(&writes, &social_door(addr(2))),
        ["GiftcardsChanged"]
    );
    let burn = OwnedTx {
        outputs: vec![],
        deleted: transfer.inputs.clone(),
        ..transfer
    };
    let writes = run(&[burn]);
    assert_eq!(published(&writes).len(), 1);
}

#[test]
fn social_objects_publish_full_state_invalidations() {
    let trade = obj(
        id(1),
        OwnerKind::Shared,
        game("trade", "Trade"),
        &decode::Trade {
            id: id(1),
            state: decode::TradeState {
                initiator: addr(7),
                invitee: addr(9),
                phase: decode::TradePhase::Requested,
                offer_revision: 0,
                initiator_accepted: false,
                invitee_accepted: false,
            },
            sui_a: Balance { value: 0 },
            sui_b: Balance { value: 0 },
            kares_a: Balance { value: 0 },
            kares_b: Balance { value: 0 },
            caps_a: vec![],
            caps_b: vec![],
        },
    );
    let friends = obj(
        id(2),
        OwnerKind::Address(addr(7)),
        game("friends", "FriendList"),
        &decode::FriendList {
            id: id(2),
            owner: addr(7),
            friends: decode::VecSet {
                contents: vec![addr(9)],
            },
        },
    );
    let party = obj(
        id(3),
        OwnerKind::Shared,
        game("party", "Party"),
        &decode::Party {
            id: id(3),
            members: vec![id(4)],
            pending: vec![id(5)],
        },
    );
    let writes = run(&[OwnedTx {
        outputs: vec![trade, friends, party],
        ..tx()
    }]);
    assert_eq!(
        kinds_on(&writes, &social_door(addr(7))),
        ["FriendListChanged", "TradeChanged"]
    );
    assert_eq!(kinds_on(&writes, &social_door(addr(9))), ["TradeChanged"]);
    assert_eq!(kinds_on(&writes, &character_door(id(4))), ["PartyJoined"]);
    assert_eq!(
        kinds_on(&writes, &character_door(id(5))),
        ["PartyInvitesChanged"]
    );
    assert_eq!(
        kinds_on(&writes, &format!("evt:party:{}", id(3).hex())),
        ["PartyJoined", "PartyInvitesChanged"]
    );
}

#[test]
fn custody_moves_reach_the_character_and_owner_doors() {
    // A fight's creator takes seat 0 at birth with no join event: custody is the witness.
    let seated = OwnedTx {
        outputs: vec![
            character(id(5), OwnerKind::Object(id(6))),
            seat_wrapper(id(6), id(1), 0, id(5)),
        ],
        ..tx()
    };
    let writes = run(&[seated]);
    assert_eq!(
        kinds_on(&writes, &character_door(id(5))),
        ["CharacterChanged", "CharacterSeated"]
    );
    let (_, payload) = published(&writes)
        .into_iter()
        .find(|(_, payload)| payload["type"] == "CharacterSeated")
        .unwrap();
    assert_eq!(payload["data"]["fight"], id(1).hex());
    assert_eq!(payload["data"]["seat"], 0);

    // A forfeit or settle re-locks it: the return reaches the character and its owner.
    let returned = OwnedTx {
        inputs: vec![super::market::owner_marker()],
        outputs: vec![
            character(id(5), OwnerKind::Object(id(6))),
            kiosk_wrapper(id(6), id(2), id(5)),
            item(id(9), OwnerKind::Object(id(8))),
            kiosk_wrapper(id(8), id(2), id(9)),
        ],
        ..tx()
    };
    let writes = run(&[returned]);
    assert_eq!(
        kinds_on(&writes, &character_door(id(5))),
        ["CharacterChanged", "CharacterHeld"]
    );
    assert_eq!(kinds_on(&writes, &social_door(addr(9))), ["CharacterHeld"]);
    // An item moving between kiosks is inventory, never a character-door fact.
    assert!(kinds_on(&writes, &character_door(id(9))).is_empty());
}

#[test]
fn certified_events_route_to_their_doors_and_foreign_events_stay_data() {
    let started = game_event(
        "fight",
        "FightStarted",
        &(
            id(1),
            "01_first_shore".to_string(),
            49_986u32,
            49_998u32,
            vec![1u64, 0],
        ),
    );
    let seed = game_event("fight", "TurnSeedUsed", &(id(1), 0u64, 7u64));
    let created = game_event(
        "kolizeum",
        "KolizeumCreated",
        &(id(31), id(32), 10u64, 3u64),
    );
    let lobby = obj(
        id(31),
        OwnerKind::Shared,
        game("kolizeum", "Kolizeum"),
        &decode::Kolizeum {
            id: id(31),
            pot: Balance { value: 10 },
            pledge: 10,
            fight: id(32),
            format: 3,
            level_min: 1,
            level_max: 50,
            allowed: None,
        },
    );
    let foreign = OwnedEvent {
        package: format!("0x{}", "ee".repeat(32)),
        ..game_event("fight", "FightEnded", &[1u8, 2, 3])
    };
    let unknown = game_event("evil", "Injected", &[1u8, 2, 3]);
    let writes = run(&[OwnedTx {
        events: vec![started, seed, created, foreign, unknown],
        outputs: vec![lobby],
        ..tx()
    }]);
    let fight = format!("evt:fight:{}", id(1).hex());
    assert_eq!(kinds_on(&writes, &fight), ["FightStarted", "TurnSeedUsed"]);
    // The zone's bystanders hear the start through its anchor; u64 stays a string.
    let (_, start) = published(&writes)
        .into_iter()
        .find(|(channel, _)| channel == "evt:zone:01_first_shore:97:97")
        .unwrap();
    assert_eq!(start["data"]["queue"], serde_json::json!(["1", "0"]));
    // The lobby write and its receipt make ONE directory invalidation.
    assert_eq!(kinds_on(&writes, "evt:kolizeum"), ["KolizeumChanged"]);
    // A known game event with the wrong bytes is layout drift, never noise.
    let broken = game_event("fight", "FightEnded", &[0xFFu8]);
    assert!(try_run(&[OwnedTx {
        events: vec![broken],
        ..tx()
    }])
    .is_err());
}

#[test]
fn character_changes_deletions_and_dungeon_runs_invalidate_once() {
    // Testnet Field<CheckpointKey, Checkpoint>, 0xa75ea0…f46a @ v981006460,
    // character 0x1c493b…7d69, captured 2026-08-19.
    let checkpoint = OwnedObj {
        id: id(2),
        version: 981_006_460,
        owner: OwnerKind::Object(id(1)),
        type_key: field(
            &format!("{GAME}::world::CheckpointKey"),
            &format!("{GAME}::world::Checkpoint"),
        ),
        bytes: captured(&[
            "a75ea0140fd96747a34866269e67d55496baf09cabcff5d7d140176f240bf46a",
            "0e30315f66697273745f73686f7265",
            "50c3000050c3000070dde70ea001000000",
        ]),
    };
    let root = character(id(1), OwnerKind::Object(id(9)));
    let changed = OwnedTx {
        outputs: vec![root.clone(), checkpoint.clone()],
        ..tx()
    };
    let writes = run(&[changed]);
    assert_eq!(
        kinds_on(&writes, &character_door(id(1))),
        ["CharacterChanged"]
    );
    // Unchanged bytes are silent.
    let unchanged = OwnedTx {
        inputs: vec![root.clone(), checkpoint.clone()],
        outputs: vec![root.clone(), checkpoint],
        ..tx()
    };
    assert!(kinds_on(&run(&[unchanged]), &character_door(id(1))).is_empty());
    // Certified destruction invalidates the roster; a surviving output does not.
    let deleted = OwnedTx {
        inputs: vec![root.clone()],
        deleted: vec![root.clone()],
        ..tx()
    };
    assert_eq!(
        kinds_on(&run(&[deleted]), &character_door(id(1))),
        ["CharacterDeleted"]
    );

    // A dungeon run write and its deletion reach the lobby and the character.
    let run_field = obj(
        id(44),
        OwnerKind::Object(id(5)),
        game_field("dungeon::DungeonRunKey"),
        &decode::Field {
            id: id(44),
            name: false,
            value: decode::DungeonRun {
                dungeon: "tangled_aftermath".into(),
                room: 2,
                seed: 88,
            },
        },
    );
    let written = OwnedTx {
        outputs: vec![run_field.clone()],
        ..tx()
    };
    let ended = OwnedTx {
        inputs: vec![run_field.clone()],
        deleted: vec![run_field],
        ..tx()
    };
    for scenario in [written, ended] {
        let writes = run(&[scenario]);
        assert_eq!(
            kinds_on(&writes, "evt:dungeon:tangled_aftermath"),
            ["DungeonLobbyChanged"]
        );
        assert_eq!(
            kinds_on(&writes, &character_door(id(5))),
            ["CharacterChanged"]
        );
    }
}
