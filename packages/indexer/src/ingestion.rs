// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//! Live gRPC streaming, with the configured archive owning every historical gap.
//! A streaming provider may retain less history than the stream's catch-up window;
//! its LedgerService NOT_FOUND must never become an endless restart retry.
use std::sync::Arc;

use prometheus::Registry;
use sui_indexer_alt_framework::ingestion::{
    ingestion_client::IngestionClient, streaming_client::GrpcStreamingClient, ArcStreamingClient,
    ClientArgs, IngestionConfig,
};
use sui_indexer_alt_framework::metrics::IngestionMetrics;

pub fn clients(
    args: ClientArgs,
    config: &IngestionConfig,
    registry: &Registry,
) -> anyhow::Result<(
    IngestionClient,
    Option<ArcStreamingClient>,
    Option<IngestionClient>,
)> {
    let metrics = IngestionMetrics::new(None, registry);
    let archive = IngestionClient::new(args.ingestion, metrics)?;
    let streaming = args.streaming.streaming_url.map(|uri| {
        Arc::new(GrpcStreamingClient::new(
            uri,
            config.streaming_connection_timeout(),
            config.streaming_statement_timeout(),
        )) as ArcStreamingClient
    });
    // None explicitly tells the framework to fill every restart/reconnect gap
    // through `archive`, rather than the live provider's possibly pruned ledger.
    Ok((archive, streaming, None))
}

#[cfg(test)]
#[path = "../test/ingestion.rs"]
mod tests;
