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
//! ## Scope — the board/turn family plus the action envelope's leading pair
//! Journalled: `FightCreated`/`FightJoined`/`Placed`/`Ready`/`TurnStarted`/`Moved`/
//! `MobMoved`/`Displaced`/`Cast`/`ActionStarted`/`ActionEffect`/`CriticalFailure`/
//! `StanceChanged`/`Revealed`/`Hit`/`Drain`/`Tackled`/`TurnEnded`/`Abandoned`/`Victory`/
//! `Defeat`/`Settled`/`Swept`, decoded to their `parsedJson`-shaped fields (u64 as
//! string, u8/u16/u32 as number, bool as bool, `ID`/address as `0x…` hex — byte-shaped
//! IDENTICALLY to the fullnode's `parsedJson`, so the client folds a journal page through
//! the SAME decoder its own receipts use — `sdk/fight_read.js::decode_fight_event`).
//!
//! ### Why the envelope pair is NOT optional (#1143)
//! This module's header used to defer the whole `ActionStarted`/`ActionEffect`/`ActionResolved`
//! triple "because NO client consumes them today". That premise died with #481:
//! `fight/inputs.js::self_status_from_effect` mints a fighter's timed status row off the
//! `ActionEffect` descriptor, using the `target_cell` only `ActionStarted` carries. An ACTOR
//! gets both on its own tx receipt and paints instantly; every OTHER client's live ordered
//! transport is this journal, and the object poll cannot stand in — `core_inbox.js::adopt_snapshot`
//! refuses any read at or behind the event frontier, and the SSE tail always reaches a version
//! first. Dropping the pair therefore made a partner's buff PERMANENTLY invisible to observers,
//! not merely late. `packages/fight/test/coop_transport_status_parity.test.js` is that consumer
//! contract, and it reads the journalled set out of THIS file's match arms.
//!
//! DEFERRED (returns `None`): `ActionResolved` — alone in the triple it carries
//! `Option<SpellLevel>` + `vector<WeaponLine>` (nested `vector<Effect>`), the modelling
//! liability `snapshot.rs` avoids, for facts no fold reads. Its only client arm frees the
//! finished action's `action_contexts` entry; the keys are per `(caster, turn, action)` and
//! can never be re-hit, so its absence costs an observer a handful of retained descriptors
//! per fight and changes no outcome. Also deferred: the settlement `Result*`/`LootMinted`
//! artifacts (keyed by result, projected to `/v1/fight-results`), and `CreatorCapIssued`.
//!
//! Pure decode/assemble (unit-tested offline against REAL captured testnet wire below);
//! the impure `(checkpoint, tx, event)` indices + tx digest + post-tx fight version are
//! threaded in by `mod.rs::process` (which alone has the checkpoint context).

use serde_json::{json, Value};
use sui_indexer_alt_framework::types::base_types::ObjectID;

use super::decode::decode_bcs;
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

