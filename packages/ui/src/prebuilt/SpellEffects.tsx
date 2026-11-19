// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The spell effect list shared by spell cards and fight tooltips. Callers supply translated
// prose and resolved colours; authoring wraps each displayed part through `field`.

import type { ComponentType, ReactNode } from 'react'

import type { ItemSheetField } from './ItemSheet.tsx'

/** A glyph component, such as a Lucide icon. The sheet owns its size. */
export type SpellGlyph = ComponentType<Readonly<{ size?: number; strokeWidth?: number; className?: string }>>

export type SpellEffectIcon =
  | Readonly<{ kind: 'art'; src: string; title: string }>
  | Readonly<{ kind: 'glyph'; glyph: SpellGlyph; color: string; title: string }>
  | Readonly<{ kind: 'dot'; color: string }>

/** A 5×5 area pictogram. Without a mask the shape name stands alone. */
export type SpellArea = Readonly<{ label: string; size: number; mask: readonly string[] | null }>
export type SpellCritical = Readonly<{ label: string; value?: string }>

/** A player-facing effect line. */
export type SpellEffectRead = Readonly<{
  kind: 'read'
  key: string
  icon: SpellEffectIcon
  pre: string
  value: string | null
  tone: string
  post: string
  area: SpellArea | null
  target: string | null
  turns: string | null
  chance: number | null
  critical: SpellCritical | null
}>

/** An authoring line: every part is a separately editable word. */
export type SpellEffectDraft = Readonly<{
  kind: 'draft'
  key: string
  icon: SpellEffectIcon
  action: string
  amount: Readonly<{ text: string; color: string }> | null
  stat: string | null
  suffix: string | null
  area: SpellArea | null
  target: string | null
  duration: Readonly<{ text: string; active: boolean }> | null
  chance: string
  critical: SpellCritical | null
}>

export type SpellEffectView = SpellEffectRead | SpellEffectDraft

export type SpellEffectListProps = Readonly<{
  rows: readonly SpellEffectView[]
  compact?: boolean
  field?: ItemSheetField
  /** Trailing controls of one authoring line. */
  row_action?: (key: string) => ReactNode
  footer?: ReactNode
}>

/** Read-only surfaces show each part as it is. */
export const plain_field: ItemSheetField = ({ display }) => display

export const SpellEffectIcon = ({ icon }: Readonly<{ icon: SpellEffectIcon }>) => {
  switch (icon.kind) {
    case 'art':
      return <img alt="" className="aui-spell-effect-art" src={icon.src} title={icon.title} />
    case 'glyph': {
      const Glyph = icon.glyph
      return (
        <span className="aui-spell-effect-glyph" style={{ color: icon.color }} title={icon.title}>
          <Glyph size={15} strokeWidth={1.6} />
        </span>
      )
    }
    case 'dot':
      return <span aria-hidden="true" className="aui-spell-effect-dot" style={{ backgroundColor: icon.color }} />
  }
}

export const SpellAreaGlyph = ({ area }: Readonly<{ area: SpellArea }>) =>
  area.mask ? (
    <span className="aui-spell-area" title={area.label}>
      <span aria-hidden="true" className="aui-spell-area-grid">
        {area.mask.flatMap((row, row_index) =>
          [...row].map((cell, column_index) => (
            <span
              className={cell === '1' ? 'aui-spell-area-cell aui-spell-area-on' : 'aui-spell-area-cell'}
              key={`${column_index}:${row_index}`}
            />
          ))
        )}
      </span>
      <span className="aui-spell-area-size">{area.size}</span>
    </span>
  ) : (
    <span className="aui-spell-area-label">{area.label}</span>
  )

const SpellCriticalBadge = ({ label, value }: SpellCritical) => (
  <span className="aui-spell-critical" data-spell-critical-badge>
    <span className="aui-spell-critical-label">{label}</span>
    {value && <span className="aui-spell-critical-value">{value}</span>}
  </span>
)

const ReadRow = ({ row }: Readonly<{ row: SpellEffectRead }>) => (
  <div className="aui-spell-effect" data-spell-effect-row>
    <SpellEffectIcon icon={row.icon} />
    <span className="aui-spell-prose">
      {row.pre}
      {row.value !== null && <b style={{ color: row.tone }}>{row.value}</b>}
      {row.post}
    </span>
    {row.area && <SpellAreaGlyph area={row.area} />}
    {row.target && (
      <span className="aui-spell-note" data-spell-effect-target>
        ({row.target})
      </span>
    )}
    {row.turns !== null && <span className="aui-spell-turns">{row.turns}</span>}
    {row.chance !== null && <span className="aui-spell-note">· {row.chance}%</span>}
    {row.critical && <SpellCriticalBadge {...row.critical} />}
  </div>
)

const DraftWords = ({ row, field }: Readonly<{ row: SpellEffectDraft; field: ItemSheetField }>) => (
  <span className="aui-spell-words">
    {field({ slot: `${row.key}:kind`, display: row.action })}
    {row.amount &&
      field({
        slot: `${row.key}:power`,
        class_name: 'aui-spell-amount',
        display: <span style={{ color: row.amount.color }}>{row.amount.text}</span>,
      })}
    {row.stat !== null && field({ slot: `${row.key}:stat`, display: row.stat })}
    {row.suffix !== null && field({ slot: `${row.key}:suffix`, display: row.suffix })}
  </span>
)

const DraftRow = ({
  row,
  field,
  action,
}: Readonly<{ row: SpellEffectDraft; field: ItemSheetField; action: ReactNode }>) => (
  <div className="aui-spell-effect">
    {field({ slot: `${row.key}:element`, display: <SpellEffectIcon icon={row.icon} /> })}
    <DraftWords field={field} row={row} />
    {row.area && field({ slot: `${row.key}:area`, display: <SpellAreaGlyph area={row.area} /> })}
    {row.target !== null && field({ slot: `${row.key}:target`, class_name: 'aui-spell-note', display: row.target })}
    {row.duration &&
      field({
        slot: `${row.key}:duration`,
        class_name: row.duration.active ? 'aui-spell-turns' : 'aui-spell-turns aui-spell-turns-idle',
        display: row.duration.text,
      })}
    {field({ slot: `${row.key}:chance`, class_name: 'aui-spell-note', display: row.chance })}
    {row.critical && field({ slot: `${row.key}:critical`, display: <SpellCriticalBadge {...row.critical} /> })}
    {action}
  </div>
)

export const SpellEffectList = ({
  rows,
  compact = false,
  field = plain_field,
  row_action,
  footer,
}: SpellEffectListProps) => (
  <div
    className={compact ? 'aui-spell-effects aui-spell-effects-compact' : 'aui-spell-effects'}
    {...(compact ? { 'data-spell-effects-compact': '' } : {})}
  >
    {rows.map((row) =>
      row.kind === 'read' ? (
        <ReadRow key={row.key} row={row} />
      ) : (
        <DraftRow action={row_action?.(row.key)} field={field} key={row.key} row={row} />
      )
    )}
    {footer}
  </div>
)
