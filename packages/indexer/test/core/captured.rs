// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Wire decoding against CAPTURED payloads (L-D4): a self-round-trip proves nothing.
//! Each case names its object, version and capture date beside the bytes.

use super::*;
use crate::decode::{self, Balance, Field, MarkerKey};
use crate::pipeline::OwnedObj;

fn hex_id(hex: &str) -> Id {
    Id(hex::decode(hex.trim_start_matches("0x"))
        .unwrap()
        .try_into()
        .unwrap())
}

#[test]
fn captured_character_root_decodes() {
    // Live testnet capture: character 0x1c493b…7d69 @ version 981006460,
    // transaction EDhfar…Kaq6, captured 2026-08-19.
    let bytes = captured(&[
        "1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69",
        "0573636561740579616a696e046d616c6500000000000000000100fd8e4900ff",
        "7d1a003de5ff0000000000000000000000000000000000",
    ]);
    let chr: decode::Character = decode::from_bytes(&bytes).unwrap();
    assert_eq!(
        chr.id.hex(),
        "0x1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69"
    );
    assert_eq!((chr.name.as_str(), chr.classe.as_str()), ("sceat", "yajin"));
    assert_eq!(
        (chr.sex.as_str(), chr.experience, chr.level),
        ("male", 0, 1)
    );
    // The colours are the only non-zero numerics: a field-order slip reads as garbage here.
    assert_eq!(
        (chr.color_1, chr.color_2, chr.color_3),
        (4_820_733, 1_736_191, 16_770_365)
    );
    assert_eq!(
        (chr.vitality, chr.agility, chr.available_spell_points),
        (0, 0, 0)
    );
}

#[test]
fn captured_marker_and_positional_keys_decode() {
    // Field<progression::HpKey, Hp> 0xe3c352…d722 @ v981006460 of character 0x1c493b…7d69,
    // captured 2026-08-19. `HpKey()` has no fields: the wire carries one hidden
    // `dummy_field: bool` between id and value.
    let hp = captured(&[
        "e3c35270cf3c66c5af75fbc7d2241aed272bf10f4c7ca11f8cc2db4b1897d722",
        "00",
        "3700000000000000",
        "70dde70ea0010000",
    ]);
    let field: Field<MarkerKey, decode::Hp> = decode::from_bytes(&hp).unwrap();
    assert!(!field.name);
    assert_eq!(
        (field.value.current, field.value.last_ms),
        (55, 1_786_956_471_664)
    );
    // Field<world::CheckpointKey, Checkpoint> 0xa75ea0…f46a @ v981006460, same character
    // and date. A positional single-field key gets no extra framing: the bare string.
    let checkpoint = captured(&[
        "a75ea0140fd96747a34866269e67d55496baf09cabcff5d7d140176f240bf46a",
        "0e30315f66697273745f73686f7265",
        "50c3000050c3000070dde70ea001000000",
    ]);
    let field: Field<decode::CheckpointKey, decode::Checkpoint> =
        decode::from_bytes(&checkpoint).unwrap();
    assert_eq!(field.name.0, "01_first_shore");
    assert_eq!((field.value.x, field.value.z), (50_000, 50_000));
    assert!(!field.value.pet);
}

#[test]
fn captured_rolled_stats_decode_and_truncation_fails() {
    let (fixture, bytes) = fixture(include_str!("../../tests/rolled_stats.localnet.json"));
    let field: Field<MarkerKey, decode::RolledStats> = decode::from_bytes(&bytes).unwrap();
    assert_eq!(field.id.hex(), fixture["provenance"]["object_id"]);
    assert_eq!(field.value.statistics.strength, 32772);
    assert_eq!(field.value.statistics.wisdom, 32779);
    assert_eq!((field.value.puits, field.value.revision), (60, 5));
    // A twin that leaves bytes unread, or runs out of them, has the wrong layout.
    let short = &bytes[..bytes.len() - 1];
    assert!(decode::from_bytes::<Field<MarkerKey, decode::RolledStats>>(short).is_err());
    let long = [bytes.as_slice(), &[0xFF]].concat();
    assert!(decode::from_bytes::<Field<MarkerKey, decode::RolledStats>>(&long).is_err());
}

