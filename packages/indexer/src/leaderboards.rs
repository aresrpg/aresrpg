// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Certified transaction facts, independent of connections and current ownership.

use std::collections::{BTreeSet, HashMap};

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::decode::{self, Addr, Character, Fight, FighterAuthority, Id};
use crate::events;
use crate::ownership::ObjView;
use crate::publish::TxView;

pub const META_KEY: &str = "leaderboards:meta";
pub const CHANNEL: &str = "evt:leaderboards";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Metric {
    Xp,
    Kills,
    Dungeons,
    Jobs,
    Marketplace,
    Kolizeum,
    Zones,
    Feeding,
    Gathering,
}

impl Metric {
    pub fn key(self) -> &'static str {
        match self {
            Self::Xp => "xp",
            Self::Kills => "kills",
            Self::Dungeons => "dungeons",
            Self::Jobs => "jobs",
            Self::Marketplace => "marketplace",
            Self::Kolizeum => "kolizeum",
            Self::Zones => "zones",
            Self::Feeding => "feeding",
            Self::Gathering => "gathering",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Contribution {
    pub metric: Metric,
    pub address: Addr,
    pub amount: u64,
    /// Only dungeon completions need a marker across transactions and monthly resets.
    pub dungeon_fight: Option<Id>,
}

impl Contribution {
    pub fn new(metric: Metric, address: Addr, amount: u64) -> Self {
        Self {
            metric,
            address,
            amount,
            dungeon_fight: None,
        }
    }
}

fn is_object(view: &ObjView<'_>, game: &str, module: &str, name: &str) -> bool {
    view.type_key.package == game && view.type_key.module == module && view.type_key.name == name
}

#[derive(Debug, Clone, Copy)]
struct Participant {
    character: Id,
    owner: Addr,
    team: u8,
}

#[derive(Debug, Default)]
struct Roster {
    // Indices match Move authority seats. None is a mob or a departed player.
    seats: Vec<Option<Participant>>,
    mob_teams: Vec<u8>,
}

fn rosters(tx: &TxView<'_>, game: &str) -> Result<HashMap<Id, Roster>> {
    let mut rosters = HashMap::new();
    for view in tx
        .inputs
        .iter()
        .chain(tx.outputs)
        .filter(|view| is_object(view, game, "fight", "Fight"))
    {
        if rosters.contains_key(&view.id) {
            continue;
        }
        let fight: Fight = decode::from_bytes(view.bytes)?;
        let mut roster = Roster::default();
        for (authority, row) in fight.authorities.iter().zip(&fight.combat.fighters) {
            let player = match authority {
                FighterAuthority::Player { character, owner } if !row.settled && !row.forfeited => {
                    Some(Participant {
                        character: *character,
                        owner: *owner,
                        team: row.team,
                    })
                }
                FighterAuthority::Mob => {
                    roster.mob_teams.push(row.team);
                    None
                }
                _ => None,
            };
            roster.seats.push(player);
        }
        rosters.insert(view.id, roster);
    }
    Ok(rosters)
}

fn characters(views: &[ObjView<'_>], game: &str) -> Result<HashMap<Id, Character>> {
    views
        .iter()
        .filter(|view| is_object(view, game, "character", "Character"))
        .map(|view| Ok((view.id, decode::from_bytes(view.bytes)?)))
        .collect()
}

fn gained_xp(tx: &TxView<'_>, game: &str) -> Result<Vec<Contribution>> {
    let before = characters(tx.inputs, game)?;
    let after = characters(tx.outputs, game)?;
    let mut gains = Vec::new();
    for (id, character) in after {
        let previous = before.get(&id).map_or(0, |row| row.experience);
        let amount = character
            .experience
            .checked_sub(previous)
            .ok_or_else(|| anyhow::anyhow!("Character XP decreased: {}", id.hex()))?;
        if amount > 0 {
            // Move awards XP only through winning settlement, whose guard requires
            // owner == ctx.sender. The authority gate pins this projection dependency.
            gains.push(Contribution::new(Metric::Xp, tx.sender, amount));
        }
    }
    Ok(gains)
}

fn take_participant(rosters: &mut HashMap<Id, Roster>, character: Id) -> Option<(Id, Participant)> {
    for (fight, roster) in rosters {
        if let Some(seat) = roster
            .seats
            .iter_mut()
            .find(|seat| seat.is_some_and(|player| player.character == character))
        {
            return seat.take().map(|player| (*fight, player));
        }
    }
    None
}

fn kill_contributions(roster: &Roster, winner: Option<u8>) -> Vec<Contribution> {
    let mobs = roster
        .mob_teams
        .iter()
        .filter(|team| Some(**team) != winner)
        .count() as u64;
    if winner.is_none() || mobs == 0 {
        return vec![];
    }
    let mut owners = BTreeSet::new();
    roster
        .seats
        .iter()
        .flatten()
        .filter(|player| Some(player.team) == winner)
        .filter(|player| owners.insert(player.owner.hex()))
        .map(|player| Contribution::new(Metric::Kills, player.owner, mobs))
        .collect()
}

pub fn extract(tx: &TxView<'_>, game: &str) -> Result<Vec<Contribution>> {
    // Existing fights start from INPUT custody; events advance it in certified order.
    // New shared fight openers exist only in outputs and cannot settle in their birth PTB.
    let mut rosters = rosters(tx, game)?;
    let mut facts = gained_xp(tx, game)?;
    for view in tx
        .outputs
        .iter()
        .filter(|view| is_object(view, game, "zone", "Zone"))
    {
        if !tx.inputs.iter().any(|input| input.id == view.id) {
            facts.push(Contribution::new(Metric::Zones, tx.sender, 1));
        }
    }
    for event in tx.events.iter().filter(|event| event.package == game) {
        match (event.module, event.name) {
            ("fight", "FightEnded") => {
                let event: events::FightEnded = decode::from_bytes(event.bytes)?;
                let roster = rosters
                    .get(&event.fight)
                    .ok_or_else(|| anyhow::anyhow!("FightEnded without Fight"))?;
                facts.extend(kill_contributions(roster, event.winner));
            }
            ("fight", "FighterJoined") => {
                let event: events::FighterJoined = decode::from_bytes(event.bytes)?;
                // fight::admit stores ctx.sender() as this seat's owner before emitting.
                take_participant(&mut rosters, event.character);
                let roster = rosters
                    .get_mut(&event.fight)
                    .ok_or_else(|| anyhow::anyhow!("FighterJoined without Fight"))?;
                roster.seats.push(Some(Participant {
                    character: event.character,
                    owner: tx.sender,
                    team: event.team,
                }));
            }
            ("fight", "FighterForfeited") => {
                let event: events::FighterForfeited = decode::from_bytes(event.bytes)?;
                let seat = rosters
                    .get_mut(&event.fight)
                    .and_then(|roster| roster.seats.get_mut(event.fighter as usize))
                    .ok_or_else(|| anyhow::anyhow!("forfeit without a known seat"))?;
                *seat = None;
            }
            ("dungeon", "DungeonRoomCleared") => {
                let event: events::DungeonRoomCleared = decode::from_bytes(event.bytes)?;
                take_participant(&mut rosters, event.character);
            }
            ("dungeon", "DungeonEnded") => {
                let event: events::DungeonEnded = decode::from_bytes(event.bytes)?;
                let seat = take_participant(&mut rosters, event.character);
                // Staging abandonment has no fight; only a successful completion requires one.
                if event.won {
                    let (fight, player) = seat.ok_or_else(|| {
                        anyhow::anyhow!(
                            "dungeon completion without active custody: {}",
                            event.character.hex()
                        )
                    })?;
                    facts.push(Contribution {
                        metric: Metric::Dungeons,
                        address: player.owner,
                        amount: 1,
                        dungeon_fight: Some(fight),
                    });
                }
            }
            ("gathering", "ResourceGathered") => {
                let event: events::ResourceGathered = decode::from_bytes(event.bytes)?;
                facts.push(Contribution::new(
                    Metric::Gathering,
                    event.gatherer,
                    event.quantity,
                ));
                facts.push(Contribution::new(
                    Metric::Jobs,
                    event.gatherer,
                    event.job_xp_gained,
                ));
            }
            ("gathering", "RareGathered") => {
                let event: events::RareGathered = decode::from_bytes(event.bytes)?;
                facts.push(Contribution::new(Metric::Gathering, event.gatherer, 1));
            }
            ("crafting", "Crafted") => {
                let event: events::Crafted = decode::from_bytes(event.bytes)?;
                facts.push(Contribution::new(
                    Metric::Jobs,
                    event.crafter,
                    event.job_xp_gained,
                ));
            }
            ("kolizeum", "KolizeumPaid") => {
                let event: events::KolizeumPaid = decode::from_bytes(event.bytes)?;
                facts.push(Contribution::new(
                    Metric::Kolizeum,
                    event.winner,
                    event.amount,
                ));
            }
            ("pet", "PetFed") => {
                let event: events::PetFed = decode::from_bytes(event.bytes)?;
                facts.push(Contribution::new(Metric::Feeding, event.feeder, 1));
            }
            _ => (),
        }
    }
    Ok(facts)
}

#[cfg(test)]
#[path = "../tests/leaderboards/extract.rs"]
mod tests;

#[cfg(test)]
#[path = "../tests/leaderboards/authority.rs"]
mod authority_tests;
