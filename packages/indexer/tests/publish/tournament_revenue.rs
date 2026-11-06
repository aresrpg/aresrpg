use crate::decode::Addr;
use crate::publish::{analyze, EventView, TxView};

// Captured from sui move test, tournament_fee_tests::successful_registration_splits_exactly_and_leave_does_not_refund,
// 2026-11-03. Local Move VM scenario (not a mainnet transaction): tournament object
// 0xdba72804cc9504a82bbaa13ed4a83a0e2c6219d7e45125cf57fd10cbab957a97,
// initial scenario registration, fee 5 MIST -> treasury 2 MIST. No chain object version exists.
const CAPTURE: &str = "0200000000000000";
const GAME: &str = "0x99";

fn money(events: &[EventView<'_>]) -> anyhow::Result<crate::publish::Wire> {
    analyze(
        60,
        4_000,
        &[TxView {
            tx_index: 4,
            sender: Addr([7; 32]),
            move_calls: &[],
            events,
            inputs: &[],
            outputs: &[],
            deleted: &[],
        }],
        GAME,
        "0x98",
    )
}

fn event<'a>(package: &'a str, name: &'a str, bytes: &'a [u8], index: u64) -> EventView<'a> {
    EventView {
        package,
        module: "tournament",
        name,
        type_params: &[],
        bytes,
        index,
    }
}

#[test]
fn captured_treasury_cut_counts_each_registration_even_through_wrappers() {
    let bytes = hex::decode(CAPTURE).unwrap();
    let wire = money(&[
        event(GAME, "EntryFeePaid", &bytes, 2),
        event(GAME, "TournamentUpdated", &[0; 32], 3),
        event(GAME, "EntryFeePaid", &bytes, 4),
    ])
    .unwrap();
    assert_eq!(wire.money.len(), 2);
    assert_eq!(wire.money[0].coordinate, "60:4:2");
    assert_eq!(wire.money[1].coordinate, "60:4:4");
    let totals = crate::analytics_totals::checkpoint_totals(60, 1, 0, &wire.money).unwrap();
    assert_eq!(totals.tournament_mist, 4);
    assert_eq!(totals.kolizeum_mist, 0);
    assert_eq!(totals.item_royalty_mist, 0);
}

#[test]
fn lifecycle_updates_and_foreign_fee_events_never_infer_revenue() {
    let bytes = hex::decode(CAPTURE).unwrap();
    // Donation, withdrawal, cancellation and claims emit only TournamentUpdated.
    let wire = money(&[
        event(GAME, "TournamentUpdated", &[0; 32], 0),
        event("0xforeign", "EntryFeePaid", &bytes, 1),
    ])
    .unwrap();
    assert!(wire.money.is_empty());
    // Aborted registrations certify no events.
    assert!(money(&[]).unwrap().money.is_empty());
    assert!(money(&[event(GAME, "EntryFeePaid", &bytes[..7], 0)]).is_err());
}

#[test]
fn free_or_one_mist_registration_has_no_platform_revenue() {
    let mut bytes = hex::decode(CAPTURE).unwrap();
    bytes.fill(0);
    let wire = money(&[event(GAME, "EntryFeePaid", &bytes, 0)]).unwrap();
    let totals = crate::analytics_totals::checkpoint_totals(60, 1, 0, &wire.money).unwrap();
    assert_eq!(totals.tournament_mist, 0);
}
