// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Leaderboard contributions: who earned what, from certified fights, events and objects.

use super::*;
use crate::decode::{self, DungeonTag, FighterAuthority};
use crate::leaderboards::{Contribution, Metric};
use crate::pipeline::OwnedObj;

/// Character `object` with `xp` experience.
fn hero(object: u8, xp: u64) -> OwnedObj {
    let base = character(id(object), OwnerKind::Object(id(200)));
    let mut value: decode::Character = decode::from_bytes(&base.bytes).unwrap();
    value.experience = xp;
    OwnedObj {
        bytes: bcs(&value),
        ..base
    }
}

fn ended(fight: Id, winner: Option<u8>) -> OwnedEvent {
    game_event("fight", "FightEnded", &(fight, "world", 1u32, 2u32, winner))
}

fn joined(fight: Id, character: u8) -> OwnedEvent {
    game_event("fight", "FighterJoined", &(fight, id(character), 0u8))
}

fn completed(character: u8, won: bool) -> OwnedEvent {
    game_event(
        "dungeon",
        "DungeonEnded",
        &(id(character), "world", 3u64, won),
    )
}

/// Contributions of one transaction sent by `addr(99)`.
fn contributions(
    inputs: Vec<OwnedObj>,
    outputs: Vec<OwnedObj>,
    events: Vec<OwnedEvent>,
) -> anyhow::Result<Vec<Contribution>> {
    let writes = try_run(&[OwnedTx {
        sender: addr(99),
        inputs,
        outputs,
        events,
        ..tx()
    }])?;
    Ok(leaderboard(&writes))
}

fn in_temple(mut fight: decode::Fight) -> decode::Fight {
    fight.dungeon = Some(DungeonTag {
        dungeon: "temple".into(),
        room: 3,
    });
    fight
}

fn running(mut fight: decode::Fight) -> decode::Fight {
    fight.combat.ended = false;
    fight.combat.winner = None;
    fight
}

#[test]
fn fights_credit_each_owner_once_and_only_the_authorized_sender() {
    // Kills: owners deduplicate, dead winners count, forfeits never do.
    let mut won = fight(1, &[2, 2, 2, 2, 3, 4], 6);
    won.combat.fighters[4].dead = true;
    won.combat.fighters[5].forfeited = true;
    let kills = contributions(vec![], vec![fight_obj(&won)], vec![ended(won.id, Some(0))]).unwrap();
    assert_eq!(
        kills,
        [
            Contribution::new(Metric::Kills, addr(2), 6),
            Contribution::new(Metric::Kills, addr(3), 6)
        ]
    );
    for loser in [None, Some(1)] {
        let none = contributions(vec![], vec![fight_obj(&won)], vec![ended(won.id, loser)]);
        assert!(none.unwrap().is_empty());
    }
    assert!(
        contributions(vec![fight_obj(&won)], vec![fight_obj(&won)], vec![])
            .unwrap()
            .is_empty()
    );
    // A FightEnded receipt without its Fight is refused, never guessed.
    assert!(contributions(vec![], vec![], vec![ended(won.id, Some(0))]).is_err());

    // Settlement credits XP to the seat's sender; a later custody transfer earns nothing.
    let seated = running(fight(1, &[99], 6));
    let settled = contributions(
        vec![fight_obj(&seated), hero(10, 100)],
        vec![hero(10, 250)],
        vec![ended(seated.id, Some(0))],
    )
    .unwrap();
    assert!(settled.contains(&Contribution::new(Metric::Xp, addr(99), 150)));
    assert!(settled.contains(&Contribution::new(Metric::Kills, addr(99), 6)));
    assert!(
        contributions(vec![hero(10, 250)], vec![hero(10, 250)], vec![])
            .unwrap()
            .is_empty()
    );
    // A transferred character settles while its old fight is already closed.
    let mut old = fight(1, &[3, 99], 6);
    old.combat.fighters[0].settled = true;
    old.combat.fighters[1].settled = true;
    let current = fight(2, &[99], 6);
    let moved = contributions(
        vec![fight_obj(&old), fight_obj(&current), hero(10, 100)],
        vec![hero(10, 250)],
        vec![],
    )
    .unwrap();
    assert_eq!(moved, [Contribution::new(Metric::Xp, addr(99), 150)]);
    // A new character joins, wins and closes without a final Fight object.
    let mut lobby = running(fight(1, &[99, 99], 6));
    lobby.combat.fighters[0].forfeited = true;
    lobby.combat.fighters[0].settled = true;
    let closed = contributions(
        vec![fight_obj(&lobby)],
        vec![hero(12, 60)],
        vec![
            joined(lobby.id, 12),
            game_event("fight", "FighterForfeited", &(lobby.id, 1u64)),
            ended(lobby.id, Some(0)),
        ],
    )
    .unwrap();
    assert_eq!(
        closed,
        [
            Contribution::new(Metric::Xp, addr(99), 60),
            Contribution::new(Metric::Kills, addr(99), 6)
        ]
    );
}

