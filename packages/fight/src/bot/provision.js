// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/provision.js — THE SEARCH LEG'S BRAIN (#1184), pure and clockless.
//
// The drive's first full-gate run refused honestly at setup: the seat's checkpoint zone held no unclaimed
// group, because the night's play had consumed them. A repeatable drive cannot depend on zone freshness, so
// when the dry-scan finds nothing the drive PROVISIONS a zone instead of dead-ending: pull the [F] search
// lever where the chain accepts one, rescan, and when this zone is TTL-fresh (or its reroll turned up
// nothing) walk one zone over and repeat — bounded, so a barren neighbourhood stops honestly instead of
// burning gas in a circle.
//
// This module decides ONLY that. It holds no clock, touches no chain, and knows nothing about a browser:
// `plan_provision(scout, memory)` takes the world as the seat sees it plus what this run has already tried,
// and answers with ONE command row the runner performs (scripts/fight_bot/world_search.mjs). Every spend
// decision is therefore a fixture test, not a live-chain experiment — which matters here more than anywhere
// else in the rig, because every `search` row it emits is a real transaction that burns real SUI.

/** The issue's bound: three zone hops per provisioning run, then an honest stop. */
export const MAX_HOPS = 3

/** The zone-grid key the spawns core, the scouter and this planner all agree on. */
export const zone_key_of = (zx, zy) => `${zx}:${zy}`

/** Ring offsets at Chebyshev radius `r`, in a fixed scan order — the planner is deterministic by construction. */
const ring = (r) => {
  const out = []
  for (let dy = -r; dy <= r; dy += 1)
    for (let dx = -r; dx <= r; dx += 1) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push({ dx, dy })
  return out
}

/**
 * The nearest zone worth walking to: not already tried this run, not TTL-fresh (the chain refuses a search
 * there), and on the grid. Scanned outward from where the body stands, so "walk one zone over" is literally
 * the first candidate and the wider rings are only the fallback when the neighbours are all fresh.
 * @param {{ zx: number, zy: number }} here
 * @param {Set<string>} off_limits tried ∪ fresh
 * @param {number} reach how many rings out to look
 * @returns {{ zx: number, zy: number } | null}
 */
export function pick_hop(here, off_limits, reach = MAX_HOPS) {
  for (let r = 1; r <= reach; r += 1)
    for (const { dx, dy } of ring(r)) {
      const zx = here.zx + dx
      const zy = here.zy + dy
      if (zx < 0 || zy < 0) continue // off the u32 zone grid — no such zone exists
      if (!off_limits.has(zone_key_of(zx, zy))) return { zx, zy }
    }
  return null
}

/**
 * ONE provisioning decision.
 *
 * @param {{ ok?: boolean, zone: { zx: number, zy: number } | null, prompt_armed?: boolean,
 *   fresh_keys?: string[] }} scout `__ARES_DEV_WORLD_SCOUT()` — where the body stands, whether the [F] lever
 *   is armed right here, and which zones the chain currently refuses a search on.
 * @param {{ hops?: number, tried?: string[] }} memory what this provisioning run has already spent
 * @param {{ max_hops?: number }} [bounds]
 * @returns {{ kind: 'search', zx: number, zy: number } | { kind: 'hop', zx: number, zy: number }
 *   | { kind: 'exhausted', why: string }}
 */
export function plan_provision(scout, memory = {}, { max_hops = MAX_HOPS } = {}) {
  const hops = memory.hops ?? 0
  const tried = new Set(memory.tried ?? [])
  if (!scout?.zone)
    return { kind: 'exhausted', why: 'the seat published no standing zone — the body or the world is unbound' }
  const here = zone_key_of(scout.zone.zx, scout.zone.zy)
  // SPEND HERE FIRST. A search where the body already stands costs one transaction and no travel; every hop
  // costs a walk that can fail for reasons that have nothing to do with the chain.
  if (!tried.has(here) && scout.prompt_armed) return { kind: 'search', zx: scout.zone.zx, zy: scout.zone.zy }
  if (hops >= max_hops)
    return { kind: 'exhausted', why: `${max_hops} zone hops spent and no claimable group turned up` }
  const next = pick_hop(scout.zone, new Set([...tried, ...(scout.fresh_keys ?? [])]), max_hops)
  return next
    ? { kind: 'hop', zx: next.zx, zy: next.zy }
    : {
        kind: 'exhausted',
        why: `every zone within ${max_hops} of ${here} is TTL-fresh or already tried this run`,
      }
}
