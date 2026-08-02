// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The browser's half of the TURN credential contract (#1792). Our coturn runs in `use-auth-secret` mode, so
// there is no static password that could ever authenticate against it — a peer needs `<unix-expiry>:<label>`
// plus base64(HMAC-SHA1(secret, that)), and the secret may never enter a client bundle. This module fetches
// that pair from the api service's mint and hands lobby-room ONE optional ICE entry.
//
// DEGRADE HONESTLY, NEVER SILENTLY: every failure here returns null and says so once. Null means the ICE
// config is STUN-only — exactly today's behaviour, where a symmetric-NAT pair never links — so a mint outage
// costs the minority its relay and costs everyone else nothing.
//
// Env is read at ONE seam (`turn_ice_server`); the fetch below takes its url as an argument, so the network
// path is drivable without touching the process-global env module.

import { SPONSOR_URL, TURN_CRED, TURN_URL, TURN_USER } from '../env'
import { game_log } from '../core/log.js'

/** The mint sits BESIDE the sponsor door on the same service, so its URL is DERIVED from the one the client
 *  already knows — a second env var would be a second home for the same host. */
export const turn_mint_url = (sponsor_url) => sponsor_url.replace(/[^/]*$/, 'turn-credentials')

/** THE one home for "does this deployment have a relay at all". lobby-room reads it to skip the mint — and
 *  the suspension the mint costs — entirely, and the door below reads the same fact. */
export const TURN_ENABLED = Boolean(TURN_URL)

// ICE only needs the pair valid when an allocation is opened, but coturn re-hashes the expiry on every
// authentication — so refresh before the deadline rather than at it.
const REFRESH_MARGIN_MS = 60_000

/** @type {{ ice_server: { urls: string, username: string, credential: string }, expires_at_ms: number } | null} */
let cached = null

/** Test seam only — the mint's cache is module state and a suite must be able to start from cold. */
export const reset_turn_credentials = () => {
  cached = null
}

/**
 * One mint round trip. Never throws: a mint that cannot answer leaves ICE exactly as it was without it.
 * @param {string} mint_url
 * @param {string} fallback_urls the relay to dial when the mint names none of its own
 * @returns {Promise<{ ice_server: { urls: string, username: string, credential: string }, ttl_secs: number } | null>}
 */
export async function mint_ice_server(mint_url, fallback_urls) {
  try {
    const response = await fetch(mint_url)
    if (!response.ok) throw new Error(`mint answered ${response.status}`)
    const { urls, username, credential, ttl } = await response.json()
    if (typeof username !== 'string' || typeof credential !== 'string' || !username || !credential)
      throw new Error('mint answered without a credential pair')
    // The mint is authoritative for WHICH relay its own secret opens; the env value is the fallback.
    return { ice_server: { urls: urls || fallback_urls, username, credential }, ttl_secs: Number(ttl) || 0 }
  } catch (error) {
    game_log(
      'p2p',
      `TURN credential mint unreachable (${error?.message ?? error}) — ICE falls back to STUN-only, so peers ` +
        'behind a symmetric NAT will not connect this session'
    )
    return null
  }
}

/**
 * The TURN entry for this session's ICE config, or null when there is none to be had.
 * @returns {Promise<{ urls: string, username: string, credential: string } | null>}
 */
export async function turn_ice_server() {
  if (!TURN_ENABLED) return null
  // The manual override, unchanged: a hand-configured static pair skips the mint entirely. It cannot
  // authenticate against OUR coturn (use-auth-secret keeps no user table) — it exists for pointing a local
  // build at some other relay.
  if (TURN_USER && TURN_CRED) return { urls: TURN_URL, username: TURN_USER, credential: TURN_CRED }
  if (cached && cached.expires_at_ms - REFRESH_MARGIN_MS > Date.now()) return cached.ice_server

  const minted = await mint_ice_server(turn_mint_url(SPONSOR_URL), TURN_URL)
  cached = minted && { ice_server: minted.ice_server, expires_at_ms: Date.now() + minted.ttl_secs * 1000 }
  return minted?.ice_server ?? null
}
