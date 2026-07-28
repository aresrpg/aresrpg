// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Topic-keyed SSE read surface (#1382).
//!
//! Two routes are deliberately in scope:
//!
//! * `GET /v1/stream/fight/{fight_id}` replays the already-decoded per-fight
//!   journal and then tip-polls it for live events.
//! * `GET /v1/stream/presence/{world_id}?address=…&character=…` maintains and
//!   observes an ephemeral presence registry, and delivers the courier's world
//!   traffic — live poses and chat lines — on the same connection.
//!
//! Both fan-out paths use only the location's Redis. There is intentionally no
//! Redis-to-Redis transport. Fight SSE is a second consumer of the journal
//! produced by the existing `ares` decode; it never BCS-decodes chain events.
//! Presence is connection-observed and location-local: cross-location users do
//! not appear in this registry. The courier half is a second consumer of what
//! `api/courier.mjs` already authenticated and wrote; this route never accepts
//! player input and never authors a courier row.

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
use axum::middleware;
use axum::response::sse::{Event, KeepAlive};
use axum::response::{IntoResponse, Response, Sse};
use axum::routing::get;
use axum::Router;
use redis::aio::MultiplexedConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sui_indexer_alt_framework::types::base_types::{ObjectID, SuiAddress};
use tokio::sync::mpsc;
use tokio::time::{interval, interval_at, Instant, MissedTickBehavior};
use tokio_stream::wrappers::ReceiverStream;
use tokio_stream::{Stream, StreamExt as _};
use tracing::warn;

const FIGHT_POLL_INTERVAL: Duration = Duration::from_millis(250);
const PRESENCE_POLL_INTERVAL: Duration = Duration::from_secs(1);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(20);
const PRESENCE_REFRESH_INTERVAL: Duration = Duration::from_secs(15);
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
        .route("/v1/stream/presence/{world_id}", get(presence_stream))
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
    // Subscribe BEFORE reading either snapshot: a row published while we are still assembling the join
    // frames waits in the channel instead of vanishing into the gap.
    let courier_rows = subscribe_courier(&state.redis, &presence.world).await?;
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

    let live_poses = read_courier_positions(&mut conn, &presence.world).await?;
    let snapshot = courier_positions_frame(&presence.world, &live_poses);
    if sender
        .send(Ok(Event::default().event("positions").data(snapshot)))
        .await
        .is_err()
    {
        return Ok(());
    }
    // The courier's deltas ride the SAME connection from here on. The task ends with the socket: its sends
    // fail the moment this receiver is dropped.
    tokio::spawn(pump_courier(Box::pin(courier_rows), sender.clone()));

    let now = Instant::now();
    let mut poll = interval_at(now + PRESENCE_POLL_INTERVAL, PRESENCE_POLL_INTERVAL);
    // Half the score TTL: this socket's own registry row must never lapse while
    // the connection is open. It is a liveness write, not a transport keepalive.
    let mut refresh = interval_at(now + PRESENCE_REFRESH_INTERVAL, PRESENCE_REFRESH_INTERVAL);
    poll.set_missed_tick_behavior(MissedTickBehavior::Skip);
    refresh.set_missed_tick_behavior(MissedTickBehavior::Skip);

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
            _ = refresh.tick() => refresh_presence(&mut conn, &presence).await?,
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

// ── THE COURIER'S DELIVERY HALF (#1508)
//
// `api/courier.mjs` authenticates a pose or a chat line and writes it to this location's Redis: the latest
// pose under `courier:position:<world>:<character>` (indexed with its expiry score in
// `courier:positions:<world>`), and EVERY accepted row published on `courier:presence:<world>`. This route is
// that channel's only reader — the write half had no reader at all, so a world client had no delivery path
// for peer positions or for any chat line.
//
// Courier rows are EPHEMERAL: no journal, therefore no cursor and deliberately no SSE id. A reconnect gets the
// live snapshot, never a replay — the fight stream's Last-Event-ID law is untouched by this half.

fn courier_channel(world: &str) -> String {
    format!("courier:presence:{world}")
}

fn courier_index_key(world: &str) -> String {
    format!("courier:positions:{world}")
}

fn courier_position_key(world: &str, character: &str) -> String {
    format!("courier:position:{world}:{character}")
}

/// One published courier row → the NAMED frame it is delivered as. The courier owns the row vocabulary, so
/// the bytes it authored are forwarded verbatim; a row this route cannot name is dropped, never guessed at.
pub(crate) fn courier_frame(payload: &str) -> Option<(&'static str, String)> {
    let row: Value = serde_json::from_str(payload).ok()?;
    let kind = match row.get("type").and_then(Value::as_str)? {
        "position" => "position",
        "chat" => "chat",
        _ => return None,
    };
    Some((kind, payload.to_owned()))
}

