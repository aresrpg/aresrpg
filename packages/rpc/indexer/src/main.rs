// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! AresRPG RPC — Sui checkpoint indexer.
//!
//! Streams Sui checkpoints into Redis for the read-only AresRPG RPC. This binary
//! carries the ingestion spine: one sequential pipeline recording checkpoint
//! liveness ([`handlers::CheckpointHandler`]). Game-specific pipelines
//! (characters, kiosk listings, pools, shop, per-world zones — SPEC §14) register
//! the same way as the matching Move packages ship.
//!
//! Read-only by construction: it holds no keys, signs nothing, and only writes a
//! re-derivable cache of public chain truth.
//!
//! Configuration is entirely env-driven (see the [`Args`] fields); a `.env` file
//! is loaded if present.
//!
//! ## Error reporting — BLOCKED this pass (design note, issue #29)
//!
//! Not wired: the org's Sentry "indexer" project has a DSN reserved, but a correct
//! integration needs a new `sentry` crate dependency (features `["anyhow"]` for
//! [`anyhow::Error`] capture via `sentry_anyhow::capture_anyhow`, plus the default
//! panic-hook integration `sentry::integrations::panic` to catch a panic in ANY
//! tokio task the framework spawns, not just an `Err` bubbling out of `main`) —
//! and this crate has no cached `target/` or registry in a fresh checkout, so
//! resolving + compiling that dependency (on top of the already-heavy
//! `sui-indexer-alt-framework` git dependency) is a from-scratch build too slow to
//! verify inside this lane's budget. Recommended shape for the follow-up:
//! ```ignore
//! let _guard = std::env::var("SENTRY_DSN").ok().filter(|d| !d.is_empty()).map(|dsn| {
//!     sentry::init((dsn, sentry::ClientOptions {
//!         release: sentry::release_name!(),
//!         environment: Some(args.network.clone().into()),
//!         traces_sample_rate: 0.0, // errors-only, matches docs/ERRORS.md
//!         ..Default::default()
//!     }))
//! }); // guard dropped at end of main ⇒ flushes on exit; None (no DSN) ⇒ zero-cost no-op
//! ```
//! wrapping the `main()` body's `?`-propagated `Result` so a top-level `Err` reports via
//! `sentry_anyhow::capture_anyhow(&err)` before returning it (main's own `Result` error
//! path already prints + exits non-zero — reporting is additive, not a behavior change).

mod handlers;
mod store;

use anyhow::Result;
use clap::Parser;
use sui_indexer_alt_framework::ingestion::{
    ingestion_client::IngestionClientArgs, streaming_client::StreamingClientArgs, ClientArgs,
    IngestConcurrencyConfig, IngestionConfig,
};
use sui_indexer_alt_framework::pipeline::sequential::SequentialConfig;
use sui_indexer_alt_framework::{Indexer, IndexerArgs};
use tracing::info;
use url::Url;

use std::collections::HashSet;

use crate::handlers::{AresHandler, AresSnapshotHandler, CheckpointHandler};
use crate::store::RedisStore;

#[derive(Parser, Debug)]
#[command(
    name = "aresrpg-rpc-indexer",
    about = "Read-only Sui checkpoint indexer for the AresRPG RPC"
)]
struct Args {
    /// Framework indexer args (--first-checkpoint / --last-checkpoint / --pipeline).
    #[clap(flatten)]
    indexer: IndexerArgs,

    /// gRPC checkpoint streaming source (--streaming-url / STREAMING_URL). When set,
    /// the framework streams live over gRPC (primary) and falls back to the remote
    /// store for backfill / gap-fill; when unset it polls the remote store only.
    #[clap(flatten)]
    streaming: StreamingClientArgs,

