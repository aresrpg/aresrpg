// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ComponentProps, ReactNode } from 'react'

import { Button, IconButton, KeyHint } from './controls.tsx'
import { useWindowDrag } from './useWindowDrag.ts'
import { NativeModal } from './NativeModal.tsx'

export const Panel = ({ className = '', ...props }: Readonly<ComponentProps<'section'>>) => (
  <section {...props} className={`aui-panel ${className}`} />
)

export const GameWindow = ({
  title,
  icon,
  hotkey,
  meta,
  close,
  close_label,
  children,
  className = '',
  draggable = false,
  style,
  ...props
}: Readonly<
  Omit<ComponentProps<'section'>, 'title' | 'draggable'> & {
    title: string
    draggable?: boolean
    icon?: ReactNode
    hotkey?: string
    meta?: ReactNode
    close: (() => void) | null
    close_label: string
    children: ReactNode
  }
>) => {
  const drag = useWindowDrag(draggable)
  return (
    <section
      {...props}
      ref={drag.root}
      style={draggable ? { ...style, translate: `${drag.offset.x}px ${drag.offset.y}px` } : style}
      className={`aui-window ${className}`}
    >
      <header className="aui-window-header" data-draggable={draggable || undefined} {...drag.header}>
        <span className="aui-window-meta">{meta}</span>
        <div className="aui-window-title">
          {icon}
          <h1>{title}</h1>
          {hotkey && <KeyHint>{hotkey}</KeyHint>}
        </div>
        {close && (
          <>
            <IconButton label={close_label} onClick={close} icon={<span aria-hidden="true">×</span>} />
          </>
        )}
      </header>
      {children}
    </section>
  )
}

export const ConfirmDialog = ({
  title,
  confirm_label,
  cancel_label,
  close_label,
  on_confirm,
  on_cancel,
  icon,
  description,
  danger = false,
}: Readonly<{
  title: string
  confirm_label: string
  cancel_label: string
  close_label: string
  on_confirm: () => void
  on_cancel: () => void
  icon?: ReactNode
  description?: string
  danger?: boolean
}>) => (
  <NativeModal close={on_cancel} label={title} className="aui-modal-scrim">
    <GameWindow title={title} close={on_cancel} close_label={close_label} className="aui-confirm" icon={icon}>
      {description && <p className="aui-confirm-description">{description}</p>}
      <div className="aui-confirm-actions">
        <Button tone="primary" onClick={on_cancel}>
          {cancel_label}
        </Button>
        <Button tone={danger ? 'danger' : 'neutral'} onClick={on_confirm}>
          {confirm_label}
        </Button>
      </div>
    </GameWindow>
  </NativeModal>
)
