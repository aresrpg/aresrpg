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
FAIL=0

cleanup() { docker rm --force "$REDIS_CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "starting throwaway redis on 127.0.0.1:$REDIS_PORT for sponsor.test.js"
docker run --detach --rm --name "$REDIS_CONTAINER" --publish "$REDIS_PORT:6379" redis:8 >/dev/null
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
