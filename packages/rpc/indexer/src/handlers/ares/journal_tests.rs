// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Unit tests for the per-fight event journal ([`super::decode_journal_event`] +
//! [`super::journal_writes`]).
//!
//! ## RUNTIME PROVENANCE (the real captured wire)
//! The `*_WIRE` byte arrays below are the EXACT BCS bodies of live testnet
//! `aresrpg_fight::fight_events` events (engine origin package
//! `0x599bda…3dafb`), captured from fight `0x7cdc59f2…ee928` via
//! `suix_queryEvents{MoveEventModule{package, module:"fight_events"}}` and decoded from
//! the response's base64 `bcs`. Each test asserts our decode reproduces the fullnode's
//! own `parsedJson` field-for-field (value convention: u64→string, u32/u8→number,
//! bool→bool, ID→`0x…` hex) — proving the model matches the REAL wire, not a self-encoded
//! round trip (the code-law: a codec test that encodes with the model it decodes with
//! proves nothing). `FightCreated`/`Hit`/`Displaced`/`Moved` cover every value type
//! (2 ids, a >2^63 u64 `spawn_id`, u32 coords, a u8 mechanics `kind`, bools, plain u64s).

use super::*;

// fight `0x7cdc59f2…ee928`, character `0xbb07fa5d…f8e3`, world `0xde6a3e8d…41ae`.
const FIGHT: &str = "0x7cdc59f27303d92c0e777e6f8c3022567ddf333e44d7aee95cc455c6d92ee928";
const CHARACTER: &str = "0xbb07fa5dedd33ba4a8c58e654ff4123e42f7ec104d7841854d686c0f040df8e3";
const WORLD: &str = "0xde6a3e8d06042e99e13e888fdf55fe6986cc3eca0efdbfaf06b0eb9d213341ae";

// FightCreated (97 bytes) — parsedJson: spawn_id "12475479364079269131" (>2^63), anchor_x
// 250144, anchor_z 250088, public_fight true, aged_bp "0", mob_count "2".
const FIGHTCREATED_WIRE: &[u8] = &[
    124, 220, 89, 242, 115, 3, 217, 44, 14, 119, 126, 111, 140, 48, 34, 86, 125, 223, 51, 62, 68,
    215, 174, 233, 92, 196, 85, 198, 217, 46, 233, 40, 222, 106, 62, 141, 6, 4, 46, 153, 225, 62,
    136, 143, 223, 85, 254, 105, 134, 204, 62, 202, 14, 253, 191, 175, 6, 176, 235, 157, 33, 51,
    65, 174, 11, 53, 169, 58, 98, 206, 33, 173, 32, 209, 3, 0, 232, 208, 3, 0, 1, 0, 0, 0, 0, 0, 0,
    0, 0, 2, 0, 0, 0, 0, 0, 0, 0,
];
// Hit (57 bytes) — victim_is_mob true, victim_idx "0", amount "7", remaining_hp "10".
const HIT_WIRE: &[u8] = &[
    124, 220, 89, 242, 115, 3, 217, 44, 14, 119, 126, 111, 140, 48, 34, 86, 125, 223, 51, 62, 68,
    215, 174, 233, 92, 196, 85, 198, 217, 46, 233, 40, 1, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0,
    0, 0, 10, 0, 0, 0, 0, 0, 0, 0,
];
// Displaced (74 bytes) — target_is_mob true, target_idx "0", kind 12 (u8 mechanics code),
// from_cell "61", to_cell "60", requested "2", blocked "1".
const DISPLACED_WIRE: &[u8] = &[
    124, 220, 89, 242, 115, 3, 217, 44, 14, 119, 126, 111, 140, 48, 34, 86, 125, 223, 51, 62, 68,
    215, 174, 233, 92, 196, 85, 198, 217, 46, 233, 40, 1, 0, 0, 0, 0, 0, 0, 0, 0, 12, 61, 0, 0, 0,
    0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
];
// Moved (72 bytes) — character `0xbb07fa5d…f8e3`, to_cell "64".
const MOVED_WIRE: &[u8] = &[
    124, 220, 89, 242, 115, 3, 217, 44, 14, 119, 126, 111, 140, 48, 34, 86, 125, 223, 51, 62, 68,
    215, 174, 233, 92, 196, 85, 198, 217, 46, 233, 40, 187, 7, 250, 93, 237, 211, 59, 164, 168,
    197, 142, 101, 79, 244, 18, 62, 66, 247, 236, 16, 77, 120, 65, 133, 77, 104, 108, 15, 4, 13,
    248, 227, 64, 0, 0, 0, 0, 0, 0, 0,
];