#[test]
fn captured_trade_tokens_field_keeps_settling_parent() {
    // Real testnet objects captured 2026-10-02; the fixture pins ids, versions and bytes.
    let capture: Value =
        serde_json::from_str(include_str!("../fixtures/trade_tokens.testnet.json")).unwrap();
    let row = |index: usize| &capture["objects"][index];
    let bytes = |index: usize| hex::decode(row(index)["bcs"].as_str().unwrap()).unwrap();
    let trade: decode::Trade = decode::from_bytes(&bytes(0)).unwrap();
    assert_eq!(trade.id.hex(), row(0)["object_id"]);
    let value_type = row(1)["type"]
        .as_str()
        .unwrap()
        .strip_prefix(&format!(
            "{SUI_FRAMEWORK}::dynamic_field::Field<vector<u8>,"
        ))
        .unwrap()
        .strip_suffix('>')
        .unwrap()
        .to_string();
    let parent = OwnedObj {
        id: trade.id,
        version: 1_037_886_856,
        owner: OwnerKind::Shared,
        type_key: game("trade", "Trade"),
        bytes: bytes(0),
    };
    let child = OwnedObj {
        id: hex_id(row(1)["object_id"].as_str().unwrap()),
        version: 1_037_886_856,
        owner: OwnerKind::Object(trade.id),
        type_key: field("vector<u8>", &value_type),
        bytes: bytes(1),
    };
    // A child-only write keeps its read-only parent: the balances land, both parties hear it.
    let writes = run(&[OwnedTx {
        sender: trade.state.initiator,
        inputs: vec![parent.clone()],
        outputs: vec![child.clone()],
        ..tx()
    }]);
    assert!(cypher(&writes).contains(&format!(
        "MATCH (v:Trade {{id: '{}'}}) SET v.token_a = '123000000000', v.token_b = '0', v.ckpt = 100",
        trade.id.hex()
    )
    .as_str()));
    for party in [trade.state.initiator, trade.state.invitee] {
        assert_eq!(
            kinds_on(&writes, &format!("evt:social:{}", party.hex())),
            ["TradeChanged"]
        );
    }
    // A deleted child clears the balances; a certified parent deletion destroys the trade.
    let closed = run(&[OwnedTx {
        inputs: vec![parent.clone(), child.clone()],
        deleted: vec![parent.clone(), child.clone()],
        ..tx()
    }]);
    assert!(cypher(&closed)
        .iter()
        .any(|s| s.contains("v.token_a = '0', v.token_b = '0'")));
    assert!(kinds_on(
        &closed,
        &format!("evt:social:{}", trade.state.invitee.hex())
    )
    .contains(&"TradeDestroyed".to_string()));
    // SECURITY: a foreign lookalike parent is never decoded, even with garbage bytes.
    let foreign = OwnedObj {
        type_key: ty(&format!("0x{}", "ee".repeat(32)), "trade", "Trade", &[]),
        ..parent
    };
    let garbage = OwnedObj {
        bytes: vec![255],
        ..child
    };
    let writes = run(&[OwnedTx {
        inputs: vec![foreign],
        outputs: vec![garbage],
        ..tx()
    }]);
    assert!(!cypher(&writes).iter().any(|s| s.contains(":Trade")));
}

