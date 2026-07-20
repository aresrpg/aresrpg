//! Checkpoint ingestion handler — the read spine.
//!
//! Records the latest ingested checkpoint (sequence, epoch, timestamp) into Redis
//! as a single JSON document at `rpc:checkpoint:latest`. This proves the ingestion
//! pipeline end-to-end and feeds the API's `/v1/status` lag calculation. The
//! framework's committer watermark (see `store.rs`) tracks replay position
//! separately; this record is the human/API-facing "chain tip we've reached".

use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use serde::Serialize;
use sui_indexer_alt_framework::pipeline::{sequential::Handler, Processor};
use sui_indexer_alt_framework::store::Store;
use sui_indexer_alt_framework::types::full_checkpoint_content::Checkpoint;
use tracing::info;

use crate::store::RedisStore;

/// Redis key holding the latest ingested checkpoint as a JSON document.
pub const LATEST_CHECKPOINT_KEY: &str = "rpc:checkpoint:latest";

/// One record per checkpoint. The framework batches these in checkpoint order;
/// only the highest is persisted (it supersedes the rest for a "latest" view).
#[derive(Debug, Clone, Serialize)]
pub struct CheckpointRecord {
    pub sequence_number: u64,
    pub epoch: u64,
    pub timestamp_ms: u64,
    pub transaction_count: usize,
}

/// Records checkpoint liveness into Redis.
pub struct CheckpointHandler {
    /// Chain label ("testnet" | "mainnet" | …) stamped onto the record for readers.
    pub network: String,
}

#[async_trait]
impl Processor for CheckpointHandler {
    type Value = CheckpointRecord;

    const NAME: &'static str = "checkpoints";

    async fn process(&self, checkpoint: &Arc<Checkpoint>) -> Result<Vec<Self::Value>> {
        let summary = &checkpoint.summary;
        Ok(vec![CheckpointRecord {
            sequence_number: summary.sequence_number,
            epoch: summary.epoch,
            timestamp_ms: summary.timestamp_ms,
            transaction_count: checkpoint.transactions.len(),
        }])
    }
}

#[async_trait]
impl Handler for CheckpointHandler {
    type Store = RedisStore;
    type Batch = Vec<CheckpointRecord>;

    fn batch(&self, batch: &mut Self::Batch, values: std::vec::IntoIter<Self::Value>) {
        batch.extend(values);
    }

    async fn commit<'a>(
        &self,
        batch: &Self::Batch,
        conn: &mut <Self::Store as Store>::Connection<'a>,
    ) -> Result<usize> {
        // Checkpoints arrive in order; the last record is the newest tip. Writing
        // only the tip keeps the "latest" doc correct while collapsing a batch of
        // N checkpoints into one write.
        let Some(tip) = batch.last() else {
            return Ok(0);
        };

        let doc = serde_json::json!({
            "sequence_number": tip.sequence_number,
            "epoch": tip.epoch,
            "timestamp_ms": tip.timestamp_ms,
            "transaction_count": tip.transaction_count,
            "network": self.network,
        })
        .to_string();

        let _: () = redis::cmd("JSON.SET")
            .arg(LATEST_CHECKPOINT_KEY)
            .arg("$")
            .arg(doc)
            .query_async(conn.connection())
            .await?;

        info!(
            checkpoint = tip.sequence_number,
            epoch = tip.epoch,
            timestamp_ms = tip.timestamp_ms,
            batched = batch.len(),
            "recorded checkpoint tip"
        );

        Ok(batch.len())
    }
}