/// The live-pose snapshot a joining connection needs before any delta means anything.
pub(crate) fn courier_positions_frame(world: &str, payloads: &[Option<String>]) -> String {
    let positions: Vec<Value> = payloads
        .iter()
        .flatten()
        .filter_map(|raw| serde_json::from_str(raw).ok())
        .collect();
    json!({ "type": "positions", "world": world, "positions": positions }).to_string()
}

/// Forward one world's courier channel onto an open presence connection until either end goes away. The
/// row source is a parameter so this delivery path is exercised by a test instead of only in production.
pub(crate) async fn pump_courier<S>(mut rows: S, sender: SseSender)
where
    S: Stream<Item = String> + Unpin,
{
    while let Some(payload) = rows.next().await {
        let Some((kind, data)) = courier_frame(&payload) else {
            continue;
        };
        if sender
            .send(Ok(Event::default().event(kind).data(data)))
            .await
            .is_err()
        {
            return;
        }
    }
}

async fn subscribe_courier(client: &redis::Client, world: &str) -> Result<impl Stream<Item = String>> {
    let mut pubsub = client
        .get_async_pubsub()
        .await
        .context("connecting the courier channel")?;
    pubsub
        .subscribe(courier_channel(world))
        .await
        .context("subscribing to the courier channel")?;
    Ok(pubsub
        .into_on_message()
        .filter_map(|message| message.get_payload::<String>().ok()))
}

/// Prune the lapsed scores and read every live pose in one local step — the same expiry semantics the writer
/// applies, kept atomic so a snapshot can never carry a pose the index has already dropped.
async fn read_courier_positions(
    conn: &mut MultiplexedConnection,
    world: &str,
) -> Result<Vec<Option<String>>> {
    let index = courier_index_key(world);
    let now = unix_ms();
    let characters: Vec<String> = redis::cmd("EVAL")
        .arg(
            "redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1]); \
             return redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], '+inf')",
        )
        .arg(1)
        .arg(&index)
        .arg(now)
        .query_async(conn)
        .await
        .context("reading the courier position index")?;
    if characters.is_empty() {
        return Ok(Vec::new());
    }
    let keys: Vec<String> = characters
        .iter()
        .map(|character| courier_position_key(world, character))
        .collect();
    redis::cmd("MGET")
        .arg(keys)
        .query_async(conn)
        .await
        .context("reading the live courier positions")
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
        active_presence_rows, bad_request, courier_positions_frame, fight_frame_payload,
        last_event_id, presence_changes, public_read_cors, pump_courier, replay_tail,
        stream_response, FightCursor, FightStreamQuery, PresenceChange, PresenceRecord, SseItem,
    };
    use axum::body::to_bytes;
    use axum::extract::Query;
    use axum::http::{
        header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderMap, HeaderValue, StatusCode, Uri,
    };
    use axum::response::sse::Event;
    use axum::response::IntoResponse;
    use serde_json::json;
    use std::collections::BTreeSet;
    use tokio::sync::mpsc;

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

    /// THE DELIVERY GATE (#1508): a row the courier published reaches a connection subscribed to that
    /// world — named by its own `type`, carrying the courier's bytes, and nothing else invented.
    #[tokio::test]
    async fn published_courier_rows_reach_a_subscribed_connection() {
        let world = fixture_id("aa");
        let character = fixture_id("1");
        let pose =
            format!(r#"{{"type":"position","world":"{world}","character":"{character}","x":4.0,"z":6.0}}"#);
        let line = format!(r#"{{"type":"chat","world":"{world}","character":"{character}","text":"hi"}}"#);
        let (sender, mut receiver) = mpsc::channel::<SseItem>(8);

        pump_courier(
            tokio_stream::iter([
                pose.clone(),
                r#"{"type":"weather"}"#.to_owned(), // a vocabulary this route does not speak
                "not json at all".to_owned(),
                line.clone(),
            ]),
            sender,
        )
        .await;

        // `Event` exposes no reader, so the wire bytes are read off its Debug buffer; the quote-unescape
        // undoes only Debug's own rendering, leaving the exact bytes the connection would receive.
        let mut frames = Vec::new();
        while let Ok(frame) = receiver.try_recv() {
            frames.push(format!("{:?}", frame.unwrap()).replace("\\\"", "\""));
        }

        assert_eq!(frames.len(), 2, "only nameable courier rows are delivered");
        assert!(frames[0].contains("event: position") && frames[0].contains(&pose));
        assert!(frames[1].contains("event: chat") && frames[1].contains(&line));
    }

    #[test]
    fn the_join_snapshot_carries_every_live_pose_and_no_debris() {
        let world = fixture_id("aa");
        let pose = format!(r#"{{"type":"position","character":"{}","x":1.0,"z":2.0}}"#, fixture_id("1"));
        let frame = courier_positions_frame(
            &world,
            &[Some(pose.clone()), None, Some("expired debris".to_owned())],
        );

        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&frame).unwrap(),
            json!({
                "type": "positions",
                "world": world,
                "positions": [serde_json::from_str::<serde_json::Value>(&pose).unwrap()],
            })
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
