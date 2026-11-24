// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The graph projection: custody, parent-guarded fields, transaction order, injection safety.

use super::*;
use crate::decode::{self, Field, KioskListingKey};
use crate::pipeline::OwnedObj;

fn listing(field: Id, kiosk: Id, object: Id, version: u64) -> OwnedObj {
    OwnedObj {
        version,
        ..obj(
            field,
            OwnerKind::Object(kiosk),
            super::field(&format!("{SUI_FRAMEWORK}::kiosk::Listing"), "u64"),
            &Field {
                id: field,
                name: KioskListingKey {
                    id: object,
                    is_exclusive: false,
                },
                value: 1_000u64,
            },
        )
    }
}

/// A transaction that writes these objects only.
fn writing(outputs: Vec<OwnedObj>) -> OwnedTx {
    OwnedTx { outputs, ..tx() }
}

fn position(cypher: &[&str], needle: &str) -> usize {
    cypher
        .iter()
        .position(|statement| statement.contains(needle))
        .unwrap_or_else(|| panic!("no statement contains {needle}: {cypher:#?}"))
}

#[test]
fn custody_keeps_one_ownership_edge() {
    let item_at = |owner| {
        obj(
            id(3),
            owner,
            game("item", "Item"),
            &decode::Item {
                id: id(3),
                template: id(4),
                name: "Sword".into(),
                item_type: "sword".into(),
                category: "weapon".into(),
                level: 1,
                amount: 1,
            },
        )
    };
    let claim = obj(
        id(20),
        OwnerKind::Address(addr(7)),
        game("loot_box", "BoxClaim"),
        &decode::BoxClaim {
            id: id(20),
            box_template: id(21),
            rolled_template: id(22),
            amount: 2,
        },
    );
    let crush = OwnedObj {
        id: id(23),
        type_key: game("forgemagie", "CrushClaim"),
        bytes: vec![],
        ..claim.clone()
    };
    let writes = run(&[OwnedTx {
        outputs: vec![
            // a fight seat replaces the character's standing edge
            character(id(1), OwnerKind::Object(id(6))),
            seat_wrapper(id(6), id(8), 2, id(1)),
            // an equipped item sits at its character's address: no wallet fact
            item_at(OwnerKind::Address(Addr(id(1).0))),
            // a foreign lookalike at an address never resolves
            OwnedObj {
                id: id(30),
                type_key: ty(&format!("0x{}", "bb".repeat(32)), "item", "Item", &[]),
                ..item_at(OwnerKind::Address(addr(7)))
            },
            claim,
            crush,
        ],
        ..tx()
    }]);
    let cypher = cypher(&writes);
    let seat = position(&cypher, "CREATE (f)-[:FIGHTER {seat: 2}]->(c)");
    assert!(cypher[seat - 1].contains(&format!(
        "MATCH (:Character {{id: '{}'}})<-[r:HOLDS|FIGHTER|EQUIPS]-() DELETE r",
        id(1).hex()
    )));
    assert!(!cypher
        .iter()
        .any(|statement| statement.contains("[:HOLDS]")));
    assert!(!cypher
        .iter()
        .any(|statement| statement.contains(&id(30).hex())));
    // Claims anchor their holder edge; readers need the roll and the id only.
    let box_claim = cypher[position(&cypher, "MERGE (v:BoxClaim")];
    assert!(box_claim.contains(&format!("v.rolled_template = '{}'", id(22).hex())));
    assert!(!box_claim.contains("box_template"));
    assert!(cypher.iter().any(|statement| statement
        .ends_with(&format!("{}'}}) SET v.ckpt = 100", id(23).hex()))
        && statement.starts_with("MERGE (v:CrushClaim")));
    assert!(cypher
        .iter()
        .any(|statement| statement.contains("CREATE (u)-[:HOLDS_CLAIM]->(n)")));
}

