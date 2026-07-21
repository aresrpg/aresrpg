// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Per-fight ORDERED event journal — the V2 observer-replay transport (#216).
//!
//! Production is a snapshot-adoption system: an observer polls the mutable `Fight`
//! object every 4s and GUESSES the turn history by diffing consecutive reads (lossy,
//! order-unrecoverable, actor-guessed). The cure is identity: one canonical ORDERED
//! LOG of the fight's events, served as immutable cursor pages so every client replays
//! the SAME sequence the actor's own receipt did — no diff-inference.
//!
//! ## The seq — a contiguous per-fight ordinal, assigned at ingest
//! The `ares` event pipeline walks each checkpoint's transactions and events IN ORDER,
//! so `(checkpoint, tx_index, event_index)` is the total order of every event on chain.
//! We record each fight-timeline event into a per-fight Redis SORTED SET
//! `rpc:fight:{id}:journal` (mirroring the sales-log idiom, `project.rs`):
//!   * **score** = the checkpoint sequence number (exact — checkpoints are far below
//!     the 2^53 f64 bound the score is stored as; orders events ACROSS checkpoints).
//!   * **member** = `"{tx_index:06}:{event_index:04}|{payload_json}"` — the zero-padded
//!     `(tx, event)` prefix makes the ZSET's WITHIN-checkpoint (equal-score) lexicographic
//!     tie-break the exact `(tx, event)` order. Together the ZSET is totally ordered by
//!     `(checkpoint, tx, event)` with NO score packing / cap to overflow.
//!
//! The client-facing **seq is the RANK** in that set (contiguous `0..journal_head`), and
//! `journal_head = ZCARD` — derived at read time, never a stored counter (which a crash
//! replay would double-count). A distinct event has a distinct member (its prefix or its
//! payload digest differ), so a crash-replay `ZADD` of the byte-identical member is a
//! no-op — **idempotent**, exactly like every other write in this store (`store.rs`).
//! An idle TTL (refreshed per append) reclaims a settled fight's journal; there is NO
//! rank cap (capping would drop the early seqs and break contiguous replay from 0), and
//! the journal deliberately OUTLIVES `settle_and_destroy`'s doc delete (the post-mortem
//! read a straggler needs for the end card — bug ⑤).
//!
//! ## Scope — the flat board/turn family; the action-envelope triple deferred
//! Journalled: `FightCreated`/`FightJoined`/`Placed`/`Ready`/`TurnStarted`/`Moved`/
//! `MobMoved`/`Displaced`/`Cast`/`CriticalFailure`/`StanceChanged`/`Revealed`/`Hit`/
//! `Drain`/`Tackled`/`TurnEnded`/`Abandoned`/`Victory`/`Defeat`/`Settled`/`Swept` — every
//! FLAT-scalar `fight_events` struct, decoded to its `parsedJson`-shaped fields (u64 as
//! string, u8/u16/u32 as number, bool as bool, `ID`/address as `0x…` hex — byte-shaped
//! IDENTICALLY to the fullnode's `parsedJson`, so the client folds a journal page through
//! the SAME decoder its own receipts use — `sdk/fight_read.js::decode_fight_event`).
//! DEFERRED (returns `None`): the action-envelope triple `ActionStarted`/`ActionEffect`/
//! `ActionResolved` (the latter two carry nested `Effect`/`SpellLevel`/`WeaponLine`
//! vectors — the modelling liability `snapshot.rs` deliberately avoids — and NO client
//! consumes them today; per the pipeline-v2 amendment they ENRICH beats, never trigger
//! them, so they ride a later milestone as one unit), the settlement `Result*`/`LootMinted`
//! artifacts (keyed by result, projected to `/v1/fight-results`), and `CreatorCapIssued`.
//!
//! Pure decode/assemble (unit-tested offline against REAL captured testnet wire below);
//! the impure `(checkpoint, tx, event)` indices + tx digest + post-tx fight version are
//! threaded in by `mod.rs::process` (which alone has the checkpoint context).

use serde_json::{json, Value};
use sui_indexer_alt_framework::types::base_types::ObjectID;

use super::model::*;
use super::project::{expire, zadd, RedisWrite};

/// The per-fight journal sorted set. A DISTINCT key from the fight doc (`rpc:fight:{id}`),
/// so `Settled`/`Swept` deleting the doc leaves the journal intact (the post-mortem read).
pub(super) fn k_fight_journal(fight_id: &str) -> String {
    format!("rpc:fight:{fight_id}:journal")
}

