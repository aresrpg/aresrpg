// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The movement paint's ONE candidate-set boundary. Callers decide the presented MP verdict; this pure adapter
// projects that verdict through the sim-owned BFS and returns encoded destinations (start excluded).

import { bfs_reachable } from '@aresrpg/sim/pathfind'

/**
 * @param {{ start: number, movement_points: number, blocked: Set<number> | number[] }} input
 * @returns {number[]}
 */
export const presented_reachable_cells = ({ start, movement_points, blocked }) =>
  bfs_reachable(start, movement_points, blocked)
