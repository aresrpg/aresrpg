// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
use std::collections::BTreeSet;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use async_trait::async_trait;
use futures::StreamExt;
use object_store::local::LocalFileSystem;
use prometheus::Registry;
use sui_indexer_alt_framework::ingestion::{
    ingestion_client::{
        CheckpointError, CheckpointResult, IngestionClient, IngestionClientArgs,
        IngestionClientTrait,
    },
    store_client::StoreIngestionClient,
    streaming_client::{CheckpointStream, CheckpointStreamingClient, StreamingClientArgs},
    ClientArgs, IngestConcurrencyConfig, IngestionConfig, IngestionService,
};
use sui_indexer_alt_framework::types::{
    digests::ChainIdentifier, full_checkpoint_content::Checkpoint,
};

const START: u64 = 342543637;
const LIVE: u64 = START + 3;
const END: u64 = LIVE + 3;

struct Archive {
    fixture: Checkpoint,
    requests: Arc<Mutex<Vec<u64>>>,
}

impl Archive {
    fn checkpoint_at(&self, sequence: u64) -> Checkpoint {
        let mut checkpoint = self.fixture.clone();
        checkpoint.summary.data_mut_for_testing().sequence_number = sequence;
        checkpoint
    }

    fn chain(&self) -> ChainIdentifier {
        (*self.fixture.summary.digest()).into()
    }
}

#[async_trait]
impl IngestionClientTrait for Archive {
    async fn chain_id(&self) -> anyhow::Result<ChainIdentifier> {
        Ok(self.chain())
    }
    async fn checkpoint(&self, sequence: u64) -> CheckpointResult {
        self.requests.lock().unwrap().push(sequence);
        Ok(self.checkpoint_at(sequence))
    }
    async fn latest_checkpoint_number(&self) -> anyhow::Result<u64> {
        Ok(END - 1)
    }
}

struct PrunedLedger(Arc<AtomicUsize>, ChainIdentifier);

#[async_trait]
impl IngestionClientTrait for PrunedLedger {
    async fn chain_id(&self) -> anyhow::Result<ChainIdentifier> {
        Ok(self.1)
    }
    async fn checkpoint(&self, _: u64) -> CheckpointResult {
        self.0.fetch_add(1, Ordering::Relaxed);
        Err(CheckpointError::NotFound)
    }
    async fn latest_checkpoint_number(&self) -> anyhow::Result<u64> {
        Ok(LIVE)
    }
}

#[async_trait]
impl CheckpointStreamingClient for Archive {
    async fn connect(
        &self,
    ) -> sui_indexer_alt_framework::ingestion::error::Result<CheckpointStream> {
        let checkpoints = (LIVE..END)
            .map(|cp| Ok(self.checkpoint_at(cp)))
            .collect::<Vec<_>>();
        Ok(CheckpointStream {
            stream: tokio_stream::StreamExt::peekable(futures::stream::iter(checkpoints).boxed()),
            chain_id: self.chain(),
        })
    }
}

// Publicnode's 2026-11-07 incident: restart at 342543637, live stream succeeds,
// but its LedgerService has already pruned that checkpoint. The archival source
// still has it; retrying NOT_FOUND on the streaming provider can never recover.
#[tokio::test]
async fn restart_gap_uses_archive_when_streaming_ledger_has_pruned_history() {
    let registry = Registry::new();
    let config = IngestionConfig {
        ingest_concurrency: IngestConcurrencyConfig::Fixed { value: 1 },
        streaming_connection_timeout_ms: 10,
        retry_interval_ms: 1,
        ..Default::default()
    };
    let args = ClientArgs {
        ingestion: IngestionClientArgs {
            remote_store_url: Some("https://archive.invalid".parse().unwrap()),
            ..Default::default()
        },
        streaming: StreamingClientArgs {
            streaming_url: Some("http://127.0.0.1:1".parse().unwrap()),
        },
    };
    let (archive_client, _, gap_fill) = super::clients(args, &config, &registry).unwrap();
    let metrics = archive_client.metrics().clone();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let fixtures = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    let fixture = StoreIngestionClient::new(
        Arc::new(LocalFileSystem::new_with_prefix(fixtures).unwrap()),
        None,
    )
    .checkpoint(330185168)
    .await
    .unwrap();
    let archive = Arc::new(Archive {
        fixture,
        requests: requests.clone(),
    });
    let pruned_requests = Arc::new(AtomicUsize::new(0));
    let gap_fill = gap_fill.map(|_| {
        IngestionClient::from_trait(
            Arc::new(PrunedLedger(pruned_requests.clone(), archive.chain())),
            metrics.clone(),
        )
    });
    let mut ingestion = IngestionService::with_clients(
        IngestionClient::from_trait(archive.clone(), metrics),
        Some(archive),
        gap_fill,
        config,
    );
    let mut receiver = ingestion.subscribe_bounded(4);
    let mut service = ingestion.run(START..END).await.unwrap();
    let received = tokio::time::timeout(Duration::from_secs(1), async {
        let mut checkpoints = BTreeSet::new();
        while checkpoints.len() < (END - START) as usize {
            let envelope = receiver
                .recv()
                .await
                .expect("ingestion remains open until complete");
            checkpoints.insert(envelope.checkpoint.summary.sequence_number);
        }
        checkpoints
    })
    .await
    .expect("a pruned streaming ledger must not block the archive restart gap");
    service.join().await.unwrap();
    assert_eq!(received, (START..END).collect());
    assert_eq!(*requests.lock().unwrap(), (START..LIVE).collect::<Vec<_>>());
    assert_eq!(pruned_requests.load(Ordering::Relaxed), 0);
}

#[test]
fn an_unconfigured_stream_keeps_archive_polling_available() {
    let args = ClientArgs {
        ingestion: IngestionClientArgs {
            remote_store_url: Some("https://archive.invalid".parse().unwrap()),
            ..Default::default()
        },
        ..Default::default()
    };
    let (_, streaming, gap_fill) =
        super::clients(args, &IngestionConfig::default(), &Registry::new()).unwrap();
    assert!(streaming.is_none());
    assert!(gap_fill.is_none());
}