#[test]
fn dynamic_fields_write_only_their_typed_parent() {
    let hp = obj(
        id(9),
        OwnerKind::Object(id(1)),
        game_field("progression::HpKey"),
        &Field {
            id: id(9),
            name: false,
            value: decode::Hp {
                current: 137,
                last_ms: 5,
            },
        },
    );
    // Alone (equip/hp mutate only the child), the write is MATCH-guarded: a foreign or
    // unknown parent matches nothing.
    let lone = run(&[writing(vec![hp.clone()])]);
    let lone = cypher(&lone);
    assert_eq!(lone.len(), 1);
    assert!(lone[0].starts_with("MATCH (v:Character") && lone[0].contains("v.hp = '137'"));
    // Born with its parent, it merges order-free; the root version is certified last.
    let born = run(&[writing(vec![hp, character(id(1), OwnerKind::Shared)])]);
    let born = cypher(&born);
    assert!(born[position(&born, "v.hp = '137'")].contains("v.hp_ms = 5"));
    assert!(born[0].contains("v.version = NULL"));
    assert!(born.last().unwrap().contains("SET c.version = '1'"));
    assert_eq!(
        born.iter()
            .filter(|s| s.contains("SET c.version ="))
            .count(),
        1
    );

    // Only the current world's checkpoint owns the active anchor.
    let checkpoint = |field: u8, world: &str, x| {
        obj(
            id(field),
            OwnerKind::Object(id(1)),
            super::field(
                &format!("{GAME}::world::CheckpointKey"),
                &format!("{GAME}::world::Checkpoint"),
            ),
            &Field {
                id: id(field),
                name: decode::CheckpointKey(world.into()),
                value: decode::Checkpoint {
                    x,
                    z: 200,
                    at_ms: 300,
                    pet: false,
                },
            },
        )
    };
    let current = obj(
        id(8),
        OwnerKind::Object(id(1)),
        game_field("world::CurrentWorldKey"),
        &Field {
            id: id(8),
            name: false,
            value: "yakutia".to_string(),
        },
    );
    let lone = run(&[writing(vec![checkpoint(9, "nauvis", 100)])]);
    assert!(cypher(&lone)[0].contains("WHERE v.world = 'nauvis'"));
    let stale = run(&[writing(vec![checkpoint(9, "nauvis", 100), current.clone()])]);
    assert!(!cypher(&stale)
        .iter()
        .any(|s| s.contains("v.checkpoint_world")));
    let travel = run(&[writing(vec![checkpoint(7, "yakutia", 400), current])]);
    let travel = cypher(&travel);
    let active = travel[position(&travel, "v.checkpoint_world")];
    assert!(active.contains("v.checkpoint_world = 'yakutia'") && active.contains("v.x = 400"));
    assert!(!active.contains("WHERE v.world"));
}

#[test]
fn transaction_order_keeps_final_state() {
    // A listing that survives the transaction beats its consumed pre-state.
    let moved = listing(id(9), id(3), id(5), 2);
    let consumed = listing(id(9), id(2), id(5), 1);
    let writes = run(&[OwnedTx {
        inputs: vec![consumed.clone()],
        outputs: vec![moved],
        deleted: vec![consumed.clone()],
        ..tx()
    }]);
    let statements = cypher(&writes);
    assert!(statements
        .iter()
        .any(|s| s.contains("CREATE (o)-[:LISTED_IN")));
    assert!(statements.last().unwrap().contains("SET k.market_version"));
    // A deleted listing ends it under both labels; the wrong label matches nothing.
    let ended = run(&[OwnedTx {
        inputs: vec![consumed.clone()],
        deleted: vec![consumed],
        ..tx()
    }]);
    let ended = cypher(&ended);
    assert!(ended[0].contains(":Item") && ended[1].contains(":Character"));
    assert!(ended[..2]
        .iter()
        .all(|s| s.contains("[r:LISTED_IN]") && s.contains(&id(5).hex())));
    // A split lot exists before its listing edge, whatever order Sui returns them in; its
    // version stays a string above 2⁵³.
    let lot = OwnedObj {
        version: 9_007_199_254_740_993,
        ..obj(
            id(5),
            OwnerKind::Object(id(2)),
            game("item", "Item"),
            &decode::Item {
                id: id(5),
                template: id(4),
                name: "Wool".into(),
                item_type: "wooling_wool".into(),
                category: "resource".into(),
                level: 1,
                amount: 10,
            },
        )
    };
    let split = run(&[writing(vec![listing(id(9), id(2), id(5), 1), lot])]);
    let split = cypher(&split);
    let item = position(&split, "MERGE (v:Item");
    assert!(split[item].contains("v.version = '9007199254740993'"));
    assert!(item < position(&split, "CREATE (o)-[:LISTED_IN"));
}

#[test]
fn cypher_escaping_defuses_injection() {
    let mut hostile = fight(1, &[7], 0);
    hostile.world = "'}) DETACH DELETE (n) // \\".into();
    let named = OwnedObj {
        bytes: bcs(&decode::Character {
            name: "it's".into(),
            ..decode::from_bytes(&character(id(1), OwnerKind::Shared).bytes).unwrap()
        }),
        ..character(id(1), OwnerKind::Shared)
    };
    let writes = run(&[writing(vec![named, fight_obj(&hostile)])]);
    let statements = cypher(&writes);
    assert!(statements.iter().any(|s| s.contains("v.name = 'it\\'s'")));
    assert!(statements
        .iter()
        .any(|s| s.contains("v.world = '\\'}) DETACH DELETE (n) // \\\\'")));
}

#[test]
fn party_invites_match_never_mint_phantom_characters() {
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
    let writes = run(&[writing(vec![party])]);
    let edges = cypher(&writes)
        .into_iter()
        .filter(|s| s.contains("MEMBER_OF {order") || s.contains("[:INVITED]"))
        .collect::<Vec<_>>();
    assert_eq!(edges.len(), 2);
    // The chain never checks an invited id exists: only MATCH may name a character.
    for edge in edges {
        assert!(edge.contains("MATCH (c:Character") && !edge.contains("MERGE (c:Character"));
    }
}

