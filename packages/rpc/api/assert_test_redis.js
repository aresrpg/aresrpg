// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TEST-ONLY SAFETY RAIL — the ONLY sanctioned way for a suite to FLUSH Redis.
//
// Incident #1: a wave FLUSHALL'd the LIVE indexer cache by running `bun test` with
// REDIS_URL unset: `redis.js` then defaults to redis://127.0.0.1:6379 — the live
// store the indexer writes and the :3000 API reads. This module then threw at
// import time. Incident #2 (2026-07-12) proved that throw INSUFFICIENT: bun caches
// the module-evaluation error but KEEPS RUNNING the sibling test files, whose own
// raw `redis.send('FLUSHALL')` calls wiped the live cache anyway (recovered via
// AOF truncation). A side-effect import guards only the first importer — so the
// gate now lives IN the flush path itself: suites call `flush_test_redis()`, which
// re-validates REDIS_URL on EVERY call before flushing through the same client.
// Raw FLUSHALL in a test file is a defect; grep for it in review.
//
//   docker run -d --rm -p 6399:6379 redis:8
//   REDIS_URL=redis://127.0.0.1:6399 bun test

import { redis } from './redis.js'

// Loopback:6379 is the live cache (docker-compose maps REDIS_PORT:-6379). Refuse it
// even when set explicitly — the tests destroy data, so the live port is never a
// valid target regardless of intent.
const LIVE = new Set([
  'redis://127.0.0.1:6379',
  'redis://localhost:6379',
  'redis://127.0.0.1',
  'redis://localhost',
  'redis://[::1]:6379',
])

function assert_safe_url() {
  const url = process.env.REDIS_URL
  if (!url || LIVE.has(url.trim().replace(/\/$/, ''))) {
    throw new Error(
      'REFUSING TO RUN: these tests FLUSHALL Redis and REDIS_URL is unset or points at ' +
        'the live cache (:6379). Point it at a throwaway instance first:\n' +
        '  docker run -d --rm -p 6399:6379 redis:8\n' +
        '  REDIS_URL=redis://127.0.0.1:6399 bun test\n' +
        `Got REDIS_URL=${url ?? '(unset → defaults to the LIVE cache at 127.0.0.1:6379)'}`
    )
  }
}

// Fail the first importer fast (layer 1 — loud, but bypassable per incident #2).
assert_safe_url()

// Layer 2 — the un-bypassable gate: the flush and the check are one atom. The
// shared `redis` client was built from the SAME env var this validates, so the
// URL we checked is the URL we flush.
export async function flush_test_redis() {
  assert_safe_url()
  await redis.send('FLUSHALL', [])
}
