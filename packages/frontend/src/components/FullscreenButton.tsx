// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Maximize, Minimize } from 'lucide-react'
import { useSyncExternalStore, type ReactNode } from 'react'

import { localized_error } from '../i18n/error_text.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { toast } from '../toast.ts'

const subscribe = (notify: () => void): (() => void) => {
  document.addEventListener('fullscreenchange', notify)
  return () => document.removeEventListener('fullscreenchange', notify)
}
const read_fullscreen = () =>
  document.fullscreenEnabled ? (document.fullscreenElement ? 'fullscreen' : 'windowed') : 'unavailable'
const server_snapshot = () => 'unavailable'

export const toggle_fullscreen = async (copy: AppCopy): Promise<void> => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen()
  } catch (cause) {
    toast.add(localized_error(copy.fullscreen_failed, cause))
  }
}

export const FullscreenButton = ({
  copy,
  icon,
  class_name,
  hotkey,
  title,
}: Readonly<{ copy: AppCopy; icon?: ReactNode; class_name?: string; hotkey?: string; title?: string }>) => {
  const mode = useSyncExternalStore(subscribe, read_fullscreen, server_snapshot)
  if (mode === 'unavailable') return null
  const active = mode === 'fullscreen'
  const label = active ? copy.fullscreen_exit : copy.fullscreen_enter

  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={
        class_name ??
        'grid w-9 shrink-0 cursor-pointer place-items-center border-l border-border text-gold-light transition-colors hover:bg-gold/15 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold'
      }
      data-fullscreen-toggle=""
      onClick={() => void toggle_fullscreen(copy)}
      title={title ?? label}
      type="button"
    >
      {icon ?? (active ? <Minimize aria-hidden="true" size={17} /> : <Maximize aria-hidden="true" size={17} />)}
      {hotkey && <kbd className="aui-key">{hotkey}</kbd>}
    </button>
  )
}
