// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type SelectionPoint = Readonly<{ x: number; y: number }>
export type SelectionCell = Readonly<{ id: string; left: number; top: number; width: number; height: number }>

export const point_inside = (
  point: SelectionPoint,
  bounds: Readonly<{ left: number; top: number; width: number; height: number }>
): boolean =>
  point.x >= bounds.left &&
  point.x <= bounds.left + bounds.width &&
  point.y >= bounds.top &&
  point.y <= bounds.top + bounds.height

const axis_interval = (from: number, to: number, minimum: number, maximum: number): readonly [number, number] => {
  if (from === to) return from >= minimum && from <= maximum ? [-Infinity, Infinity] : [Infinity, -Infinity]
  const first = (minimum - from) / (to - from),
    last = (maximum - from) / (to - from)
  return [Math.min(first, last), Math.max(first, last)]
}

/** Segment intersection catches crossed cells even when a fast pointer skips intermediate events. */
export const stroke_selection = (
  from: SelectionPoint,
  to: SelectionPoint,
  cells: readonly SelectionCell[],
  selected: readonly string[]
): readonly string[] => [
  ...new Set([
    ...selected,
    ...cells
      .filter((cell) => {
        const [x_start, x_end] = axis_interval(from.x, to.x, cell.left, cell.left + cell.width)
        const [y_start, y_end] = axis_interval(from.y, to.y, cell.top, cell.top + cell.height)
        return Math.max(0, x_start, y_start) <= Math.min(1, x_end, y_end)
      })
      .map(({ id }) => id),
  ]),
]

export const selection_edge_speed = (position: number, size: number): number => {
  const edge = 24
  if (position < edge) return -Math.min(12, (edge - position) / 2)
  if (position > size - edge) return Math.min(12, (position - size + edge) / 2)
  return 0
}