#[test]
fn captured_personal_kiosk_marker_and_two_hop_custody() {
    let kiosk = hex_id("77a7927ddf70d1642cd27cfe220c162383d9fdd891a56792d061aec6c878bb92");
    let character_id = hex_id("1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69");
    // Testnet owner marker 0xeb5a…a878 @ v981006460, captured 2026-09-08 via gRPC.
    let marker_bytes = captured(&[
        "eb5ae9f66a12c2bbf7ae66dd17f0a46beb18ae86e38a5ceadf72c82b02b2a87800",
        "3d1342fb7de99c69ce821183bcfc5b6374d81453bf5ca9bf7e383e75b3722983",
    ]);
    let marker_type = |package: &str| {
        field(
            &format!("{package}::personal_kiosk::OwnerMarker"),
            "address",
        )
    };
    let marker = OwnedObj {
        id: Id(marker_bytes[..32].try_into().unwrap()),
        version: 981_006_460,
        owner: OwnerKind::Object(kiosk),
        type_key: marker_type(crate::personal_kiosk::PACKAGES[0]),
        bytes: marker_bytes,
    };
    // Kiosk item wrapper 0x759406…a07f @ v981006460, transaction EDhfar…Kaq6, captured
    // 2026-08-17: the two-hop walk from the character to its kiosk.
    let wrapper = OwnedObj {
        id: hex_id("759406de53dc0570802d762b4ae48ab88580b32c8c4a3ce7d119908cf77fa07f"),
        bytes: captured(&[
            "759406de53dc0570802d762b4ae48ab88580b32c8c4a3ce7d119908cf77fa07f",
            "1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69",
            "1c493b5be7919d5f459854bd49beea436514b5f5c0501d4d4c8b9db11e967d69",
        ]),
        version: 981_006_460,
        ..kiosk_wrapper(id(0), kiosk, character_id)
    };
    let owner = "0x3d1342fb7de99c69ce821183bcfc5b6374d81453bf5ca9bf7e383e75b3722983";
    let writes = run(&[OwnedTx {
        inputs: vec![marker.clone()],
        outputs: vec![
            character(character_id, OwnerKind::Object(wrapper.id)),
            wrapper,
        ],
        ..tx()
    }]);
    let cypher = cypher(&writes);
    assert!(cypher.iter().any(|s| s.contains(&format!(
        "MATCH (o:Character {{id: '{}'}}) MERGE (k:Kiosk {{id: '{}'}}) CREATE (k)-[:HOLDS]->(o)",
        character_id.hex(),
        kiosk.hex()
    ))));
    assert!(cypher
        .iter()
        .any(|s| s.contains(&format!("MERGE (u:User {{address: '{owner}'}})"))));
    assert!(cypher
        .iter()
        .any(|s| s.contains(&format!("SET c.owner = '{owner}'"))));
    assert_eq!(
        kinds_on(&writes, &format!("evt:social:{owner}")),
        ["CharacterHeld"]
    );
    // An attacker's lookalike marker package proves no owner.
    let forged = OwnedObj {
        type_key: marker_type("0xattacker"),
        ..marker
    };
    let writes = run(&[OwnedTx {
        inputs: vec![forged],
        ..tx()
    }]);
    assert!(!super::cypher(&writes).iter().any(|s| s.contains(owner)));
}

#[test]
fn spoofed_kiosk_owner_and_disagreeing_seller_proofs_fail() {
    // The cosmetic `Kiosk.owner` (88) is display metadata: the immutable cap owns the graph.
    let cap = obj(
        id(4),
        OwnerKind::Address(addr(7)),
        ty(
            crate::personal_kiosk::PACKAGES[0],
            "personal_kiosk",
            "PersonalKioskCap",
            &[],
        ),
        &decode::PersonalKioskCap {
            id: id(4),
            cap: Some(decode::KioskOwnerCap {
                id: id(5),
                for_: id(6),
            }),
        },
    );
    let kiosk = obj(
        id(6),
        OwnerKind::Shared,
        ty(SUI_FRAMEWORK, "kiosk", "Kiosk", &[]),
        &decode::Kiosk {
            id: id(6),
            profits: Balance { value: 10 },
            owner: addr(88),
            item_count: 0,
            allow_extensions: false,
        },
    );
    let writes = run(&[OwnedTx {
        inputs: vec![cap.clone()],
        outputs: vec![kiosk],
        ..tx()
    }]);
    let query = cypher(&writes).join("\n");
    assert!(query.contains(&addr(7).hex()) && !query.contains(&addr(88).hex()));
    assert!(query.contains(&format!("SET k.personal_cap = '{}'", id(4).hex())));
    // A marker naming another owner for the same kiosk refuses the checkpoint.
    let marker = obj(
        id(9),
        OwnerKind::Object(id(6)),
        field(
            &format!(
                "{}::personal_kiosk::OwnerMarker",
                crate::personal_kiosk::PACKAGES[0]
            ),
            "address",
        ),
        &Field {
            id: id(9),
            name: false,
            value: addr(10),
        },
    );
    assert!(try_run(&[OwnedTx {
        inputs: vec![cap, marker],
        ..tx()
    }])
    .is_err());
}

