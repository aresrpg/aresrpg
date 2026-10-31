// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
use crate::{decode, tournament};

fn captured() -> decode::Tournament {
    // Actual local-chain object 0x481f8cc2ab4b185f8d4777e26d62db1c352388a53e13d0f28bff62e77934cf7c,
    // version 70396, captured 2026-10-24 after two real registrations, donation, start and Fight opening.
    // The fixture retains the chain identifier, package type and transaction digest; no Rust encoder produced it.
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../tests/tournament.localnet.json")).unwrap();
    decode::from_bytes(&hex::decode(fixture["bcs"].as_str().unwrap()).unwrap()).unwrap()
}

#[test]
fn real_tournament_wire_pins_nested_rosters_bracket_prizes_and_custody() {
    let t = captured();
    assert_eq!(t.name, "Captured cup");
    assert_eq!(t.status, "in_progress");
    assert_eq!(t.sui.value, 2_000_000_001);
    assert_eq!(t.sui_total, t.sui.value);
    assert_eq!(t.kares_pool, None);
    assert_eq!(t.teams.len(), 2);
    assert_eq!(t.teams[0].seats.len(), 1);
    assert_eq!(t.teams[0].seats[0].owner, t.organizer);
    assert!(!t.teams[0].seats[0].sui_claimed);
    assert_eq!(t.matches[0].a, Some(1));
    assert_eq!(t.matches[0].b, Some(0));
    assert_eq!(t.matches[0].state, 1);
    assert_eq!(t.matches[0].winner, None);
    assert_eq!(
        t.fights[0].unwrap().hex(),
        "0x63d24b6611e0ffb60ffdf0dccae42e25d46e0bcc3ffa46d59b071df0e87181b7"
    );
    assert_eq!(t.rewards[0].place, 1);
    assert_eq!(t.rewards[0].amount, 2);
    assert_eq!(
        t.rewards[0].template.hex(),
        "0xabfc16e03836e9a706aef5f28c2db725ef30af5d44bb54822d7a2a3f85ef2a66"
    );
}

#[test]
fn wire_money_and_claim_masks_never_cross_javascript_as_numbers() {
    let mut t = captured();
    t.sui.value = u64::MAX;
    t.sui_total = u64::MAX;
    t.teams[0].revision = u64::MAX;
    t.teams[0].seats[0].items_claimed = u64::MAX;
    let row = tournament::row(&t, u64::MAX);
    assert_eq!(row["sui_pool"], u64::MAX.to_string());
    assert_eq!(row["sui_total"], u64::MAX.to_string());
    assert_eq!(row["teams"][0]["revision"], u64::MAX.to_string());
    assert_eq!(
        row["teams"][0]["seats"][0]["items_claimed"],
        u64::MAX.to_string()
    );
    assert_eq!(row["version"], u64::MAX.to_string());
    assert_eq!(
        row["teams"][0]["seats"][0]["character"],
        t.teams[0].seats[0].character.hex()
    );
}

#[test]
fn pending_prizes_outlive_the_current_tournament_until_each_entitlement_is_claimed() {
    let mut t = captured();
    assert!(!tournament::pending(&t, 0, 0));
    t.status = "finished".into();
    assert!(!tournament::pending(&t, 0, 0));
    t.teams[0].place = 1;
    assert!(tournament::pending(&t, 0, 0));
    t.teams[0].seats[0].sui_claimed = true;
    assert!(tournament::pending(&t, 0, 0));
    t.teams[0].seats[0].items_claimed = 1;
    assert!(!tournament::pending(&t, 0, 0));
}