#[test]
fn dungeon_completions_follow_certified_event_order() {
    // Two fights in one PTB: each character matches its own fight.
    let first = in_temple(fight(1, &[2], 6));
    let mut second = in_temple(fight(2, &[3], 6));
    second.authorities[0] = FighterAuthority::Player {
        character: id(11),
        owner: addr(3),
    };
    let facts = contributions(
        vec![fight_obj(&first), fight_obj(&second)],
        vec![],
        vec![completed(10, true), completed(11, true)],
    )
    .unwrap();
    assert_eq!(facts[0].dungeon_fight, Some(first.id));
    assert_eq!(
        (facts[1].dungeon_fight, facts[1].address),
        (Some(second.id), addr(3))
    );
    assert!(contributions(vec![], vec![], vec![completed(10, false)])
        .unwrap()
        .is_empty());
    assert!(contributions(vec![], vec![], vec![completed(10, true)]).is_err());

    // A seat joined and settled in one transaction has no input seat.
    let before = running(in_temple(fight(1, &[2], 6)));
    let mut after = in_temple(fight(1, &[2], 6));
    after.authorities.push(FighterAuthority::Player {
        character: id(11),
        owner: addr(99),
    });
    let mut seat = fighter(0, false);
    seat.settled = true;
    after.combat.fighters.push(seat.clone());
    let facts = contributions(
        vec![fight_obj(&before)],
        vec![fight_obj(&after)],
        vec![joined(after.id, 11), completed(11, true)],
    )
    .unwrap();
    assert_eq!(facts.len(), 1);
    assert_eq!(
        (facts[0].address, facts[0].dungeon_fight),
        (addr(99), Some(after.id))
    );

    // One character completes, joins the next room's fight and completes again.
    let first = fight(1, &[99], 6);
    let mut next = running(in_temple(fight(2, &[99], 6)));
    next.authorities[0] = FighterAuthority::Player {
        character: id(11),
        owner: addr(99),
    };
    let mut finished = next.clone();
    finished.combat.ended = true;
    finished.combat.winner = Some(0);
    finished.authorities.push(FighterAuthority::Player {
        character: id(10),
        owner: addr(99),
    });
    finished.combat.fighters.push(seat);
    let facts = contributions(
        vec![fight_obj(&in_temple(first.clone())), fight_obj(&next)],
        vec![fight_obj(&finished)],
        vec![
            completed(10, true),
            joined(next.id, 10),
            completed(10, true),
        ],
    )
    .unwrap();
    assert_eq!(
        facts
            .iter()
            .map(|fact| fact.dungeon_fight)
            .collect::<Vec<_>>(),
        [Some(first.id), Some(next.id)]
    );
}

#[test]
fn gathering_jobs_zones_feeding_and_kolizeum_count_once() {
    let gathered = game_event(
        "gathering",
        "ResourceGathered",
        &(
            "world",
            1u32,
            2u32,
            addr(2),
            "wheat",
            1u8,
            17u64,
            10u64,
            false,
        ),
    );
    let rare = game_event(
        "gathering",
        "RareGathered",
        &("world", 1u32, 2u32, addr(2), "wheat", "golden_wheat"),
    );
    let crafted = game_event(
        "crafting",
        "Crafted",
        &(id(1), id(10), addr(2), id(3), 100u16, 10u16, 300u64),
    );
    let fed = game_event("pet", "PetFed", &(id(5), addr(2), 500u64));
    let paid = game_event("kolizeum", "KolizeumPaid", &(id(6), addr(2), u64::MAX));
    let facts = contributions(vec![], vec![], vec![gathered, rare, crafted, fed, paid]).unwrap();
    let total = |metric| {
        facts
            .iter()
            .filter(|fact| fact.metric == metric)
            .map(|fact| fact.amount)
            .sum::<u64>()
    };
    // 17 units + 1 rare find; job XP from gathering and crafting only
    assert_eq!((total(Metric::Gathering), total(Metric::Jobs)), (18, 310));
    assert!(facts.contains(&Contribution::new(Metric::Feeding, addr(2), 1)));
    assert!(facts.contains(&Contribution::new(Metric::Kolizeum, addr(2), u64::MAX)));

    // Discovery counts a new Zone object, never a fresh search of a known one.
    let zone = |seed| {
        obj(
            id(8),
            OwnerKind::Shared,
            game("zone", "Zone"),
            &decode::Zone {
                id: id(8),
                world: "01_first_shore".into(),
                zone_x: 97,
                zone_z: 98,
                seed,
                searched_at_ms: 1,
                mob_taken: 5,
                res_taken: vec![1, 2],
            },
        )
    };
    assert_eq!(
        contributions(vec![], vec![zone(1)], vec![]).unwrap(),
        [Contribution::new(Metric::Zones, addr(99), 1)]
    );
    let searched = game_event(
        "zone",
        "ZoneSearched",
        &("01_first_shore", 97u32, 98u32, 2u64, true),
    );
    let refreshed = contributions(vec![zone(1)], vec![zone(2)], vec![searched]).unwrap();
    assert!(refreshed.is_empty());
}
