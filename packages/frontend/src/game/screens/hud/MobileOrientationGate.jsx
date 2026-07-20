// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { RotateCw, Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { is_mobile_portrait, on_mobile_orientation_change, request_mobile_landscape } from './mobile_layout.js'

import './mobile-orientation.css'

const server_landscape = () => false

/** Pure portrait blocker kept separate so DOM-less tests can prove its accessible contract. */
export function MobileRotateOverlay({ title, detail, dialog_ref }) {
  return (
    <div
      ref={dialog_ref}
      className="mobile-orientation-overlay"
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby="mobile-orientation-title"
      aria-describedby="mobile-orientation-detail"
      data-mobile-orientation-overlay="portrait"
    >
      <div className="mobile-orientation-overlay__card">
        <span className="mobile-orientation-overlay__icon" aria-hidden="true">
          <Smartphone />
          <RotateCw />
        </span>
        <strong id="mobile-orientation-title">{title}</strong>
        <span id="mobile-orientation-detail">{detail}</span>
      </div>
    </div>
  )
}

/** Mobile-only fullscreen/orientation controller. Desktop never mounts this component. */
export function MobileOrientationGate() {
  const { t } = useTranslation()
  const portrait = useSyncExternalStore(on_mobile_orientation_change, is_mobile_portrait, server_landscape)
  const dialog_ref = useRef(null)

  useEffect(() => {
    let attempted = false
    const cleanup = () => {
      window.removeEventListener('pointerup', activate, true)
      window.removeEventListener('keydown', activate, true)
    }
    const activate = () => {
      if (attempted) return
      attempted = true
      cleanup()
      void request_mobile_landscape(document, window.screen)
    }

    window.addEventListener('pointerup', activate, true)
    window.addEventListener('keydown', activate, true)
    return cleanup
  }, [])

  useEffect(() => {
    const dialog = dialog_ref.current
    if (!portrait || !dialog) return undefined

    const restore_inert = []
    let branch = dialog
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || sibling.inert) continue
        sibling.inert = true
        restore_inert.push(() => {
          sibling.inert = false
        })
      }
      branch = branch.parentElement
    }

    const prior_focus = document.activeElement
    const keep_focus_inside = (event) => {
      if (!dialog.contains(event.target)) dialog.focus({ preventScroll: true })
    }
    dialog.focus({ preventScroll: true })
    document.addEventListener('focusin', keep_focus_inside, true)

    return () => {
      document.removeEventListener('focusin', keep_focus_inside, true)
      restore_inert.forEach((restore) => restore())
      prior_focus?.focus?.({ preventScroll: true })
    }
  }, [portrait])

  if (!portrait) return null
  return (
    <MobileRotateOverlay title={t('touch.rotate_title')} detail={t('touch.rotate_detail')} dialog_ref={dialog_ref} />
  )
}
