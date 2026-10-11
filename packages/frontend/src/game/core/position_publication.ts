// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ClientPacket } from '@aresrpg/protocol'

export type PublishedPosition = Readonly<
  Omit<Extract<ClientPacket, { type: 'packet/position' }>, 'type' | 'character_id'>
>

const position_changed = (before: PublishedPosition | null, current: PublishedPosition): boolean =>
  !before ||
  before.checkpoint !== current.checkpoint ||
  before.riding !== current.riding ||
  before.gliding !== current.gliding ||
  Math.hypot(before.x - current.x, before.y - current.y, before.z - current.z) >= 0.25

export const create_position_publisher = ({
  send,
  now = Date.now,
}: Readonly<{
  send: (character_id: string, position: PublishedPosition) => boolean
  now?: () => number
}>) => {
  const sent = new Map<string, Readonly<{ at_ms: number; position: PublishedPosition }>>()
  const publish = (
    character_id: string,
    position: PublishedPosition,
    interval_ms: number,
    force?: boolean
  ): boolean => {
    const at_ms = now()
    const previous = sent.get(character_id)
    if (!force) {
      if (previous && at_ms - previous.at_ms < interval_ms) return false
      if (!position_changed(previous?.position ?? null, position)) return false
    }
    if (!send(character_id, position)) return false
    sent.set(character_id, Object.freeze({ at_ms, position }))
    return true
  }
  return Object.freeze({
    publish,
    /** Retiring a controller must not leave its last remote mount/glide state latched. */
    release: (character_id: string): boolean => {
      const previous = sent.get(character_id)?.position
      if (!previous || (!previous.riding && !previous.gliding)) return false
      return publish(character_id, { ...previous, riding: false, gliding: false }, 0, true)
    },
  })
}
