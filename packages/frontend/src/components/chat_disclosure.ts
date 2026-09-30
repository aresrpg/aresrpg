// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

import type { ChatChannel } from '../modules/chat.ts'

type Line = Readonly<{ id: string; channel: ChatChannel }>

/** Read position belongs to this presentation; message history remains in the chat reducer. */
export const useChatDisclosure = (lines: readonly Line[], enabled: boolean) => {
  const [view, set_view] = useState(() => {
    const compact = globalThis.matchMedia?.('(max-width: 1023px), (pointer: coarse)').matches ?? false
    return { compact, collapsed: enabled && compact, seen: new Set(lines.map(({ id }) => id)) }
  })
  useEffect(() => {
    if (!enabled) return
    const media = globalThis.matchMedia('(max-width: 1023px), (pointer: coarse)')
    const resize = () =>
      set_view((previous) =>
        previous.compact === media.matches
          ? previous
          : {
              compact: media.matches,
              collapsed: media.matches,
              seen: new Set(lines.map(({ id }) => id)),
            }
      )
    media.addEventListener('change', resize)
    resize()
    return () => media.removeEventListener('change', resize)
  }, [enabled, lines])
  const unread = view.collapsed
    ? new Set(lines.filter(({ id, channel }) => channel !== 'combat' && !view.seen.has(id)).map(({ id }) => id)).size
    : 0
  return {
    collapsed: view.collapsed,
    unread,
    toggle: () => set_view({ ...view, collapsed: !view.collapsed, seen: new Set(lines.map(({ id }) => id)) }),
  }
}