/// Idle TTL, refreshed on every append: a fight settles in minutes, so this bounds a dead
/// journal's lifetime to ~a day past its LAST event (ample for a straggler / reload to
/// fetch the terminal end card), then Redis reclaims it. An active fight keeps refreshing.
const JOURNAL_TTL_SECS: i64 = 24 * 60 * 60;

/// Canonical `0x…` hex for an id/address field (matches the fullnode's `parsedJson`).
fn hex(id: ObjectID) -> String {
    id.to_canonical_string(true)
}

/// Decode one fight board/turn event into `(fight object id, event-kind, parsedJson-shaped
/// data)`, or `None` when the event is not journalled (foreign module, the deferred
/// action-envelope triple, or a settlement/result artifact). The `data` object mirrors the
/// on-chain event field-for-field with the fullnode's `parsedJson` value convention (u64 →
/// string, u8/u16/u32 → number, bool → bool, `ID`/address → hex) so a journal page decodes
/// byte-identically to a receipt. `fight` is the FIRST field of every arm (the journal key).
pub(super) fn decode_journal_event(
    module: &str,
    name: &str,
    contents: &[u8],
) -> Option<(ObjectID, &'static str, Value)> {
    if module != "fight_events" {
        return None;
    }
    Some(match name {
        "FightCreated" => {
            let e: FightCreated = bcs::from_bytes(contents).ok()?;
            (
                e.fight,
                "FightCreated",
                json!({
                    "fight": hex(e.fight), "world": hex(e.world),
                    "spawn_id": e.spawn_id.to_string(),
                    "anchor_x": e.anchor_x, "anchor_z": e.anchor_z,
                    "public_fight": e.public_fight,
                    "aged_bp": e.aged_bp.to_string(), "mob_count": e.mob_count.to_string(),
                }),
            )
        }
        "FightJoined" => {
            let e: FightJoined = bcs::from_bytes(contents).ok()?;
            (e.fight, "FightJoined", json!({
                "fight": hex(e.fight), "character": hex(e.character), "seat": e.seat.to_string(),
            }))
        }
        "Placed" => {
            let e: Placed = bcs::from_bytes(contents).ok()?;
            (e.fight, "Placed", json!({
                "fight": hex(e.fight), "character": hex(e.character), "cell": e.cell.to_string(),
            }))
        }
        "Ready" => {
            let e: Ready = bcs::from_bytes(contents).ok()?;
            (e.fight, "Ready", json!({ "fight": hex(e.fight), "character": hex(e.character) }))
        }
        "TurnStarted" => {
            let e: TurnStarted = bcs::from_bytes(contents).ok()?;
            (e.fight, "TurnStarted", json!({
                "fight": hex(e.fight), "is_mob": e.is_mob,
                "idx": e.idx.to_string(), "deadline_ms": e.deadline_ms.to_string(),
            }))
        }
        "Moved" => {
            let e: Moved = bcs::from_bytes(contents).ok()?;
            (e.fight, "Moved", json!({
                "fight": hex(e.fight), "character": hex(e.character), "to_cell": e.to_cell.to_string(),
            }))
        }
        "MobMoved" => {
            let e: MobMoved = bcs::from_bytes(contents).ok()?;
            (e.fight, "MobMoved", json!({
                "fight": hex(e.fight), "idx": e.idx.to_string(), "to_cell": e.to_cell.to_string(),
            }))
        }
        "Displaced" => {
            let e: Displaced = bcs::from_bytes(contents).ok()?;
            (e.fight, "Displaced", json!({
                "fight": hex(e.fight), "target_is_mob": e.target_is_mob,
                "target_idx": e.target_idx.to_string(), "kind": e.kind,
                "from_cell": e.from_cell.to_string(), "to_cell": e.to_cell.to_string(),
                "requested": e.requested.to_string(), "blocked": e.blocked.to_string(),
            }))
        }
        "Cast" => {
            let e: Cast = bcs::from_bytes(contents).ok()?;
            (e.fight, "Cast", json!({
                "fight": hex(e.fight), "caster_is_mob": e.caster_is_mob,
                "caster_idx": e.caster_idx.to_string(), "target_cell": e.target_cell.to_string(),
            }))
        }
        "CriticalFailure" => {
            let e: CriticalFailure = bcs::from_bytes(contents).ok()?;
            (e.fight, "CriticalFailure", json!({
                "fight": hex(e.fight), "caster_is_mob": e.caster_is_mob,
                "caster_idx": e.caster_idx.to_string(),
            }))
        }
        "StanceChanged" => {
            let e: StanceChanged = bcs::from_bytes(contents).ok()?;
            (e.fight, "StanceChanged", json!({
                "fight": hex(e.fight), "fighter_is_mob": e.fighter_is_mob,
                "fighter_idx": e.fighter_idx.to_string(), "stance": e.stance.to_string(),
                "active": e.active,
            }))
        }
        "Revealed" => {
            let e: Revealed = bcs::from_bytes(contents).ok()?;
            (e.fight, "Revealed", json!({
                "fight": hex(e.fight), "is_mob": e.is_mob, "idx": e.idx.to_string(),
            }))
        }
        "Hit" => {
            let e: Hit = bcs::from_bytes(contents).ok()?;
            (e.fight, "Hit", json!({
                "fight": hex(e.fight), "victim_is_mob": e.victim_is_mob,
                "victim_idx": e.victim_idx.to_string(), "amount": e.amount.to_string(),
                "remaining_hp": e.remaining_hp.to_string(),
            }))
        }
        "Drain" => {
            let e: Drain = bcs::from_bytes(contents).ok()?;
            (e.fight, "Drain", json!({
                "fight": hex(e.fight), "target_is_mob": e.target_is_mob,
                "target_idx": e.target_idx.to_string(), "point_kind": e.point_kind,
                "removed": e.removed.to_string(), "requested": e.requested.to_string(),
            }))
        }
        "Tackled" => {
            let e: Tackled = bcs::from_bytes(contents).ok()?;
            (e.fight, "Tackled", json!({
                "fight": hex(e.fight), "runner_is_mob": e.runner_is_mob,
                "runner_idx": e.runner_idx.to_string(), "ap_lost": e.ap_lost.to_string(),
                "mp_lost": e.mp_lost.to_string(), "num": e.num.to_string(), "den": e.den.to_string(),
            }))
        }
        "TurnEnded" => {
            let e: TurnEnded = bcs::from_bytes(contents).ok()?;
            (e.fight, "TurnEnded", json!({
                "fight": hex(e.fight), "is_mob": e.is_mob, "idx": e.idx.to_string(),
            }))
        }
        "Abandoned" => {
            let e: Abandoned = bcs::from_bytes(contents).ok()?;
            (e.fight, "Abandoned", json!({
                "fight": hex(e.fight), "character": hex(e.character), "seat": e.seat.to_string(),
            }))
        }
        "Victory" => {
            let e: FightVictory = bcs::from_bytes(contents).ok()?;
            (e.fight, "Victory", json!({ "fight": hex(e.fight), "aged_bp": e.aged_bp.to_string() }))
        }
        "Defeat" => {
            let e: OneId = bcs::from_bytes(contents).ok()?;
            (e.id, "Defeat", json!({ "fight": hex(e.id) }))
        }
        "Settled" => {
            let e: FightSettled = bcs::from_bytes(contents).ok()?;
            (e.fight, "Settled", json!({
                "fight": hex(e.fight), "outcome": e.outcome, "results": e.results.to_string(),
            }))
        }
        "Swept" => {
            let e: OneId = bcs::from_bytes(contents).ok()?;
            (e.id, "Swept", json!({ "fight": hex(e.id) }))
        }
        // ActionStarted/ActionEffect/ActionResolved (deferred triple), ResultMinted/
        // ResultOpened/LootMinted/ResultBurned (result artifacts), CreatorCapIssued.
        _ => return None,
    })
}

