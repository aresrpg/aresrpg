// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type PublishedPosition = Readonly<{ x: number; y: number; z: number; riding: boolean }>

const position_changed = (before: PublishedPosition | null, current: PublishedPosition): boolean =>
  !before ||
  before.riding !== current.riding ||
  Math.hypot(before.x - current.x, before.y - current.y, before.z - current.z) >= 0.25

export const create_position_publisher = ({
  send,
  now = Date.now,
}: Readonly<{
  send: (character_id: string, position: PublishedPosition) => boolean
  now?: () => number
}>) => {
  const sent = new Map<string, Readonly<{ at_ms: number; position: PublishedPosition }>>()
  return Object.freeze({
    publish: (character_id: string, position: PublishedPosition, interval_ms: number): boolean => {
      const at_ms = now()
      const previous = sent.get(character_id)
      if (previous && at_ms - previous.at_ms < interval_ms) return false
      if (!position_changed(previous?.position ?? null, position)) return false
      if (!send(character_id, position)) return false
      sent.set(character_id, Object.freeze({ at_ms, position }))
      return true
    },
  })
}
