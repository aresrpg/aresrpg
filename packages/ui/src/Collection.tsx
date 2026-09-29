// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, type ReactNode } from 'react'

import { Button } from './controls.tsx'
export type CollectionEntry = Readonly<{
  id: string
  label: string
  icon?: ReactNode
  image?: string
  meta?: string
  badge?: string
  muted?: boolean
}>
export const CollectionTile = ({
  entry,
  selected,
  on_select,
  className = '',
}: Readonly<{ entry: CollectionEntry; selected?: boolean; on_select: () => void; className?: string }>) => {
  const [failed_src, set_failed_src] = useState<string | null>(null)
  const show_image = entry.image && failed_src !== entry.image
  return (
    <Button
      className={`aui-collection-tile ${className}`}
      aria-pressed={selected}
      title={entry.label}
      onClick={on_select}
      data-muted={entry.muted}
    >
      {entry.icon}
      {show_image ? (
        <img src={entry.image} alt="" loading="lazy" decoding="async" onError={() => set_failed_src(entry.image!)} />
      ) : (
        !entry.icon && (
          <span className="aui-collection-glyph" aria-hidden="true">
            {entry.label.slice(0, 1)}
          </span>
        )
      )}
      <span className="aui-collection-copy">
        <strong>{entry.label}</strong>
        {entry.meta && <small>{entry.meta}</small>}
      </span>
      {entry.badge && <span className="aui-collection-badge">{entry.badge}</span>}
    </Button>
  )
}
export const Collection = ({
  entries,
  selected,
  select,
  label,
  variant = 'tiles',
}: Readonly<{
  entries: readonly CollectionEntry[]
  selected?: string | null
  select: (id: string) => void
  label: string
  variant?: 'tiles' | 'rows'
}>) => (
  <div className={`aui-collection aui-collection--${variant}`} aria-label={label}>
    {entries.map((entry) => (
      <CollectionTile
        key={entry.id}
        entry={entry}
        selected={selected === entry.id}
        on_select={() => select(entry.id)}
      />
    ))}
  </div>
)
