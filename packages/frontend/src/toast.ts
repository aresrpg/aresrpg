import { create } from 'zustand'

import i18n from './i18n'
import { game_log } from './core/log.js'
import { report_error } from './core/report.js'
import { humanize_tx_error } from './game/core/abort_copy.js'

// The fixed toast stack's positioning + width contract, extracted here (its own testable module, mirroring
// version_badge) so the width cap is asserted without importing app.tsx's Vite-virtual graph. Desktop pins the
// stack top-right at a capped width; mobile clamps to the safe-area edges but MUST stay capped too — never a
// full-bleed `max-w-none` (a recurring regression). `max-w-[min(24rem,calc(100vw-2rem))]`
// caps at the house sm width and never overflows a narrow phone.
export const TOAST_CONTAINER_CLASS =
  'fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-[min(24rem,calc(100vw-2rem))] max-lg:top-[max(3rem,var(--safe-top))] max-lg:right-[max(1rem,var(--safe-right))]'

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
  /** Drive a tx through a loading toast: pending(spinner) → success / error. Returns the awaited promise. */
  promise: <T>(p: Promise<T>, messages: { pending: string; success?: string; error?: string }) => Promise<T>
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
  promise: async (p, messages) => {
    const id = next_id++
    set((s) => ({ toasts: [...s.toasts, { id, message: messages.pending, type: 'pending', persistent: true }] }))
    try {
      const result = await p
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
