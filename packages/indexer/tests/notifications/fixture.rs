use crate::decode::*;
use crate::ownership::{ObjView, OwnerKind, TypeKey};
use crate::publish::EventView;
use serde::Serialize;
pub const GAME: &str = "0xgame";
pub fn fighter(team: u8, mob: bool) -> Fighter {
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

pub fn fight(id: u8, owners: &[u8], mobs: usize) -> Fight {
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

pub struct Object {
    pub id: Id,
    pub key: TypeKey,
    pub bytes: Vec<u8>,
}

pub fn object<T: Serialize>(id: Id, module: &str, name: &str, value: &T) -> Object {
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
pub fn fight_object(fight: &Fight) -> Object {
    object(fight.id, "fight", "Fight", fight)
}
pub fn view(object: &Object) -> ObjView<'_> {
    ObjView {
        id: object.id,
        version: 1,
        owner: OwnerKind::Address(Addr([77; 32])),
        type_key: &object.key,
        bytes: &object.bytes,
    }
}
pub fn event<'a>(module: &'a str, name: &'a str, bytes: &'a [u8]) -> EventView<'a> {
    EventView {
        package: GAME,
        module,
        name,
        bytes,
        type_params: &[],
        index: 0,
    }
}
