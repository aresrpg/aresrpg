// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/**
 * Resolves the entity standing on a plane-picked board cell. Entity render objects are deliberately
 * absent from this seam: fight pointer targeting is cell-only, regardless of model size or shape.
 *
 * @param {Map<string, { cell?: { x: number, y: number } }>} entities
 * @param {{ x: number, y: number } | null | undefined} cell
 * @returns {string | null}
 */
export function entity_id_at_cell(entities, cell) {
  if (!cell) return null
  for (const [id, entity] of entities) if (entity.cell?.x === cell.x && entity.cell.y === cell.y) return id
  return null
}