/// One authored `spell_effect::Effect` in the fullnode's own `parsedJson` shape — the nested
/// object an `ActionEffect` carries verbatim. Values ride EXACTLY as chain state holds them:
/// a signed kind stays 32768-CENTERED, because `fight/core_wire.js::decode_status_value` is the
/// ONE decoder for both status doors (this wire and `Fight.fx`) and centering is what makes them
/// one dialect (#983). Re-centering here would fork them.
fn effect_json(effect: &Effect) -> Value {
    json!({
        "kind": effect.kind, "element": effect.element,
        "value": effect.value.to_string(), "value_max": effect.value_max.to_string(),
        "area_shape": effect.area_shape, "area_size": effect.area_size.to_string(),
        "target_filter": effect.target_filter, "chance": effect.chance,
        "turns": effect.turns, "stat": effect.stat,
        "flags": effect.flags, "phase": effect.phase,
    })
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
            let e: FightCreated = decode_bcs(module, name, contents)?;
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
            let e: FightJoined = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "FightJoined",
                json!({
                    "fight": hex(e.fight), "character": hex(e.character), "seat": e.seat.to_string(),
                }),
            )
        }
        "Placed" => {
            let e: Placed = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Placed",
                json!({
                    "fight": hex(e.fight), "character": hex(e.character), "cell": e.cell.to_string(),
                }),
            )
        }
        "Ready" => {
            let e: Ready = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Ready",
                json!({ "fight": hex(e.fight), "character": hex(e.character) }),
            )
        }
        "TurnStarted" => {
            let e: TurnStarted = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "TurnStarted",
                json!({
                    "fight": hex(e.fight), "is_mob": e.is_mob,
                    "idx": e.idx.to_string(), "deadline_ms": e.deadline_ms.to_string(),
                    // The turn-seed inputs the client folds to derive THIS turn's rolls
                    // (`@aresrpg/fight` predict_cast.js). A receipt carries them, so a journal
                    // page must too — otherwise a replayed/spectated fight folds a different
                    // seed than the actor's own receipt did.
                    "turn_entropy": e.turn_entropy.to_string(),
                    "turn_ordinal": e.turn_ordinal.to_string(),
                }),
            )
        }
        "Moved" => {
            let e: Moved = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Moved",
                json!({
                    "fight": hex(e.fight), "character": hex(e.character), "to_cell": e.to_cell.to_string(),
                }),
            )
        }
        "MobMoved" => {
            let e: MobMoved = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "MobMoved",
                json!({
                    "fight": hex(e.fight), "idx": e.idx.to_string(), "to_cell": e.to_cell.to_string(),
                }),
            )
        }
        "Displaced" => {
            let e: Displaced = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Displaced",
                json!({
                    "fight": hex(e.fight), "target_is_mob": e.target_is_mob,
                    "target_idx": e.target_idx.to_string(), "kind": e.kind,
                    "from_cell": e.from_cell.to_string(), "to_cell": e.to_cell.to_string(),
                    "requested": e.requested.to_string(), "blocked": e.blocked.to_string(),
                }),
            )
        }
        "Cast" => {
            let e: Cast = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Cast",
                json!({
                    "fight": hex(e.fight), "caster_is_mob": e.caster_is_mob,
                    "caster_idx": e.caster_idx.to_string(), "target_cell": e.target_cell.to_string(),
                }),
            )
        }
        "ActionStarted" => {
            let e: ActionStarted = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "ActionStarted",
                json!({
                    "fight": hex(e.fight), "caster_is_mob": e.caster_is_mob,
                    "caster_idx": e.caster_idx.to_string(),
                    "turn_ordinal": e.turn_ordinal.to_string(),
                    "action_ordinal": e.action_ordinal.to_string(),
                    "action_kind": e.action_kind,
                    "target_cell": e.target_cell.to_string(),
                    "ap_cost": e.ap_cost.to_string(),
                    "effect_count": e.effect_count.to_string(),
                }),
            )
        }
        "ActionEffect" => {
            let e: ActionEffect = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "ActionEffect",
                json!({
                    "fight": hex(e.fight), "caster_is_mob": e.caster_is_mob,
                    "caster_idx": e.caster_idx.to_string(),
                    "turn_ordinal": e.turn_ordinal.to_string(),
                    "action_ordinal": e.action_ordinal.to_string(),
                    "effect_ordinal": e.effect_ordinal.to_string(),
                    "effect": effect_json(&e.effect),
                }),
            )
        }
        "CriticalFailure" => {
            let e: CriticalFailure = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "CriticalFailure",
                json!({
                    "fight": hex(e.fight), "caster_is_mob": e.caster_is_mob,
                    "caster_idx": e.caster_idx.to_string(),
                }),
            )
        }
        "StanceChanged" => {
            let e: StanceChanged = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "StanceChanged",
                json!({
                    "fight": hex(e.fight), "fighter_is_mob": e.fighter_is_mob,
                    "fighter_idx": e.fighter_idx.to_string(), "stance": e.stance.to_string(),
                    "active": e.active,
                }),
            )
        }
        "Revealed" => {
            let e: Revealed = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Revealed",
                json!({
                    "fight": hex(e.fight), "is_mob": e.is_mob, "idx": e.idx.to_string(),
                }),
            )
        }
        "Hit" => {
            let e: Hit = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Hit",
                json!({
                    "fight": hex(e.fight), "victim_is_mob": e.victim_is_mob,
                    "victim_idx": e.victim_idx.to_string(), "amount": e.amount.to_string(),
                    "remaining_hp": e.remaining_hp.to_string(),
                }),
            )
        }
        "Drain" => {
            let e: Drain = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Drain",
                json!({
                    "fight": hex(e.fight), "target_is_mob": e.target_is_mob,
                    "target_idx": e.target_idx.to_string(), "point_kind": e.point_kind,
                    "removed": e.removed.to_string(), "requested": e.requested.to_string(),
                }),
            )
        }
        "Tackled" => {
            let e: Tackled = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Tackled",
                json!({
                    "fight": hex(e.fight), "runner_is_mob": e.runner_is_mob,
                    "runner_idx": e.runner_idx.to_string(), "ap_lost": e.ap_lost.to_string(),
                    "mp_lost": e.mp_lost.to_string(), "num": e.num.to_string(), "den": e.den.to_string(),
                }),
            )
        }
        "TurnEnded" => {
            let e: TurnEnded = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "TurnEnded",
                json!({
                    "fight": hex(e.fight), "is_mob": e.is_mob, "idx": e.idx.to_string(),
                }),
            )
        }
        "Abandoned" => {
            let e: Abandoned = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Abandoned",
                json!({
                    "fight": hex(e.fight), "character": hex(e.character), "seat": e.seat.to_string(),
                }),
            )
        }
        "Victory" => {
            let e: FightVictory = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Victory",
                json!({ "fight": hex(e.fight), "aged_bp": e.aged_bp.to_string() }),
            )
        }
        "Defeat" => {
            let e: FightDefeat = decode_bcs(module, name, contents)?;
            (e.fight, "Defeat", json!({ "fight": hex(e.fight) }))
        }
        "Settled" => {
            let e: FightSettled = decode_bcs(module, name, contents)?;
            (
                e.fight,
                "Settled",
                json!({
                    "fight": hex(e.fight), "outcome": e.outcome, "results": e.results.to_string(),
                }),
            )
        }
        "Swept" => {
            let e: FightSwept = decode_bcs(module, name, contents)?;
            (e.fight, "Swept", json!({ "fight": hex(e.fight) }))
        }
        // ActionResolved (the SpellLevel/WeaponLine carrier — see the header), ResultMinted/
        // ResultOpened/LootMinted/ResultBurned (result artifacts), CreatorCapIssued.
        _ => return None,
    })
}

/// The `(checkpoint, tx, event)` position that totally orders an event within its fight —
/// the ZSET score (`checkpoint`) + member-prefix (`tx_index`/`event_index`) ingredients
/// (see the module header). Bundled so `journal_writes` stays a small, one-concept call.
pub(super) struct JournalCursor {
    pub checkpoint: u64,
    /// Zero-based ordinal among ALL events in the checkpoint, walking transactions
    /// and each transaction's events in chain order. SSE encodes this with the
    /// checkpoint as `<checkpoint>:<intra_checkpoint_event_index>`.
    pub intra_checkpoint_event_index: u64,
    pub tx_index: usize,
    pub event_index: usize,
}

/// Assemble the Redis writes that append one decoded event to its fight's journal. The
/// stored `payload` is `{id, kind, data, digest, version}` — `id` is the chain-derived
/// SSE cursor and `version` is the fight object's
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
        // Binding cursor law (#1382 topology ruling): the SSE id contains chain
        // coordinates only. It is NEVER a Redis sequence/rank/counter.
        "id": format!("{}:{}", cursor.checkpoint, cursor.intra_checkpoint_event_index),
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
