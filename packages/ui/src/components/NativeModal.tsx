// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'

type CloseDoor = (() => void) | null

const open_dialogs = (document: Readonly<Document>): readonly HTMLDialogElement[] => [
  ...document.querySelectorAll<HTMLDialogElement>('.aui-native-modal[open]'),
]
const sync_modal_backdrops = (document: Readonly<Document>): void => {
  open_dialogs(document).forEach((element, index) => element.toggleAttribute('data-modal-nested', index > 0))
}

export const front_window = (document: Readonly<Document>): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('.aui-native-modal[open],.aui-floating-window:popover-open')]
    .sort((left, right) => Number(left.dataset.windowOrder) - Number(right.dataset.windowOrder))
    .at(-1)

/** Passive consumers follow real browser windows rather than maintaining a second stack. */
export const observe_window_changes = (document: Readonly<Document>, changed: () => void): (() => void) => {
  const observer = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.type === 'attributes' ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element &&
              !!(
                node.matches('dialog, [popover], [aria-modal]') || node.querySelector('dialog, [popover], [aria-modal]')
              )
          )
      )
    )
      changed()
  })
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open', 'aria-modal', 'data-window-order'],
  })
  return () => observer.disconnect()
}

export const active_modal = (document: Readonly<Document>): HTMLDialogElement | undefined =>
  [...document.querySelectorAll<HTMLDialogElement>('.aui-native-modal[open]')]
    .sort((left, right) => Number(left.dataset.windowOrder) - Number(right.dataset.windowOrder))
    .at(-1)

const mark_front = (element: Readonly<HTMLElement>): void =>
  element.setAttribute(
    'data-window-order',
    String(Number(front_window(element.ownerDocument)?.dataset.windowOrder ?? 0) + 1)
  )

/** Vendor DOM modals cannot receive input underneath a native top-layer modal. Keep the
 * React windows mounted while lending modality, then restore surviving windows below any
 * newer native dialog. The DOM remains the window registry; no application state is copied. */
export const suspend_native_modals = (document: Readonly<Document>): (() => void) => {
  const suspended = [...open_dialogs(document)].sort(
    (a, b) => Number(a.dataset.windowOrder) - Number(b.dataset.windowOrder)
  )
  const previous_focus = document.activeElement
  ;[...suspended].reverse().forEach((element) => element.close())
  sync_modal_backdrops(document)
  return () => {
    const active = [...open_dialogs(document)].sort(
      (a, b) => Number(a.dataset.windowOrder) - Number(b.dataset.windowOrder)
    )
    const focus = active.length ? document.activeElement : previous_focus
    const restore = [...suspended.filter((element) => element.isConnected && !element.open), ...active]
    ;[...active].reverse().forEach((element) => element.close())
    restore.forEach((element) => {
      mark_front(element)
      element.showModal()
    })
    sync_modal_backdrops(document)
    if (focus instanceof HTMLElement && restore.at(-1)?.contains(focus)) focus.focus({ preventScroll: true })
  }
}

export const show_floating_window = (element: Readonly<HTMLElement>): void => {
  if (element.matches(':popover-open')) element.hidePopover()
  mark_front(element)
  element.showPopover()
  element.focus({ preventScroll: true })
}

/** Browser top-layer order and DOM order stay together; no second modal registry is retained. */
export const focus_modal = (identity: string): boolean => {
  if (typeof document === 'undefined') return false
  const target = Array.from(document.querySelectorAll<HTMLElement>('[data-modal-identity]')).find(
    (element) =>
      element.dataset.modalIdentity === identity && element.closest('dialog[open],.aui-floating-window:popover-open')
  )
  const floating = target?.closest<HTMLElement>('.aui-floating-window')
  if (floating) {
    show_floating_window(floating)
    floating.focus()
    return true
  }
  const existing = target?.closest<HTMLDialogElement>('dialog[open]')
  if (!existing) return false
  existing.close()
  existing.parentElement?.append(existing)
  mark_front(existing)
  existing.showModal()
  sync_modal_backdrops(document)
  existing.focus()
  return true
}

const useModalDialog = () => {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    mark_front(element)
    element.showModal()
    sync_modal_backdrops(element.ownerDocument)
    return () => {
      element.close()
      sync_modal_backdrops(element.ownerDocument)
    }
  }, [])
  return dialog
}

const dismiss_scrim = (event: Readonly<ReactMouseEvent<HTMLDialogElement>>, close: CloseDoor): void => {
  if (
    close &&
    event.target === event.currentTarget &&
    front_window(event.currentTarget.ownerDocument) === event.currentTarget
  )
    close()
}

const mount_modal = (content: Readonly<ReactNode>): ReactNode =>
  typeof document === 'undefined' ? content : createPortal(content, document.body)

/** All modal surfaces share browser focus/top-layer ownership; card visuals stay with their owner. */
export const NativeModal = ({
  children,
  close,
  label,
  className = '',
  identity,
  onClick,
  onKeyDown,
  onClose,
  ...attributes
}: Readonly<
  Omit<ComponentProps<'dialog'>, 'ref' | 'open' | 'onCancel'> & { close: CloseDoor; label: string; identity?: string }
>) => {
  const dialog = useModalDialog()
  const content = (
    <dialog
      {...attributes}
      aria-label={label}
      data-modal-identity={identity}
      onClose={(event) => {
        // React bubbles native close through portals, including lifecycle cleanup. Parent dialogs must not dismiss.
        event.stopPropagation()
        onClose?.(event)
      }}
      onKeyDown={(event) => {
        // Native cancel owns Escape. Portal parents and underlying game shortcuts must not handle it too.
        if (event.key === 'Escape') event.stopPropagation()
        onKeyDown?.(event)
      }}
      className={`aui-native-modal ${className}`}
      onCancel={(event) => {
        // React propagates cancel through portal parents; only the top dialog owns it.
        event.stopPropagation()
        event.preventDefault()
        close?.()
      }}
      onClick={onClick ?? ((event) => dismiss_scrim(event, close))}
      ref={dialog}
      role="dialog"
    >
      {children}
    </dialog>
  )
  return mount_modal(content)
}
