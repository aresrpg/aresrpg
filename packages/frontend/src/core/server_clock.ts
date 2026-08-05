// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE SERVER CLOCK OFFSET — the one home for "how far this device's clock sits from the server's".
//
// #2263: sponsorship is gated on a `aresrpg-sponsor:<sender>:<epoch-ms>` challenge the service refuses outside
// a 5-minute freshness window (api/zklogin_auth.mjs). That timestamp was minted from the DEVICE clock, so a
// player whose phone or PC was ≥5 minutes off could never be sponsored — and nothing they could do inside the
// game would fix it, because the game never knew. The offset below is measured from the `Date` header of
// responses the app ALREADY receives, and challenges are stamped `Date.now() + offset` instead.
//
// FRESHNESS IS THE WHOLE CONTRACT. A cached response replays a stale `Date`, which can only move the offset
// BACKWARD — i.e. refuse a player whose clock is fine. So exactly two doors feed this, both bounded, and
// nothing else may: the sponsor's own POST responses (a POST is never served from a cache) and `/v1/status`
// (`cache-control: public, max-age=2`, the shortest-lived route the read API serves). An HTTP date has
// second granularity and travels one network hop, so the measurement carries ~1s + latency of error — three
// orders of magnitude under the window it protects.
//
// Effects stay at the edges: the two transports OBSERVE, this module only remembers, and `server_now()` is a
// pure function of (device clock, offset).

/** server − device, in ms. `null` until a response has been observed — never a fabricated zero. */
let offset_ms: number | null = null

/**
 * Record one observation from an HTTP `Date` header. Absent (not exposed cross-origin, a fetch double) or
 * unparseable ⇒ nothing is recorded and the caller keeps device time; a clock read is never load-bearing enough
 * to fail a request over. Last observation wins: the device clock can be corrected mid-session (that is exactly
 * the remedy we tell a skewed player to apply), and the next response must be believed over the old reading.
 */
export function observe_server_date(header: string | null | undefined, received_at: number = Date.now()): void {
  if (!header) return
  const server_ms = Date.parse(header)
  if (!Number.isFinite(server_ms)) return
  offset_ms = server_ms - received_at
}

/** The measured offset (server − device) in ms, or null when nothing has been observed yet. */
export const server_clock_offset_ms = (): number | null => offset_ms

/** Epoch ms as the SERVER reads it — device time exactly as before when no observation has landed. */
export const server_now = (): number => Date.now() + (offset_ms ?? 0)

/** Test isolation for the module-lifetime offset; production callers never need to forget it. */
export function _reset_server_clock_for_test(): void {
  offset_ms = null
}
