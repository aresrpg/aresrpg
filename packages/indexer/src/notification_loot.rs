// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! New rolled gear must reconcile to a winning seat's consumed drop budget.
use anyhow::Result;
use serde_json::{json, Value};
use std::collections::BTreeMap;

use crate::decode::{self, Field, FighterAuthority, Item, MarkerKey, RolledStats};
use crate::events;
use crate::graph::field_key;
use crate::notification_events::{fights, game_object};
use crate::ownership::{self, Custody, OwnerKind};
use crate::publish::TxView;

type Budget = BTreeMap<String, u64>;

fn claimed(tx: &TxView<'_>, game: &str) -> Result<Budget> {
    let after = fights(tx.outputs, game)?;
    let mut budgets = Budget::new();
    for fight in fights(tx.inputs, game)? {
        if !fight.combat.ended {
            continue;
        }
        let output = after.iter().find(|other| other.id == fight.id);
        for (seat, (authority, row)) in fight
            .authorities
            .iter()
            .zip(&fight.combat.fighters)
            .enumerate()
        {
            let FighterAuthority::Player { owner, character } = authority else {
                continue;
            };
            if *owner != tx.sender
                || row.settled
                || row.forfeited
                || fight.combat.winner != Some(row.team)
            {
                continue;
            }
            if output.is_some_and(|after| !after.combat.fighters[seat].settled) {
                continue;
            }
            // A retired Fight must return this settled seat's Character in the same PTB.
            if output.is_none()
                && !tx.outputs.iter().any(|view| {
                    view.id == *character && game_object(view, game, "character", "Character")
                })
            {
                continue;
            }
            let mut drops = row.drops.clone();
            for event in tx.events.iter().filter(|event| {
                event.package == game && event.module == "fight" && event.name == "DropsRolled"
            }) {
                let rolled: events::DropsRolled = decode::from_bytes(event.bytes)?;
                if rolled.fight == fight.id && rolled.fighter == seat as u64 {
                    drops = rolled.drops
                }
            }
            for drop in drops {
                *budgets.entry(drop.item_type).or_default() += u64::from(drop.qty);
            }
        }
    }
    Ok(budgets)
}

pub fn extract(checkpoint: u64, tx: &TxView<'_>, game: &str) -> Result<Vec<Value>> {
    let budgets = claimed(tx, game)?;
    if budgets.is_empty() {
        return Ok(Vec::new());
    }
    let views = tx
        .inputs
        .iter()
        .chain(tx.outputs)
        .cloned()
        .collect::<Vec<_>>();
    let custody = ownership::resolve(&views, game)?;
    let mut minted = Vec::new();
    for view in tx
        .outputs
        .iter()
        .filter(|view| game_object(view, game, "item", "Item"))
    {
        if tx.inputs.iter().any(|input| input.id == view.id) {
            continue;
        }
        let item: Item = decode::from_bytes(view.bytes)?;
        if !budgets.contains_key(&item.item_type) {
            continue;
        }
        if !custody.iter().any(|fact| matches!(fact, Custody::KioskHolds { object, owner: Some(owner), .. } if *object == item.id && *owner == tx.sender)) { continue }
        let key = format!("{game}::item::StatsKey");
        let Some(field) = tx.outputs.iter().find(|field| {
            field.owner == OwnerKind::Object(item.id)
                && field_key(field.type_key) == Some(key.as_str())
        }) else {
            continue;
        };
        let stats = decode::from_bytes::<Field<MarkerKey, RolledStats>>(field.bytes)?.value;
        // A forged same-PTB result is not an exceptional natural loot roll.
        if stats.revision != 0 {
            continue;
        }
        minted.push((item, stats.statistics));
    }
    let mut totals = BTreeMap::<String, u64>::new();
    for (item, _) in &minted {
        *totals.entry(item.item_type.clone()).or_default() += u64::from(item.amount)
    }
    let mut notifications = Vec::new();
    for (item, statistics) in minted {
        let quantity = budgets[&item.item_type];
        // Extra same-type mints (e.g. crafting in the PTB) cannot be attributed to fight loot.
        if totals[&item.item_type] != quantity {
            continue;
        }
        let stats = serde_json::to_value(statistics)?
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, value)| (key.clone(), json!(value.as_i64().unwrap() - 32768)))
            .collect::<serde_json::Map<String, Value>>();
        notifications.push(json!({ "kind": "loot", "id": format!("{checkpoint}:{}:{}:loot", tx.tx_index, item.id.hex()),
            "address": tx.sender.hex(), "object": item.id.hex(), "item_type": item.item_type,
            "name": item.name, "category": item.category, "level": item.level, "stats": stats }));
    }
    Ok(notifications)
}
