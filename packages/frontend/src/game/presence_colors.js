// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** The material palette carried by a presence render row, or null for the uncustomized all-zero default.
 * Invalid wire values become zero at this render boundary instead of leaking NaN into Three.Color.
 * @param {{ color_1?:unknown, color_2?:unknown, color_3?:unknown } | null | undefined} entry
 * @returns {[number, number, number] | null} */
export function presence_colors(entry) {
  if (!entry) return null
  const colors = [entry.color_1, entry.color_2, entry.color_3].map((value) => {
    const color = Number(value ?? 0)
    return Number.isFinite(color) ? color : 0
  })
  return colors.some(Boolean) ? /** @type {[number, number, number]} */ (colors) : null
}
