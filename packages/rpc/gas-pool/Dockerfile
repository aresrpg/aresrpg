# Mysten sui-gas-pool — sponsor service (OPT-IN, `docker compose --profile gas up`).
#
# No public image exists, so the station is built from source: the first build is
# the full Sui cargo compile (slow + memory-hungry, like the indexer). For local
# dev you may prefer running the station natively — see README.md. The sponsor
# secret is NOT baked into the image; entrypoint.sh renders the config from env at
# start.

# --- build the station binary from source ------------------------------------
# Pinned by digest (tag: rust:1-bookworm, resolved via `docker buildx imagetools
# inspect rust:1-bookworm` on 2026-07-08 — re-resolve + bump when upgrading).
FROM rust:1-bookworm@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        clang libclang-dev cmake pkg-config protobuf-compiler git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
ARG GAS_POOL_GIT=https://github.com/MystenLabs/sui-gas-pool.git
# Pinned commit (not the floating `main` branch), resolved via:
#   git ls-remote https://github.com/MystenLabs/sui-gas-pool.git refs/heads/main
# -> 45ed6d3f1c6b0039c7555746d02e73687074663b on 2026-07-08. Override with
# --build-arg GAS_POOL_REF=<rev> to move it deliberately.
ARG GAS_POOL_REF=45ed6d3f1c6b0039c7555746d02e73687074663b
# `--branch` can't take a bare commit SHA, so clone shallow-without-checkout,
# shallow-fetch the pinned SHA specifically, then check it out.
RUN git clone --no-checkout --depth 1 "$GAS_POOL_GIT" . \
    && git fetch --depth 1 origin "$GAS_POOL_REF" \
    && git checkout "$GAS_POOL_REF" \
    && cargo build --release --bin sui-gas-station \
    && cp target/release/sui-gas-station /usr/local/bin/sui-gas-station

# --- runtime: station binary + bun (for env-driven config generation) --------
# Pinned by digest (tag: oven/bun:1-debian, resolved 2026-07-08).
FROM oven/bun:1-debian@sha256:9dba1a1b43ce28c9d7931bfc4eb00feb63b0114720a0277a8f939ae4dfc9db6f AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /usr/local/bin/sui-gas-station /usr/local/bin/sui-gas-station
COPY generate-config.mjs entrypoint.sh ./
RUN chmod +x entrypoint.sh

# Config (env): GAS_POOL_KEYPAIR (required, fresh+funded), GAS_POOL_REDIS_URL,
# SUI_FULLNODE_URL, GAS_POOL_PORT, GAS_POOL_DAILY_CAP (0.2 SUI/day default),
# GAS_POOL_MAX_PER_REQUEST (0.1 SUI/request default — anti-drain constitution),
# GAS_STATION_AUTH.
EXPOSE 9527
ENTRYPOINT ["./entrypoint.sh"]
