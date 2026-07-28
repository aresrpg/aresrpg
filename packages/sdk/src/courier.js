// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Stateless courier HTTP contract. Authentication is deliberately data here: the browser wallet edge signs
// courier_challenge(), then passes the resulting sender/challenge/signature triplet into either POST helper.

export const COURIER_POSITION_PATH = '/v1/courier/position'
export const COURIER_CHAT_PATH = '/v1/courier/chat'
export const COURIER_PRESENCE_PATH = '/v1/stream/presence'
export const COURIER_CHAT_MAX_LENGTH = 280

export class CourierError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message)
    this.name = 'CourierError'
    this.status = status
  }
}

/** @param {string} address @param {number} [issued_at] */
export const courier_challenge = (address, issued_at = Date.now()) => `aresrpg-courier:${address}:${issued_at}`

/** @param {string} base_url @param {string} path */
const endpoint = (base_url, path) => `${String(base_url ?? '').replace(/\/+$/, '')}${path}`

/** @param {Response} response */
async function decode(response) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new CourierError(String(body?.error ?? `courier HTTP ${response.status}`), response.status)
  return body
}

/**
 * @param {{
 *   base_url?: string, world: string, character: string, x: number, z: number, heading: number,
 *   sender: string, challenge: string, signature: string
 * }} input
 * @param {typeof fetch} [fetch_impl]
 */
export async function post_courier_position(
  { base_url = '', world, character, x, z, heading, sender, challenge, signature },
  fetch_impl = fetch
) {
  return decode(
    await fetch_impl(endpoint(base_url, COURIER_POSITION_PATH), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ world, character, x, z, heading, sender, challenge, signature }),
    })
  )
}

/**
 * `channel`, `target`, and `party` preserve the existing client chat vocabulary on the one world stream; the
 * public endpoint's required abuse-floor contract remains exactly world/character/text + zkLogin auth.
 * @param {{
 *   base_url?: string, world: string, character: string, text: string,
 *   sender: string, challenge: string, signature: string,
 *   channel?: string, target?: string, party?: string | null
 * }} input
 * @param {typeof fetch} [fetch_impl]
 */
export async function post_courier_chat(
  { base_url = '', world, character, text, sender, challenge, signature, channel, target, party },
  fetch_impl = fetch
) {
  const body = { world, character, text, sender, challenge, signature }
  if (channel) Object.assign(body, { channel })
  if (target) Object.assign(body, { target })
  if (party) Object.assign(body, { party })
  return decode(
    await fetch_impl(endpoint(base_url, COURIER_CHAT_PATH), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )
}

/**
 * THE presence-link URL — one home for the route contract both halves speak. The world is the path; the
 * connection's own identity is the query, and the read layer REFUSES a link that names neither (it is how the
 * socket registers itself in the world's presence registry).
 * @param {string} base_url @param {string} world
 * @param {{ address?: string | null, character?: string | null }} [identity]
 */
export const courier_presence_url = (base_url, world, { address = null, character = null } = {}) => {
  const url = new URL(endpoint(base_url, `${COURIER_PRESENCE_PATH}/${encodeURIComponent(world)}`))
  if (address) url.searchParams.set('address', String(address))
  if (character) url.searchParams.set('character', String(character))
  return url.toString()
}

