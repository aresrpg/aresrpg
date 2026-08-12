// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! FalkorDB store for the `sui-indexer-alt-framework`.
//!
//! Implements the framework's sequential-pipeline store traits over the FalkorDB
//! Redis instance. Only RESP core commands + `GRAPH.QUERY` are used — the FalkorDB
//! image carries no RedisJSON/search, so bookkeeping lives in PLAIN string keys.
//!
//! ## Crash-safety on a non-transactional store
//!
//! The framework's sequential committer calls `set_committer_watermark` *before*
//! `Handler::commit` inside one `transaction` closure. Writing it eagerly would let
//! the watermark advance past a failed data commit. So `set_committer_watermark`
//! only BUFFERS the watermark on the connection; [`SequentialStore::transaction`]
//! flushes it *after* the data commit succeeds — the watermark is the LAST write of
//! every batch. A crash before the flush replays the batch, which converges because
//! every write is idempotent (README, law 5).

use anyhow::{Context, Result};
use async_trait::async_trait;
use redis::aio::MultiplexedConnection;
use scoped_futures::ScopedBoxFuture;
use serde::{Deserialize, Serialize};
use sui_indexer_alt_framework::store::{
    CommitterWatermark, Connection, InitWatermark, SequentialConnection, SequentialStore, Store,
};
use tracing::debug;

/// Key prefix for per-pipeline committer watermarks (`idx:watermark:{pipeline}`).
const WATERMARK_PREFIX: &str = "idx:watermark:";
/// Key holding the hex chain id this cache is bound to (network-mix guard).
const CHAIN_ID_KEY: &str = "idx:chain_id";

/// Persisted watermark document — a plain JSON string under a plain key.
#[derive(Debug, Serialize, Deserialize)]
struct WatermarkDoc {
    checkpoint_hi_inclusive: u64,
    epoch_hi_inclusive: u64,
    tx_hi: u64,
    timestamp_ms_hi_inclusive: u64,
}

/// A cloneable handle to FalkorDB that the framework uses as its backing store.
#[derive(Clone)]
pub struct FalkorStore {
    conn: MultiplexedConnection,
}

impl FalkorStore {
    /// Connect and verify reachability (fails fast on a bad `REDIS_URL`).
    pub async fn new(url: &str) -> Result<Self> {
        let client = redis::Client::open(url).context("opening Redis client")?;
        let mut conn = client
            .get_multiplexed_async_connection()
            .await
            .context("connecting to FalkorDB")?;
        let _: () = redis::cmd("PING")
            .query_async(&mut conn)
            .await
            .context("FalkorDB PING failed")?;
        Ok(Self { conn })
    }
}

#[async_trait]
impl Store for FalkorStore {
    type Connection<'c> = FalkorConnection;

    async fn connect<'c>(&'c self) -> Result<Self::Connection<'c>> {
        // MultiplexedConnection is cheap to clone; commands share one socket.
        Ok(FalkorConnection {
            conn: self.conn.clone(),
            pending_watermark: None,
        })
    }
}

#[async_trait]
impl SequentialStore for FalkorStore {
    type SequentialConnection<'c> = FalkorConnection;

    async fn transaction<'a, R, F>(&self, f: F) -> Result<R>
    where
        R: Send + 'a,
        F: Send + 'a,
        F: for<'r> FnOnce(&'r mut Self::Connection<'_>) -> ScopedBoxFuture<'a, 'r, Result<R>>,
    {
        let mut conn = self.connect().await?;
        // The data commit (plus the framework's buffered watermark write). `?`
        // propagates errors WITHOUT flushing, so a failed batch never advances.
        let result = f(&mut conn).await?;
        // Data is in — the watermark becomes the batch's last write.
        conn.flush_watermark().await?;
        Ok(result)
    }
}

/// A per-batch connection: a cloned multiplexed handle + the buffered watermark.
pub struct FalkorConnection {
    conn: MultiplexedConnection,
    pending_watermark: Option<(String, CommitterWatermark)>,
}

impl FalkorConnection {
    /// Mutable access to the underlying handle, for handler writes.
    pub fn connection(&mut self) -> &mut MultiplexedConnection {
        &mut self.conn
    }

    /// Persist the buffered committer watermark, if any — called by
    /// [`SequentialStore::transaction`] after the data commit succeeds.
    async fn flush_watermark(&mut self) -> Result<()> {
        let Some((pipeline, wm)) = self.pending_watermark.take() else {
            return Ok(());
        };
        let key = format!("{WATERMARK_PREFIX}{pipeline}");
        let doc = serde_json::to_string(&WatermarkDoc {
            checkpoint_hi_inclusive: wm.checkpoint_hi_inclusive,
            epoch_hi_inclusive: wm.epoch_hi_inclusive,
            tx_hi: wm.tx_hi,
            timestamp_ms_hi_inclusive: wm.timestamp_ms_hi_inclusive,
        })?;
        let _: () = redis::cmd("SET")
            .arg(&key)
            .arg(doc)
            .query_async(&mut self.conn)
            .await
            .context("writing committer watermark")?;
        Ok(())
    }
}

#[async_trait]
impl Connection for FalkorConnection {
    async fn init_watermark(
        &mut self,
        pipeline_task: &str,
        checkpoint_hi_inclusive: Option<u64>,
    ) -> Result<Option<InitWatermark>> {
        // Sequential pipeline: no pre-created watermark row — delegate to the
        // committer watermark. `None` makes the framework start from the boot-
        // derived first checkpoint.
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
            // A different chain — refuse: testnet and mainnet never mix in one cache.
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
        let raw: Option<String> = redis::cmd("GET")
            .arg(&key)
            .query_async(&mut self.conn)
            .await
            .context("reading committer watermark")?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let doc: WatermarkDoc = serde_json::from_str(&raw)?;
        Ok(Some(CommitterWatermark {
            epoch_hi_inclusive: doc.epoch_hi_inclusive,
            checkpoint_hi_inclusive: doc.checkpoint_hi_inclusive,
            tx_hi: doc.tx_hi,
            timestamp_ms_hi_inclusive: doc.timestamp_ms_hi_inclusive,
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

// Sequential pipelines only need the default helper; nothing more to implement.
impl SequentialConnection for FalkorConnection {}
