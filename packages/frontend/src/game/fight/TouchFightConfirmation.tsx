// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- Refs retain pending pointer gestures at this DOM input boundary. */

import { Check, X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import './touch_fight_confirmation.css'

import type { AppCopy } from '../../i18n/copy.ts'

/** A newly displayed control cannot inherit the board tap that revealed it. */
const ReviewButton = ({
  label,
  class_name,
  activate,
  children,
}: Readonly<{
  label: string
  class_name: string
  activate: () => void
  children: ReactNode
}>) => {
  const pressed = useRef<number | null>(null)
  return (
    <button
      className={class_name}
      aria-label={label}
      type="button"
      onPointerDown={(event) => {
        if (event.button === 0) pressed.current = event.pointerId
      }}
      onPointerLeave={() => {
        pressed.current = null
      }}
      onPointerCancel={() => {
        pressed.current = null
      }}
      onPointerUp={(event) => {
        const admitted = pressed.current === event.pointerId
        pressed.current = null
        if (!admitted) return
        const box = event.currentTarget.getBoundingClientRect()
        if (
          event.clientX >= box.left &&
          event.clientX <= box.right &&
          event.clientY >= box.top &&
          event.clientY <= box.bottom
        )
          activate()
      }}
      onClick={(event) => {
        if (event.detail === 0) activate()
      }}
    >
      {children}
    </button>
  )
}

export const TouchFightConfirmation = ({
  visible,
  copy,
  cancel,
  confirm,
}: Readonly<{
  visible: boolean
  copy: AppCopy
  cancel: () => void
  confirm: () => void
}>) =>
  visible ? (
    <div className="fight-touch-confirm" data-touch-fight-confirm>
      <ReviewButton class_name="fight-touch-cancel" label={String(copy.characters_page.cancel)} activate={cancel}>
        <X size={24} aria-hidden="true" />
      </ReviewButton>
      <ReviewButton class_name="fight-touch-accept" label={copy.ui.mobile_confirm_action} activate={confirm}>
        <Check size={24} aria-hidden="true" />
      </ReviewButton>
    </div>
  ) : null
