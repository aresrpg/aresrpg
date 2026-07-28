// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Topic-keyed SSE read surface (#1382).
//!
//! Two routes are deliberately in scope:
//!
//! * `GET /v1/stream/fight/{fight_id}` replays the already-decoded per-fight
//!   journal and then tip-polls it for live events.
//! * `GET /v1/stream/presence/{world_id}?address=…&character=…` maintains and
//!   observes an ephemeral presence registry.
//!
//! Both fan-out paths use only the location's Redis. There is intentionally no
//! Redis-to-Redis transport. Fight SSE is a second consumer of the journal
//! produced by the existing `ares` decode; it never BCS-decodes chain events.
//! Presence is connection-observed and location-local: cross-location users do
//! not appear in this registry.

use std::collections::BTreeSet;
use std::convert::Infallible;
use std::fmt;
use std::str::FromStr;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use axum::extract::{Path, Query, State};
use axum::http::{
    header::{ACCESS_CONTROL_ALLOW_ORIGIN, CACHE_CONTROL, CONNECTION},
    HeaderMap, HeaderName, HeaderValue, StatusCode,
};
use axum::response::sse::Event;
use axum::response::{IntoResponse, Response, Sse};
use axum::routing::get;
use axum::Router;
use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sui_indexer_alt_framework::types::base_types::{ObjectID, SuiAddress};
use tokio::sync::mpsc;
use tokio::time::{interval_at, Instant, MissedTickBehavior};
use tokio_stream::wrappers::ReceiverStream;
use tracing::warn;

const FIGHT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const PRESENCE_POLL_INTERVAL: Duration = Duration::from_secs(1);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const PRESENCE_TTL_MS: i64 = 30_000;
const PRESENCE_KEY_IDLE_MS: i64 = 45_000;
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
    pub(crate) id: FightCursor,
    kind: String,
    data: Value,
    digest: String,
    version: Option<String>,
}

