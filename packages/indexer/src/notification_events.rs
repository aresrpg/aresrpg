// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Confirmed social moments from the same checkpoint inputs as gameplay projections.
use anyhow::Result;
use serde_json::{json, Value};
use std::collections::BTreeSet;

use crate::decode::{self, Fight, FighterAuthority, FighterKind, Id};
use crate::events;
use crate::ownership::ObjView;
use crate::publish::TxView;

pub(crate) fn game_object(view: &ObjView<'_>, game: &str, module: &str, name: &str) -> bool {
    view.type_key.package == game && view.type_key.module == module && view.type_key.name == name
}

pub(crate) fn fights(views: &[ObjView<'_>], game: &str) -> Result<Vec<Fight>> {
    views
        .iter()
        .filter(|view| game_object(view, game, "fight", "Fight"))
        .map(|view| decode::from_bytes(view.bytes))
        .collect()
}

fn victory(tx: &TxView<'_>, game: &str, id: Id, winner: Option<u8>) -> Result<Option<Value>> {
    let Some(fight) = fights(tx.outputs, game)?
        .into_iter()
        .chain(fights(tx.inputs, game)?)
        .find(|fight| fight.id == id)
    else {
        return Ok(None);
    };
    let Some(dungeon) = fight.dungeon else {
        return Ok(None);
    };
    if fight.rewards.weight == 0 || winner.is_none() {
        return Ok(None);
    }
    let mut winners = BTreeSet::new();
    let mut mobs = Vec::new();
    for (authority, row) in fight.authorities.iter().zip(&fight.combat.fighters) {
        match (authority, &row.kind) {
            (FighterAuthority::Player { owner, .. }, _)
                if !row.forfeited && Some(row.team) == winner =>
            {
                winners.insert(owner.hex());
            }
            (_, FighterKind::Mob(mob)) => mobs.push(mob.mob_type.clone()),
            _ => (),
        }
    }
    if winners.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        json!({ "kind": "victory", "fight": id.hex(), "dungeon": dungeon.dungeon,
        "winners": winners, "mob_types": mobs }),
    ))
}

pub fn extract(
    checkpoint: u64,
    timestamp: u64,
    tx: &TxView<'_>,
    digest: &str,
    game: &str,
) -> Result<Vec<Value>> {
    let mut result = Vec::new();
    for event in tx.events.iter().filter(|event| event.package == game) {
        let notification = match (event.module, event.name) {
            ("gathering", "RareGathered") => {
                let gathered: events::RareGathered = decode::from_bytes(event.bytes)?;
                Some(
                    json!({ "kind": "gather", "address": gathered.gatherer.hex(),
                    "item_type": gathered.rare_item_type, "world": gathered.world }),
                )
            }
            ("fight", "FightEnded") => {
                let ended: events::FightEnded = decode::from_bytes(event.bytes)?;
                victory(tx, game, ended.fight, ended.winner)?
            }
            _ => None,
        };
        if let Some(mut notification) = notification {
            notification["id"] = json!(format!(
                "{checkpoint}:{}:{}:event",
                tx.tx_index, event.index
            ));
            result.push(notification);
        }
    }
    result.extend(crate::notification_loot::extract(checkpoint, tx, game)?);
    for row in &mut result {
        row["digest"] = json!(digest);
        row["ts_ms"] = json!(timestamp);
    }
    Ok(result)
}

#[cfg(test)]
#[path = "../tests/notifications/events.rs"]
mod tests;
