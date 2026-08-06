// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Unit tests for the per-fight event journal ([`super::decode_journal_event`] +
//! [`super::journal_writes`]).
//!
//! ## RUNTIME PROVENANCE (the real captured wire)
//! Every `*_WIRE` byte array below is the EXACT BCS body of a LIVE testnet
//! `aresrpg_fight::fight_events` event, and every expectation is that same response's own
//! fullnode-rendered `parsedJson` — so each test proves the model matches the REAL wire, not a
//! self-encoded round trip (the code-law: a codec test that encodes with the model it decodes
//! with proves nothing). Value convention: u64→string, u32/u8→number, bool→bool, ID→`0x…` hex.
//!
//! The arrays come in THREE independently-dated capture sets, each stating its own engine
//! package, endpoint, and fight/transaction beside its constants — a set is only as trustworthy
//! as the origin it names, so none of them inherit this paragraph's word for it. The first set
//! (`FightCreated`/`Hit`/`Displaced`/`Moved`, engine origin `0x599bda…3dafb`, fight
//! `0x7cdc59f2…ee928`, harvested through the since-retired
//! `suix_queryEvents{MoveEventModule{…}}`) covers every scalar value type: 2 ids, a >2^63 u64
//! `spawn_id`, u32 coords, a u8 mechanics `kind`, bools, plain u64s.

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

// ── the action envelope's leading pair (#1143) ────────────────────────────────────────────
// A THIRD capture set, harvested 2026-08-06 off testnet GraphQL
// (`https://graphql.testnet.sui.io/graphql`, `events(filter:{ type:
// "0x5b20ac04d1caa5b0b10cb14923f12d12205b7454f2b8061b3fdd9f9188b733b4::fight_events::<name>" })`)
// — the same official-endpoint harvest as the arrays above, over the CURRENT engine origin
// package, since public JSON-RPC is retired. Each array is the response's base64 `contents.bcs`
// decoded; each expectation below is the SAME response's `contents.json`, i.e. the fullnode's
// own parsedJson, transcribed field-for-field. Both events ride fight
// `0x01df0cca…bdf3`.
const ENVELOPE_FIGHT: &str = "0x01df0cca7047c493ebc7c21e2e841aecab42fc73ba3c3e17bacd5d1973bfbdf3";

// ActionStarted (82 bytes) — tx `GoXvjpwQxdS3ahQTPmH5JdeDxxQoD4pjecH3G5tBpikQ`. parsedJson:
// caster_is_mob false, caster_idx "0", turn_ordinal "6", action_ordinal "1", action_kind 0
// (u8 → number), target_cell "62", ap_cost "2", effect_count "2".
const ACTIONSTARTED_WIRE: &[u8] = &[
    1, 223, 12, 202, 112, 71, 196, 147, 235, 199, 194, 30, 46, 132, 26, 236, 171, 66, 252, 115,
    186, 60, 62, 23, 186, 205, 93, 25, 115, 191, 189, 243, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0,
    0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 62, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 2, 0,
    0, 0, 0, 0, 0, 0,
];

// ActionEffect (98 bytes = 32 id + bool + 4 × u64 + a 33-byte inlined Effect) — tx
// `7Mzp4taJ9MUrpmjh4v1ernjT6GrCaKHhqquaVjiK3r7h`. THE #1143 class itself: a 2-turn
// TF_ONLY_CASTER (32) self-buff whose `value` is the 32768-CENTERED 32793 (= +25), the exact row
// an observer never saw. parsedJson: caster_is_mob true, caster_idx "1", turn_ordinal "1",
// action_ordinal "0", effect_ordinal "0", effect { kind 9, element 255, value/value_max "32793",
// area_shape 0, area_size "0", target_filter 32, chance 100, turns 2, stat 8, flags 0, phase 0 }.
const ACTIONEFFECT_SELF_BUFF_WIRE: &[u8] = &[
    1, 223, 12, 202, 112, 71, 196, 147, 235, 199, 194, 30, 46, 132, 26, 236, 171, 66, 252, 115,
    186, 60, 62, 23, 186, 205, 93, 25, 115, 191, 189, 243, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9, 255, 25, 128, 0, 0, 0, 0, 0, 0,
    25, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32, 100, 2, 8, 0, 0,
];

