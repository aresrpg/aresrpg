use super::*;
use crate::decode::{
    CombatState, DungeonTag, FightRewards, Fighter, FighterKind, FighterStats, GridSpec,
    MobSnapshot, Sheet,
};
use crate::ownership::{OwnerKind, TypeKey};
use crate::publish::EventView;

const GAME: &str = "0xgame";

fn fighter(team: u8, mob: bool) -> Fighter {
    Fighter {
        team,
        kind: if mob {
            FighterKind::Mob(MobSnapshot {
                mob_type: "wooling".into(),
                level: 1,
                kit: vec![],
                xp: 10,
                loot: vec![],
            })
        } else {
            FighterKind::Player
        },
        stats: FighterStats {
            sheet: Sheet {
                strength: 0,
                intelligence: 0,
                chance: 0,
                agility: 0,
                wisdom: 0,
                raw_damage: 0,
                critical: 0,
                range_bonus: 0,
                level: 1,
            },
            max_hp: 100,
            base_ap: 6,
            base_mp: 3,
            earth_resistance: 0,
            fire_resistance: 0,
            water_resistance: 0,
            air_resistance: 0,
        },
        cell: 0,
        ready: true,
        dead: false,
        settled: false,
        forfeited: false,
        hp: 100,
        ap: 6,
        mp: 3,
        drops: vec![],
        effects: vec![],
        cooldowns: vec![],
    }
}

fn fight(id: u8, owners: &[u8], mobs: usize) -> Fight {
    let authorities = owners
        .iter()
        .enumerate()
        .map(|(seat, owner)| FighterAuthority::Player {
            character: Id([seat as u8 + 10; 32]),
            owner: Addr([*owner; 32]),
        })
        .chain((0..mobs).map(|_| FighterAuthority::Mob))
        .collect();
    Fight {
        id: Id([id; 32]),
        world: "world".into(),
        x: 1,
        z: 2,
        access_a: 0,
        access_b: 255,
        opener_a: None,
        opener_b: None,
        authorities,
        combat: CombatState {
            board: GridSpec {
                width: 2,
                height: 2,
                shape_mask: vec![15],
                obstacles: vec![],
                holes: vec![],
                start_cells_a: vec![0],
                start_cells_b: vec![3],
            },
            closed: vec![],
            fighters: owners
                .iter()
                .map(|_| fighter(0, false))
                .chain((0..mobs).map(|_| fighter(1, true)))
                .collect(),
            zones: vec![],
            queue: vec![],
            turn_pointer: 0,
            round: 1,
            ended: true,
            winner: Some(0),
            turn_seed: 0,
            turn_cast_index: 0,
            turn_casts: vec![],
            placement_started_ms: 0,
            turn_started_ms: 0,
        },
        dungeon: None,
        door_policy: 0,
        drops_rolled: false,
        next_turn_entropy: 0,
        loot_entropy_ready: true,
        rewards: FightRewards {
            weight: 0,
            paid: None,
        },
    }
}

struct Object {
    id: Id,
    key: TypeKey,
    bytes: Vec<u8>,
}

