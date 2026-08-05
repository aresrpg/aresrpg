// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! The party/social leg of the SSE chassis (#2086).
//!
//! `GET /v1/stream/party/{character_id}` pushes ONE character's social scope —
//! the party it belongs to and the parties holding a pending invitation for it —
//! the moment the projection changes, instead of every client re-asking `/v1`
//! every four seconds.
//!
//! ## What the frame is, and what it deliberately is NOT
//!
//! The frame carries the RAW projection pointers the indexer writes
//! (`rpc:char_party:<character>` and `rpc:idx:char_invites:<character>`), never
//! the shaped party/invite documents. Those shapes — the kiosk-owner resolution,
//! the fail-closed membership re-check, the "already a member" invite filter —
//! have ONE home, `packages/rpc/api/parties_view.js`, and re-deriving them here
//! would be a second source of truth for the same fact. So this leg is the
//! CHANGE SIGNAL and `/v1/parties` + `/v1/party-invites` stay the authority: the
//! client re-enters the read it already had, through the reducer door it already
//! had, within a frame of the change rather than up to a poll period after it.
//!
//! ## Scope
//!
//! The path segment IS the scope, exactly as `/v1/stream/fight/{fight_id}` is
//! scoped to one fight: a subscriber is served the projection of the ONE
//! character it named and nothing wider — never an owner's roster, never a
//! party-wide fan-out, never a firehose. Both keys read here are already served
//! unauthenticated at that same key by `/v1/parties?character=` and
//! `/v1/party-invites?character=`, so this route widens no blast radius; it only
//! changes when the same public bytes arrive.
//!
//! ## No cursor
//!
//! A fight frame carries a chain cursor because the journal is an ordered log a
//! fold resumes into. A scope frame is a LEVEL, not an event: the newest one
//! subsumes every earlier one, so the frames carry no `id`, `Last-Event-ID` is
//! never consulted, and a reconnect resyncs simply by being sent the current
//! scope as its first frame. Nothing to bookkeep, nothing to drift.

use std::time::Duration;

use anyhow::{Context, Result};
use axum::extract::{Path, State};
use axum::response::sse::Event;
use axum::response::Response;
use redis::aio::MultiplexedConnection;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tokio::time::{interval, MissedTickBehavior};
use tracing::warn;

use crate::handlers::{character_invites_key, character_party_key};

use super::{object_id, stream_response, HttpError, SseItem, SseSender, StreamState};

/// Tip cadence. The felt budget this row exists for is "the invitee's card is up
/// within about a second of the send", and a client spends one `/v1` round trip
/// after the frame, so half a second of detection leaves the whole budget intact
/// while costing half the Redis traffic of the fight tip (whose 250ms buys a
/// turn timer, not a social notification).
const PARTY_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// One character's whole social projection as the read layer holds it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct PartyScope {
    party: Option<String>,
    invites: Vec<String>,
}

/// The frame to send for `scope`, or `None` when it is byte-for-byte what the
/// subscriber was last told. A level, not an event: the first read of a
/// subscription always frames (that IS the resync), and an unchanged tip is
/// silence rather than a redundant wake-up.
fn party_frame(last: Option<&PartyScope>, scope: &PartyScope) -> Option<Value> {
    if last == Some(scope) {
        return None;
    }
    Some(json!({ "party": scope.party, "invites": scope.invites }))
}

pub(super) async fn party_stream(
    State(state): State<StreamState>,
    Path(character_id): Path<String>,
) -> std::result::Result<Response, HttpError> {
    let character_id = object_id(&character_id, "character_id")?;
    let (sender, receiver) = mpsc::channel::<SseItem>(8);
    tokio::spawn(async move {
        if let Err(error) = pump_party(state, character_id.clone(), sender).await {
            warn!(%character_id, error = %error, "party SSE stream stopped");
        }
    });
    Ok(stream_response(receiver))
}

