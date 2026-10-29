// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useLayoutEffect, useRef } from 'react'

const OBSTACLES = '.world-social-dock, .fight-hud__bottom > *, .gw-worldchat, .mobile-jump, .mobile-joystick'

/** Keep the existing chat anchor unless the entire card stack fits in the opposite corner. */
export const useHudPlacement = () => {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const cards = root.current
    const chat = cards?.closest<HTMLElement>('.gw-worldchat')
    const frame = chat?.closest<HTMLElement>('[data-world-frame], [data-chat-viewport]')
    if (!cards || !chat || !frame) return
    const scope = cards.closest('.app-ui') ?? document.body
    let scheduled = 0
    const arrange = (): void => {
      scheduled = 0
      const bounds = frame.getBoundingClientRect()
      const anchor = chat.getBoundingClientRect()
      const size = cards.getBoundingClientRect()
      const right = bounds.right - 10
      const bottom = bounds.bottom - 10
      const left = right - size.width
      const top = bottom - size.height
      const blocked = [...scope.querySelectorAll<HTMLElement>(OBSTACLES)].some((element) => {
        const rect = element.getBoundingClientRect()
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left < right + 8 &&
          rect.right > left - 8 &&
          rect.top < bottom + 8 &&
          rect.bottom > top - 8
        )
      })
      const fits = size.height > 0 && left >= bounds.left + 10 && top >= bounds.top + 10 && !blocked
      const transform = fits ? `translate(${left - anchor.left}px, ${bottom - anchor.top + 8}px)` : ''
      if (cards.style.transform !== transform) cards.style.setProperty('transform', transform)
    }
    const schedule = (): void => {
      if (!scheduled) scheduled = requestAnimationFrame(arrange)
    }
    const sizes = new ResizeObserver(schedule)
    const observe = (): void => {
      sizes.disconnect()
      for (const element of [frame, chat, cards, ...scope.querySelectorAll(OBSTACLES)]) sizes.observe(element)
      schedule()
    }
    // Content changes can add/remove blockers; resizing and dragging also change the available space.
    const content = new MutationObserver(observe)
    content.observe(document.body, { childList: true, subtree: true })
    const dragging = new MutationObserver(schedule)
    dragging.observe(chat, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', schedule)
    observe()
    return () => {
      sizes.disconnect()
      content.disconnect()
      dragging.disconnect()
      window.removeEventListener('resize', schedule)
      cancelAnimationFrame(scheduled)
    }
  }, [])
  return root
}
