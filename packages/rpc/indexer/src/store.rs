// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Redis store for the `sui-indexer-alt-framework`.
//!
//! Implements the framework's sequential-pipeline store traits over Redis 8:
//!
//!  * [`Store`] hands out connections.
//!  * [`SequentialStore`] provides the batched `transaction` the framework's
//!    committer wraps around `set_committer_watermark` + `Handler::commit`.
//!  * [`Connection`] / [`SequentialConnection`] carry watermark + chain-id state.
//!
//! Watermarks live as JSON docs at `rpc:watermark:{pipeline}`; the observed chain
//! id at `rpc:chain_id`. Everything here is a re-derivable cache of public chain
//! truth — the store holds no keys and signs nothing.
//!
//! ## Crash-safety on a non-transactional store
//!
//! Redis has no cross-key transaction spanning our data write and the watermark
//! write, and the framework's sequential committer calls `set_committer_watermark`
//! *before* `Handler::commit` inside a single `transaction` closure. Writing the
//! watermark eagerly would let it advance ahead of a failed data commit and
//! corrupt the read-model. So `set_committer_watermark` only BUFFERS the watermark
//! on the connection; [`SequentialStore::transaction`] flushes it to Redis *after*
//! the data commit succeeds, making the watermark the last write of the batch. A
//! crash before the flush leaves the watermark un-advanced and the framework
//! cleanly replays the batch — safe because every write here is an idempotent
//! upsert (`JSON.SET`).

use anyhow::{Context, Result};
use async_trait::async_trait;
use redis::aio::MultiplexedConnection;
use scoped_futures::ScopedBoxFuture;
use serde::Deserialize;
use sui_indexer_alt_framework::store::{
    CommitterWatermark, Connection, InitWatermark, SequentialConnection, SequentialStore, Store,
};
use tracing::debug;

/// Key prefix for per-pipeline committer watermarks (`rpc:watermark:{pipeline}`).
const WATERMARK_PREFIX: &str = "rpc:watermark:";
/// Key holding the hex chain id this cache is bound to (guards against mixing networks).
const CHAIN_ID_KEY: &str = "rpc:chain_id";

/// Shape of a persisted watermark JSON document.
#[derive(Debug, Deserialize)]
struct WatermarkDoc {
    checkpoint_hi_inclusive: u64,
    epoch_hi_inclusive: u64,
    tx_hi: u64,
    timestamp_ms_hi_inclusive: u64,
}

/// A cloneable handle to Redis that the framework uses as its backing store.
#[derive(Clone)]
pub struct RedisStore {
    conn: MultiplexedConnection,
}

impl RedisStore {
    /// Connect to Redis and verify reachability (fails fast on a bad `REDIS_URL`).
    pub async fn new(url: &str) -> Result<Self> {
        let client = redis::Client::open(url).context("opening Redis client")?;
        let mut conn = client
            .get_multiplexed_async_connection()
            .await
            .context("connecting to Redis")?;
        let _: () = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .context("Redis PING failed")?;
        Ok(Self { conn })
    }
}

#[async_trait]
impl Store for RedisStore {
    type Connection<'c> = RedisConnection;

    async fn connect<'c>(&'c self) -> Result<Self::Connection<'c>> {
        // MultiplexedConnection is cheap to clone; commands multiplex over one socket.
        Ok(RedisConnection {
            conn: self.conn.clone(),
            pending_watermark: None,
        })
    }
}

#[async_trait]
impl SequentialStore for RedisStore {
    type SequentialConnection<'c> = RedisConnection;

    async fn transaction<'a, R, F>(&self, f: F) -> Result<R>
    where
        R: Send + 'a,
        F: Send + 'a,
        F: for<'r> FnOnce(&'r mut Self::Connection<'_>) -> ScopedBoxFuture<'a, 'r, Result<R>>,
    {
        let mut conn = self.connect().await?;
        // Run the data commit (and the framework's buffered watermark write). `?`
        // propagates any error WITHOUT flushing the watermark, so a failed batch
        // never advances it.
        let result = f(&mut conn).await?;
        // Data is in — now make the watermark the last write of the batch.
        conn.flush_watermark().await?;
        Ok(result)
    }
}

