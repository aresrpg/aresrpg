// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type BoardPointer = Readonly<{ id: number; x: number; y: number; dragged: boolean }>
export const move_board_pointer = (pointer: BoardPointer, id: number, x: number, y: number): BoardPointer =>
  pointer.id !== id ? pointer : { ...pointer, dragged: pointer.dragged || Math.hypot(x - pointer.x, y - pointer.y) > 8 }

/** Dragging past the threshold remains a drag even when the finger returns to its origin. */
export const board_pointer_taps = (pointer: BoardPointer | null, id: number, x: number, y: number): boolean =>
  !!pointer && pointer.id === id && !move_board_pointer(pointer, id, x, y).dragged
