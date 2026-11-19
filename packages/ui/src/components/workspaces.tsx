// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ReactNode } from 'react'

import { Button } from './controls.tsx'
import { NativeModal } from './NativeModal.tsx'
import { GameWindow } from './surfaces.tsx'

export type WorkspaceHeader = Readonly<{ title: string; icon?: ReactNode; close: () => void; close_label: string }>

/** Feature controllers supply content and actions; one window owns sizing and mobile layout. */
export const Workspace = ({
  title,
  icon,
  close,
  close_label,
  sidebar,
  toolbar,
  footer,
  children,
  className = '',
}: WorkspaceHeader &
  Readonly<{
    sidebar?: ReactNode
    toolbar?: ReactNode
    footer?: ReactNode
    children: ReactNode
    className?: string
  }>) => (
  <NativeModal close={close} label={title} className="aui-modal-scrim">
    <GameWindow
      title={title}
      icon={icon}
      close={close}
      close_label={close_label}
      className={`aui-workspace ${className}`}
    >
      {toolbar && <div className="aui-workspace-toolbar">{toolbar}</div>}
      <div className={`aui-workspace-content${sidebar ? ' aui-workspace-content--split' : ''}`}>
        {sidebar && <aside className="aui-workspace-sidebar">{sidebar}</aside>}
        <div className="aui-workspace-main">{children}</div>
      </div>
      {footer && <footer className="aui-workspace-footer">{footer}</footer>}
    </GameWindow>
  </NativeModal>
)

export const ValueBadge = ({ label, value, icon }: Readonly<{ label: string; value: ReactNode; icon?: ReactNode }>) => (
  <div className="aui-value-badge">
    {icon}
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  </div>
)

export type ChoiceRow = Readonly<{ id: string; label: string; detail?: string; icon?: ReactNode; disabled?: boolean }>
export const ChoiceRail = ({
  rows,
  selected,
  select,
}: Readonly<{ rows: readonly ChoiceRow[]; selected: string; select: (id: string) => void }>) => (
  <div className="aui-choice-rail">
    {rows.map((row) => (
      <Button key={row.id} disabled={row.disabled} aria-pressed={selected === row.id} onClick={() => select(row.id)}>
        {row.icon}
        <span>
          {row.label}
          {row.detail && <small>{row.detail}</small>}
        </span>
      </Button>
    ))}
  </div>
)
