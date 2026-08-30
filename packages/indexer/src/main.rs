// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! AresRPG indexer — the chain's one projectionist.
//!
//! Streams Sui checkpoints and projects the game's LIVE state into FalkorDB:
//! graph (live truth), analytics, per-address sales history, and pub/sub (the live wire).
//! The ONLY writer of this Redis; everything it stores
//! is a re-derivable cache of public chain truth. Contract: README.md.
//!
//! Config is TWO game-specific ids (original package + latest upgrade) — type
//! origins and the start checkpoint derive from chain state at boot.

mod analytics;
mod boot;
mod decode;
mod events;
mod gates;
mod graph;
mod ownership;
mod pipeline;
mod publish;
mod store;

use anyhow::{Context, Result};
use clap::Parser;
use sui_indexer_alt_framework::ingestion::{
    ingestion_client::IngestionClientArgs, streaming_client::StreamingClientArgs, ClientArgs,
    IngestConcurrencyConfig, IngestionConfig,
};
use sui_indexer_alt_framework::pipeline::sequential::SequentialConfig;
use sui_indexer_alt_framework::{Indexer, IndexerArgs};
use tracing::info;
use url::Url;

use crate::pipeline::AresHandler;
use crate::store::FalkorStore;

#[derive(Parser, Debug)]
#[command(
    name = "aresrpg-indexer",
    version,
    about = "AresRPG chain projectionist"
)]
struct Args {
    /// Framework indexer args (--first-checkpoint / --last-checkpoint / --pipeline).
    #[clap(flatten)]
    indexer: IndexerArgs,

    /// gRPC checkpoint streaming source; when set, streams live with the remote
    /// store as backfill. Unset = remote-store polling only.
    #[clap(flatten)]
    streaming: StreamingClientArgs,

    /// HTTP checkpoint store (backfill + polling source).
    #[arg(
        long,
        env = "REMOTE_STORE_URL",
        default_value = "https://checkpoints.testnet.sui.io"
    )]
    remote_store_url: Url,

    /// The FalkorDB instance (graph + zsets + pub/sub — the one store).
    #[arg(long, env = "REDIS_URL", default_value = "redis://127.0.0.1:6379")]
    redis_url: String,

    /// The game package's ORIGINAL id — type origins match against it.
    #[arg(long, env = "PACKAGE_ORIGINAL")]
    package_original: String,

    /// The game package's LATEST upgrade id — validates the lineage at boot.
    #[arg(long, env = "PACKAGE_LATEST")]
    package_latest: String,

    /// The seed (living-content) package's ORIGINAL id — content events and
    /// content-typed objects match this second origin.
    #[arg(long, env = "SEED_PACKAGE_ORIGINAL")]
    seed_package_original: String,

    /// Official GraphQL endpoint for boot derivation (lineage + publish
    /// checkpoint). Mainnet: https://sui-mainnet.mystenlabs.com/graphql
    #[arg(
        long,
        env = "GRAPHQL_URL",
        default_value = "https://graphql.testnet.sui.io/graphql"
    )]
    graphql_url: String,

    /// Ceiling on concurrent checkpoint fetches against the shared public
    /// bucket (the 2026-07-14 rate-limit incident: the framework's adaptive
    /// default self-inflicts 429 storms against Mysten's shared bucket).
    #[arg(
        long = "ingest-max-concurrency",
        env = "INGEST_MAX_CONCURRENCY",
        default_value_t = 16
    )]
    ingest_max_concurrency: usize,
}

