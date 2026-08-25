# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# =============================================================================
# AresRPG indexer — the chain's one projectionist.
# Streams Sui checkpoints → FalkorDB (graph + sales zsets + pub/sub).
#
# Multi-stage (cargo-chef caches the heavy git-sourced Sui dependency layer):
#   1. chef     — base toolchain + cargo-chef
#   2. planner  — compute the dependency recipe from the manifests
#   3. builder  — build the cached dependency layer, then the crate
#   4. runtime  — slim Debian image carrying only the binary + runtime libs
#
# Fully env-driven; see the runtime stage. The first build compiles the entire
# Sui dependency tree — slow and memory-hungry; prefer a native
# `cargo build --release` on a dev machine.
# =============================================================================

# --- 1. base toolchain -------------------------------------------------------
# Pinned by digest (tag: rust:1-bookworm, resolved 2026-07-08 — same digest as
# the old indexer's builder; re-resolve when upgrading).
FROM rust:1-bookworm@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS chef
# Several Sui `-sys` crates need a C/C++ toolchain, libclang (bindgen) and
# protoc at build time.
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
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release --bin aresrpg-indexer \
    && cp target/release/aresrpg-indexer /usr/local/bin/aresrpg-indexer

# --- 4. runtime: slim image with just the binary -----------------------------
# Pinned by digest (tag: debian:bookworm-slim, resolved 2026-07-08).
FROM debian:bookworm-slim@sha256:60eac759739651111db372c07be67863818726f754804b8707c90979bda511df AS runtime
# ca-certificates: TLS for the checkpoint store + the GraphQL boot derivation.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --system --uid 10001 --no-create-home aresrpg
USER aresrpg

COPY --from=builder /usr/local/bin/aresrpg-indexer /usr/local/bin/aresrpg-indexer

# Env-driven configuration (see src/main.rs `Args`):
#   PACKAGE_ORIGINAL  (required) — the game package's original id
#   PACKAGE_LATEST    (required) — its latest upgrade id
#   SEED_PACKAGE_ORIGINAL (required) — the living-content package's original id
#   REDIS_URL         (default redis://127.0.0.1:6379) — the FalkorDB instance
#   REMOTE_STORE_URL  (default https://checkpoints.testnet.sui.io)
#   STREAMING_URL     (optional) — gRPC live primary; remote store is backfill
#   GRAPHQL_URL       (default https://graphql.testnet.sui.io/graphql) — boot only
#   FIRST_CHECKPOINT  (optional) — overrides the boot-derived start checkpoint
#   RUST_LOG          (default info)
ENV RUST_LOG=info

ENTRYPOINT ["aresrpg-indexer"]