#[test]
fn fight_clocks_and_results_are_object_deltas() {
    let mut placement = fight(1, &[7], 1);
    placement.combat.round = 0;
    placement.combat.ended = false;
    placement.combat.winner = None;
    let mut active = placement.clone();
    active.combat.round = 1;
    let ended = fight(1, &[7], 1);
    let clocks = |input: Option<&decode::Fight>, output: &decode::Fight| {
        let writes = run(&[OwnedTx {
            inputs: input.map(fight_obj).into_iter().collect(),
            outputs: vec![fight_obj(output)],
            ..tx()
        }]);
        let node = cypher(&writes)
            .into_iter()
            .find(|s| s.starts_with("MERGE (v:Fight"))
            .unwrap()
            .to_string();
        (
            node.contains("v.started_ms = 1000"),
            node.contains("v.ended_ms = 1000"),
        )
    };
    assert_eq!(clocks(None, &placement), (false, false));
    assert_eq!(clocks(Some(&placement), &active), (true, false));
    assert_eq!(clocks(Some(&active), &active), (false, false));
    assert_eq!(clocks(Some(&active), &ended), (false, true));
    // started and ended in one transaction
    assert_eq!(clocks(Some(&placement), &ended), (true, true));
    assert_eq!(clocks(Some(&ended), &ended), (false, false));

    // An ended fight's unsettled player seat is durable post-fight work for its owner.
    let writes = run(&[writing(vec![fight_obj(&ended)])]);
    let result = cypher(&writes)
        .into_iter()
        .find(|s| s.contains("CREATE (f)-[:RESULT_FOR"))
        .unwrap();
    assert!(result.contains(&addr(7).hex()) && result.contains("settled: false"));
    assert!(cypher(&writes)
        .iter()
        .any(|s| s.contains("v.phase = 'ended'")));
}

/// Kiosk `kiosk` with `items` objects and `profits` MIST, and its personal cap held by `addr(7)`.
fn personal_kiosk(kiosk: Id, items: u32, profits: u64) -> (OwnedObj, OwnedObj) {
    let object = obj(
        kiosk,
        OwnerKind::Shared,
        ty(SUI_FRAMEWORK, "kiosk", "Kiosk", &[]),
        &decode::Kiosk {
            id: kiosk,
            profits: decode::Balance { value: profits },
            owner: addr(7),
            item_count: items,
            allow_extensions: false,
        },
    );
    let cap = obj(
        id(40),
        OwnerKind::Address(addr(7)),
        ty(
            crate::personal_kiosk::PACKAGES[0],
            "personal_kiosk",
            "PersonalKioskCap",
            &[],
        ),
        &decode::PersonalKioskCap {
            id: id(40),
            cap: Some(decode::KioskOwnerCap {
                id: id(41),
                for_: kiosk,
            }),
        },
    );
    (object, cap)
}

/// Statements that name `kiosk`, with the index of each in the checkpoint.
fn naming(writes: &[Write], kiosk: Id) -> Vec<(usize, String)> {
    cypher(writes)
        .into_iter()
        .enumerate()
        .filter(|(_, statement)| statement.contains(&kiosk.hex()))
        .map(|(index, statement)| (index, statement.to_string()))
        .collect()
}

#[test]
fn only_game_related_kiosks_reach_the_graph() {
    // A foreign personal kiosk, its cap and its profits: nothing may create a node or edge.
    let (foreign, cap) = personal_kiosk(id(30), 3, 500);
    let writes = run(&[OwnedTx {
        outputs: vec![foreign.clone(), cap.clone()],
        ..tx()
    }]);
    let named = naming(&writes, id(30));
    assert!(!named.is_empty());
    assert!(
        named.iter().all(|(_, s)| s.starts_with("MATCH (")),
        "{named:#?}"
    );
    // Every statement is guarded by an existing node: no Kiosk, User or OWNS is created.
    assert!(cypher(&writes).iter().all(|s| s.starts_with("MATCH (")));

    // Created empty, then receiving a game item in a later transaction of the same checkpoint
    // (or a later checkpoint): the relation creates the node, and that transaction's kiosk
    // facts (profits, owner, personal cap) land on it after it exists.
    let held = OwnedTx {
        inputs: vec![cap.clone(), foreign.clone()],
        outputs: vec![
            personal_kiosk(id(30), 4, 500).0,
            character(id(5), OwnerKind::Object(id(6))),
            kiosk_wrapper(id(6), id(30), id(5)),
        ],
        ..tx()
    };
    let created = OwnedTx {
        outputs: vec![foreign, cap],
        ..tx()
    };
    for txs in [vec![created.clone(), held.clone()], vec![held]] {
        let writes = run(&txs);
        let named = naming(&writes, id(30));
        let first_write = named
            .iter()
            .find(|(_, s)| !s.starts_with("MATCH (k:Kiosk") && !s.starts_with("MATCH (v:Kiosk"))
            .unwrap();
        assert!(
            first_write.1.contains("CREATE (k)-[:HOLDS]->(o)"),
            "{named:#?}"
        );
        let after = |needle: &str| {
            named
                .iter()
                .any(|(index, s)| *index > first_write.0 && s.contains(needle))
        };
        assert!(after("v.profits = '500'"));
        assert!(after(&format!(
            "MERGE (u:User {{address: '{}'}})",
            addr(7).hex()
        )));
        assert!(after(&format!("SET k.personal_cap = '{}'", id(40).hex())));
    }
}
