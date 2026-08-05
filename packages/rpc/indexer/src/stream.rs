// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Topic-keyed SSE read surface (#1382).
//!
//! `GET /v1/stream/fight/{fight_id}` replays the already-decoded per-fight
//! journal and then tip-polls it for live events.
//!
//! Fan-out uses only the location's Redis. There is intentionally no
//! Redis-to-Redis transport. Fight SSE is a second consumer of the journal
//! produced by the existing `ares` decode; it never BCS-decodes chain events.
//!
//! A second leg shares this chassis: `GET /v1/stream/party/{character_id}` (#2086,
//! `stream/party.rs`) pushes one character's social scope so party membership and
//! pending invitations stop riding a client-side four-second poll. It reuses the
//! response chassis, the id parsing and the CORS layer below, and differs in one
//! deliberate way documented there: it is a LEVEL channel with no cursor.
//!
//! A third route once shared this chassis: `GET /v1/stream/presence/{world_id}`
//! mirrored an ephemeral presence registry and the poses and chat lines written
//! by the client→server courier. That courier was retired as a violation of the
//! no-client-writes law and deleted with its service, SDK and browser edge
//! (#1843); ephemeral social rides peer-to-peer instead (docs/REALTIME.md). The
//! reader went with its writer rather than serve a channel nothing feeds.

use std::convert::Infallible;
use std::fmt;
use std::str::FromStr;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use axum::extract::{Path, Query, State};
use axum::http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CACHE_CONTROL, CONNECTION},
    HeaderMap, HeaderName, HeaderValue, StatusCode,
};
use axum::middleware;
use axum::response::sse::{Event, KeepAlive};
use axum::response::{IntoResponse, Response, Sse};
use axum::routing::get;
use axum::Router;
use redis::aio::MultiplexedConnection;
use serde::Deserialize;
use serde_json::{json, Value};
use sui_indexer_alt_framework::types::base_types::ObjectID;
use tokio::sync::mpsc;
use tokio::time::{interval, MissedTickBehavior};
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::StreamExt as _;
use tracing::warn;

mod party;

const FIGHT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(20);
const ARES_WATERMARK_KEY: &str = "rpc:watermark:ares";
const LAST_EVENT_ID: HeaderName = HeaderName::from_static("last-event-id");
const X_ACCEL_BUFFERING: HeaderName = HeaderName::from_static("x-accel-buffering");

type SseItem = std::result::Result<Event, Infallible>;
type SseSender = mpsc::Sender<SseItem>;
type HttpError = (StatusCode, String);

/// The binding fight cursor law.
///
/// Wire encoding is `<checkpoint_sequence>:<intra_checkpoint_event_index>`,
/// for example `4200:19`. The second component is the zero-based ordinal among
/// every event in that checkpoint, walking transactions and their event arrays
/// in chain order. Both coordinates are chain-derived; Redis rank, counters,
/// process state, and replica identity never participate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct FightCursor {
    checkpoint: u64,
    event_index: u64,
}

impl FightCursor {
    #[cfg(test)]
    pub(crate) const fn new(checkpoint: u64, event_index: u64) -> Self {
        Self {
            checkpoint,
            event_index,
        }
    }
}

impl fmt::Display for FightCursor {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}:{}", self.checkpoint, self.event_index)
    }
}

impl FromStr for FightCursor {
    type Err = anyhow::Error;

    fn from_str(raw: &str) -> Result<Self> {
        let (checkpoint, event_index) = raw
            .split_once(':')
            .ok_or_else(|| anyhow!("cursor must be <checkpoint>:<event-index>"))?;
        if checkpoint.is_empty() || event_index.is_empty() || event_index.contains(':') {
            return Err(anyhow!("cursor must be <checkpoint>:<event-index>"));
        }
        Ok(Self {
            checkpoint: checkpoint
                .parse()
                .context("cursor checkpoint is not a u64")?,
            event_index: event_index
                .parse()
                .context("cursor event index is not a u64")?,
        })
    }
}