// TurnStarted (65 bytes) — a DIFFERENT capture from the rest of this file: transaction
// `4KTjXhW15G2GYVXSxcPX2GtqhzxpvLAULtiZo3HgfBz4` (`turns::force_start`, checkpoint 365484088,
// engine package `0x9cfadc…84b3`) on fight `0xaf742984…8167`. parsedJson: is_mob false,
// idx "0", deadline_ms "1785286156291", turn_entropy "2969120189", turn_ordinal "1". This is
// the event whose 16 unread trailing bytes wedged every fight in placement (#1579); the journal
// had no captured-wire test for it, which is why the shortfall survived here too.
const TURNSTARTED_WIRE: &[u8] = &[
    175, 116, 41, 132, 62, 213, 68, 206, 221, 158, 208, 208, 160, 138, 192, 202, 181, 210, 96, 148,
    86, 59, 250, 25, 120, 6, 195, 197, 76, 179, 129, 103, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 224, 88,
    171, 159, 1, 0, 0, 189, 45, 249, 176, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
];
const TURNSTARTED_FIGHT: &str =
    "0xaf7429843ed544cedd9ed0d0a08ac0cab5d26094563bfa197806c3c54cb38167";

fn fight_oid() -> ObjectID {
    ObjectID::from_hex_literal(FIGHT).unwrap()
}

#[test]
fn turn_started_wire_decodes_with_its_turn_seed_inputs() {
    let (oid, kind, data) =
        decode_journal_event("fight_events", "TurnStarted", TURNSTARTED_WIRE).unwrap();
    assert_eq!(oid, ObjectID::from_hex_literal(TURNSTARTED_FIGHT).unwrap());
    assert_eq!(kind, "TurnStarted");
    // Field-for-field with the fullnode's parsedJson — including the turn-seed pair a receipt
    // carries, so a journal replay folds the SAME seed the actor's own receipt did.
    assert_eq!(
        data,
        json!({
            "fight": TURNSTARTED_FIGHT, "is_mob": false, "idx": "0",
            "deadline_ms": "1785286156291",
            "turn_entropy": "2969120189", "turn_ordinal": "1",
        })
    );
}

#[test]
fn fight_created_wire_decodes_and_shapes_like_the_fullnode() {
    let (oid, kind, data) =
        decode_journal_event("fight_events", "FightCreated", FIGHTCREATED_WIRE).unwrap();
    assert_eq!(oid, fight_oid());
    assert_eq!(kind, "FightCreated");
    assert_eq!(
        data,
        json!({
            "fight": FIGHT, "world": WORLD,
            // >2^63 — must survive as a STRING (the whole reason for the money/2^53 law).
            "spawn_id": "12475479364079269131",
            "anchor_x": 250144, "anchor_z": 250088, // u32 → NUMBER
            "public_fight": true,
            "aged_bp": "0", "mob_count": "2",
        })
    );
}

#[test]
fn hit_wire_decodes_and_shapes_like_the_fullnode() {
    let (oid, kind, data) = decode_journal_event("fight_events", "Hit", HIT_WIRE).unwrap();
    assert_eq!(oid, fight_oid());
    assert_eq!(kind, "Hit");
    assert_eq!(
        data,
        json!({
            "fight": FIGHT, "victim_is_mob": true,
            "victim_idx": "0", "amount": "7", "remaining_hp": "10",
        })
    );
}

#[test]
fn displaced_wire_keeps_the_u8_kind_distinct_from_the_event_name() {
    let (oid, kind, data) =
        decode_journal_event("fight_events", "Displaced", DISPLACED_WIRE).unwrap();
    assert_eq!(oid, fight_oid());
    assert_eq!(kind, "Displaced");
    // The payload's `kind` (12, the push/pull mechanics code, a u8 → NUMBER) is a distinct
    // fact from the top-level event-kind name — the client renames it `effect_kind`.
    assert_eq!(
        data,
        json!({
            "fight": FIGHT, "target_is_mob": true, "target_idx": "0", "kind": 12,
            "from_cell": "61", "to_cell": "60", "requested": "2", "blocked": "1",
        })
    );
}

#[test]
fn moved_wire_decodes_character_and_cell() {
    let (oid, kind, data) = decode_journal_event("fight_events", "Moved", MOVED_WIRE).unwrap();
    assert_eq!(oid, fight_oid());
    assert_eq!(kind, "Moved");
    assert_eq!(
        data,
        json!({ "fight": FIGHT, "character": CHARACTER, "to_cell": "64" })
    );
}

