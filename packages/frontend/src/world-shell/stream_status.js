// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One answer for stream-route failures shared by every SSE lifecycle owner.

const DEFINITIVE_STREAM_STATUSES = Object.freeze([404, 410])

/** A location has definitively answered that this stream route is unavailable. */
export const is_definitive_stream_status = (status) =>
  typeof status === 'number' && DEFINITIVE_STREAM_STATUSES.includes(status)

/**
 * What does this location actually answer for this url? `EventSource` exposes no response status, so read only
 * the response head and abort the body immediately. No response is the transient `null` class.
 * @param {string} url
 * @param {typeof fetch} [fetch_impl]
 * @returns {Promise<number|null>}
 */
export async function probe_stream_status(url, fetch_impl = globalThis.fetch) {
  const controller = new AbortController()
  try {
    const response = await fetch_impl(url, {
      signal: controller.signal,
      headers: { accept: 'text/event-stream' },
    })
    return typeof response?.status === 'number' ? response.status : null
  } catch {
    return null
  } finally {
    controller.abort()
  }
}
