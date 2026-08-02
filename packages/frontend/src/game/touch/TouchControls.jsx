// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Mobile roam controls: a conventional dynamic left joystick plus held JUMP and one-shot MOUNT buttons.
// This React overlay writes the existing touch_input intent shape; embed_voxel_player merges it into the
// same ctl.set_input call as WASD/Space. The lead-owned mobile_mode source is the only viewport/device gate.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsUp, Menu, PawPrint } from 'lucide-react'

import { useMobileInputMode } from './mobile_input_mode.js'
import { create_touch_stick_gesture } from './touch_stick_gesture.js'
import { is_active, set_jump, set_mount_toggle, set_move, subscribe_active } from './touch_input.js'

import './touch-controls.css'

/**
 * @param {{
 *   on_move?: (v: import('./touch_stick.js').StickVector) => void,
 *   on_jump?: (down: boolean) => void,
 *   on_mount_toggle?: () => void,
 *   on_menu_toggle?: () => void,
 * }} props
 * @returns {import('react').ReactElement | null}
 */
export function TouchControls({ on_move, on_jump, on_mount_toggle, on_menu_toggle }) {
  const { t } = useTranslation()
  const mobile = useMobileInputMode()

  const zone_ref = useRef(null)
  const callbacks = useRef({ on_move })
  callbacks.current.on_move = on_move
  // null = no active drag (the base is unmounted -- dynamic spawn, nothing to show at rest).
  const [stick, set_stick] = useState(null)
  const gesture_ref = useRef(null)
  if (!gesture_ref.current)
    gesture_ref.current = create_touch_stick_gesture({
      on_vector: (vector) => callbacks.current.on_move?.(vector),
      on_visual: set_stick,
    })
  const gesture = gesture_ref.current

  useEffect(() => {
    if (!mobile) gesture.reset()
    return () => gesture.reset()
  }, [gesture, mobile])

  const with_zone_rect = (handler) => (event) => {
    const zone = zone_ref.current
    if (zone) handler(event, zone.getBoundingClientRect())
  }

  // D160 contract: the app owns input devices; a desktop session never mounts this input layer.
  if (!mobile) return null

  return (
    <div className="touch-controls">
      <div
        ref={zone_ref}
        className="touch-controls__stick-zone"
        onPointerDown={with_zone_rect(gesture.pointer_down)}
        onPointerMove={with_zone_rect(gesture.pointer_move)}
        onPointerUp={gesture.pointer_up}
        onPointerCancel={gesture.pointer_up}
      >
        {stick && (
          <div className="touch-controls__stick-base" style={{ left: stick.x, top: stick.y }}>
            <div className="touch-controls__stick-ring" />
            <div
              className="touch-controls__stick-thumb"
              style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }}
            />
          </div>
        )}
      </div>

      <div className="touch-controls__cluster">
        <button
          type="button"
          className="touch-controls__btn touch-controls__btn--jump"
          onPointerDown={(e) => {
            e.preventDefault()
            // Capture so a thumb sliding off the button still delivers the release — the controller edge-detects
            // the press AND reads release-to-cut / swim-rise / double-jump off the SAME held bit; a stuck-true
            // jump would rocket the body. HELD (down/up), never a one-shot pulse.
            e.currentTarget.setPointerCapture?.(e.pointerId)
            on_jump?.(true)
          }}
          onPointerUp={(e) => {
            e.preventDefault()
            on_jump?.(false)
          }}
          onPointerCancel={() => on_jump?.(false)}
        >
          <ChevronsUp className="touch-controls__btn-icon" />
          <span className="touch-controls__btn-label">{t('touch.jump')}</span>
        </button>
        <button
          type="button"
          className="touch-controls__btn touch-controls__btn--mount"
          onPointerDown={(e) => {
            e.preventDefault()
            on_mount_toggle?.()
          }}
        >
          <PawPrint className="touch-controls__btn-icon" />
          <span className="touch-controls__btn-label">{t('touch.mount')}</span>
        </button>
        {on_menu_toggle && (
          <button
            type="button"
            className="touch-controls__btn touch-controls__btn--menu"
            onPointerDown={(e) => {
              e.preventDefault()
              on_menu_toggle()
            }}
          >
            <Menu className="touch-controls__btn-icon" />
            <span className="touch-controls__btn-label">{t('touch.menu')}</span>
          </button>
        )}
      </div>
    </div>
  )
}

// M-04 — the PRODUCTION overlay: the pure TouchControls above wired to the touch_input state singleton and
// gated by the engine's own is_active() (armed roam only — the frame loop disarms during a fight/menu/text
// focus, which unmounts this). One home for the gate: the overlay hides on the SAME signal the walk loop
// stops reading touch (no second fight/focus check in React). The pure component stays prop-driven so it is
// screenshot-able in isolation; this is the only place that touches the singleton.
//
// A menu button only renders when a concrete HUD owner supplies a callback; production currently leaves it
// absent so the controls never advertise a dead tap target.
export function TouchControlsLayer() {
  const active = useSyncExternalStore(subscribe_active, is_active, () => false)
  // DEV-only visual-proof seam: the mobile HUD capture uses a spectate world (no chain/network), whose
  // controller correctly stays disarmed. Production still renders solely from the real input gate.
  const capture_active =
    import.meta.env.DEV && typeof window !== 'undefined' && window.__ARES_MOBILE_HUD_CAPTURE === true
  if (!active && !capture_active) return null
  return (
    <TouchControls
      on_move={(v) => set_move(v.forward, v.strafe)}
      on_jump={(down) => set_jump(down)}
      on_mount_toggle={() => set_mount_toggle()}
    />
  )
}