#[tokio::test]
async fn captured_checkpoints_decode_through_framework() {
    use sui_indexer_alt_framework::pipeline::Processor;
    use sui_indexer_alt_framework::types::transaction::{
        CallArg, TransactionData, TransactionKind, WithdrawFrom,
    };
    // Testnet checkpoint 390188580, captured 2026-10-02: Sui 1.74 rejected the allowance
    // withdrawal at enum variant 2 before projection could run.
    let wire: Value =
        serde_json::from_str(include_str!("../fixtures/checkpoint_wire.testnet.json")).unwrap();
    let bytes = hex::decode(wire["bcs"].as_str().unwrap()).unwrap();
    let transaction: TransactionData = bcs::from_bytes(&bytes).unwrap();
    assert_eq!(
        transaction.digest().to_string(),
        wire["digest"].as_str().unwrap()
    );
    let TransactionData::V1(transaction) = transaction;
    let TransactionKind::ProgrammableTransaction(ptb) = transaction.kind else {
        panic!("expected a PTB")
    };
    assert!(ptb.inputs.iter().any(|input| matches!(input,
        CallArg::FundsWithdrawal(withdrawal) if matches!(withdrawal.withdraw_from, WithdrawFrom::SenderAllowance { .. })
    )));

    // Mainnet checkpoint 330185168, captured 2026-10-04 from
    // https://checkpoints.mainnet.sui.io/330185168.binpb.zst: the deployed decoder stalled here
    // with transaction.bcs enum variant 3. It now decodes and lifts through the one pipeline.
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("test/fixtures");
    let store = std::sync::Arc::new(
        object_store::local::LocalFileSystem::new_with_prefix(fixtures).unwrap(),
    );
    let client =
        sui_indexer_alt_framework::ingestion::store_client::StoreIngestionClient::new(store, None);
    let checkpoint = std::sync::Arc::new(client.checkpoint(330185168).await.unwrap());
    assert!(!checkpoint.transactions.is_empty());
    let handler = AresHandler::new(GAME, GAME, &[GAME.to_string()]).unwrap();
    let batch = handler.process(&checkpoint).await.unwrap();
    assert_eq!(batch[0].sequence_number, 330185168);
    let Some(Write::SetKey { value, .. }) = batch[0].writes.last() else {
        panic!("the checkpoint marker is the last write")
    };
    assert_eq!(
        serde_json::from_str::<Value>(value).unwrap()["sequence_number"],
        330185168
    );
}