/// A per-batch connection. Owns a cloned multiplexed Redis handle plus the
/// watermark buffered by `set_committer_watermark` (flushed by `transaction`).
pub struct RedisConnection {
    conn: MultiplexedConnection,
    pending_watermark: Option<(String, CommitterWatermark)>,
}

impl RedisConnection {
    /// Mutable access to the underlying Redis handle, for handler writes.
    pub fn connection(&mut self) -> &mut MultiplexedConnection {
        &mut self.conn
    }

    /// Persist the buffered committer watermark, if any. Called by
    /// [`SequentialStore::transaction`] after the data commit succeeds.
    async fn flush_watermark(&mut self) -> Result<()> {
        let Some((pipeline, wm)) = self.pending_watermark.take() else {
            return Ok(());
        };
        let key = format!("{WATERMARK_PREFIX}{pipeline}");
        let doc = serde_json::json!({
            "checkpoint_hi_inclusive": wm.checkpoint_hi_inclusive,
            "epoch_hi_inclusive": wm.epoch_hi_inclusive,
            "tx_hi": wm.tx_hi,
            "timestamp_ms_hi_inclusive": wm.timestamp_ms_hi_inclusive,
        })
        .to_string();
        let _: () = redis::cmd("JSON.SET")
            .arg(&key)
            .arg("$")
            .arg(doc)
            .query_async(&mut self.conn)
            .await
            .context("writing committer watermark")?;
        Ok(())
    }
}

#[async_trait]
impl Connection for RedisConnection {
    async fn init_watermark(
        &mut self,
        pipeline_task: &str,
        checkpoint_hi_inclusive: Option<u64>,
    ) -> Result<Option<InitWatermark>> {
        // Sequential pipeline: this store never pre-creates a watermark row, so
        // delegate to the committer watermark. Returns None when absent, which
        // makes the framework start from `--first-checkpoint` (or genesis).
        self.delegate_to_committer_watermark(pipeline_task, checkpoint_hi_inclusive)
            .await
    }

    async fn accepts_chain_id(&mut self, _pipeline_task: &str, chain_id: [u8; 32]) -> Result<bool> {
        let incoming = hex::encode(chain_id);
        let stored: Option<String> = redis::cmd("GET")
            .arg(CHAIN_ID_KEY)
            .query_async(&mut self.conn)
            .await
            .context("reading chain id")?;
        match stored {
            Some(existing) if existing == incoming => Ok(true),
            // A different chain — refuse, so e.g. testnet and mainnet data never
            // mix in one cache.
            Some(_) => Ok(false),
            None => {
                let _: () = redis::cmd("SET")
                    .arg(CHAIN_ID_KEY)
                    .arg(&incoming)
                    .query_async(&mut self.conn)
                    .await
                    .context("recording chain id")?;
                Ok(true)
            }
        }
    }

    async fn committer_watermark(
        &mut self,
        pipeline_task: &str,
    ) -> Result<Option<CommitterWatermark>> {
        let key = format!("{WATERMARK_PREFIX}{pipeline_task}");
        let raw: Option<String> = redis::cmd("JSON.GET")
            .arg(&key)
            .arg("$")
            .query_async(&mut self.conn)
            .await
            .context("reading committer watermark")?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        // JSON.GET with a JSONPath returns an array of matches.
        let docs: Vec<WatermarkDoc> = serde_json::from_str(&raw)?;
        Ok(docs.into_iter().next().map(|d| CommitterWatermark {
            epoch_hi_inclusive: d.epoch_hi_inclusive,
            checkpoint_hi_inclusive: d.checkpoint_hi_inclusive,
            tx_hi: d.tx_hi,
            timestamp_ms_hi_inclusive: d.timestamp_ms_hi_inclusive,
        }))
    }

    async fn set_committer_watermark(
        &mut self,
        pipeline_task: &str,
        watermark: CommitterWatermark,
    ) -> Result<bool> {
        // Buffer only — flushed by `transaction` after the data commit (see the
        // crash-safety note at the top of this file).
        debug!(
            pipeline = pipeline_task,
            checkpoint = watermark.checkpoint_hi_inclusive,
            "buffering committer watermark"
        );
        self.pending_watermark = Some((pipeline_task.to_string(), watermark));
        Ok(true)
    }
}

// Sequential pipelines only need the default `delegate_to_committer_watermark`
// helper; there are no extra required methods to implement.
impl SequentialConnection for RedisConnection {}