async fn pump_party(state: StreamState, character_id: String, sender: SseSender) -> Result<()> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .context("connecting party SSE to Redis")?;

    let mut poll = interval(PARTY_POLL_INTERVAL);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last: Option<PartyScope> = None;

    loop {
        tokio::select! {
            _ = sender.closed() => return Ok(()),
            _ = poll.tick() => {
                let scope = read_party_scope(&mut conn, &character_id).await?;
                let Some(frame) = party_frame(last.as_ref(), &scope) else { continue };
                if sender
                    .send(Ok(Event::default().event("party").data(frame.to_string())))
                    .await
                    .is_err()
                {
                    return Ok(());
                }
                last = Some(scope);
            }
        }
    }
}

/// Read both projection keys through their ONE Rust-side key home
/// (`handlers::ares::party`), so the reader can never drift from the writer.
async fn read_party_scope(conn: &mut MultiplexedConnection, character: &str) -> Result<PartyScope> {
    let raw: Option<String> = redis::cmd("JSON.GET")
        .arg(character_party_key(character))
        .arg("$")
        .query_async(conn)
        .await
        .context("reading the character's party pointer for the party SSE")?;
    let party = raw
        .map(|raw| {
            serde_json::from_str::<Vec<String>>(&raw)
                .context("decoding the character's party pointer")
        })
        .transpose()?
        .and_then(|matches| matches.into_iter().next());

    let mut invites: Vec<String> = redis::cmd("SMEMBERS")
        .arg(character_invites_key(character))
        .query_async(conn)
        .await
        .context("reading the character's pending-invite index for the party SSE")?;
    // A Redis set has no order; the frame is compared for equality, so it needs one.
    invites.sort();

    Ok(PartyScope { party, invites })
}

#[cfg(test)]
mod tests {
    use super::{party_frame, PartyScope};
    use serde_json::json;

    fn scope(party: Option<&str>, invites: &[&str]) -> PartyScope {
        PartyScope {
            party: party.map(str::to_owned),
            invites: invites.iter().copied().map(str::to_owned).collect(),
        }
    }

    /// A fresh subscription is told the current level immediately — that is the whole
    /// resync story a cursorless level channel needs.
    #[test]
    fn a_fresh_subscription_is_framed_its_current_scope() {
        assert_eq!(
            party_frame(None, &scope(None, &[])),
            Some(json!({ "party": null, "invites": [] }))
        );
    }

    /// THE #2086 RED ANCHOR: the invitation arriving in the projection is a frame, and the
    /// tip that follows carrying the same invitation is silence — a level channel repeats
    /// nothing, so a subscriber can never be woken twice for one change.
    #[test]
    fn an_arriving_invitation_frames_once_and_then_goes_quiet() {
        let empty = scope(None, &[]);
        let invited = scope(None, &["0xparty"]);

        assert_eq!(
            party_frame(Some(&empty), &invited),
            Some(json!({ "party": null, "invites": ["0xparty"] }))
        );
        assert_eq!(party_frame(Some(&invited), &invited), None);
    }

    /// Membership and the pending index are two dimensions of ONE scope: accepting moves
    /// the character from the second to the first, which is a single frame.
    #[test]
    fn accepting_an_invitation_is_one_frame_carrying_both_dimensions() {
        let invited = scope(None, &["0xparty"]);
        assert_eq!(
            party_frame(Some(&invited), &scope(Some("0xparty"), &[])),
            Some(json!({ "party": "0xparty", "invites": [] }))
        );
    }

    /// A Redis set has no order, so an unsorted read of the same two invitations would
    /// frame forever, waking the client on every tip.
    #[test]
    fn invite_order_is_canonical_so_an_unchanged_set_never_reframes() {
        let one = scope(None, &["0xa", "0xb"]);
        let same = PartyScope {
            party: None,
            invites: {
                let mut invites = vec!["0xb".to_owned(), "0xa".to_owned()];
                invites.sort();
                invites
            },
        };
        assert_eq!(party_frame(Some(&one), &same), None);
    }
}