#[test]
fn captured_tournament_objects_project_prizes_and_refunds() {
    let load = |json: &str| {
        let fixture: Value = serde_json::from_str(json).unwrap();
        (
            hex::decode(fixture["bcs"].as_str().unwrap()).unwrap(),
            fixture,
        )
    };
    // Local-chain object 0x481f8c…cf7c @ v70396, captured 2026-10-24 after two real
    // registrations, a donation, the start and the Fight opening.
    let (running, _) = load(include_str!("../fixtures/tournament.localnet.json"));
    let t: decode::Tournament = decode::from_bytes(&running).unwrap();
    assert_eq!(
        (t.name.as_str(), t.status.as_str()),
        ("Captured cup", "in_progress")
    );
    assert_eq!(
        (t.sui.value, t.sui_total, t.kares_pool),
        (2_000_000_001, 2_000_000_001, None)
    );
    assert_eq!(t.teams[0].seats[0].owner, t.organizer);
    assert_eq!(
        (t.matches[0].a, t.matches[0].b, t.matches[0].state),
        (Some(1), Some(0), 1)
    );
    assert_eq!(
        t.fights[0].unwrap().hex(),
        "0x63d24b6611e0ffb60ffdf0dccae42e25d46e0bcc3ffa46d59b071df0e87181b7"
    );
    assert_eq!((t.rewards[0].place, t.rewards[0].amount), (1, 2));
    // Money and claim masks never cross JavaScript as numbers.
    let mut huge = t.clone();
    huge.sui.value = u64::MAX;
    huge.teams[0].seats[0].items_claimed = u64::MAX;
    let row = crate::tournament::row(&huge, u64::MAX);
    assert_eq!(row["sui_pool"], u64::MAX.to_string());
    assert_eq!(
        row["teams"][0]["seats"][0]["items_claimed"],
        u64::MAX.to_string()
    );
    assert_eq!(row["version"], u64::MAX.to_string());
    // Prizes stay pending until each entitlement is claimed.
    let mut won = t.clone();
    won.status = "finished".into();
    assert!(!crate::tournament::pending(&won, 0, 0));
    won.teams[0].place = 1;
    assert!(crate::tournament::pending(&won, 0, 0));
    won.teams[0].seats[0].sui_claimed = true;
    assert!(crate::tournament::pending(&won, 0, 0));
    won.teams[0].seats[0].items_claimed = 1;
    assert!(!crate::tournament::pending(&won, 0, 0));
    // The running object projects its row, registrations and match link.
    let object = OwnedObj {
        id: t.id,
        version: 70_396,
        owner: OwnerKind::Shared,
        type_key: game("tournament", "Tournament"),
        bytes: running,
    };
    let writes = run(&[OwnedTx {
        outputs: vec![object],
        ..tx()
    }]);
    let statements = cypher(&writes);
    assert!(statements
        .iter()
        .any(|s| s.starts_with("MERGE (v:Tournament") && s.contains("v.status = 'in_progress'")));
    assert_eq!(
        statements
            .iter()
            .filter(|s| s.contains("CREATE (t)-[:REGISTERED"))
            .count(),
        2
    );
    assert!(statements
        .iter()
        .any(|s| s.starts_with("MERGE (m:TournamentMatch")));
    assert_eq!(kinds_on(&writes, "evt:tournament"), ["TournamentChanged"]);

    // The same tournament after the real walkover, settlement, coin claim, Fight deletion and
    // item claim (2026-10-24): claims and absence stay distinct; its terminal clock is guarded.
    let (finished, _) = load(include_str!(
        "../fixtures/tournament_finished.localnet.json"
    ));
    let done: decode::Tournament = decode::from_bytes(&finished).unwrap();
    assert_eq!(
        (done.status.as_str(), done.sui.value, done.sui_total),
        ("finished", 0, 2_000_000_001)
    );
    assert_eq!(
        (done.matches[0].winner, done.matches[0].loser),
        (Some(0), None)
    );
    assert_eq!((done.teams[0].place, done.teams[1].place), (1, 0));
    assert!(!crate::tournament::pending(&done, 0, 0) && !crate::tournament::pending(&done, 1, 0));
    let writes = run(&[OwnedTx {
        outputs: vec![OwnedObj {
            id: done.id,
            version: 70_400,
            owner: OwnerKind::Shared,
            type_key: game("tournament", "Tournament"),
            bytes: finished,
        }],
        ..tx()
    }]);
    assert!(cypher(&writes).iter().any(|s| s.contains(
        "WHERE v.status = 'in_progress' AND v.finished_at_ms IS NULL SET v.finished_at_ms = 1000"
    )));

    // An isolated currency pool before and after its refund (2026-10-24, 2,000 units).
    let (before, _) = load(include_str!("../fixtures/tournament_pool.localnet.json"));
    let (after, _) = load(include_str!(
        "../fixtures/tournament_pool_refunded.localnet.json"
    ));
    let before: decode::TournamentKaresPool = decode::from_bytes(&before).unwrap();
    let after_pool: decode::TournamentKaresPool = decode::from_bytes(&after).unwrap();
    assert_eq!(before.id, after_pool.id);
    assert_eq!(
        (
            before.funds.balance.value,
            before.funds.paid,
            before.funds.refunded
        ),
        (2000, 0, false)
    );
    assert_eq!(
        (
            after_pool.funds.balance.value,
            after_pool.funds.paid,
            after_pool.funds.refunded
        ),
        (0, 2000, true)
    );
    let writes = run(&[OwnedTx {
        outputs: vec![OwnedObj {
            id: after_pool.id,
            version: 2,
            owner: OwnerKind::Shared,
            type_key: game("tournament", "KaresPool"),
            bytes: after,
        }],
        ..tx()
    }]);
    let pool = cypher(&writes)
        .into_iter()
        .find(|s| s.starts_with("MERGE (v:TournamentKaresPool"))
        .unwrap()
        .to_string();
    // the refund keeps the pool's total
    assert!(pool.contains("v.balance = '0'") && pool.contains("v.total = '2000'"));
    assert!(pool.contains("v.refunded = true"));

    // A Rules child captured after a compatible localnet upgrade (2026-10-29),
    // object 0x63b066…4615 @ v6272: parent-guarded, never a node of its own.
    let (rules, fixture) = load(include_str!("../fixtures/tournament_rules.localnet.json"));
    assert!(
        decode::from_bytes::<Field<MarkerKey, decode::TournamentRules>>(&rules[..rules.len() - 1])
            .is_err()
    );
    let writes = run(&[OwnedTx {
        outputs: vec![OwnedObj {
            id: hex_id(fixture["object_id"].as_str().unwrap()),
            version: 6272,
            owner: OwnerKind::Object(hex_id(fixture["parent"].as_str().unwrap())),
            type_key: field(
                &format!("{GAME}::tournament::RulesKey"),
                &format!("{GAME}::tournament::Rules"),
            ),
            bytes: rules,
        }],
        ..tx()
    }]);
    let statements = cypher(&writes);
    assert_eq!(statements.len(), 1);
    assert!(statements[0].starts_with("MATCH (v:Tournament"));
    assert!(
        statements[0].contains("v.entry_fee_mist = '5'")
            && statements[0].contains("v.max_level = 1")
    );
}
