// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
use crate::decode::Tournament;
use serde_json::{json, Value};

pub fn row(t: &Tournament, version: u64) -> Value {
    json!({
        "id": t.id.hex(), "version": version.to_string(), "name": t.name, "status": t.status,
        "organizer": t.organizer.hex(), "format": t.format, "start_before_ms": t.start_before_ms,
        "sui_bps": t.sui_bps, "token_bps": t.token_bps,
        "sui_pool": t.sui.value.to_string(), "kares_pool": t.kares_pool.map(|id| id.hex()),
        "sui_total": t.sui_total.to_string(),
        "rewards": t.rewards.iter().map(|r| json!({"place": r.place, "template": r.template.hex(), "amount": r.amount})).collect::<Vec<_>>(),
        "teams": t.teams.iter().map(|team| json!({
            "name": team.name, "revision": team.revision.to_string(), "place": team.place,
            "allowed": team.allowed.iter().map(|id| id.hex()).collect::<Vec<_>>(),
            "seats": team.seats.iter().map(|seat| json!({
                "character": seat.character.hex(), "owner": seat.owner.hex(),
                "sui_claimed": seat.sui_claimed, "items_claimed": seat.items_claimed.to_string(),
            })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
        "matches": t.matches.iter().zip(t.fights.iter()).map(|(m, fight)| json!({
            "a": m.a, "b": m.b, "available_ms": m.available_ms, "state": m.state,
            "winner": m.winner, "loser": m.loser, "fight": fight.map(|id| id.hex()),
        })).collect::<Vec<_>>(),
    })
}

/// Claimed history does not need a permanent directory subscription. Fight recovery has its own links.
pub fn pending(t: &Tournament, team: usize, seat: usize) -> bool {
    let roster = &t.teams[team];
    let member = &roster.seats[seat];
    t.status == "finished"
        && roster.place > 0
        && ((!member.sui_claimed && t.sui.value > 0 && t.sui_bps[roster.place as usize - 1] > 0)
            || t.rewards.iter().enumerate().any(|(i, reward)| {
                reward.place == roster.place && member.items_claimed & (1u64 << i) == 0
            }))
}

#[cfg(test)]
#[path = "../test/tournament.rs"]
mod tests;
