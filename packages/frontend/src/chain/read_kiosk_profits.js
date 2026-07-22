// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BUILD #180 — kiosk PROFITS truth for the marketplace HISTORY tab's COLLECT box: sellers had SUI sale
// proceeds sitting in their kiosks with no affordance anywhere to see or claim them. `profits` is a plain
// Balance<SUI> field ON the Kiosk object itself (0x2::kiosk::Kiosk.profits) — @mysten/kiosk's own
// getKioskObject already parses it (no BCS decode reinvented here; the read is chain-direct because this
// is a private per-owner balance, never indexed by /v1 — mirrors kiosk_resolve.js's own chain-direct reads).
//
// MULTI-KIOSK TRUTH: a wallet can hold more than one personal kiosk across lineages (kiosk_resolve.js's
// header — the crush bug proved it), so this sums EVERY personal kiosk the wallet owns via
// kiosk_cap_cache's get_personal_caps — the ONE multi-kiosk-aware cap list already used by
// kiosk_resolve/write_listings, never a first-cap pick.
import { getKioskObject } from '@mysten/kiosk'

import { get_personal_caps } from './kiosk_cap_cache'

/**
 * Sum of unwithdrawn SUI sale proceeds across every personal kiosk the wallet owns, plus the exact set of
 * kiosk ids that carry a non-zero balance (what a follow-up collect must target). `read_kiosk` is
 * injectable (mirrors kiosk_resolve.js's `sleep` seam) so this aggregation is unit-testable without faking
 * @mysten/kiosk's internal BCS parse — production always calls the real `getKioskObject`.
 *
 * A single kiosk read failing THROWS (never silently under-report real money as zero); the caller decides
 * how to degrade (marketplace_chain.ts keeps the last-known-good amount rather than blanking it).
 * @param {any} sdk @param {string} address
 * @param {(client: any, kiosk_id: string) => Promise<{profits: string}>} [read_kiosk]
 * @returns {Promise<{ total_mist: bigint, kiosk_ids: string[] }>}
 */
export async function get_kiosk_profits(sdk, address, read_kiosk = getKioskObject) {
  const caps = await get_personal_caps(sdk, address)
  if (caps.length === 0) return { total_mist: 0n, kiosk_ids: [] }

  const reads = await Promise.all(
    caps.map(async (cap) => {
      const kiosk = await read_kiosk(sdk.grpc_client, cap.kioskId)
      return { kiosk_id: cap.kioskId, profits_mist: BigInt(kiosk.profits) }
    })
  )
  const with_profits = reads.filter((r) => r.profits_mist > 0n)
  return {
    total_mist: with_profits.reduce((sum, r) => sum + r.profits_mist, 0n),
    kiosk_ids: with_profits.map((r) => r.kiosk_id),
  }
}

/**
 * Whether the HISTORY tab's COLLECT box + tab dot should show — collectible money is visible the instant
 * the sum is non-zero. A named predicate (not an inlined `> 0n` at each call site) so the exact boundary
 * (0 hides, 1 mist shows) is its own RED-FIRST assertion and has exactly ONE home.
 * @param {bigint} total_mist
 */
export function has_collectible_profits(total_mist) {
  return total_mist > 0n
}
