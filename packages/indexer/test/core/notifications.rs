// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The Discord feed: confirmed social moments, never a guess.

use serde_json::json;

use super::*;
use crate::decode::{self, DungeonTag, Field, FighterKind, LootEntry, RolledDrop, RolledStats};
use crate::pipeline::OwnedObj;

fn of_kind(writes: &[Write], kind: &str) -> Vec<Value> {
    notifications(writes)
        .into_iter()
        .filter(|row| row["kind"] == kind)
        .collect()
}

#[test]
fn rare_finds_and_boss_victories_are_one_confirmed_card() {
    let rare = game_event(
        "gathering",
        "RareGathered",
        &("nauvis", 1u32, 2u32, addr(7), "wheat", "golden_wheat"),
    );
    let writes = run(&[OwnedTx {
        sender: addr(99),
        events: vec![rare],
        ..tx()
    }]);
    let cards = of_kind(&writes, "gather");
    assert_eq!(cards.len(), 1);
    // the actual finder, not the sender
    assert_eq!(cards[0]["address"], addr(7).hex());
    assert_eq!(cards[0]["item_type"], "golden_wheat");
    assert_eq!(cards[0]["id"], "100:0:0:event");
    assert_eq!(
        (&cards[0]["digest"], &cards[0]["ts_ms"]),
        (&json!("digest"), &json!(1000))
    );

    // A boss victory is one party card: winners deduplicate and a forfeit never counts.
    let mut boss = fight(1, &[7, 7, 8, 9], 1);
    boss.dungeon = Some(DungeonTag {
        dungeon: "gilded_lorito".into(),
        room: 7,
    });
    boss.rewards.weight = 20;
    boss.combat.fighters[3].forfeited = true;
    let ended = |fight: &decode::Fight, winner: Option<u8>| OwnedTx {
        events: vec![game_event(
            "fight",
            "FightEnded",
            &(fight.id, "nauvis", 1u32, 2u32, winner),
        )],
        inputs: vec![fight_obj(fight)],
        outputs: vec![fight_obj(fight)],
        ..tx()
    };
    let cards = of_kind(&run(&[ended(&boss, Some(0))]), "victory");
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["winners"], json!([addr(7).hex(), addr(8).hex()]));
    // never a defeat, never an ordinary room
    assert!(of_kind(&run(&[ended(&boss, Some(1))]), "victory").is_empty());
    boss.rewards.weight = 0;
    assert!(of_kind(&run(&[ended(&boss, Some(0))]), "victory").is_empty());
}

/// A settlement claiming one rolled golden hood into the player's personal kiosk.
struct Loot {
    before: decode::Fight,
    after: OwnedObj,
    owner: OwnedObj,
    item: decode::Item,
    wrapper: OwnedObj,
    stats: Field<bool, RolledStats>,
}

fn loot() -> Loot {
    let mut before = fight(1, &[7], 2);
    // Only the defeated mob whose loot table holds the item is its source.
    if let FighterKind::Mob(mob) = &mut before.combat.fighters[1].kind {
        mob.mob_type = "golden_lorito".into();
        mob.loot = vec![LootEntry {
            item_type: "lorito_hat__golden".into(),
            chance_bp: 100,
            min_qty: 1,
            max_qty: 1,
        }];
    }
    before.drops_rolled = true;
    before.combat.fighters[0].drops = vec![RolledDrop {
        item_type: "lorito_hat__golden".into(),
        qty: 1,
    }];
    let mut after = before.clone();
    after.combat.fighters[0].settled = true;
    after.combat.fighters[0].drops.clear();
    let item = decode::Item {
        id: id(20),
        template: id(21),
        name: "Golden Lorito Hood".into(),
        item_type: "lorito_hat__golden".into(),
        category: "hat".into(),
        level: 16,
        amount: 1,
    };
    let owner = OwnedObj {
        owner: OwnerKind::Object(id(25)),
        ..super::market::owner_marker()
    };
    let owner = OwnedObj {
        bytes: bcs(&Field {
            id: owner.id,
            name: false,
            value: addr(7),
        }),
        ..owner
    };
    let statistics = serde_json::from_value(json!({ "vitality": 32817, "wisdom": 32768,
        "strength": 32768, "intelligence": 32816, "chance": 32768, "agility": 32768,
        "range": 32768, "movement": 32768, "action": 32768, "critical": 32770,
        "raw_damage": 32768, "earth_resistance": 32768, "fire_resistance": 32768,
        "water_resistance": 32768, "air_resistance": 32768 }))
    .unwrap();
    Loot {
        after: fight_obj(&after),
        before,
        owner,
        wrapper: kiosk_wrapper(id(22), id(25), id(20)),
        stats: Field {
            id: id(24),
            name: false,
            value: RolledStats {
                statistics,
                puits: 0,
                revision: 0,
            },
        },
        item,
    }
}