// ActionEffect (98 bytes) — tx `2D9gVznzddUUWZhXqNq4VKmkAbYdG6F9ZSqVp2SKUMBD`, fight
// `0xc0036b00…f573`. The RANGED half of the layout: `value` 6 ≠ `value_max` 11 (#577's second
// u64), which a mirror that stopped at the pre-#577 25-byte Effect would silently mis-read.
// parsedJson: caster_is_mob true, caster_idx "0", turn_ordinal "9", action_ordinal "0",
// effect_ordinal "0", effect { kind 0, element 1, value "6", value_max "11", area_shape 0,
// area_size "0", target_filter 1, chance 100, turns 0, stat 0, flags 0, phase 0 }.
const ACTIONEFFECT_RANGED_WIRE: &[u8] = &[
    192, 3, 107, 0, 178, 98, 252, 185, 98, 133, 78, 151, 250, 237, 57, 134, 166, 85, 31, 117, 188,
    38, 63, 102, 196, 36, 114, 177, 238, 229, 245, 115, 1, 0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 6, 0, 0, 0, 0, 0, 0, 0, 11, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 100, 0, 0, 0, 0,
];
const ACTIONEFFECT_RANGED_FIGHT: &str =
    "0xc0036b00b262fcb962854e97faed3986a6551f75bc263f66c42472b1eee5f573";

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
fn action_started_wire_carries_the_envelope_key_and_target_cell() {
    let (oid, kind, data) =
        decode_journal_event("fight_events", "ActionStarted", ACTIONSTARTED_WIRE).unwrap();
    assert_eq!(oid, ObjectID::from_hex_literal(ENVELOPE_FIGHT).unwrap());
    assert_eq!(kind, "ActionStarted");
    // Field-for-field with the fullnode's parsedJson. `target_cell` is the whole reason this
    // row cannot be dropped: it is the zone origin `self_status_from_effect` tests the caster
    // against, and no other journalled event carries it for a non-`Cast` action boundary.
    assert_eq!(
        data,
        json!({
            "fight": ENVELOPE_FIGHT, "caster_is_mob": false, "caster_idx": "0",
            "turn_ordinal": "6", "action_ordinal": "1",
            "action_kind": 0, // u8 → NUMBER
            "target_cell": "62", "ap_cost": "2", "effect_count": "2",
        })
    );
}

#[test]
fn action_effect_wire_decodes_its_nested_effect_uncentered() {
    let (oid, kind, data) =
        decode_journal_event("fight_events", "ActionEffect", ACTIONEFFECT_SELF_BUFF_WIRE).unwrap();
    assert_eq!(oid, ObjectID::from_hex_literal(ENVELOPE_FIGHT).unwrap());
    assert_eq!(kind, "ActionEffect");
    // The nested Effect is a plain OBJECT (the fullnode inlines a by-value struct in parsedJson),
    // u64 as string / u8 as number like every other field — and `value` stays CENTERED at
    // 32768+25: `core_wire.js::decode_status_value` is the one decoder for both status doors.
    assert_eq!(
        data,
        json!({
            "fight": ENVELOPE_FIGHT, "caster_is_mob": true, "caster_idx": "1",
            "turn_ordinal": "1", "action_ordinal": "0", "effect_ordinal": "0",
            "effect": {
                "kind": 9, "element": 255,
                "value": "32793", "value_max": "32793",
                "area_shape": 0, "area_size": "0",
                "target_filter": 32, "chance": 100, "turns": 2,
                "stat": 8, "flags": 0, "phase": 0,
            },
        })
    );
}

#[test]
fn action_effect_wire_keeps_the_ranged_value_max_distinct() {
    let (oid, kind, data) =
        decode_journal_event("fight_events", "ActionEffect", ACTIONEFFECT_RANGED_WIRE).unwrap();
    assert_eq!(
        oid,
        ObjectID::from_hex_literal(ACTIONEFFECT_RANGED_FIGHT).unwrap()
    );
    assert_eq!(kind, "ActionEffect");
    assert_eq!(
        data,
        json!({
            "fight": ACTIONEFFECT_RANGED_FIGHT, "caster_is_mob": true, "caster_idx": "0",
            "turn_ordinal": "9", "action_ordinal": "0", "effect_ordinal": "0",
            "effect": {
                "kind": 0, "element": 1,
                "value": "6", "value_max": "11", // the #577 range, both halves read
                "area_shape": 0, "area_size": "0",
                "target_filter": 1, "chance": 100, "turns": 0,
                "stat": 0, "flags": 0, "phase": 0,
            },
        })
    );
}

#[test]
fn a_truncated_envelope_wire_is_dropped_loudly_not_half_decoded() {
    // `decode_bcs` reports (ERROR + sentry_event) and yields None: a mirror that no longer
    // matches its Move source must never produce a plausible partial row (#1579's class).
    let short = &ACTIONEFFECT_SELF_BUFF_WIRE[..ACTIONEFFECT_SELF_BUFF_WIRE.len() - 1];
    assert!(decode_journal_event("fight_events", "ActionEffect", short).is_none());
    assert!(decode_journal_event("fight_events", "ActionStarted", HIT_WIRE).is_none());
}

#[test]
fn deferred_and_foreign_events_are_not_journalled() {
    // `ActionResolved` — the one envelope member still deferred (Option<SpellLevel> +
    // vector<WeaponLine>; its client arm only frees a finished action's context entry).
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