/// A connection string with its userinfo stripped — `redis://user:pw@host:6379`
/// becomes `redis://***@host:6379`. Boot logs name the endpoint the operator
/// needs to recognise; the credential in it is not part of that fact, and logs
/// outlive the process in places the secret store does not reach.
fn redacted_url(url: &str) -> String {
    let Some((scheme, rest)) = url.split_once("://") else {
        return url.to_string();
    };
    match rest.rsplit_once('@') {
        Some((_, host)) => format!("{scheme}://***@{host}"),
        None => url.to_string(),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let mut args = Args::parse();
    let package_original = pipeline::canonical(&args.package_original)?;
    let seed_package_original = pipeline::canonical(&args.seed_package_original)?;
    let package_latest = pipeline::canonical(&args.package_latest)?;

    let store = FalkorStore::new(&args.redis_url)
        .await
        .context("connecting store")?;

    // ── boot derivation: two ids in, everything else from chain state ──
    let mut boot_conn = redis::Client::open(args.redis_url.as_str())?
        .get_multiplexed_async_connection()
        .await
        .context("boot connection")?;
    boot::ensure_indexes(&mut boot_conn).await?;
    boot::bind_projection(&mut boot_conn, &package_original, &seed_package_original).await?;
    // A RESUMING deploy (a watermark exists) never touches the network at boot
    // (README): lineage was validated when the store was fresh, and the store
    // itself is bound to its chain by the chain-id guard.
    let fresh = !boot::has_watermark(&mut boot_conn).await?;
    if fresh {
        args.indexer.first_checkpoint = Some(
            boot::publish_checkpoint(&args.graphql_url, &package_original)
                .await
                .context("deriving the start checkpoint")?,
        );
    }
    let activity_lineage = boot::activity_lineage(
        &mut boot_conn,
        &args.graphql_url,
        &package_original,
        &package_latest,
        fresh,
    )
    .await?;

    info!(
        redis_url = %redacted_url(&args.redis_url),
        package_original = %package_original,
        seed_package_original = %seed_package_original,
        package_latest = %package_latest,
        remote_store_url = %redacted_url(args.remote_store_url.as_str()),
        first_checkpoint = ?args.indexer.first_checkpoint,
        "starting AresRPG indexer"
    );

    let client_args = ClientArgs {
        ingestion: IngestionClientArgs {
            remote_store_url: Some(args.remote_store_url),
            ..Default::default()
        },
        streaming: args.streaming,
    };

    let ingestion_config = IngestionConfig {
        ingest_concurrency: IngestConcurrencyConfig::Adaptive {
            initial: 1,
            min: 1,
            max: args.ingest_max_concurrency,
            dead_band: None,
        },
        ..IngestionConfig::default()
    };

    let registry = prometheus::Registry::new();
    let mut indexer = Indexer::new(
        store,
        args.indexer,
        client_args,
        ingestion_config,
        None,
        &registry,
    )
    .await
    .context("creating indexer")?;

    // The ONE pipeline: objects → graph; transactions/events → analytics, sales, and pub/sub.
    indexer
        .sequential_pipeline(
            AresHandler::new(
                &package_original,
                &package_latest,
                &seed_package_original,
                &activity_lineage,
            )?,
            // Explicit channel sizes: the framework defaults derive them from num_cpus/2,
            // which is 0 under a 1-CPU container limit — mpsc::channel(0) panics at boot
            // (2026-08-19, first k8s deploy). Sized for one sequential pipeline, not cores.
            SequentialConfig {
                processor_channel_size: Some(4),
                pipeline_depth: Some(4),
                ..SequentialConfig::default()
            },
        )
        .await
        .context("registering ares pipeline")?;

    info!("pipeline registered; running");
    let mut service = indexer.run().await.context("starting indexer service")?;
    service.join().await.context("joining indexer service")?;
    info!("indexer stopped");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::redacted_url;

    #[test]
    fn boot_logs_never_carry_the_password() {
        assert_eq!(
            redacted_url("redis://admin:hunter2@falkor.internal:6379"),
            "redis://***@falkor.internal:6379"
        );
        // a password containing '@' still redacts — the LAST '@' separates the host
        assert_eq!(
            redacted_url("redis://admin:p@ss@falkor.internal:6379"),
            "redis://***@falkor.internal:6379"
        );
        // credential-free urls survive whole: the endpoint IS the fact worth logging
        assert_eq!(
            redacted_url("redis://127.0.0.1:6379"),
            "redis://127.0.0.1:6379"
        );
        assert_eq!(
            redacted_url("https://checkpoints.testnet.sui.io"),
            "https://checkpoints.testnet.sui.io"
        );
        assert_eq!(redacted_url("not-a-url"), "not-a-url");
    }
}