/// The `(checkpoint, tx, event)` position that totally orders an event within its fight —
/// the ZSET score (`checkpoint`) + member-prefix (`tx_index`/`event_index`) ingredients
/// (see the module header). Bundled so `journal_writes` stays a small, one-concept call.
pub(super) struct JournalCursor {
    pub checkpoint: u64,
    pub tx_index: usize,
    pub event_index: usize,
}

/// Assemble the Redis writes that append one decoded event to its fight's journal. The
/// stored `payload` is `{kind, data, digest, version}` — `version` is the fight object's
/// post-tx Sui version as a STRING (u64, the 2^53 law + M2's "u64 versions stop being
/// Number-coerced"), `null` for a terminal that DELETED the object (no output version).
/// See the module header for the score/member ordering + idempotence contract.
pub(super) fn journal_writes(
    fight_id: &str,
    cursor: JournalCursor,
    kind: &str,
    data: Value,
    digest: &str,
    version: Option<u64>,
) -> Vec<RedisWrite> {
    let payload = json!({
        "kind": kind,
        "data": data,
        "digest": digest,
        "version": version.map(|v| v.to_string()),
    });
    let member = format!("{:06}:{:04}|{payload}", cursor.tx_index, cursor.event_index);
    let key = k_fight_journal(fight_id);
    vec![
        zadd(key.clone(), cursor.checkpoint as i64, member),
        expire(key, JOURNAL_TTL_SECS),
    ]
}

#[cfg(test)]
#[path = "journal_tests.rs"]
mod tests;
