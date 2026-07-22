// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The bounded retry policy the gold fixture search rides — pure (no Playwright), so its classification and its
// budget are unit-tested without a browser (search_retry_test.ts). fight_mouse_helpers.ts owns only the impure
// wiring (search_zone_settled passes the real search_zone + page.waitForTimeout as the injected effects).
//
// The owned-object READ index lags the execution view by a checkpoint or two after a kiosk-mutating tx: the join
// (then each executed search) re-versions the character's Kiosk + PersonalKioskCap, but a getObject issued right
// after still returns the PRE-mutation version (kiosk_resolve.js documents this same owned-object index lag). TWO
// retryable failure classes fall out of that ONE lag — both ZERO-GAS pre-flight refusals (tx-retry-burn law: only
// an EXECUTED failure, one that carries a digest, is un-retryable), both bounded so a genuine failure still
// surfaces to the caller's assertion:
//   • STALE VERSION — a search built immediately resolves the pkcap at a stale version → the fullnode rejects it
//     at input-check ("Transaction needs to be rebuilt … unavailable for consumption"). Rebuild + resubmit; each
//     attempt re-resolves the object's current version.
//   • KIOSK UNRESOLVED — one hop earlier: the character's Kiosk object itself hasn't hit the read index, so
//     kiosk_for_character returns null and search_zone short-circuits (fight_mouse_helpers.ts:186) BEFORE any tx.
//     Re-poll the resolve; the product cache self-evicts empties (kiosk_resolve.js, 9c86ce1a) so each retry
//     re-reads live. (Until this class was retryable, a fresh-boot null-resolve failed the whole boot in ~4.7s
//     with no retry at all — the loop's guard only matched the stale-version strings.)

export type SearchResult = { ok: boolean; error?: string; digest?: string | null; close?: boolean }

const decode = (error: unknown): string => {
  const raw = String(error ?? '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export const is_stale_version_error = (error: unknown): boolean =>
  /unavailable for consumption|needs to be rebuilt|not available for consumption/i.test(decode(error))

export const is_kiosk_unresolved_error = (error: unknown): boolean =>
  /character kiosk did not resolve/i.test(decode(error))

export const is_retryable_search_error = (error: unknown): boolean =>
  is_stale_version_error(error) || is_kiosk_unresolved_error(error)

// Re-run `search` until it succeeds or a non-retryable failure surfaces, bounded by `budget`. The kiosk-unresolved
// class waits a touch longer (the read index lags a checkpoint or two) and logs each poll; the stale-version class
// rebuilds faster. Effects (search, wait) are injected so the retry policy is unit-testable without a browser.
export async function settle_search(
  search: () => Promise<SearchResult>,
  wait: (ms: number) => Promise<void>,
  budget = 12
): Promise<SearchResult> {
  let result = await search()
  for (let attempt = 1; attempt <= budget && !result.ok && is_retryable_search_error(result.error); attempt += 1) {
    const kiosk_lag = is_kiosk_unresolved_error(result.error)
    if (kiosk_lag) console.log(`[gold] kiosk not indexed yet, attempt ${attempt}/${budget}`)
    await wait(kiosk_lag ? 2_000 : 1_000)
    result = await search()
  }
  return result
}