fn decode_stored_fight_event(member: &str) -> Result<Option<StoredFightEvent>> {
    let (_, payload) = member
        .split_once('|')
        .ok_or_else(|| anyhow!("fight journal member is missing its ordering prefix"))?;
    let payload: StoredFightPayload =
        serde_json::from_str(payload).context("decoding stored fight journal payload")?;
    let Some(id) = payload.id else {
        return Ok(None);
    };
    Ok(Some(StoredFightEvent {
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
    after: Option<FightCursor>,
) -> Result<Vec<StoredFightEvent>>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    members
        .into_iter()
        .map(|member| decode_stored_fight_event(member.as_ref()))
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
        .route("/v1/stream/presence/{world_id}", get(presence_stream))
        .with_state(StreamState { redis }))
}

fn stream_response(receiver: mpsc::Receiver<SseItem>) -> Response {
    let mut response = Sse::new(ReceiverStream::new(receiver)).into_response();
    let headers = response.headers_mut();
    headers.insert(ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
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

fn address(raw: &str) -> std::result::Result<String, HttpError> {
    SuiAddress::from_str(raw)
        .map(|id| id.to_string())
        .map_err(|error| bad_request(format!("address is not a Sui address: {error}")))
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

    // Heartbeats begin only AFTER cursor catch-up. A replica behind a presented
    // cursor therefore holds the response completely silent as required.
    let now = Instant::now();
    let mut poll = interval_at(now, FIGHT_POLL_INTERVAL);
    let mut heartbeat = interval_at(now + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut last_sent = after;

    loop {
        tokio::select! {
            _ = sender.closed() => return Ok(()),
            _ = poll.tick() => {
                let events = read_fight_events(&mut conn, &fight_id, last_sent).await?;
                for event in events {
                    let data = json!({
                        "kind": event.kind,
                        "data": event.data,
                        "digest": event.digest,
                        "version": event.version,
                    })
                    .to_string();
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
            _ = heartbeat.tick() => {
                if sender.send(Ok(Event::default().comment("heartbeat"))).await.is_err() {
                    return Ok(());
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
        .arg(key)
        .arg(minimum)
        .arg("+inf")
        .query_async(conn)
        .await
        .context("reading stored fight events")?;
    replay_tail(members, after)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PresenceRecord {
    world: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    character: Option<String>,
}

impl PresenceRecord {
    #[cfg(test)]
    pub(crate) fn new(world: &str, address: Option<&str>, character: Option<&str>) -> Self {
        Self {
            world: world.to_owned(),
            address: address.map(str::to_owned),
            character: character.map(str::to_owned),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PresenceChange {
    Join(PresenceRecord),
    Leave(PresenceRecord),
}

/// Apply the Redis TTL scores at `now_ms`. This function is used by the live
/// registry reader and is the test seam for exact lapse semantics.
pub(crate) fn active_presence_rows<I, S>(rows: I, now_ms: i64) -> BTreeSet<PresenceRecord>
where
    I: IntoIterator<Item = (S, i64)>,
    S: AsRef<str>,
{
    rows.into_iter()
        .filter(|(_, expires_at)| *expires_at > now_ms)
        .filter_map(|(member, _)| serde_json::from_str(member.as_ref()).ok())
        .collect()
}

pub(crate) fn presence_changes(
    previous: &BTreeSet<PresenceRecord>,
    current: &BTreeSet<PresenceRecord>,
) -> Vec<PresenceChange> {
    previous
        .difference(current)
        .cloned()
        .map(PresenceChange::Leave)
        .chain(
            current
                .difference(previous)
                .cloned()
                .map(PresenceChange::Join),
        )
        .collect()
}

#[derive(Debug, Deserialize)]
struct PresenceQuery {
    address: Option<String>,
    character: Option<String>,
}

async fn presence_stream(
    State(state): State<StreamState>,
    Path(world_id): Path<String>,
    Query(query): Query<PresenceQuery>,
) -> std::result::Result<Response, HttpError> {
    let world = object_id(&world_id, "world_id")?;
    let address = query.address.as_deref().map(address).transpose()?;
    let character = query
        .character
        .as_deref()
        .map(|value| object_id(value, "character"))
        .transpose()?;
    if address.is_none() && character.is_none() {
        return Err(bad_request(
            "presence requires ?address=, ?character=, or both",
        ));
    }
    let presence = PresenceRecord {
        world: world.clone(),
        address,
        character,
    };
    let (sender, receiver) = mpsc::channel::<SseItem>(128);
    tokio::spawn(async move {
        if let Err(error) = pump_presence(state, presence, sender).await {
            warn!(%world, error = %error, "presence SSE stream stopped");
        }
    });
    Ok(stream_response(receiver))
}

async fn pump_presence(
    state: StreamState,
    presence: PresenceRecord,
    sender: SseSender,
) -> Result<()> {
    let mut conn = state
        .redis
        .get_multiplexed_async_connection()
        .await
        .context("connecting presence SSE to Redis")?;
    refresh_presence(&mut conn, &presence).await?;
    let mut current = read_presence(&mut conn, &presence.world).await?;
    let initial = json!({ "world": presence.world, "presence": current }).to_string();
    if sender
        .send(Ok(Event::default().event("current-set").data(initial)))
        .await
        .is_err()
    {
        return Ok(());
    }

    let now = Instant::now();
    let mut poll = interval_at(now + PRESENCE_POLL_INTERVAL, PRESENCE_POLL_INTERVAL);
    let mut heartbeat = interval_at(now + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = sender.closed() => return Ok(()),
            _ = poll.tick() => {
                let next = read_presence(&mut conn, &presence.world).await?;
                for change in presence_changes(&current, &next) {
                    let (kind, record) = match change {
                        PresenceChange::Join(record) => ("join", record),
                        PresenceChange::Leave(record) => ("leave", record),
                    };
                    if sender
                        .send(Ok(Event::default().event(kind).data(serde_json::to_string(&record)?)))
                        .await
                        .is_err()
                    {
                        return Ok(());
                    }
                }
                current = next;
            }
            _ = heartbeat.tick() => {
                refresh_presence(&mut conn, &presence).await?;
                if sender.send(Ok(Event::default().comment("heartbeat"))).await.is_err() {
                    return Ok(());
                }
            }
        }
    }
}

async fn refresh_presence(
    conn: &mut MultiplexedConnection,
    presence: &PresenceRecord,
) -> Result<()> {
    let now = unix_ms();
    let expires_at = now.saturating_add(PRESENCE_TTL_MS);
    let key = presence_key(&presence.world);
    let member = serde_json::to_string(presence)?;
    // One local-Redis atomic step: prune lapses, refresh this socket's identity,
    // and arrange cleanup after the world's final connection disappears.
    let _: i64 = redis::cmd("EVAL")
        .arg(
            "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); \
             redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3]); \
             redis.call('PEXPIRE', KEYS[1], ARGV[4]); return 1",
        )
        .arg(1)
        .arg(key)
        .arg(now)
        .arg(expires_at)
        .arg(member)
        .arg(PRESENCE_KEY_IDLE_MS)
        .query_async(conn)
        .await
        .context("refreshing local presence TTL")?;
    Ok(())
}

async fn read_presence(
    conn: &mut MultiplexedConnection,
    world: &str,
) -> Result<BTreeSet<PresenceRecord>> {
    let rows: Vec<(String, i64)> = redis::cmd("ZRANGE")
        .arg(presence_key(world))
        .arg(0)
        .arg(-1)
        .arg("WITHSCORES")
        .query_async(conn)
        .await
        .context("reading local presence registry")?;
    Ok(active_presence_rows(rows, unix_ms()))
}

fn presence_key(world: &str) -> String {
    format!("rpc:presence:{world}")
}

fn unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{
        active_presence_rows, last_event_id, presence_changes, replay_tail, FightCursor,
        FightStreamQuery, PresenceChange, PresenceRecord,
    };
    use axum::extract::Query;
    use axum::http::{HeaderMap, HeaderValue, Uri};
    use std::collections::BTreeSet;

    /// Synthetic fixture ids, widened from a short tail so this module hand-types no live-shaped
    /// object id (scripts/check-chain-ids.mjs — a hardcoded id drifts the moment a package republishes,
    /// and these are stand-ins for presence keys, never pointers at a real object).
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

        let tail = replay_tail(stored, Some(FightCursor::new(90, 7))).unwrap();

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
    fn presence_ttl_lapse_emits_leave() {
        let (world, alice_id, bob_id) = (fixture_id("aa"), fixture_id("1"), fixture_id("2"));
        let alice = PresenceRecord::new(&world, Some(alice_id.as_str()), None);
        let bob = PresenceRecord::new(&world, Some(bob_id.as_str()), None);
        let rows = vec![
            (serde_json::to_string(&alice).unwrap(), 30_000),
            (serde_json::to_string(&bob).unwrap(), 45_000),
        ];
        let before = active_presence_rows(rows.clone(), 29_999);
        let after = active_presence_rows(rows, 30_001);

        assert_eq!(before, BTreeSet::from_iter([alice.clone(), bob.clone()]));
        assert_eq!(after, BTreeSet::from_iter([bob]));
        assert_eq!(
            presence_changes(&before, &after),
            vec![PresenceChange::Leave(alice)]
        );
    }
}
