// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// House Tooltip primitive — ONE reusable glass tooltip for the whole HUD, the single home that
// replaces native `title=` everywhere. It:
//   - portals the card to <body> so it escapes drawer/overflow clipping and stacks above everything,
//   - opens after a ~120ms hover/focus INTENT delay (no flicker on a quick mouse sweep),
//   - edge-flips vertically + clamps horizontally so it always stays fully on-screen,
//   - wraps its SINGLE child WITHOUT adding a DOM node (cloneElement merges a ref + hover/focus
//     handlers onto the child) so it never disturbs layout,
//   - is accessible: role="tooltip" + aria-describedby, dismiss on Escape, closes on scroll, and
//     honours prefers-reduced-motion (CSS).
// Pass `text` for a plain label or `content` for rich JSX (the item / stat / spell cards). The child
// must be a single DOM element (button / div / span / a) — which every title= site already is.

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import './tooltip.css'
import { tooltip_anchor } from './tooltip_anchor.js'

const OPEN_DELAY = 120 // ms hover/focus intent before the card shows

/** Merge a local ref with whatever ref the child already carried (skips falsy). */
const merge_refs =
  (/** @type {any[]} */ ...refs) =>
  (/** @type {any} */ node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    }
  }

/** Chain our handler AFTER the child's existing one (never clobber it). */
const chain =
  (/** @type {Function | undefined} */ theirs, /** @type {Function} */ ours) =>
  (/** @type {any[]} */ ...args) => {
    theirs?.(...args)
    ours(...args)
  }

/**
 * @param {{
 *   children: import('react').ReactElement,
 *   text?: string,
 *   content?: import('react').ReactNode,
 *   placement?: 'top' | 'bottom',
 *   className?: string,
 * }} props
 * @returns {import('react').ReactNode}
 */
export function Tooltip({
  children,
  text,
  content,
  placement = 'top',
  className,
}) {
  const trigger_ref = useRef(/** @type {HTMLElement | null} */ (null))
  const card_ref = useRef(/** @type {HTMLDivElement | null} */ (null))
  const timer = useRef(
    /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined),
  )
  const [open, set_open] = useState(false)
  const [pos, set_pos] = useState({ left: 0, top: 0 })
  const id = useId()
  // empty-string text (a conditional "" label) means no tooltip, so collapse it to null
  const body = content ?? (text ? text : null)

  const close = useCallback(() => {
    clearTimeout(timer.current)
    set_open(false)
  }, [])

  const schedule = useCallback(() => {
    if (body == null) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => set_open(true), OPEN_DELAY)
  }, [body])

  // drop any pending timer on unmount
  useEffect(() => () => clearTimeout(timer.current), [])

  // while open: dismiss on Escape, and close on any scroll (a moved trigger would orphan the card)
  useEffect(() => {
    if (!open) return undefined
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', on_key)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', on_key)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, close])

  // position AFTER the card mounts (pre-paint): measure both boxes, then place via the ONE positioning home
  // (tooltip_anchor) — place per placement, edge-flip vertically + clamp both axes fully on-screen.
  useLayoutEffect(() => {
    if (!open) return
    const trig = trigger_ref.current
    const card = card_ref.current
    if (!trig || !card) return
    set_pos(
      tooltip_anchor({
        trigger: trig.getBoundingClientRect(),
        card: card.getBoundingClientRect(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement,
      })
    )
  }, [open, placement, body])

  const child = Children.only(children)
  if (!isValidElement(child) || body == null) return children

  const props = /** @type {any} */ (child.props)
  const trigger = cloneElement(
    child,
    /** @type {any} */ ({
      ref: merge_refs(trigger_ref, props?.ref),
      onMouseEnter: chain(props.onMouseEnter, schedule),
      onMouseLeave: chain(props.onMouseLeave, close),
      onFocus: chain(props.onFocus, schedule),
      onBlur: chain(props.onBlur, close),
      'aria-describedby': open ? id : props['aria-describedby'],
    }),
  )

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={card_ref}
            id={id}
            role="tooltip"
            className={`tt-card${className ? ` ${className}` : ''}`}
            style={{ left: pos.left, top: pos.top }}
          >
            {typeof body === 'string' ? (
              <span className="tt-text">{body}</span>
            ) : (
              body
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