#[derive(Debug, Deserialize)]
struct StoredFightPayload {
    // Journals written before the SSE route shipped have no chain cursor. They
    // remain valid for the ordinal JSON page, but cannot lawfully be assigned an
    // SSE id after the fact, so this consumer ignores only those legacy rows.
    id: Option<String>,
    kind: String,
    data: Value,
    digest: String,
    version: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoredFightEvent {
    pub(crate) seq: u64,
    pub(crate) id: FightCursor,
    kind: String,
    data: Value,
    digest: String,
    version: Option<String>,
}

fn decode_stored_fight_event(member: &str, seq: u64) -> Result<Option<StoredFightEvent>> {
    let (_, payload) = member
        .split_once('|')
        .ok_or_else(|| anyhow!("fight journal member is missing its ordering prefix"))?;
    let payload: StoredFightPayload =
        serde_json::from_str(payload).context("decoding stored fight journal payload")?;
    let Some(id) = payload.id else {
        return Ok(None);
    };
    Ok(Some(StoredFightEvent {
        seq,
        id: id.parse().context("decoding stored fight cursor")?,
        kind: payload.kind,
        data: payload.data,
        digest: payload.digest,
        version: payload.version,
    }))
}

/// Decode stored journal members and select the standard Last-Event-ID tail:
/// the presented event itself is excluded and every strictly later event is
/// returned in the journal's chain order.
pub(crate) fn replay_tail<I, S>(
    members: I,
    first_seq: u64,
    after: Option<FightCursor>,
) -> Result<Vec<StoredFightEvent>>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    members
        .into_iter()
        .enumerate()
        .map(|(offset, member)| {
            let offset = u64::try_from(offset).context("fight journal rank offset exceeds u64")?;
            let seq = first_seq
                .checked_add(offset)
                .context("fight journal rank exceeds u64")?;
            decode_stored_fight_event(member.as_ref(), seq)
        })
        .filter_map(|decoded| match decoded {
            Ok(Some(event)) if after.is_none_or(|cursor| event.id > cursor) => Some(Ok(event)),
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        })
        .collect()
}

#[derive(Clone)]
struct StreamState {
    redis: redis::Client,
}

pub(crate) fn router(redis_url: &str) -> Result<Router> {
    let redis = redis::Client::open(redis_url).context("opening SSE Redis client")?;
    Ok(Router::new()
        .route("/v1/stream/fight/{fight_id}", get(fight_stream))
        .route("/v1/stream/party/{character_id}", get(party::party_stream))
        .with_state(StreamState { redis })
        .layer(middleware::map_response(public_read_cors)))
}

async fn public_read_cors(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    response
}

/// Wrap a pump's channel as the SSE body.
///
/// The correct no-buffering headers are not enough: an intermediary (Cloudflare
/// fronts `rpc.aresrpg.world`) forwards nothing to the client until the body has
/// a first byte, so a subscription that is merely *waiting* — an unjournalled
/// fight, a replica still catching up — reaches a public client as a hang rather
/// than as an open stream. The greeting comment is that first byte, emitted
/// before the pump has even reached Redis, and `KeepAlive` re-supplies one after
/// every `KEEPALIVE_INTERVAL` of silence (its timer resets on each real event,
/// so an active stream never pays for it).
///
/// Both frames are SSE comments: they carry no event name, no data and no `id`,
/// so `EventSource` consumers never observe them and the cursor a client would
/// resume from is untouched.
fn stream_response(receiver: mpsc::Receiver<SseItem>) -> Response {
    let greeting = tokio_stream::once(Ok(Event::default().comment("ok")));
    let mut response = Sse::new(greeting.chain(ReceiverStream::new(receiver)))
        .keep_alive(KeepAlive::new().interval(KEEPALIVE_INTERVAL).text("ka"))
        .into_response();
    let headers = response.headers_mut();
    headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static("no-cache, no-transform"),
    );
    headers.insert(CONNECTION, HeaderValue::from_static("keep-alive"));
    headers.insert(X_ACCEL_BUFFERING, HeaderValue::from_static("no"));
    response
}

