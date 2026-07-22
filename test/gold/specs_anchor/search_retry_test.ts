// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bun test — the search-retry classification + the bounded settle loop (search + wait injected, so the retry
// policy is exercised with ZERO browser). Named *_test.ts (NOT *.test.ts): the anchor Playwright config's default
// testMatch would otherwise collect a `.test.ts` sibling as a browser spec and explode on the bun:test import
// (the click_verify_test.ts / fight_recovery_test.ts law). search_retry.ts is Playwright-free on purpose so this
// stays a pure unit.
//   run: bun test test/gold/specs_anchor/search_retry_test.ts
// @ts-expect-error tsconfig.lint.json (lint-only ts.Program, types:["node"]) has no bun:test declarations — the
// runtime is bun itself; this turns into an "unused directive" tripwire the day @types/bun lands at the root.
import { describe, expect, test } from 'bun:test'

import {
  is_kiosk_unresolved_error,
  is_retryable_search_error,
  is_stale_version_error,
  settle_search,
  type SearchResult,
} from './search_retry'

const KIOSK_LAG = 'character kiosk did not resolve' // the fight_mouse_helpers.ts:186 null-resolve return (no tx yet)
const STALE = 'the object is unavailable for consumption' // an owned-object version lag at tx input-check
const STALE_REBUILT = 'Transaction needs to be rebuilt and resubmitted'
const HARD = 'fixture search produced no certified digest' // a genuine, non-lag failure — must NEVER retry

describe('search-retry classification (pure)', () => {
  test('a stale owned-object version error stays retryable (the original class)', () => {
    expect(is_stale_version_error(STALE)).toBe(true)
    expect(is_stale_version_error(STALE_REBUILT)).toBe(true)
    expect(is_retryable_search_error(STALE)).toBe(true)
  })
  // THE BUG: a null kiosk resolve failed the whole boot in ~4.7s because it was NOT classified retryable, so
  // search_zone_settled's loop never re-entered. It is the SAME owned-object read-index lag as the stale class.
  test('a null kiosk resolve is retryable (was NOT — the 4.7s no-retry bug)', () => {
    expect(is_kiosk_unresolved_error(KIOSK_LAG)).toBe(true)
    expect(is_retryable_search_error(KIOSK_LAG)).toBe(true)
  })
  test('a genuine (non-lag) failure is NOT retryable — honest surfacing is preserved', () => {
    expect(is_stale_version_error(HARD)).toBe(false)
    expect(is_kiosk_unresolved_error(HARD)).toBe(false)
    expect(is_retryable_search_error(HARD)).toBe(false)
  })
  test('undefined / empty never crashes and is not retryable', () => {
    expect(is_retryable_search_error(undefined)).toBe(false)
    expect(is_retryable_search_error('')).toBe(false)
  })
})

// An injected resolver lag: `search` returns the given error N times, then a success. Calls are counted AT THE
// DOOR (never inferred from the log) — the fight_recovery_test tx-door idiom. `wait` is a no-op so the unit is
// instant regardless of the loop's real 1–2s backoff.
const lagging_search = (fail_n: number, error = KIOSK_LAG) => {
  let calls = 0
  const search = async (): Promise<SearchResult> => {
    calls += 1
    return calls <= fail_n ? { ok: false, error, close: false } : { ok: true, digest: '0xdone', close: true }
  }
  return { search, calls: () => calls }
}
const no_wait = async () => {}

describe('settle_search — bounded retry over an injected resolver lag', () => {
  test('kiosk-unresolved ×3 then a hit → succeeds on attempt 4 (exactly 4 door calls)', async () => {
    const { search, calls } = lagging_search(3)
    const result = await settle_search(search, no_wait, 12)
    expect(result.ok).toBe(true)
    expect(result.digest).toBe('0xdone')
    expect(calls()).toBe(4)
  })
  test('an exhausted budget surfaces the SAME honest failure (never a false green)', async () => {
    const { search, calls } = lagging_search(Number.POSITIVE_INFINITY)
    const result = await settle_search(search, no_wait, 3)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(KIOSK_LAG)
    expect(calls()).toBe(4) // 1 initial + 3 bounded retries
  })
  test('the stale-version class still retries (regression guard on the original path)', async () => {
    const { search, calls } = lagging_search(2, STALE_REBUILT)
    const result = await settle_search(search, no_wait, 12)
    expect(result.ok).toBe(true)
    expect(calls()).toBe(3)
  })
  test('a non-retryable failure returns immediately — one call, no wasted polls', async () => {
    const { search, calls } = lagging_search(1, HARD)
    const result = await settle_search(search, no_wait, 12)
    expect(result.ok).toBe(false)
    expect(result.error).toBe(HARD)
    expect(calls()).toBe(1)
  })
})
