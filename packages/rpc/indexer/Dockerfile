# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# =============================================================================
# AresRPG RPC indexer — Rust read-model builder.
# Streams Sui checkpoints -> Redis (JSON docs + query-engine indexes).
#
# Multi-stage (cargo-chef caches the heavy git-sourced Sui dependency layer):
#   1. chef     — base toolchain + cargo-chef
#   2. planner  — compute the dependency recipe from the manifests
#   3. builder  — build the cached dependency layer, then the crate
#   4. runtime  — slim Debian image carrying only the binary + runtime libs
#
# The crate is fully env-driven; see the runtime stage for the variables it reads.
# NOTE: the first build compiles the entire Sui dependency tree and is slow /
# memory-hungry. On a dev laptop, prefer a native `cargo build --release` and run
# the binary directly (see README "Running the indexer natively").
# =============================================================================

# --- 1. base toolchain -------------------------------------------------------
# Pinned by digest (tag: rust:1-bookworm, resolved 2026-07-08 — same digest as
# gas-pool/Dockerfile's builder stage; re-resolve + bump both when upgrading).
FROM rust:1-bookworm@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS chef
# Several Sui `-sys` crates need a C/C++ toolchain, libclang (bindgen) and protoc
# at build time.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        clang \
        libclang-dev \
        cmake \
        pkg-config \
        protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*
RUN cargo install cargo-chef --locked
WORKDIR /app

# --- 2. planner: capture the dependency recipe -------------------------------
FROM chef AS planner
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# --- 3. builder: cached deps layer, then the crate ---------------------------
FROM chef AS builder
# Build & cache ALL dependencies first. This layer only busts when the recipe
# (i.e. the manifests) changes, not on source edits.
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
# Now build the application itself against the cached deps.
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release --bin aresrpg-rpc-indexer \
    && cp target/release/aresrpg-rpc-indexer /usr/local/bin/aresrpg-rpc-indexer

# --- 4. runtime: slim image with just the binary -----------------------------
# Pinned by digest (tag: debian:bookworm-slim, resolved 2026-07-08).
FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS runtime
# ca-certificates: TLS verification for the checkpoint store / gRPC endpoint.
# libstdc++6: linked at runtime by some transitive deps.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Run unprivileged. The sticky log directory is the shared-volume target used by
# the optional Sentry log-ship process; only ERROR records are written there.
RUN useradd --system --uid 10001 --no-create-home aresrpg \
    && mkdir -p /var/log/aresrpg \
    && chmod 1777 /var/log/aresrpg
USER aresrpg

COPY --from=builder /usr/local/bin/aresrpg-rpc-indexer /usr/local/bin/aresrpg-rpc-indexer

# Env-driven configuration (see src/main.rs `Args`):
#   REDIS_URL         (default redis://127.0.0.1:6379) — read-model store
#   REMOTE_STORE_URL  (default https://checkpoints.testnet.sui.io) — checkpoint source
#   STREAMING_URL     (optional) — gRPC live-streaming primary; remote store is backfill
#   NETWORK           (default testnet) — label stamped onto records
#   FIRST_CHECKPOINT  (optional) — start checkpoint for a fresh pipeline (else genesis)
#   METRICS_PREFIX    (optional) — prometheus metrics prefix
#   INDEXER_ERROR_LOG (optional) — ERROR-only structured JSONL for the Sentry sidecar
#   RUST_LOG          (default info)
ENV RUST_LOG=info

ENTRYPOINT ["aresrpg-rpc-indexer"]