#[test]
fn defeat_reads_its_single_id_as_the_fight() {
    // `Defeat { fight }` is a bare positional ID (the `OneId` shape) — the fight id itself.
    let body = FIGHTCREATED_WIRE[..32].to_vec(); // the leading 32-byte fight id
    let (oid, kind, data) = decode_journal_event("fight_events", "Defeat", &body).unwrap();
    assert_eq!(oid, fight_oid());
    assert_eq!(kind, "Defeat");
    assert_eq!(data, json!({ "fight": FIGHT }));
}

#[test]
fn deferred_and_foreign_events_are_not_journalled() {
    // The action-envelope triple (nested Effect/SpellLevel/WeaponLine — deferred as one unit).
    assert!(decode_journal_event("fight_events", "ActionStarted", HIT_WIRE).is_none());
    assert!(decode_journal_event("fight_events", "ActionEffect", HIT_WIRE).is_none());
    assert!(decode_journal_event("fight_events", "ActionResolved", HIT_WIRE).is_none());
    // Settlement artifacts (keyed by result → /v1/fight-results, not the fight timeline).
    assert!(decode_journal_event("fight_events", "ResultMinted", HIT_WIRE).is_none());
    assert!(decode_journal_event("fight_events", "LootMinted", HIT_WIRE).is_none());
    // A non-fight module never journals.
    assert!(decode_journal_event("kiosk", "ItemListed", HIT_WIRE).is_none());
}

#[test]
fn journal_writes_build_the_ordered_member_score_and_ttl() {
    let (_, kind, data) = decode_journal_event("fight_events", "Hit", HIT_WIRE).unwrap();
    let cursor = JournalCursor {
        checkpoint: 4_200,
        intra_checkpoint_event_index: 19,
        tx_index: 3,
        event_index: 7,
    };
    let w = journal_writes(
        FIGHT,
        cursor,
        kind,
        data.clone(),
        "TxDigestBase58",
        Some(88),
    );
    let key = k_fight_journal(FIGHT);
    let expected_payload = json!({
        "id": "4200:19", "kind": "Hit", "data": data,
        "digest": "TxDigestBase58", "version": "88"
    });
    let expected_member = format!("000003:0007|{expected_payload}");
    assert_eq!(
        w,
        vec![
            zadd(key.clone(), 4_200, expected_member), // score = checkpoint
            expire(key, 24 * 60 * 60),
        ]
    );
}

#[test]
fn a_terminal_that_destroyed_the_object_journals_a_null_version() {
    let (_, kind, data) =
        decode_journal_event("fight_events", "Defeat", &FIGHTCREATED_WIRE[..32]).unwrap();
    let cursor = JournalCursor {
        checkpoint: 9,
        intra_checkpoint_event_index: 2,
        tx_index: 0,
        event_index: 0,
    };
    let w = journal_writes(FIGHT, cursor, kind, data, "D", None);
    let RedisWrite::ZAdd { member, .. } = &w[0] else {
        panic!("expected ZAdd")
    };
    // version is JSON null (the fight object was deleted → no post-tx output version).
    assert!(member.contains("\"version\":null"), "member = {member}");
}

#[test]
fn member_prefixes_sort_in_checkpoint_tx_event_order() {
    // The zero-padded (tx, event) prefix must make lexicographic member order == numeric
    // (tx, event) order within a checkpoint — the ZSET's equal-score tie-break the journal
    // rank (client seq) rides on. Same score (checkpoint), so member order alone decides.
    let member = |tx, evt| {
        let (_, kind, data) = decode_journal_event("fight_events", "Hit", HIT_WIRE).unwrap();
        let cursor = JournalCursor {
            checkpoint: 1,
            intra_checkpoint_event_index: (tx * 100 + evt) as u64,
            tx_index: tx,
            event_index: evt,
        };
        let RedisWrite::ZAdd { member, .. } =
            journal_writes(FIGHT, cursor, kind, data, "d", Some(1)).remove(0)
        else {
            panic!()
        };
        member
    };
    // tx 2 evt 9 comes before tx 2 evt 10 (not the naive "9" > "10" string trap), and
    // tx 2 before tx 10.
    assert!(member(2, 9) < member(2, 10));
    assert!(member(2, 10) < member(10, 0));
    assert!(member(0, 0) < member(0, 1));
}
