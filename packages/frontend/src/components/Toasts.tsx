// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Notifications stay bottom-right across pages. Actions remain inline.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { active_modal, observe_window_changes } from '@aresrpg/ui'

import { TOAST_CONTAINER_CLASS, toast as toast_api, toast_glass_class, type Toast } from '../toast.ts'

const PART_TONE_CLASS = Object.freeze({
  default: '',
  gold: 'text-[#e8b654]',
  primary: 'text-[#e8e4dc]',
  sui: 'text-[#67adff]',
})

const ToastMessage = ({ toast }: Readonly<{ toast: Toast }>) => (
  <span className="min-w-0 flex-1 text-[11px] leading-relaxed tracking-wide break-words whitespace-pre-wrap">
    {toast.parts
      ? toast.parts.map((part, index) => (
          <span className={PART_TONE_CLASS[part.tone]} key={`${index}:${part.text}`}>
            {part.text}
          </span>
        ))
      : toast.message}
  </span>
)

const raise_toasts = (element: Readonly<HTMLElement> | null): void => {
  if (!element?.isConnected) return
  if (element.matches(':popover-open')) element.hidePopover()
  element.showPopover()
}

/** Top-layer rendering handles occlusion; dialog ancestry keeps actions outside the inert page. */
const ToastLayer = ({ children }: Readonly<{ children: ReactNode }>) => {
  const layer = useRef<HTMLElement>(null)
  const [host, set_host] = useState<HTMLElement>(() => active_modal(document) ?? document.body)
  useLayoutEffect(
    () =>
      observe_window_changes(document, () => {
        set_host(active_modal(document) ?? document.body)
        raise_toasts(layer.current)
      }),
    []
  )
  useLayoutEffect(() => {
    const element = layer.current
    raise_toasts(element)
    return () => element?.hidePopover()
  }, [host])
  return createPortal(
    <aside
      ref={layer}
      popover="manual"
      role="status"
      aria-live="polite"
      data-blocking-overlay="false"
      data-toasts=""
      className={`${TOAST_CONTAINER_CLASS} pointer-events-none`}
      style={{
        top: 'auto',
        left: 'auto',
        margin: 0,
        padding: 0,
        border: 0,
        background: 'transparent',
        color: 'inherit',
      }}
    >
      {children}
    </aside>,
    host
  )
}

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
    <ToastLayer>
      {toasts.map((toast) => (
        <div
          className={`${toast_glass_class} pointer-events-auto ${
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
          <div className="flex min-w-0 items-center gap-3">
            {toast.icon ? (
              <img alt="" aria-hidden="true" className="size-8 shrink-0 object-contain" src={toast.icon} />
            ) : toast.type === 'pending' ? (
              <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-[#c8963c]/30 border-t-[#c8963c]" />
            ) : toast.type === 'success' ? (
              <span className="shrink-0 text-[13px] leading-none">✓</span>
            ) : null}
            <ToastMessage toast={toast} />
            {toast.actions?.map((action) => (
              <button
                className="shrink-0 cursor-pointer border border-[#c8963c]/45 px-3 py-1.5 font-mono text-[9px] leading-none font-semibold tracking-[0.15em] text-[#c8963c] uppercase hover:border-[#c8963c] hover:bg-[#c8963c]/10"
                key={action.label}
                onClick={action.onClick}
                type="button"
              >
                {action.label}
              </button>
            ))}
            <button
              className="shrink-0 cursor-pointer text-[10px] opacity-40 transition-opacity hover:opacity-80"
              onClick={() => toast_api.remove(toast.id)}
              type="button"
            >
              &#10005;
            </button>
          </div>
        </div>
      ))}
    </ToastLayer>
  )
}