fn bad_request(error: impl fmt::Display) -> HttpError {
    (StatusCode::BAD_REQUEST, error.to_string())
}

fn object_id(raw: &str, field: &str) -> std::result::Result<String, HttpError> {
    ObjectID::from_hex_literal(raw)
        .map(|id| id.to_canonical_string(true))
        .map_err(|error| bad_request(format!("{field} is not a Sui object id: {error}")))
}

#[derive(Debug, Deserialize)]
struct FightStreamQuery {
    #[serde(rename = "lastEventId")]
    last_event_id: Option<String>,
}

fn parse_last_event_id(raw: Option<&str>) -> std::result::Result<Option<FightCursor>, HttpError> {
    let Some(raw) = raw else {
        return Ok(None);
    };
    if raw.is_empty() {
        return Ok(None);
    }
    raw.parse().map(Some).map_err(bad_request)
}

fn last_event_id(
    headers: &HeaderMap,
    query: &FightStreamQuery,
) -> std::result::Result<Option<FightCursor>, HttpError> {
    let raw = headers
        .get(&LAST_EVENT_ID)
        .map(|value| value.to_str().map_err(bad_request))
        .transpose()?
        .or(query.last_event_id.as_deref());
    parse_last_event_id(raw)
}

async fn fight_stream(
    State(state): State<StreamState>,
    Path(fight_id): Path<String>,
    Query(query): Query<FightStreamQuery>,
    headers: HeaderMap,
) -> std::result::Result<Response, HttpError> {
    let fight_id = object_id(&fight_id, "fight_id")?;
    let after = last_event_id(&headers, &query)?;
    let (sender, receiver) = mpsc::channel::<SseItem>(128);
    tokio::spawn(async move {
        if let Err(error) = pump_fight(state, fight_id.clone(), after, sender).await {
            warn!(%fight_id, error = %error, "fight SSE stream stopped");
        }
    });
    Ok(stream_response(receiver))
}

fn fight_frame_payload(event: &StoredFightEvent) -> Value {
    json!({
        "seq": event.seq,
        "kind": event.kind,
        "data": event.data,
        "digest": event.digest,
        "version": event.version,
    })
}

async fn pump_fight(
    state: StreamState,
    fight_id: String,
    after: Option<FightCursor>,
    sender: SseSender,
) -> Result<()> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .context("connecting fight SSE to Redis")?;

    if let Some(cursor) = after {
        wait_until_caught_up(&mut conn, cursor, &sender).await?;
    }

    // A replica behind a presented cursor emits no FRAME until it catches up —
    // only the transport's comments, which carry no id and resume nothing.
    let mut poll = interval(FIGHT_POLL_INTERVAL);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_sent = after;

    loop {
        tokio::select! {
            _ = sender.closed() => return Ok(()),
            _ = poll.tick() => {
                let events = read_fight_events(&mut conn, &fight_id, last_sent).await?;
                for event in events {
                    let data = fight_frame_payload(&event).to_string();
                    let id = event.id;
                    if sender
                        .send(Ok(Event::default().event("fight").id(id.to_string()).data(data)))
                        .await
                        .is_err()
                    {
                        return Ok(());
                    }
                    last_sent = Some(id);
                }
            }
        }
    }
}

async fn wait_until_caught_up(
    conn: &mut MultiplexedConnection,
    cursor: FightCursor,
    sender: &SseSender,
) -> Result<()> {
    loop {
        if read_ares_watermark(conn)
            .await?
            .is_some_and(|watermark| watermark >= cursor.checkpoint)
        {
            return Ok(());
        }
        tokio::select! {
            _ = sender.closed() => return Ok(()),
            _ = tokio::time::sleep(FIGHT_POLL_INTERVAL) => {}
        }
    }
}