#[test]
fn captured_walkover_keeps_claims_and_absence_distinct_after_fight_cleanup() {
    // Same local tournament as the running fixture, captured after the real 60s walkover,
    // character settlement, coin claim, Fight deletion and item claim on 2026-10-24.
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../tests/tournament_finished.localnet.json")).unwrap();
    let t: decode::Tournament =
        decode::from_bytes(&hex::decode(fixture["bcs"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(t.status, "finished");
    assert_eq!(t.sui.value, 0);
    assert_eq!(t.sui_total, 2_000_000_001);
    assert_eq!(t.matches[0].winner, Some(0));
    assert_eq!(t.matches[0].loser, None);
    assert_eq!(t.teams[0].place, 1);
    assert_eq!(t.teams[1].place, 0);
    assert!(t.teams[0].seats[0].sui_claimed);
    assert_eq!(t.teams[0].seats[0].items_claimed, 1);
    assert!(!tournament::pending(&t, 0, 0));
    assert!(!tournament::pending(&t, 1, 0));
}

#[test]
fn captured_optional_currency_pool_preserves_total_after_refund() {
    // Isolated local-chain pool; both files retain object ID, version, digest and capture date.
    // Captured 2026-10-24 after binding a burn-only currency, contributing 2,000 units, then cancelling.
    let before: serde_json::Value =
        serde_json::from_str(include_str!("../tests/tournament_pool.localnet.json")).unwrap();
    let after: serde_json::Value = serde_json::from_str(include_str!(
        "../tests/tournament_pool_refunded.localnet.json"
    ))
    .unwrap();
    let before: decode::TournamentKaresPool =
        decode::from_bytes(&hex::decode(before["bcs"].as_str().unwrap()).unwrap()).unwrap();
    let after: decode::TournamentKaresPool =
        decode::from_bytes(&hex::decode(after["bcs"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(before.id, after.id);
    assert_eq!(before.funds.balance.value, 2000);
    assert_eq!(before.funds.paid, 0);
    assert!(!before.funds.refunded);
    assert_eq!(after.funds.balance.value, 0);
    assert_eq!(after.funds.paid, 2000);
    assert!(after.funds.refunded);
    assert!(after.funds.claimed.contents.is_empty());
}

#[test]
fn captured_rules_keep_registration_limits_and_are_parent_guarded() {
    use crate::decode::{Field, Id, MarkerKey, TournamentRules};
    use crate::graph::{project, CheckpointView};
    use crate::ownership::{ObjView, OwnerKind, TypeKey, SUI_FRAMEWORK};
    // Real Rules child captured after a compatible localnet upgrade on 2026-10-29.
    // Object 0x63b06676b2d9203bdb0ef3d709f2e7180f16d35b6ca4837b7067a16d27264615, version 6272.
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../tests/tournament_rules.localnet.json")).unwrap();
    let bytes = hex::decode(fixture["bcs"].as_str().unwrap()).unwrap();
    let field: Field<MarkerKey, TournamentRules> = decode::from_bytes(&bytes).unwrap();
    assert!(!field.name);
    assert_eq!(field.value.entry_fee_mist, 5);
    assert_eq!(field.value.max_level, Some(1));
    assert!(
        decode::from_bytes::<Field<MarkerKey, TournamentRules>>(&bytes[..bytes.len() - 1]).is_err()
    );
    let game = fixture["type"]
        .as_str()
        .unwrap()
        .split('<')
        .nth(1)
        .unwrap()
        .split("::")
        .next()
        .unwrap();
    let ty = TypeKey {
        package: SUI_FRAMEWORK.into(),
        module: "dynamic_field".into(),
        name: "Field".into(),
        type_params: vec![
            format!("{game}::tournament::RulesKey"),
            format!("{game}::tournament::Rules"),
        ],
    };
    let parent = Id(
        hex::decode(fixture["parent"].as_str().unwrap().trim_start_matches("0x"))
            .unwrap()
            .try_into()
            .unwrap(),
    );
    let output = ObjView {
        id: field.id,
        version: 6272,
        owner: OwnerKind::Object(parent),
        type_key: &ty,
        bytes: &bytes,
    };
    let statements = project(
        &CheckpointView {
            lamport_version: 6272,
            ckpt: 1,
            ts_ms: 1,
            outputs: &[output],
            deleted: &[],
            custody: &[],
            market: &[],
            fight_lifecycle: &[],
        },
        game,
    )
    .unwrap();
    assert_eq!(statements.len(), 1);
    assert!(statements[0].starts_with("MATCH (v:Tournament"));
    assert!(statements[0].contains("v.entry_fee_mist = '5'"));
    assert!(statements[0].contains("v.max_level = 1"));
    assert!(!statements[0].contains("v.data"));
}
