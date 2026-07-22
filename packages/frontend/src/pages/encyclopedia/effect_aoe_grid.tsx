// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Static spell-card AoE visual. Shape enumeration delegates to the exact sim function the live board hover uses;
// this module only normalizes those cells into a small caster-relative gothic-terminal matrix.

import { get_aoe_cells } from '@aresrpg/sim/spell_targeting'

type OffsetCell = Readonly<{ x: number; y: number }>
type AoeGridCell = Readonly<{ key: string; affected: boolean; caster: boolean }>
export type AoeGridView = Readonly<{
  cells: readonly AoeGridCell[]
  columns: number
  rows: number
  caster_key: string
}>
type AoeMiniGridProps = Readonly<{
  view: AoeGridView | null
  label: string | null
}>

// A stable interior cast pose for the static card. Keeping the caster immediately west of the target makes
// LINE/TBAR/CONE orientation explicit while leaving every shape decision to the sim's canonical function.
const AOE_TARGET = { x: 10, y: 9 } as const
const AOE_CASTER = { x: 9, y: 9 } as const
const AOE_CASTER_OFFSET = { x: AOE_CASTER.x - AOE_TARGET.x, y: AOE_CASTER.y - AOE_TARGET.y } as const

const finite_number = (value: unknown) => {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const cell_key = (cell: OffsetCell) => `${cell.x},${cell.y}`

/**
 * One projected effect -> its compact grid view. The projected row retains the numeric `area_shape_id`; swapping
 * that back into `area_shape` is the only adapter needed by get_aoe_cells. Its returned footprint is also the one
 * AoE gate: zero/one actual cell returns null, so metadata can never claim an area the cast geometry does not have.
 */
export const aoe_grid_view = (effect: Readonly<Record<string, unknown>>): AoeGridView | null => {
  const area_shape_id = finite_number(effect.area_shape_id)
  const area_size = finite_number(effect.area_size)
  if (area_shape_id == null || area_size == null) return null

  const affected_offsets = get_aoe_cells(
    { type: 'UNSUPPORTED', area_shape: area_shape_id, area_size },
    AOE_TARGET,
    AOE_CASTER
  ).map((cell) => ({ x: cell.x - AOE_TARGET.x, y: cell.y - AOE_TARGET.y }))
  if (affected_offsets.length <= 1) return null

  const affected_keys = new Set(affected_offsets.map(cell_key))
  const frame_cells = [...affected_offsets, AOE_CASTER_OFFSET]
  const min_x = Math.min(...frame_cells.map((cell) => cell.x))
  const max_x = Math.max(...frame_cells.map((cell) => cell.x))
  const min_y = Math.min(...frame_cells.map((cell) => cell.y))
  const max_y = Math.max(...frame_cells.map((cell) => cell.y))
  const columns = max_x - min_x + 1
  const rows = max_y - min_y + 1
  const caster_key = cell_key(AOE_CASTER_OFFSET)
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const key = cell_key({ x: min_x + (index % columns), y: min_y + Math.floor(index / columns) })
    return { key, affected: affected_keys.has(key), caster: key === caster_key }
  })

  return { cells, columns, rows, caster_key }
}

export function AoeMiniGrid({ view, label }: AoeMiniGridProps) {
  if (!view) return null
  const cell_size = Math.max(view.columns, view.rows) > 10 ? 2 : 6

  return (
    <div
      className="shrink-0 p-1 border border-border font-mono"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${view.columns}, ${cell_size}px)`,
        gap: 1,
        background: 'rgba(0,0,0,0.2)',
      }}
      role={label ? 'img' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      data-aoe-grid="true"
      data-aoe-caster={view.caster_key}
    >
      {view.cells.map((cell) => (
        <span
          key={cell.key}
          className="flex items-center justify-center leading-none"
          style={{
            width: cell_size,
            height: cell_size,
            fontSize: cell_size,
            color: cell.affected ? '#09090f' : 'var(--color-gold)',
            background: cell.affected ? 'var(--color-gold)' : 'rgba(255,255,255,0.035)',
            boxShadow: cell.caster ? 'inset 0 0 0 1px var(--color-text)' : 'inset 0 0 0 1px rgba(255,255,255,0.06)',
          }}
          data-aoe-cell={cell.affected ? cell.key : undefined}
          data-aoe-caster-cell={cell.caster ? 'true' : undefined}
          aria-hidden="true"
        >
          {cell.caster && cell_size > 2 ? '◆' : null}
        </span>
      ))}
    </div>
  )
}
