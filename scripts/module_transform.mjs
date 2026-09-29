// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** One placement transform owns geometry, ports and decoration. Mirror X before the quarter turn. */
export const module_transform = ({ position, rotation, mirror = false }) => {
  if (![0, 1, 2, 3].includes(rotation)) throw new TypeError('Schematic rotation must be 0..3')
  if (typeof mirror !== 'boolean') throw new TypeError('Schematic mirror must be boolean')
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite))
    throw new TypeError('Invalid schematic position')
  const direction = ([x, y, z]) => {
    const mx = mirror ? -x : x
    return [
      [mx, y, z],
      [-z, y, mx],
      [-mx, y, -z],
      [z, y, -mx],
    ][rotation]
  }
  return {
    direction,
    mirrored: mirror,
    point: (point) => direction(point).map((value, axis) => value + position[axis]),
  }
}
