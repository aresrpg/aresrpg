// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
use super::{canonical, game_type, TypeTag};
use std::collections::HashSet;

#[test]
fn new_types_and_events_from_a_certified_upgrade_reach_the_same_game_projection() {
    let original = canonical("0x11").unwrap();
    let versions = HashSet::from([original.clone(), canonical("0x22").unwrap()]);
    let raw: TypeTag = "0x22::tournament::Tournament".parse().unwrap();
    assert_eq!(
        game_type(raw, &original, &versions).to_canonical_string(true),
        format!("{original}::tournament::Tournament")
    );
    let event: TypeTag = "0x22::tournament::TournamentUpdated".parse().unwrap();
    assert_eq!(
        game_type(event, &original, &versions).to_canonical_string(true),
        format!("{original}::tournament::TournamentUpdated")
    );
}

#[test]
fn nested_dynamic_fields_normalize_game_types_without_trusting_foreign_lookalikes() {
    let original = canonical("0x11").unwrap();
    let versions = HashSet::from([original.clone(), canonical("0x22").unwrap()]);
    let raw: TypeTag =
        "0x2::dynamic_field::Field<0x22::tournament::Key, vector<0x33::tournament::Tournament>>"
            .parse()
            .unwrap();
    let expected: TypeTag =
        "0x2::dynamic_field::Field<0x11::tournament::Key, vector<0x33::tournament::Tournament>>"
            .parse()
            .unwrap();
    assert_eq!(game_type(raw, &original, &versions), expected);
    let coin: TypeTag = "0x33::token::Token".parse().unwrap();
    assert_eq!(game_type(coin.clone(), &original, &versions), coin);
    assert_eq!(game_type(TypeTag::U64, &original, &versions), TypeTag::U64);
}
