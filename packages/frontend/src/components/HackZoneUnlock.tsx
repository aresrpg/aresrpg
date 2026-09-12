// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'
import { Shield } from 'lucide-react'

import { advance_konami, KONAMI_CODE } from '../game/core/konami.ts'
import { world_keyboard_eligible, WORLD_MOVE_KEYS } from '../game/core/world_input.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'

import './hack_zone.css'

const manual_control = (code: string): boolean => Boolean(WORLD_MOVE_KEYS[code]) || ['Space', 'Escape'].includes(code)

export const HackZoneUnlock = ({ copy, enabled }: Readonly<{ copy: AppCopy; enabled: boolean }>) => {
  const unlocked = useAppStore((state) => state.automation.unlocked)
  const [expired, set_expired] = useState(false)
  const ceremony = unlocked && !expired
  const text = copy_text(copy.automation_panel)
  useEffect(() => {
    if (!enabled) return
    let prefix: readonly string[] = []
    const on_key = (event: Readonly<KeyboardEvent>): void => {
      const state = read_app_state()
      if (state.navigation.page !== 'world' || !world_keyboard_eligible(event)) return
      if (state.automation.run && manual_control(event.code))
        dispatch_app({ type: 'automation/stop', reason: 'stopped' })
      if (unlocked || event.repeat) return
      if ([event.altKey, event.ctrlKey, event.metaKey, event.shiftKey].some(Boolean)) {
        prefix = []
        return
      }
      prefix = advance_konami(prefix, event.code)
      if (prefix.length !== KONAMI_CODE.length) return
      event.preventDefault()
      dispatch_app({ type: 'automation/unlocked' })
    }
    globalThis.addEventListener('keydown', on_key, { capture: true })
    return () => globalThis.removeEventListener('keydown', on_key, { capture: true })
  }, [enabled, unlocked])

  useEffect(() => {
    if (!ceremony) return
    const frame = document.querySelector('[data-world-frame]')
    const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    const shake = reduced
      ? null
      : frame?.animate(
          [
            { transform: 'translate(0, 0)' },
            { transform: 'translate(-9px, 4px)' },
            { transform: 'translate(8px, -5px)' },
            { transform: 'translate(-6px, -3px)' },
            { transform: 'translate(5px, 3px)' },
            { transform: 'translate(-2px, 1px)' },
            { transform: 'translate(0, 0)' },
          ],
          { duration: 580, easing: 'ease-out' }
        )
    const timer = setTimeout(() => set_expired(true), 2800)
    return () => {
      clearTimeout(timer)
      shake?.cancel()
    }
  }, [ceremony])

  if (!ceremony) return null
  return (
    <div className="hack-zone" role="status" aria-live="polite" data-hack-zone="">
      <div className="hack-zone__ring" aria-hidden="true" />
      <div className="hack-zone__badge">
        <Shield size={34} strokeWidth={1.3} aria-hidden="true" />
        <span className="hack-zone__eyebrow">{text('unlocked')}</span>
        <strong className="hack-zone__title">{text('badge')}</strong>
        <span className="hack-zone__footer">{text('available')}</span>
      </div>
    </div>
  )
}
