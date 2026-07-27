// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Nostr signaling diet for Trystero 0.25.3. Game actions never enter here: makeAction sends them through the
// active peer's RTCDataChannel. This seam suppresses only Trystero's unconditional root-room presence note after
// a direct peer exists. The relay subscription and every peer-specific offer/answer/candidate EVENT remain live,
// so a later browser can still announce itself and be answered by an already-connected browser.

const encoder = new TextEncoder()
const signal_keys = ['offer', 'answer', 'candidate']
const socket_patches = new WeakMap()

/** Match Trystero 0.25.3's `sha1`: each digest byte is base-36 and concatenated without padding. */
export async function trystero_room_topic(app_id, room_id) {
  const bytes = await globalThis.crypto.subtle.digest('SHA-1', encoder.encode(`Trystero@${app_id}@${room_id}`))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(36)).join('')
}

/** True only for the periodic root-room `{ peerId }` note. Targeted signaling on a peer topic always passes. */
export function is_periodic_room_announcement(data, root_topic) {
  if (typeof data !== 'string') return false
  try {
    const [type, event] = JSON.parse(data)
    if (type !== 'EVENT' || !event || typeof event !== 'object') return false
    if (!event.tags?.some((tag) => tag?.[0] === 'x' && tag?.[1] === root_topic)) return false
    const payload = JSON.parse(event.content)
    return (
      !!payload &&
      typeof payload === 'object' &&
      typeof payload.peerId === 'string' &&
      !signal_keys.some((key) => typeof payload[key] === 'string' && payload[key])
    )
  } catch {
    return false
  }
}

const suppress_on_socket = (socket, root_topic) => {
  if (!socket || typeof socket.send !== 'function') return () => {}
  let patch = socket_patches.get(socket)
  if (!patch) {
    const original = socket.send
    const topics = new Map()
    const wrapped = function (data, ...rest) {
      if ([...topics.keys()].some((topic) => is_periodic_room_announcement(data, topic))) return undefined
      return original.call(this, data, ...rest)
    }
    try {
      socket.send = wrapped
    } catch {
      return () => {}
    }
    patch = { original, topics }
    socket_patches.set(socket, patch)
  }
  patch.topics.set(root_topic, (patch.topics.get(root_topic) ?? 0) + 1)
  let active = true
  return () => {
    if (!active) return
    active = false
    const count = patch.topics.get(root_topic) ?? 0
    if (count > 1) patch.topics.set(root_topic, count - 1)
    else patch.topics.delete(root_topic)
    if (patch.topics.size > 0) return
    socket.send = patch.original
    socket_patches.delete(socket)
  }
}

/** Suppress periodic announcements on the current relay sockets. Returns an idempotent restore function. */
export function suppress_periodic_room_announcements(sockets, root_topic) {
  const restores = Object.values(sockets ?? {}).map((socket) => suppress_on_socket(socket, root_topic))
  let active = true
  return () => {
    if (!active) return
    active = false
    restores.forEach((restore) => restore())
  }
}
