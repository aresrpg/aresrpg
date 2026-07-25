#!/usr/bin/env bash
# SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
# © 2026 Sceat — All rights reserved. See LICENSE.
# api/run_tests.sh — the sponsor api unit suite, ONE bun process PER FILE (issue #683).
#
# sponsor.mjs resolves its Redis client + PTB allowlist ONCE at module load and memoizes them for
# the life of the process (api/sponsor_state.mjs) — the same module-global class
# scripts/order-independence-gate.sh guards elsewhere in this repo. Every file below already
# documents its own correct standalone invocation in its own header comment; this script is the
# mechanical aggregate of those documented invocations, each run in its own bun process, so a local
# dev and CI get exactly what every file already demands — never the single combined `bun test` run
# the files' own comments forbid.
#
# sponsor.test.js alone proves the cross-instance SHARED rate-limit store, so it alone needs a REAL
# throwaway Redis — this script starts and tears down one on 127.0.0.1:$REDIS_PORT around that one
# file's invocation only. Every other file sets or defaults its own REDIS_URL internally (see each
# file's header); this script never sets an ambient REDIS_URL for the whole run, because
# sponsor.failclosed.test.js's entire point is Redis genuinely UNREACHABLE — sharing one URL across
# every file would silently defeat that proof.
set -uo pipefail
cd "$(dirname "$0")"

REDIS_PORT="${API_TESTS_REDIS_PORT:-6399}"
REDIS_CONTAINER=aresrpg-api-tests-redis
# Issue #828: a bare `redis:8` resolved a FLOATING tag against Docker Hub inside `docker run`, so
# every api leg made one unretried registry call before a single test ran — a Hub timeout reddened
# the gate on a third party's weather, then burned 30 more seconds in the PING loop below. The
# digest is the multi-arch INDEX digest, so it resolves on amd64 (CI) and arm64 (dev macs) alike.
# To bump: `docker buildx imagetools inspect redis:8` and paste its `Digest:` line here.
REDIS_IMAGE="redis:8@sha256:c88d347edef6249a6d2293f926f1eeb48bd40c57cbcd02c07f52e7f1fd2cb46b"
FAIL=0

cleanup() { docker rm --force "$REDIS_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Pre-pull, bounded: a cached image (warm runner, local dev) skips the registry entirely, and a
# cold one gets 3 attempts with a short backoff instead of one shot. Pulling BEFORE `docker run`
# is what keeps a registry failure honest — it aborts here saying so, rather than surfacing 30
# seconds later as a Redis that "never answered PING".
if docker image inspect "$REDIS_IMAGE" >/dev/null 2>&1; then
  echo "redis image already present locally — no registry call"
else
  pulled=0
  for attempt in 1 2 3; do
    if docker pull --quiet "$REDIS_IMAGE" >/dev/null; then
      pulled=1
      break
    fi
    echo "docker pull of $REDIS_IMAGE failed (attempt $attempt/3)" >&2
    [ "$attempt" -lt 3 ] && sleep $((attempt * 3))
  done
  if [ "$pulled" -ne 1 ]; then
    echo "could not pull $REDIS_IMAGE after 3 attempts — aborting before any test ran" >&2
    exit 1
  fi
fi

echo "starting throwaway redis on 127.0.0.1:$REDIS_PORT for sponsor.test.js"
if ! docker run --detach --rm --name "$REDIS_CONTAINER" --publish "$REDIS_PORT:6379" "$REDIS_IMAGE" >/dev/null; then
  echo "throwaway redis container failed to start — aborting" >&2
  exit 1
fi
ready=0
for _ in $(seq 1 30); do
  if docker exec "$REDIS_CONTAINER" redis-cli ping 2>/dev/null | grep -q PONG; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "throwaway redis never answered PING — aborting" >&2
  exit 1
fi

for file in *.test.js; do
  echo "── $file ──"
  ok=1
  if [ "$file" = sponsor.test.js ]; then
    REDIS_URL="redis://127.0.0.1:$REDIS_PORT" bun test "$file" || ok=0
  else
    bun test "$file" || ok=0
  fi
  if [ "$ok" -eq 1 ]; then
    echo "  ✓ $file"
  else
    echo "  ✗ $file"
    FAIL=1
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo "api test suite FAILED — see the ✗ lines above."
  exit 1
fi
echo "api test suite PASSED — every *.test.js file, its own process, green."