async fn read_ares_watermark(conn: &mut MultiplexedConnection) -> Result<Option<u64>> {
    let raw: Option<String> = redis::cmd("JSON.GET")
        .arg(ARES_WATERMARK_KEY)
        .arg("$.checkpoint_hi_inclusive")
        .query_async(conn)
        .await
        .context("reading Ares watermark for SSE catch-up")?;
    raw.map(|raw| {
        serde_json::from_str::<Vec<u64>>(&raw)
            .context("decoding Ares watermark")
            .map(|values| values.into_iter().next())
    })
    .transpose()
    .map(Option::flatten)
}

async fn read_fight_events(
    conn: &mut MultiplexedConnection,
    fight_id: &str,
    after: Option<FightCursor>,
) -> Result<Vec<StoredFightEvent>> {
    let key = format!("rpc:fight:{fight_id}:journal");
    let minimum = after
        .map(|cursor| cursor.checkpoint.to_string())
        .unwrap_or_else(|| "-inf".to_owned());
    let members: Vec<String> = redis::cmd("ZRANGEBYSCORE")
        .arg(&key)
        .arg(minimum)
        .arg("+inf")
        .query_async(conn)
        .await
        .context("reading stored fight events")?;
    let Some(first_member) = members.first() else {
        return Ok(Vec::new());
    };
    let Some(first_seq): Option<u64> = redis::cmd("ZRANK")
        .arg(key)
        .arg(first_member)
        .query_async(conn)
        .await
        .context("reading first stored fight event rank")?
    else {
        return Ok(Vec::new());
    };
    replay_tail(members, first_seq, after)
}

#[cfg(test)]
mod tests {
    use super::{
        bad_request, fight_frame_payload, last_event_id, public_read_cors, replay_tail,
        stream_response, FightCursor, FightStreamQuery, SseItem,
    };
    use axum::body::to_bytes;
    use axum::extract::Query;
    use axum::http::{
        header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderMap, HeaderValue, StatusCode, Uri,
    };
    use axum::response::sse::Event;
    use axum::response::IntoResponse;
    use serde_json::json;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::sync::mpsc;

