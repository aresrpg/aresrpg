// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Extracted house dialog shell: one scrim and one card; passing no close door makes an operation modal terminal.

/* eslint-disable functional/prefer-immutable-types -- DOM lifecycle boundary. */
import { X } from 'lucide-react'
import { useLayoutEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'

type CloseDoor = (() => void) | null

const useModalDialog = () => {
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    element.showModal()
    return () => {
      element.close()
    }
  }, [])
  return dialog
}

const dismiss_scrim = (event: Readonly<ReactMouseEvent<HTMLDialogElement>>, close: CloseDoor): void => {
  if (close && event.target === event.currentTarget) close()
}

const mount_modal = (content: ReactNode): ReactNode =>
  typeof document === 'undefined' ? content : createPortal(content, document.body)

/** All modal surfaces share browser focus/top-layer ownership; card visuals stay with their owner. */
export const NativeModal = ({
  children,
  close,
  label,
  className = '',
  onClick,
  ...attributes
}: Readonly<Omit<ComponentProps<'dialog'>, 'ref' | 'open' | 'onCancel'> & { close: CloseDoor; label: string }>) => {
  const dialog = useModalDialog()
  return mount_modal(
    <dialog
      {...attributes}
      aria-label={label}
      className={`fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 p-0 text-inherit ${className}`}
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
}

const CloseButton = ({ close, label }: Readonly<{ close: CloseDoor; label: string }>) =>
  close ? (
    <button
      aria-label={label}
      className="absolute top-4 right-4 z-10 cursor-pointer opacity-40 transition-opacity hover:opacity-80"
      onClick={close}
      type="button"
    >
      <X className="text-muted" size={16} />
    </button>
  ) : null

export const ModalFrame = ({
  children,
  close,
  close_label,
  label,
  max_width = 'max-w-md',
  soft = false,
}: Readonly<{
  children: ReactNode
  close: CloseDoor
  close_label: string
  label: string
  max_width?: string
  soft?: boolean
}>) => {
  return (
    <NativeModal
      close={close}
      label={label}
      className="open:flex open:items-center open:justify-center"
      style={{ backgroundColor: soft ? 'rgba(0,0,0,0.68)' : 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className={`relative mx-4 max-h-[90vh] w-full ${max_width} overflow-y-auto ${soft ? 'rounded-xl bg-surface/97' : 'bg-surface'}`}
        style={{
          animation: 'modal-enter 0.3s ease-out',
          border: soft ? '1px solid rgba(200,150,60,0.28)' : '1px solid var(--color-border)',
          borderImage: soft ? undefined : 'linear-gradient(135deg, #c8963c, #8b6914, #f5d0a9) 1',
          boxShadow: soft
            ? '0 22px 70px rgba(0,0,0,0.58), inset 0 1px rgba(255,255,255,0.04)'
            : '0 0 30px rgba(200,150,60,0.12), inset 0 0 30px rgba(200,150,60,0.03)',
        }}
      >
        <CloseButton close={close} label={close_label} />
        {children}
      </div>
    </NativeModal>
  )
}
