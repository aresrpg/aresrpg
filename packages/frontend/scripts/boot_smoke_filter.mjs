// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE boot-smoke blocking decision, as one pure function. It lives apart from boot_smoke.mjs because that
// script spawns a preview server and a browser the moment it is imported — this module imports clean, so
// the decision is testable without driving a browser.
import { RELAY_URLS } from '../src/p2p/relays.js'

// ALLOWLIST — console.error substrings tolerated at boot. Each entry names its cause. The PRIMARY signal is
// pageerror === 0 (the uncaught migration-stub throw class); console.error catches loud degrades + regressions.
export const CONSOLE_ERROR_ALLOWLIST = [
  // #106 — the spell corpus is a runtime blob (spell_corpus.json) the seed ceremony publishes, NEVER a repo
  // artifact. Until it publishes, load_spell_corpus degrades loudly to inert spell surfaces. THIS PR's line.
  '[spell-corpus] no spell_corpus runtime asset',
  // #94 (merged) — the deployment-pin manifest is absent in the open-source tree; resolve_seed_manifest
  // degrades loudly. Allowlisted per the ruling's known-content-degrade clause.
  '[seed_manifest] no seed manifest at',
  // #106 eager-cascade degrades (inventory rows) — content consumers that used to THROW at module load,
  // crashing boot before the spell fix mattered; now they degrade loudly + inert. Full runtime-loader
  // conversion is boarded follow-up; degrade-only is the crash-killer.
  '[deployment] seed manifest carries no worlds', // deployment.ts — worlds enumeration
  '[world_corpus] world knowledge inert', // world_corpus.ts — runtime blob unpublished/unreachable in CI (#196)
  '[living_corpus] seed manifest carries', // living_corpus.ts — living-content fence
  // Environmental — the headless CI preview has NO backend (RPC / Walrus aggregator / asset host), so boot-time
  // asset & RPC fetches fail. These are BROWSER resource-load failures, not app-code errors; the pageerror
  // assertion is what guards real JS crashes. Never masks a migration-stub throw (those are uncaught, not 404s).
  'Failed to load resource',
]

// The app's own rendezvous relays, by host — DERIVED from the frontend's one list, never a second copy.
export const RELAY_HOSTS = RELAY_URLS.map((url) => new URL(url).host)

// Chrome's NATIVE WebSocket failure line: `WebSocket connection to '<url>' failed: <reason>`. The browser
// emits it itself, so no app code can suppress or downgrade it. Anchored at the start and the target URL
// parsed back out — never a broad /websocket/i sweep, so only the line's actual DESTINATION grants exemption.
const NATIVE_WS_FAILURE = /^WebSocket connection to '([^']+)' failed(?::|$)/

const failed_ws_host = (text) => {
  const match = NATIVE_WS_FAILURE.exec(text)
  if (!match) return null
  try {
    return new URL(match[1]).host
  } catch {
    return null
  }
}

// #1361 — a public nostr relay flapping is third-party weather, not a defect: the p2p layer dials 5 relays at
// redundancy 3 precisely so one can die, yet damus 503s reddened two consecutive landing queues on 2026-07-28.
// EXACTLY that class is exempt: the browser-native failure line whose target host is one of ours. Every other
// console.error — including a WebSocket failure to any other host — still blocks.
export const is_blocking_console_error = (text, relay_hosts = RELAY_HOSTS) => {
  if (CONSOLE_ERROR_ALLOWLIST.some((frag) => text.includes(frag))) return false
  const host = failed_ws_host(text)
  return !(host !== null && relay_hosts.includes(host))
}
