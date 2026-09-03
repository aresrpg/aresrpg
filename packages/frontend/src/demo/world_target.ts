// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const demo_world_coordinate = (target: string): readonly [number, number] | null => {
  const coordinates = target.split(',').map(Number)
  return coordinates.length === 2 && coordinates.every(Number.isFinite)
    ? Object.freeze([coordinates[0]!, coordinates[1]!] as const)
    : null
}