    /// Drive the REAL router over a real socket and return the response's status line.
    ///
    /// A `tower::ServiceExt::oneshot` would prove the same thing at the cost of a new
    /// dev-dependency; this crate is bin-only, so a `tests/` integration file cannot reach
    /// `router()` either. Opening the actual listener keeps the proof on the wire the pod serves.
    async fn status_line(path: &str) -> String {
        // `redis::Client::open` only parses the URL — no connection is made here, and the
        // routes that would need one fail inside their own spawned task, never in the response.
        let router = super::router("redis://127.0.0.1:6379").expect("building the SSE router");
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router).await });

        let mut socket = tokio::net::TcpStream::connect(address).await.unwrap();
        socket
            .write_all(
                format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                    .as_bytes(),
            )
            .await
            .unwrap();

        // A live stream's body never ends, so read the status line and not one byte more.
        let mut line = Vec::new();
        let mut byte = [0_u8; 1];
        while !line.ends_with(b"\r\n") && socket.read_exact(&mut byte).await.is_ok() {
            line.push(byte[0]);
        }
        server.abort();
        String::from_utf8_lossy(&line).trim().to_owned()
    }

    /// THE RETIREMENT GATE (#1843): the courier-presence route is gone from the router, so a
    /// client that still asks for it is told so instead of being handed an ephemeral stream no
    /// writer feeds. The fight journal is a DIFFERENT system riding the same chassis and is the
    /// positive control — without it a router that failed to build anything at all would 404 the
    /// presence path too and this gate would pass for entirely the wrong reason.
    #[tokio::test]
    async fn the_retired_courier_presence_route_is_unroutable() {
        let world = fixture_id("aa");
        let character = fixture_id("1");

        assert_eq!(
            status_line(&format!(
                "/v1/stream/presence/{world}?character={character}"
            ))
            .await,
            "HTTP/1.1 404 Not Found",
            "the courier-presence route was retired with its transport (#1843)"
        );
        assert_eq!(
            status_line(&format!("/v1/stream/fight/{world}")).await,
            "HTTP/1.1 200 OK",
            "the fight journal stream is untouched by that retirement"
        );
    }

    /// #2086 — the party scope is a leg OF this chassis, not a service beside it: it answers on
    /// the same listener, under the same `/v1/stream` prefix, and rejects a non-object-id key
    /// through the same parser the fight route uses.
    #[tokio::test]
    async fn the_party_scope_route_is_mounted_beside_the_fight_route() {
        let character = fixture_id("2");

        assert_eq!(
            status_line(&format!("/v1/stream/party/{character}")).await,
            "HTTP/1.1 200 OK",
            "party membership and invites must have a pushed channel (#2086)"
        );
        assert_eq!(
            status_line("/v1/stream/party/not-an-object-id").await,
            "HTTP/1.1 400 Bad Request",
            "the path segment IS the subscription scope — an unparseable one is refused"
        );
    }

    #[tokio::test]
    async fn a_fresh_subscription_greets_before_any_event() {
        let (sender, receiver) = mpsc::channel::<SseItem>(2);
        let response = stream_response(receiver);
        sender
            .send(Ok(Event::default().event("fight").id("90:7").data("{}")))
            .await
            .unwrap();
        drop(sender);

        let body = to_bytes(response.into_body(), 4096).await.unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();

        assert!(
            body.starts_with(": ok\n\n"),
            "a proxy only flushes once a body byte exists, so the greeting must lead: {body:?}"
        );
        assert!(body.contains("event: fight"), "{body:?}");
    }

    #[tokio::test]
    async fn handler_error_response_allows_public_read_cors() {
        let response = public_read_cors(bad_request("invalid cursor").into_response()).await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(&HeaderValue::from_static("*"))
        );
    }

    /// Synthetic fixture ids, widened from a short tail so this module hand-types no live-shaped
    /// object id (scripts/check-chain-ids.mjs — a hardcoded id drifts the moment a package republishes,
    /// and these are stand-ins for path segments, never pointers at a real object).
    fn fixture_id(tail: &str) -> String {
        format!("0x{tail:0>64}")
    }

    #[test]
    fn stored_events_replay_from_a_mid_cursor_yields_exactly_the_tail() {
        let stored = [
            r#"000002:0004|{"id":"90:7","kind":"Placed","data":{"cell":"4"},"digest":"a","version":"1"}"#,
            r#"000003:0001|{"id":"90:11","kind":"Ready","data":{},"digest":"b","version":"2"}"#,
            r#"000000:0000|{"id":"91:0","kind":"TurnStarted","data":{"turn":"1"},"digest":"c","version":"3"}"#,
        ];

        let tail = replay_tail(stored, 0, Some(FightCursor::new(90, 7))).unwrap();

        assert_eq!(
            tail.into_iter().map(|event| event.id).collect::<Vec<_>>(),
            [FightCursor::new(90, 11), FightCursor::new(91, 0)]
        );
    }

    #[test]
    fn query_param_resume_is_honored_when_header_is_absent() {
        let uri: Uri = "/v1/stream/fight/0x1?lastEventId=90%3A7".parse().unwrap();
        let Query(query) = Query::<FightStreamQuery>::try_from_uri(&uri).unwrap();

        let mut headers = HeaderMap::new();
        assert_eq!(
            last_event_id(&headers, &query).unwrap(),
            Some(FightCursor::new(90, 7))
        );

        headers.insert("last-event-id", HeaderValue::from_static("91:2"));
        assert_eq!(
            last_event_id(&headers, &query).unwrap(),
            Some(FightCursor::new(91, 2))
        );
    }

    #[test]
    fn fight_frame_carries_the_journal_sequence() {
        let stored = [
            r#"000002:0004|{"id":"90:7","kind":"Placed","data":{"cell":"4"},"digest":"a","version":"1"}"#,
        ];
        let event = replay_tail(stored, 12, None).unwrap().remove(0);

        assert_eq!(
            fight_frame_payload(&event),
            json!({
                "seq": 12,
                "kind": "Placed",
                "data": { "cell": "4" },
                "digest": "a",
                "version": "1",
            })
        );
    }
}
