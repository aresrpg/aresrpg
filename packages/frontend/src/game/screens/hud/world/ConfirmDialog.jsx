// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// In-app CONFIRM dialog — replaces the native browser `window.confirm` (standing house law: NEVER a native
// dialog; every prompt is the app modal, so it matches the gothic-terminal DNA and can't be styled by the OS).
// Pure, prop-driven view: the caller owns `open` (a local state flag), passes the copy + the two handlers, and
// this renders a near-black glass card over a dimmed scrim with a DANGER (gold-on-loss red) confirm + a plain
// cancel. Escape / scrim-click cancels. No chain jargon in the copy — the caller supplies already-translated,
// player-facing strings (t('…')). Reused by every abandon-confirm surface (DungeonBoard / DungeonIdleRoom /
// CharacterSwitcher) so the prompt is ONE component, one look, zero native dialogs.

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { resettable_single_shot } from '../../../../utils/single_flight.js'

import './confirm-dialog.css'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * @param {{
 *   open: boolean,
 *   title: string,
 *   message: import('react').ReactNode,
 *   confirm_label: import('react').ReactNode,
 *   cancel_label: string,
 *   danger?: boolean,
 *   confirm_disabled?: boolean,
 *   on_confirm: () => void,
 *   on_cancel: () => void,
 * }} props
 * @returns {import('react').ReactElement | null}
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirm_label,
  cancel_label,
  danger = false,
  confirm_disabled = false,
  on_confirm,
  on_cancel,
}) {
  const dialog_ref = useRef(null)
  const cancel_ref = useRef(on_cancel)
  const confirm_consumed_ref = useRef(resettable_single_shot())

  useEffect(() => {
    cancel_ref.current = on_cancel
  }, [on_cancel])

  // Focus enters the modal, Tab/Shift+Tab wrap inside it, Escape cancels, and focus returns to the trigger.
  // The listener is bound only while open; callback churn does not tear down/re-focus the dialog.
  useEffect(() => {
    if (!open) {
      confirm_consumed_ref.current.reset()
      return
    }
    confirm_consumed_ref.current.reset()
    const previous_focus = document.activeElement
    const dialog = dialog_ref.current
    const focusable = () => [...(dialog?.querySelectorAll(FOCUSABLE_SELECTOR) ?? [])]
    const first_focusable = focusable()[0]
    ;(first_focusable ?? dialog)?.focus()

    const on_key = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel_ref.current()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = focusable()
      if (nodes.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog?.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', on_key)
    return () => {
      window.removeEventListener('keydown', on_key)
      previous_focus?.focus?.()
    }
  }, [open])

  if (!open) return null

  const confirm_once = () => {
    if (!confirm_consumed_ref.current.take()) return
    on_confirm()
  }

  // Portal to <body> (mirrors PetFeedModal/PlayerActionMenu/AddFundsModal): several callers (WorldSwitcher's
  // travel confirm, OnlinePlayers' friend-remove) mount this from inside a `.gw-panel`, and EVERY `.gw-panel`
  // sets `backdrop-filter` — which per spec establishes a new containing block for `position: fixed`
  // descendants. Rendered inline, the scrim's `fixed inset-0` was fixed to that blurred panel instead of the
  // viewport, so it anchored beside the panel instead of screen-centering. Portaling out to
  // body sidesteps ANY ancestor's containing-block/stacking traps for every current and future caller — one
  // fix, every instance, without hunting each wrapper for the CSS property that broke it this time.
  return createPortal(
    <div className="confirm-dialog__scrim" onClick={on_cancel}>
      <div
        ref={dialog_ref}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="confirm-dialog__title">{title}</div>
        <div className="confirm-dialog__msg">{message}</div>
        <div className="confirm-dialog__btns">
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--cancel"
            onClick={on_cancel}
          >
            {cancel_label}
          </button>
          <button
            type="button"
            disabled={confirm_disabled}
            className={`confirm-dialog__btn ${danger ? 'confirm-dialog__btn--danger' : 'confirm-dialog__btn--confirm'}`}
            onClick={confirm_once}
          >
            {confirm_label}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
