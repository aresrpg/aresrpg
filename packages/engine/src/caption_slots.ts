// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export const CAPTION_ATLAS_SIZE = 2048
export const CAPTION_CELL_WIDTH = 512
export const CAPTION_ROW_HEIGHT = 128
export type CaptionSlot = Readonly<{ column: number; row: number; rows: number }>

/** Four columns of sixteen rows; the first cell reserves the solid-color texel. */
export const create_caption_slots = (size = CAPTION_ATLAS_SIZE) => {
  const columns: number[] = Array.from({ length: size / CAPTION_CELL_WIDTH }, (_, index) => (index === 0 ? 1 : 0))
  const row_count = size / CAPTION_ROW_HEIGHT
  let count = 0
  return {
    allocate: (height: number): CaptionSlot | null => {
      const rows = Math.ceil(height / CAPTION_ROW_HEIGHT)
      if (rows < 1 || rows > row_count) return null
      const mask = (1 << rows) - 1
      for (let column = 0; column < columns.length; column++) {
        for (let row = 0; row <= row_count - rows; row++) {
          const bits = mask << row
          if ((columns[column]! & bits) !== 0) continue
          columns[column] = columns[column]! | bits
          count++
          return { column, row, rows }
        }
      }
      return null
    },
    release: ({ column, row, rows }: CaptionSlot): void => {
      columns[column] = columns[column]! & ~(((1 << rows) - 1) << row)
      count--
    },
    empty: () => count === 0,
  }
}
