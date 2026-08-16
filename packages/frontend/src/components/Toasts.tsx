// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useState } from 'react'

import { TOAST_CONTAINER_CLASS, toast as toast_api, toast_glass_class, type Toast } from '../toast.ts'

export const Toasts = () => {
  const [toasts, set_toasts] = useState<readonly Toast[]>([])
  useEffect(
    () =>
      toast_api.subscribe((event) =>
        set_toasts((current) =>
          event.type === 'remove'
            ? current.filter(({ id }) => id !== event.id)
            : Object.freeze([...current.filter(({ id }) => id !== event.toast.id), event.toast])
        )
      ),
    []
  )
  if (toasts.length === 0) return null
  return (
    <aside className={TOAST_CONTAINER_CLASS}>
      {toasts.map((toast) => (
        <div
          className={`${toast_glass_class} ${
            toast.type === 'error'
              ? 'text-red-400'
              : toast.type === 'pending'
                ? 'text-[#f5d0a9]'
                : toast.type === 'success'
                  ? 'text-emerald-400'
                  : 'text-[#4de3ff]'
          }`}
          key={toast.id}
        >
          <div className="flex min-w-0 items-start gap-3">
            {toast.type === 'pending' && (
              <span className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-[#c8963c]/30 border-t-[#c8963c]" />
            )}
            {toast.type === 'success' && <span className="mt-0.5 shrink-0 text-[13px] leading-none">✓</span>}
            <span className="min-w-0 flex-1 text-[11px] leading-relaxed tracking-wide break-words whitespace-pre-wrap">
              {toast.message}
            </span>
            <button
              className="shrink-0 cursor-pointer text-[10px] opacity-40 transition-opacity hover:opacity-80"
              onClick={() => toast_api.remove(toast.id)}
              type="button"
            >
              &#10005;
            </button>
          </div>
          {toast.action && (
            <button
              className="w-full cursor-pointer border border-[#c8963c]/45 px-3 py-2 font-mono text-[9px] leading-relaxed font-semibold tracking-[0.15em] text-[#c8963c] uppercase hover:border-[#c8963c] hover:bg-[#c8963c]/10"
              onClick={toast.action.onClick}
              type="button"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </aside>
  )
}
