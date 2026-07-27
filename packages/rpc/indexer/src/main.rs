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
//! ## Error reporting
//!
//! `INDEXER_ERROR_LOG` enables an ERROR-only JSONL tracing layer. Terminal errors and
//! panics carry `sentry_event=true`, a stable culprit, and an explicit fingerprint;
//! the adjacent Bun log-ship sidecar forwards only those marked records to Sentry.
//! The ordinary human log remains unchanged, and an absent log path is a hard no-op.

mod handlers;
mod store;
mod stream;

use anyhow::{Context, Result};
use clap::{error::ErrorKind, Parser};
use sui_indexer_alt_framework::ingestion::{
    ingestion_client::IngestionClientArgs, streaming_client::StreamingClientArgs, ClientArgs,
    IngestConcurrencyConfig, IngestionConfig,
};
use sui_indexer_alt_framework::pipeline::sequential::SequentialConfig;
use sui_indexer_alt_framework::{Indexer, IndexerArgs};
use tracing::{error, info};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::prelude::*;
use url::Url;

use std::collections::HashSet;
use std::fs::OpenOptions;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Mutex;

use crate::handlers::{AresHandler, AresSnapshotHandler, CheckpointHandler};
use crate::store::RedisStore;

#[derive(Parser, Debug)]
#[command(
    name = "aresrpg-rpc-indexer",
    version,
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

    /// Bind address for the topic-keyed SSE read surface.
    #[arg(long, env = "STREAM_BIND", default_value = "0.0.0.0:3001")]
    stream_bind: SocketAddr,

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

    let error_log_path = std::env::var_os("INDEXER_ERROR_LOG")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from);
    init_tracing(error_log_path.as_deref())?;
    install_panic_reporting();

    let result = run_indexer().await;
    if let Err(failure) = &result {
        report_terminal_error(failure);
    }
    result
}

fn init_tracing(error_log_path: Option<&Path>) -> Result<()> {
    let human_layer = tracing_subscriber::fmt::layer()
        .with_target(false)
        .with_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        );

    if let Some(path) = error_log_path {
        let error_log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .with_context(|| format!("opening structured error log {}", path.display()))?;
        let json_error_layer = tracing_subscriber::fmt::layer()
            .json()
            .with_ansi(false)
            .with_writer(Mutex::new(error_log))
            .with_filter(LevelFilter::ERROR);
        tracing_subscriber::registry()
            .with(human_layer)
            .with(json_error_layer)
            .try_init()
            .context("initializing tracing subscriber")?;
    } else {
        tracing_subscriber::registry()
            .with(human_layer)
            .try_init()
            .context("initializing tracing subscriber")?;
    }
    Ok(())
}

fn install_panic_reporting() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        let message = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|message| (*message).to_owned())
            .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "non-string panic payload".to_owned());
        let culprit = panic_info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "unknown panic location".to_owned());
        let fingerprint = format!("indexer:panic:{}", fingerprint_component(&culprit));
        error!(
            sentry_event = true,
            error_type = "panic",
            culprit = %culprit,
            error_chain = %message,
            sentry_fingerprint = %fingerprint,
            "indexer panicked"
        );
        default_hook(panic_info);
    }));
}

fn report_terminal_error(failure: &anyhow::Error) {
    let culprit = failure
        .chain()
        .next()
        .map(ToString::to_string)
        .unwrap_or_else(|| "unknown indexer error".to_owned());
    let error_chain = format!("{failure:#}");
    let fingerprint = format!("indexer:{}", fingerprint_component(&culprit));
    error!(
        sentry_event = true,
        error_type = "indexer_error",
        culprit = %culprit,
        error_chain = %error_chain,
        sentry_fingerprint = %fingerprint,
        "indexer stopped with error"
    );
}

fn fingerprint_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}

async fn run_indexer() -> Result<()> {
    // `parse()` exits the process on invalid CLI/env input, bypassing the marked
    // terminal-error seam above. Keep configuration failures inside `Result` so
    // the log shipper can report them like every other startup failure.
    let mut args = match Args::try_parse() {
        Ok(args) => args,
        Err(help)
            if matches!(
                help.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) =>
        {
            help.print().context("printing indexer help")?;
            return Ok(());
        }
        Err(failure) => return Err(failure).context("parsing indexer configuration"),
    };

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
        stream_bind = %args.stream_bind,
        remote_store_url = %args.remote_store_url,
        network = %args.network,
        streaming_mode = %streaming_mode,
        ingest_max_concurrency = args.ingest_max_concurrency,
        first_checkpoint = ?args.indexer.first_checkpoint,
        last_checkpoint = ?args.indexer.last_checkpoint,
        "starting AresRPG RPC indexer"
    );

    // Fail fast on a bad REDIS_URL before we spin up the ingestion machinery.
    let store = RedisStore::new(&args.redis_url)
        .await
        .context("connecting indexer store")?;
    let stream_router = stream::router(&args.redis_url).context("creating SSE router")?;
    let stream_listener = tokio::net::TcpListener::bind(args.stream_bind)
        .await
        .with_context(|| format!("binding SSE listener {}", args.stream_bind))?;

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
    .await
    .context("creating indexer")?;

    // Checkpoint-liveness spine.
    indexer
        .sequential_pipeline(
            CheckpointHandler {
                network: args.network,
            },
            SequentialConfig::default(),
        )
        .await
        .context("registering checkpoint pipeline")?;

    // Game read-model (SPEC §14 views). Sequential so per-object edits (e.g. a
    // price change after a sale creation) apply in checkpoint order.
    let ares_packages = if args.ares_packages.is_empty() {
        None
    } else {
        Some(args.ares_packages.into_iter().collect::<HashSet<_>>())
    };
    indexer
        .sequential_pipeline(
            AresHandler::new(ares_packages.clone()),
            SequentialConfig::default(),
        )
        .await
        .context("registering Ares event pipeline")?;

    // Object snapshots (character cosmetics/level) + taux (forgemagie) events —
    // its own watermark, so it backfills from FIRST_CHECKPOINT independently of the
    // event pipeline above (SPEC §14 bulk character profiles + taux; S-15c). NOTE:
    // the allowlist must carry every emitting package address: `forgemagie` now lives in its OWN sibling
    // `aresrpg_forgemagie` package (package-split 2026-07-12), NOT the aresrpg/character address.
    indexer
        .sequential_pipeline(
            AresSnapshotHandler::new(ares_packages),
            SequentialConfig::default(),
        )
        .await
        .context("registering Ares snapshot pipeline")?;

    info!(stream_bind = %args.stream_bind, "pipelines registered; running");
    let mut service = indexer.run().await.context("starting indexer service")?;
    let mut stream_server = tokio::spawn(async move {
        axum::serve(stream_listener, stream_router)
            .await
            .context("serving SSE routes")
    });
    tokio::select! {
        indexer_result = service.join() => {
            stream_server.abort();
            indexer_result.context("joining indexer service")?;
        }
        stream_result = &mut stream_server => {
            stream_result.context("joining SSE server task")??;
            anyhow::bail!("SSE server stopped unexpectedly");
        }
    }
    info!("indexer stopped");
    Ok(())
}
