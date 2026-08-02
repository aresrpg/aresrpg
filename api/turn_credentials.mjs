// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TURN credential mint — the ONE place the coturn long-term secret is spent (#1792).
//
// The deployed coturn runs in `use-auth-secret` (REST API) mode: it holds a long-term shared secret and
// accepts any browser that presents `<unix-expiry>:<label>` as the username and
// base64(HMAC-SHA1(secret, that username)) as the password. There is no user table — the HMAC IS the
// authorization, and its expiry timestamp is carried in the username coturn re-hashes on every
// authentication. So a browser can never be handed the secret (it would be an open relay wearing our DNS);
// a short-lived pair minted where the secret already lives is the entire contract.
//
// Everything below the response builder is PURE: same secret + same username ⇒ same credential, forever.
// That is exactly why the formula is pinned against a vector computed by openssl and python (test/
// turn_credentials.test.js) rather than against this file's own output.
import { createHmac, randomBytes } from 'node:crypto'

// A ~1h ceiling on how long a minted pair authenticates. coturn re-checks the username's timestamp on every
// authentication, so this is a real ceiling on a relayed session, not just on the handshake — long enough for
// a play session's allocation, short enough that a leaked pair is worthless by the time it travels.
export const TURN_TTL_SECS = Number(process.env.TURN_TTL_SECS || 3600)

export const TURN_UNCONFIGURED_ERROR =
  'turn-unavailable: this deployment mints no TURN credentials (TURN_SECRET / TURN_URL unset) — ' +
  'refusing to hand out a pair coturn would reject rather than pretend the relay is live'

/**
 * The credential pair for one browser, per coturn's use-auth-secret contract.
 * @param {{ secret: string, label: string, ttl_secs: number, now_secs: number }} params
 *   `label` is opaque to coturn — it only scopes the per-credential allocation quota (`user-quota`), so a
 *   fresh random one per mint means one abusive caller cannot spend another player's allocations.
 * @returns {{ username: string, credential: string, ttl: number }}
 */
export function turn_credential({ secret, label, ttl_secs, now_secs }) {
  const username = `${Math.floor(now_secs) + ttl_secs}:${label}`
  return {
    username,
    credential: createHmac('sha1', secret).update(username).digest('base64'),
    ttl: ttl_secs,
  }
}

/** A fresh opaque per-mint label. Never the caller's IP or address: it travels to the relay in cleartext. */
export const turn_label = () => `ares-${randomBytes(4).toString('hex')}`

/**
 * The minted ICE entry, or null when this deployment carries no relay. Reads env at CALL time so a rolled
 * secret takes effect without a rebuild, and never echoes the secret in any shape but the HMAC.
 */
export function mint_turn_credentials(now_ms = Date.now()) {
  const secret = process.env.TURN_SECRET?.trim()
  const urls = process.env.TURN_URL?.trim()
  if (!secret || !urls) return null
  return {
    urls,
    ...turn_credential({
      secret,
      label: turn_label(),
      ttl_secs: TURN_TTL_SECS,
      now_secs: Math.floor(now_ms / 1000),
    }),
  }
}