impl Loot {
    fn item(&self, amount: u32) -> OwnedObj {
        obj(
            self.item.id,
            OwnerKind::Object(id(22)),
            game("item", "Item"),
            &decode::Item {
                amount,
                ..self.item.clone()
            },
        )
    }

    fn stats(&self, revision: u64) -> OwnedObj {
        let mut stats = self.stats.clone();
        stats.value.revision = revision;
        obj(
            id(24),
            OwnerKind::Object(self.item.id),
            field(
                &format!("{GAME}::item::StatsKey"),
                &format!("{GAME}::item::RolledStats"),
            ),
            &stats,
        )
    }

    /// The claim transaction: settled fight, new item in the kiosk, its natural stats.
    fn claim(&self) -> OwnedTx {
        OwnedTx {
            inputs: vec![fight_obj(&self.before), self.owner.clone()],
            outputs: vec![
                self.after.clone(),
                self.item(1),
                self.wrapper.clone(),
                self.stats(0),
            ],
            ..tx()
        }
    }
}

#[test]
fn loot_cards_follow_the_settled_drop_budget_into_personal_custody() {
    let loot = loot();
    let claim = loot.claim();
    let cards = of_kind(&run(std::slice::from_ref(&claim)), "loot");
    assert_eq!(cards.len(), 1);
    assert_eq!(cards[0]["stats"]["vitality"], 49);
    assert_eq!(cards[0]["address"], addr(7).hex());
    assert_eq!(cards[0]["mob_types"], json!(["golden_lorito"]));
    assert_eq!(cards[0]["amount"], 1);
    assert_eq!(
        cards[0]["sources"],
        json!([{ "mob_type": "golden_lorito", "chance_bp": 100 }])
    );
    let cards_of = |tx: OwnedTx| of_kind(&run(&[tx]), "loot");
    // A statless item still reconciles to the consumed budget.
    let plain = OwnedTx {
        outputs: claim.outputs[..3].to_vec(),
        ..claim.clone()
    };
    assert_eq!(cards_of(plain.clone())[0]["stats"], json!({}));
    // A deposit into an existing stack reports only the confirmed increase; a larger gain is
    // not a fight drop.
    let stacked = |after| OwnedTx {
        inputs: [claim.inputs.clone(), vec![loot.item(10)]].concat(),
        outputs: vec![
            claim.outputs[0].clone(),
            loot.item(after),
            loot.wrapper.clone(),
        ],
        ..claim.clone()
    };
    assert_eq!(cards_of(stacked(11))[0]["amount"], 1);
    assert!(cards_of(stacked(12)).is_empty());
    // Another sender, a missing personal owner, an existing item or a forged roll: no card.
    assert!(cards_of(OwnedTx {
        sender: addr(8),
        ..claim.clone()
    })
    .is_empty());
    assert!(cards_of(OwnedTx {
        inputs: claim.inputs[..1].to_vec(),
        ..claim.clone()
    })
    .is_empty());
    assert!(cards_of(OwnedTx {
        inputs: [claim.inputs.clone(), vec![loot.item(1)]].concat(),
        ..claim.clone()
    })
    .is_empty());
    assert!(cards_of(OwnedTx {
        outputs: [claim.outputs[..3].to_vec(), vec![loot.stats(1)]].concat(),
        ..claim.clone()
    })
    .is_empty());
    // An unowned extra mint does not become the player's loot.
    let extra = obj(
        id(26),
        OwnerKind::Object(id(77)),
        game("item", "Item"),
        &decode::Item {
            id: id(26),
            ..loot.item.clone()
        },
    );
    assert_eq!(
        cards_of(OwnedTx {
            outputs: [claim.outputs.clone(), vec![extra]].concat(),
            ..claim.clone()
        })
        .len(),
        1
    );
    // A first settlement carries its budget in DropsRolled rather than in pre-state.
    let mut unrolled = loot.before.clone();
    unrolled.drops_rolled = false;
    unrolled.combat.fighters[0].drops.clear();
    let first = OwnedTx {
        inputs: vec![fight_obj(&unrolled), loot.owner.clone()],
        ..claim.clone()
    };
    let rolled = game_event(
        "fight",
        "DropsRolled",
        &(
            id(1),
            0u64,
            vec![RolledDrop {
                item_type: loot.item.item_type.clone(),
                qty: 1,
            }],
            0u64,
        ),
    );
    assert_eq!(
        cards_of(OwnedTx {
            events: vec![rolled],
            ..first.clone()
        })
        .len(),
        1
    );
    assert!(cards_of(first).is_empty());
    // The last settlement retires the Fight and returns its Character; an untouched Fight
    // is no claim.
    let retired = OwnedTx {
        outputs: [
            claim.outputs[1..].to_vec(),
            vec![character(id(10), OwnerKind::Object(id(99)))],
        ]
        .concat(),
        ..claim.clone()
    };
    assert_eq!(cards_of(retired).len(), 1);
    assert!(cards_of(OwnedTx {
        outputs: claim.outputs[1..].to_vec(),
        ..claim
    })
    .is_empty());
}