    /// HTTP checkpoint store to fetch checkpoints from (backfill + polling source).
    /// Defaults to the public Sui testnet checkpoint bucket, so a bare run indexes
    /// testnet out of the box, with or without a gRPC streaming URL.
    #[arg(
        long,
        env = "REMOTE_STORE_URL",
        default_value = "https://checkpoints.testnet.sui.io"
    )]
    remote_store_url: Url,

    /// Redis connection URL (the read-model store).
    #[arg(long, env = "REDIS_URL", default_value = "redis://127.0.0.1:6379")]
    redis_url: String,

    /// Start checkpoint for a fresh pipeline (one with no watermark yet).
    /// `IndexerArgs::first_checkpoint` has no env binding, so this env-backed flag
    /// feeds it. Unset = genesis (full backfill); set to a recent checkpoint to
    /// index live from near the chain tip. Ignored once a watermark exists.
    #[arg(long = "start-checkpoint", env = "FIRST_CHECKPOINT")]
    start_checkpoint: Option<u64>,

    /// Chain label stamped onto records for readers ("testnet" | "mainnet" | …).
    #[arg(long, env = "NETWORK", default_value = "testnet")]
    network: String,

    /// Optional comma-separated allowlist of AresRPG package addresses (canonical
    /// `0x…` hex). When set, the game pipeline only indexes events from these
    /// packages (native `0x2::kiosk` listings are always admitted) — a hardening
    /// seam so a look-alike foreign package can never poison the cache. Unset (the
    /// default until packages publish) matches AresRPG events by `(module, name)`.
    #[arg(long = "ares-packages", env = "ARES_PACKAGES", value_delimiter = ',')]
    ares_packages: Vec<String>,

    /// Prometheus metrics prefix.
    #[arg(long, env = "METRICS_PREFIX")]
    metrics_prefix: Option<String>,

    /// Ceiling on concurrent in-flight checkpoint fetches against the ingestion source. The
    /// framework's own default (Adaptive up to 500) is sized for a dedicated bucket; against
    /// Mysten's SHARED public checkpoint bucket it self-inflicts 429 "SlowDown" storms (2026-07-14
    /// incident: our own backfill burst exceeded the bucket's IO capacity, cascading into
    /// multi-minute /v1 staleness for players). Keep low — once STREAMING_URL carries live-tip
    /// load, this only bounds backfill/gap-fill bursts against the remote-store fallback.
    #[arg(
        long = "ingest-max-concurrency",
        env = "INGEST_MAX_CONCURRENCY",
        default_value_t = 16
    )]
    ingest_max_concurrency: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load a .env if present (env still wins for anything already set).
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    let mut args = Args::parse();

    // A bare `--first-checkpoint` flag wins; otherwise the env-backed start feeds
    // the flattened framework arg.
    if args.indexer.first_checkpoint.is_none() {
        args.indexer.first_checkpoint = args.start_checkpoint;
    }

    let streaming_mode = match &args.streaming.streaming_url {
        Some(uri) => format!("gRPC streaming ({uri}) + remote-store backfill"),
        None => "remote-store polling only".to_string(),
    };
    info!(
        redis_url = %args.redis_url,
        remote_store_url = %args.remote_store_url,
        network = %args.network,
        streaming_mode = %streaming_mode,
        ingest_max_concurrency = args.ingest_max_concurrency,
        first_checkpoint = ?args.indexer.first_checkpoint,
        last_checkpoint = ?args.indexer.last_checkpoint,
        "starting AresRPG RPC indexer"
    );

    // Fail fast on a bad REDIS_URL before we spin up the ingestion machinery.
    let store = RedisStore::new(&args.redis_url).await?;

    let client_args = ClientArgs {
        ingestion: IngestionClientArgs {
            remote_store_url: Some(args.remote_store_url),
            ..Default::default()
        },
        streaming: args.streaming,
    };

    let registry = prometheus::Registry::new();

    // Cap concurrent fetches against the (fallback/backfill) remote store — see
    // `ingest_max_concurrency`'s doc comment for the 2026-07-14 rate-limit incident this guards
    // against. Everything else keeps the framework's defaults.
    let ingestion_config = IngestionConfig {
        ingest_concurrency: IngestConcurrencyConfig::Adaptive {
            initial: 1,
            min: 1,
            max: args.ingest_max_concurrency,
            dead_band: None,
        },
        ..IngestionConfig::default()
    };

    let mut indexer = Indexer::new(
        store,
        args.indexer,
        client_args,
        ingestion_config,
        args.metrics_prefix.as_deref(),
        &registry,
    )
    .await?;

    // Checkpoint-liveness spine.
    indexer
        .sequential_pipeline(
            CheckpointHandler {
                network: args.network,
            },
            SequentialConfig::default(),
        )
        .await?;

    // Game read-model (SPEC §14 views). Sequential so per-object edits (e.g. a
    // price change after a sale creation) apply in checkpoint order.
    let ares_packages = if args.ares_packages.is_empty() {
        None
    } else {
        Some(args.ares_packages.into_iter().collect::<HashSet<_>>())
    };
    indexer
        .sequential_pipeline(AresHandler::new(ares_packages.clone()), SequentialConfig::default())
        .await?;

    // Object snapshots (character cosmetics/level) + taux (forgemagie) events —
    // its own watermark, so it backfills from FIRST_CHECKPOINT independently of the
    // event pipeline above (SPEC §14 bulk character profiles + taux; S-15c). NOTE:
    // the allowlist must carry every emitting package address: `forgemagie` now lives in its OWN sibling
    // `aresrpg_forgemagie` package (package-split 2026-07-12), NOT the aresrpg/character address.
    indexer
        .sequential_pipeline(AresSnapshotHandler::new(ares_packages), SequentialConfig::default())
        .await?;

    info!("pipelines registered; running");
    let mut service = indexer.run().await?;
    service.join().await?;
    info!("indexer stopped");
    Ok(())
}
