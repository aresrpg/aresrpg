// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create } from 'zustand'

import i18n from './i18n'
import { game_log } from './core/log.js'
import { report_error } from './core/report.js'
import { humanize_tx_error } from './game/core/abort_copy.js'

// The fixed app-toast layer overlays the top-right minimap without inheriting its flush-corner rule. It clips
// the transform-based entrance inside a viewport-bounded box, so an entering card can never grow page overflow.
// Position and glass live here so app.tsx's Vite-only graph never has to be imported by the contract tests.
export const TOAST_CONTAINER_CLASS =
  'fixed top-2 right-2 z-50 flex max-h-[calc(100dvh-1rem)] max-w-[min(24rem,calc(100vw-1rem))] flex-col items-end gap-2 overflow-hidden'

export const toast_glass_class =
  'flex flex-col gap-2 p-4 border border-white/10 bg-black/70 backdrop-blur-md rounded-[7px] animate-[slide-in_0.3s_ease-out]'

export function resolve_message(code: string): string {
  const key = `toast.${code}`
  const translated = i18n.t(key)
  // If i18next returns the key itself, it means no translation exists — return the raw code
  return translated !== key ? translated : code
}

interface Toast {
  id: number
  message: string
  type: 'error' | 'info' | 'pending' | 'success'
  action?: { label: string; onClick: () => void }
  persistent?: boolean
}

interface ToastState {
  toasts: Toast[]
  add: (code: string, type?: 'error' | 'info') => void
  add_persistent: (
    message: string,
    type: 'error' | 'info' | 'pending',
    action?: { label: string; onClick: () => void }
  ) => number
  /** Drive a task through a loading toast. A lazy task starts only after the pending state is painted. */
  promise: <T>(
    task: Promise<T> | (() => Promise<T>),
    messages: { pending: string; success?: string; error?: string }
  ) => Promise<T>
  remove: (id: number) => void
}

let next_id = 0

export const use_toast = create<ToastState>((set, get) => ({
  toasts: [],
  add: (code, type = 'error') => {
    const id = next_id++
    const message = type === 'error' ? resolve_message(code) : code
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000)
  },
  add_persistent: (message, type, action) => {
    const id = next_id++
    set((s) => ({ toasts: [...s.toasts, { id, message, type, action, persistent: true }] }))
    return id
  },
  promise: async (task, messages) => {
    const id = next_id++
    set((s) => ({ toasts: [...s.toasts, { id, message: messages.pending, type: 'pending', persistent: true }] }))
    try {
      // A user-intent caller passes a thunk when preflight/compose work must not outrun its visible feedback.
      // Invoke it synchronously after the state write: submit still starts before same-turn presentation.
      const result = await (typeof task === 'function' ? task() : task)
      // ONE toast per action, gamer lifecycle — "Doing thing…" → the SAME toast morphs to a
      // brief CHECKMARK beat → auto-dismiss. Never a second stacked toast, never "confirmed" dev-speak.
      // D57a still holds: success ABSENT = the UI transition is the feedback; the pending toast just resolves away.
      if (messages.success) {
        set((s) => ({
          toasts: s.toasts.map((t) =>
            t.id === id ? { ...t, type: 'success' as const, message: messages.success!, persistent: false } : t
          ),
        }))
        setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 1400)
      } else {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }
      return result
    } catch (e) {
      // a failure toast must NEVER swallow the raw error — the FULL abort (Move ModuleId/
      // function/code lives on `.cause`) is reported to Sentry alongside every tx toast, app-wide. This is
      // the SAFETY-NET report home for toast-driven flows that don't ride the run_tx choke (create character,
      // sponsored joins); run_tx failures arriving here were already reported there (report_error dedupes
      // per error object, so this can never double-send).
      game_log('tx', 'failed:', e)
      report_error(e, { area: 'toast', action: messages.pending })
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      // NO-JARGON LAW (a raw "Unable to perform gas selection…" blob once reached a fight-start
      // toast through THIS line): the fallback routes through the ONE shared decoder, never the raw message.
      get().add(messages.error ?? humanize_tx_error(e), 'error')
      throw e
    }
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
