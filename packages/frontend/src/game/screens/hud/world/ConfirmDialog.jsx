// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// In-app CONFIRM dialog — replaces the native browser `window.confirm` (standing house law: NEVER a native
// dialog; every prompt is the app modal, so it matches the gothic-terminal DNA and can't be styled by the OS).
// Pure, prop-driven view: the caller owns `open` (a local state flag), passes the copy + the two handlers, and
// this renders a near-black glass card over a dimmed scrim with a DANGER (gold-on-loss red) confirm + a plain
// cancel. Escape / scrim-click cancels. No chain jargon in the copy — the caller supplies already-translated,
// player-facing strings (t('…')). Reused by every abandon-confirm surface (DungeonBoard / DungeonIdleRoom /
// CharacterSwitcher) so the prompt is ONE component, one look, zero native dialogs.

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import './confirm-dialog.css'

/**
 * @param {{
 *   open: boolean,
 *   title: string,
 *   message: string,
 *   confirm_label: string,
 *   cancel_label: string,
 *   danger?: boolean,
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
  on_confirm,
  on_cancel,
}) {
  // Escape cancels (parity with a native dialog's Esc), bound only while open.
  useEffect(() => {
    if (!open) return
    const on_key = e => {
      if (e.key === 'Escape') on_cancel()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [open, on_cancel])

  if (!open) return null

  // Portal to <body> (mirrors PetFeedModal/PlayerActionMenu/FundWalletModal): several callers (WorldSwitcher's
  // travel confirm, OnlinePlayers' friend-remove) mount this from inside a `.gw-panel`, and EVERY `.gw-panel`
  // sets `backdrop-filter` — which per spec establishes a new containing block for `position: fixed`
  // descendants. Rendered inline, the scrim's `fixed inset-0` was fixed to that blurred panel instead of the
  // viewport, so it anchored beside the panel instead of screen-centering. Portaling out to
  // body sidesteps ANY ancestor's containing-block/stacking traps for every current and future caller — one
  // fix, every instance, without hunting each wrapper for the CSS property that broke it this time.
  return createPortal(
    <div className="confirm-dialog__scrim" onClick={on_cancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
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
            className={`confirm-dialog__btn ${danger ? 'confirm-dialog__btn--danger' : 'confirm-dialog__btn--confirm'}`}
            onClick={on_confirm}
          >
            {confirm_label}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
