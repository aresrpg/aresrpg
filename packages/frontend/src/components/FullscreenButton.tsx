// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Maximize, Minimize } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { toast } from '../toast.ts'

const subscribe = (notify: () => void): (() => void) => {
  document.addEventListener('fullscreenchange', notify)
  return () => document.removeEventListener('fullscreenchange', notify)
}
const read_fullscreen = () =>
  document.fullscreenEnabled ? (document.fullscreenElement ? 'fullscreen' : 'windowed') : 'unavailable'
const server_snapshot = () => 'unavailable'

export const FullscreenButton = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const mode = useSyncExternalStore(subscribe, read_fullscreen, server_snapshot)
  if (mode === 'unavailable') return null
  const active = mode === 'fullscreen'
  const label = active ? copy.fullscreen_exit : copy.fullscreen_enter
  const toggle = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (cause) {
      toast.add(new Error(copy.fullscreen_failed, { cause }))
    }
  }
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className="grid w-9 shrink-0 cursor-pointer place-items-center border-l border-border text-gold-light transition-colors hover:bg-gold/15 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold"
      data-fullscreen-toggle=""
      onClick={() => void toggle()}
      title={label}
      type="button"
    >
      {active ? <Minimize aria-hidden="true" size={17} /> : <Maximize aria-hidden="true" size={17} />}
    </button>
  )
}
