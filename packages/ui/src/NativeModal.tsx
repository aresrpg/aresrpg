// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  useContext,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type ComponentProps,
} from 'react'
import { createPortal } from 'react-dom'

import { usePreviewBounds } from './usePreviewBounds.ts'
import { PreviewContext } from './PreviewSurface.tsx'

type CloseDoor = (() => void) | null

const modal_scope = (element: Readonly<Element>): ParentNode =>
  element.closest('.aui-preview-surface') ?? element.ownerDocument
const open_dialogs = (scope: Readonly<ParentNode>): readonly HTMLDialogElement[] =>
  Array.from(scope.querySelectorAll<HTMLDialogElement>('.aui-native-modal[open]')).filter(
    (element) => modal_scope(element) === scope
  )
const sync_modal_backdrops = (scope: Readonly<ParentNode>): void => {
  open_dialogs(scope).forEach((element, index) => element.toggleAttribute('data-modal-nested', index > 0))
}

export const front_window = (document: Readonly<Document>): HTMLElement | undefined =>
  [...document.querySelectorAll<HTMLElement>('.aui-native-modal[open],.aui-floating-window:popover-open')]
    .sort((left, right) => Number(left.dataset.windowOrder) - Number(right.dataset.windowOrder))
    .at(-1)

const mark_front = (element: Readonly<HTMLElement>): void =>
  element.setAttribute(
    'data-window-order',
    String(Number(front_window(element.ownerDocument)?.dataset.windowOrder ?? 0) + 1)
  )

export const show_floating_window = (element: Readonly<HTMLElement>): void => {
  if (element.matches(':popover-open')) element.hidePopover()
  mark_front(element)
  element.showPopover()
  element.focus({ preventScroll: true })
}

/** Browser top-layer order and DOM order stay together; no second modal registry is retained. */
export const focus_modal = (identity: string, from?: Readonly<Element> | null): boolean => {
  if (typeof document === 'undefined') return false
  const scope = from ? modal_scope(from) : document
  const target = Array.from(scope.querySelectorAll<HTMLElement>('[data-modal-identity]')).find(
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
  sync_modal_backdrops(scope)
  existing.focus()
  return true
}

const useModalDialog = (embedded: boolean) => {
  const dialog = useRef<HTMLDialogElement>(null)
  usePreviewBounds(dialog, embedded)
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    const scope = modal_scope(element)
    mark_front(element)
    element.showModal()
    sync_modal_backdrops(scope)
    return () => {
      element.close()
      sync_modal_backdrops(scope)
    }
  }, [embedded])
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
  ...attributes
}: Readonly<
  Omit<ComponentProps<'dialog'>, 'ref' | 'open' | 'onCancel'> & { close: CloseDoor; label: string; identity?: string }
>) => {
  const embedded = useContext(PreviewContext)
  const dialog = useModalDialog(embedded)
  const content = (
    <dialog
      {...attributes}
      aria-label={label}
      data-modal-identity={identity}
      data-preview-dialog={embedded || undefined}
      onKeyDown={onKeyDown}
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
  return embedded ? content : mount_modal(content)
}
