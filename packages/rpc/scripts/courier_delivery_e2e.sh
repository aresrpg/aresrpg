#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# Boot a THROWAWAY courier stack and drive the cross-process delivery proof (#1508) against it:
# a Redis, the real `api/courier.mjs` ingress, and the real indexer's SSE read surface.
#
#   bash packages/rpc/scripts/courier_delivery_e2e.sh
#
# Own ports, own container, own redis db — never the live :3000/:6379/:9528 dev stack. Tears itself
# down on exit (success, failure, or Ctrl-C).
#
# The indexer is started at a checkpoint far past the live tip: the courier's delivery half touches no
# chain state, so this proof must not wait on a backfill. Ingestion idles at the future checkpoint
# while the SSE surface serves — the same separation the route already has in production.
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2 # repo root

REDIS_PORT="${COURIER_E2E_REDIS_PORT:-6398}"
COURIER_PORT="${COURIER_E2E_COURIER_PORT:-9538}"
STREAM_PORT="${COURIER_E2E_STREAM_PORT:-3011}"
CONTAINER=aresrpg-courier-e2e-redis
REDIS_IMAGE="redis:8@sha256:c88d347edef6249a6d2293f926f1eeb48bd40c57cbcd02c07f52e7f1fd2cb46b"
COURIER_PID=""
INDEXER_PID=""

teardown() {
  [ -n "$COURIER_PID" ] && kill "$COURIER_PID" 2>/dev/null
  [ -n "$INDEXER_PID" ] && kill "$INDEXER_PID" 2>/dev/null
  docker rm -f "$CONTAINER" >/dev/null 2>&1
}
trap teardown EXIT INT TERM

docker rm -f "$CONTAINER" >/dev/null 2>&1
docker run -d --name "$CONTAINER" -p "127.0.0.1:${REDIS_PORT}:6379" "$REDIS_IMAGE" >/dev/null || {
  echo "courier e2e: could not start the throwaway redis" >&2
  exit 2
}
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" redis-cli ping >/dev/null 2>&1 && break
  sleep 1
done

export REDIS_URL="redis://127.0.0.1:${REDIS_PORT}"
# The courier's own standalone server (its documented `import.meta.main` invocation) — the ingress under
# proof, without the sponsor sibling this has nothing to do with.
# QA-only: the zkLogin signature path is gated by api/courier.test.js; this proof is about DELIVERY.
COURIER_DEV_BYPASS_ZKLOGIN=1 COURIER_PORT="$COURIER_PORT" bun api/courier.mjs >/tmp/courier-e2e-api.log 2>&1 &
COURIER_PID=$!

cargo run --offline --manifest-path packages/rpc/indexer/Cargo.toml -- \
  --redis-url "$REDIS_URL" \
  --stream-bind "127.0.0.1:${STREAM_PORT}" \
  --start-checkpoint 4000000000 \
  >/tmp/courier-e2e-indexer.log 2>&1 &
INDEXER_PID=$!

for _ in $(seq 1 90); do
  # A 400 IS the route answering: it refuses an identity-less link, which is the contract itself.
  curl -s -o /dev/null "http://127.0.0.1:${STREAM_PORT}/v1/stream/presence/0x1" && break
  sleep 1
done

COURIER_URL="http://127.0.0.1:${COURIER_PORT}" STREAM_URL="http://127.0.0.1:${STREAM_PORT}" \
  bun packages/rpc/scripts/courier_delivery_e2e.mjs