fn object<T: Serialize>(id: Id, module: &str, name: &str, value: &T) -> Object {
    Object {
        id,
        key: TypeKey {
            package: GAME.into(),
            module: module.into(),
            name: name.into(),
            type_params: vec![],
        },
        bytes: bcs::to_bytes(value).unwrap(),
    }
}
fn fight_object(fight: &Fight) -> Object {
    object(fight.id, "fight", "Fight", fight)
}
fn view(object: &Object) -> ObjView<'_> {
    ObjView {
        id: object.id,
        version: 1,
        owner: OwnerKind::Address(Addr([77; 32])),
        type_key: &object.key,
        bytes: &object.bytes,
    }
}
fn event<'a>(module: &'a str, name: &'a str, bytes: &'a [u8]) -> EventView<'a> {
    EventView {
        package: GAME,
        module,
        name,
        bytes,
        type_params: &[],
        index: 0,
    }
}
fn run(
    inputs: &[Object],
    outputs: &[Object],
    events: &[EventView<'_>],
) -> Result<Vec<Contribution>> {
    extract(
        &TxView {
            tx_index: 0,
            sender: Addr([99; 32]),
            move_calls: &[],
            events,
            inputs: &inputs.iter().map(view).collect::<Vec<_>>(),
            outputs: &outputs.iter().map(view).collect::<Vec<_>>(),
        },
        GAME,
    )
}
fn character(id: u8, xp: u64) -> Character {
    Character {
        id: Id([id; 32]),
        name: "character".into(),
        classe: "senshi".into(),
        sex: "male".into(),
        experience: xp,
        level: 1,
        color_1: 0,
        color_2: 0,
        color_3: 0,
        vitality: 0,
        wisdom: 0,
        strength: 0,
        intelligence: 0,
        chance: 0,
        agility: 0,
        available_points: 0,
        available_spell_points: 0,
    }
}

#[test]
fn kills_dedupe_owners_include_dead_winners_and_exclude_forfeits() {
    let mut fight = fight(1, &[2, 2, 2, 2, 3, 4], 6);
    fight.combat.fighters[4].dead = true;
    fight.combat.fighters[5].forfeited = true;
    let ended = bcs::to_bytes(&(fight.id, "world", 1u32, 2u32, Some(0u8))).unwrap();
    let facts = run(
        &[],
        &[fight_object(&fight)],
        &[event("fight", "FightEnded", &ended)],
    )
    .unwrap();
    assert_eq!(
        facts,
        vec![
            Contribution::new(Metric::Kills, Addr([2; 32]), 6),
            Contribution::new(Metric::Kills, Addr([3; 32]), 6)
        ]
    );
    assert!(run(&[fight_object(&fight)], &[fight_object(&fight)], &[])
        .unwrap()
        .is_empty());
    for winner in [None, Some(1u8)] {
        let ended = bcs::to_bytes(&(fight.id, "world", 1u32, 2u32, winner)).unwrap();
        assert!(run(
            &[],
            &[fight_object(&fight)],
            &[event("fight", "FightEnded", &ended)]
        )
        .unwrap()
        .is_empty());
    }
}

#[test]
fn settlement_and_close_credit_the_authorized_sender_not_later_custody() {
    let mut fight = fight(1, &[99], 6);
    fight.combat.ended = false;
    fight.combat.winner = None;
    let before = character(10, 100);
    let after = character(10, 250);
    let ended = bcs::to_bytes(&(fight.id, "world", 1u32, 2u32, Some(0u8))).unwrap();
    let facts = run(
        &[
            fight_object(&fight),
            object(before.id, "character", "Character", &before),
        ],
        &[object(after.id, "character", "Character", &after)],
        &[event("fight", "FightEnded", &ended)],
    )
    .unwrap();
    assert!(facts.contains(&Contribution::new(Metric::Xp, Addr([99; 32]), 150)));
    assert!(facts.contains(&Contribution::new(Metric::Kills, Addr([99; 32]), 6)));
    let transfer = run(
        &[object(after.id, "character", "Character", &after)],
        &[object(after.id, "character", "Character", &after)],
        &[],
    )
    .unwrap();
    assert!(transfer.is_empty());
}

#[test]
fn dungeon_completions_match_characters_to_multiple_fights_in_one_ptb() {
    let mut first = fight(1, &[2], 6);
    first.dungeon = Some(DungeonTag {
        dungeon: "temple".into(),
        room: 3,
    });
    let mut second = fight(2, &[3], 6);
    second.dungeon = first.dungeon.clone();
    second.authorities[0] = FighterAuthority::Player {
        character: Id([11; 32]),
        owner: Addr([3; 32]),
    };
    let a = bcs::to_bytes(&(Id([10; 32]), "world", 3u64, true)).unwrap();
    let b = bcs::to_bytes(&(Id([11; 32]), "world", 3u64, true)).unwrap();
    let facts = run(
        &[fight_object(&first), fight_object(&second)],
        &[],
        &[
            event("dungeon", "DungeonEnded", &a),
            event("dungeon", "DungeonEnded", &b),
        ],
    )
    .unwrap();
    assert_eq!(facts[0].dungeon_fight, Some(first.id));
    assert_eq!(facts[1].dungeon_fight, Some(second.id));
    assert_eq!(facts[1].address, Addr([3; 32]));
    let lost = bcs::to_bytes(&(Id([10; 32]), "world", 3u64, false)).unwrap();
    assert!(run(&[], &[], &[event("dungeon", "DungeonEnded", &lost)])
        .unwrap()
        .is_empty());
}

#[test]
fn gather_counts_units_and_rare_bonus_jobs_count_only_craft_and_gather() {
    let gather = bcs::to_bytes(&(
        "world",
        1u32,
        2u32,
        Addr([2; 32]),
        "wheat",
        1u8,
        17u64,
        10u64,
        false,
    ))
    .unwrap();
    let rare =
        bcs::to_bytes(&("world", 1u32, 2u32, Addr([2; 32]), "wheat", "golden_wheat")).unwrap();
    let craft = bcs::to_bytes(&(
        Id([1; 32]),
        Id([10; 32]),
        Addr([2; 32]),
        Id([3; 32]),
        100u16,
        10u16,
        300u64,
    ))
    .unwrap();
    let feed = bcs::to_bytes(&(Id([5; 32]), Addr([2; 32]), 500u64)).unwrap();
    let paid = bcs::to_bytes(&(Id([6; 32]), Addr([2; 32]), u64::MAX)).unwrap();
    let facts = run(
        &[],
        &[],
        &[
            event("gathering", "ResourceGathered", &gather),
            event("gathering", "RareGathered", &rare),
            event("crafting", "Crafted", &craft),
            event("pet", "PetFed", &feed),
            event("kolizeum", "KolizeumPaid", &paid),
            event("forgemagie", "RuneScribed", &[]),
        ],
    )
    .unwrap();
    assert_eq!(
        facts
            .iter()
            .filter(|f| f.metric == Metric::Gathering)
            .map(|f| f.amount)
            .sum::<u64>(),
        18
    );
    assert_eq!(
        facts
            .iter()
            .filter(|f| f.metric == Metric::Jobs)
            .map(|f| f.amount)
            .sum::<u64>(),
        310
    );
    assert!(facts.contains(&Contribution::new(Metric::Feeding, Addr([2; 32]), 1)));
    assert!(facts.contains(&Contribution::new(
        Metric::Kolizeum,
        Addr([2; 32]),
        u64::MAX
    )));
}

#[test]
fn discovery_counts_new_zone_objects_not_fresh_search_events() {
    let zone = object(Id([8; 32]), "zone", "Zone", &0u8);
    assert_eq!(
        run(&[], &[zone], &[]).unwrap(),
        vec![Contribution::new(Metric::Zones, Addr([99; 32]), 1)]
    );
    let old = object(Id([8; 32]), "zone", "Zone", &0u8);
    let refreshed = object(Id([8; 32]), "zone", "Zone", &1u8);
    assert!(
        run(&[old], &[refreshed], &[event("zone", "ZoneSearched", &[])])
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_transferred_character_can_settle_while_its_old_fight_is_closed() {
    let mut old = fight(1, &[3, 99], 6);
    old.combat.fighters[0].settled = true;
    old.combat.fighters[1].settled = true;
    let current = fight(2, &[99], 6);
    let before = character(10, 100);
    let after = character(10, 250);
    let facts = run(
        &[
            fight_object(&old),
            fight_object(&current),
            object(before.id, "character", "Character", &before),
        ],
        &[object(after.id, "character", "Character", &after)],
        &[],
    )
    .unwrap();
    assert_eq!(
        facts,
        vec![Contribution::new(Metric::Xp, Addr([99; 32]), 150)]
    );
}

#[test]
fn a_seat_joined_and_settled_in_one_transaction_has_no_input_seat() {
    let mut before = fight(1, &[2], 6);
    before.dungeon = Some(DungeonTag {
        dungeon: "temple".into(),
        room: 3,
    });
    before.combat.ended = false;
    before.combat.winner = None;
    let mut after = before.clone();
    after.combat.ended = true;
    after.combat.winner = Some(0);
    after.authorities.push(FighterAuthority::Player {
        character: Id([11; 32]),
        owner: Addr([99; 32]),
    });
    let mut joined = fighter(0, false);
    joined.settled = true;
    after.combat.fighters.push(joined);
    let joined = bcs::to_bytes(&(after.id, Id([11; 32]), 0u8)).unwrap();
    let completed = bcs::to_bytes(&(Id([11; 32]), "world", 3u64, true)).unwrap();
    let facts = run(
        &[fight_object(&before)],
        &[fight_object(&after)],
        &[
            event("fight", "FighterJoined", &joined),
            event("dungeon", "DungeonEnded", &completed),
        ],
    )
    .unwrap();
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].address, Addr([99; 32]));
    assert_eq!(facts[0].dungeon_fight, Some(after.id));
}

#[test]
fn consecutive_completions_for_one_character_follow_certified_event_order() {
    let mut first = fight(1, &[99], 6);
    first.dungeon = Some(DungeonTag {
        dungeon: "one_room".into(),
        room: 1,
    });
    let mut second = fight(2, &[99], 6);
    second.authorities[0] = FighterAuthority::Player {
        character: Id([11; 32]),
        owner: Addr([99; 32]),
    };
    second.dungeon = first.dungeon.clone();
    second.combat.ended = false;
    second.combat.winner = None;
    let mut after = second.clone();
    after.combat.ended = true;
    after.combat.winner = Some(0);
    after.authorities.push(FighterAuthority::Player {
        character: Id([10; 32]),
        owner: Addr([99; 32]),
    });
    let mut joined = fighter(0, false);
    joined.settled = true;
    after.combat.fighters.push(joined);
    let completed = bcs::to_bytes(&(Id([10; 32]), "world", 1u64, true)).unwrap();
    let join = bcs::to_bytes(&(second.id, Id([10; 32]), 0u8)).unwrap();
    let facts = run(
        &[fight_object(&first), fight_object(&second)],
        &[fight_object(&after)],
        &[
            event("dungeon", "DungeonEnded", &completed),
            event("fight", "FighterJoined", &join),
            event("dungeon", "DungeonEnded", &completed),
        ],
    )
    .unwrap();
    assert_eq!(
        facts
            .iter()
            .map(|fact| fact.dungeon_fight)
            .collect::<Vec<_>>(),
        vec![Some(first.id), Some(second.id)]
    );
}

#[test]
fn a_new_character_can_join_win_and_close_without_a_final_fight_object() {
    let mut before = fight(1, &[99, 99], 6);
    before.combat.ended = false;
    before.combat.winner = None;
    before.combat.fighters[0].forfeited = true;
    before.combat.fighters[0].settled = true;
    let joined = bcs::to_bytes(&(before.id, Id([12; 32]), 0u8)).unwrap();
    let forfeited = bcs::to_bytes(&(before.id, 1u64)).unwrap();
    let ended = bcs::to_bytes(&(before.id, "world", 1u32, 2u32, Some(0u8))).unwrap();
    let character = character(12, 60);
    let facts = run(
        &[fight_object(&before)],
        &[object(character.id, "character", "Character", &character)],
        &[
            event("fight", "FighterJoined", &joined),
            event("fight", "FighterForfeited", &forfeited),
            event("fight", "FightEnded", &ended),
        ],
    )
    .unwrap();
    assert_eq!(
        facts,
        vec![
            Contribution::new(Metric::Xp, Addr([99; 32]), 60),
            Contribution::new(Metric::Kills, Addr([99; 32]), 6)
        ]
    );
}
