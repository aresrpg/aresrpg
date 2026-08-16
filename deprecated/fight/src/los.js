// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// board #13 (WS-C) — the client's ONE import surface for board math: `@aresrpg/fight/los`.
//
// It implements none of it. The grid vocabulary (dims, encode/decode, in_grid, manhattan), the 4-directional BFS
// and the LOS predicate all have a single home in `@aresrpg/sim` — the deterministic core whose twin is the Move
// contract — and this module re-exports them under the names ~20 client call sites already import (#1536 rows
// 1-3 collapsed a complete second copy of that vocabulary that had grown here). Every name below is verdict-
// identical to `combat_grid.move`, which is what lets the range wash, the drawn path and the click gate agree
// with what `commit_turn` actually allows on-chain.
//
// D75-stride KEYSTONE: the client works in CANONICAL stride-20 everywhere — read_dungeon normalizes every
// inbound chain cell to encode(x,y)=y*20+x (train-3 stride-10 records re-encoded at the boundary), and the
// outbound tx sites translate back. At stride 10 every canonical decode y-doubles = a scrambled board.

// Grid geometry — home: packages/sim/src/combat_grid.js
export { GRID_W, GRID_H, GRID_CELLS, encode, decode, manhattan } from '@aresrpg/sim/combat_grid'

// Line of sight — home: packages/sim/src/visibility.js (`blocks_sight`, the port of Move's `blocks`)
export { los_blocks as losBlocks, line_of_sight as lineOfSight } from '@aresrpg/sim/visibility'

// 4-connected BFS around `blocked` (obstacles ∪ holes ∪ out-of-bounds ∪ occupied fighters — body-blocking); the
// drawn path length IS the MP the commit spends. Home: packages/sim/src/pathfind.js
export { bfs_path_cost as bfsPathCost, bfs_path as bfsPath, bfs_reachable as bfsReachable } from '@aresrpg/sim/pathfind'

/** The ONE board cell→world mapper: arena-local (x,y) → roam world XZ, offset by the board origin, TILE units per
 *  cell. Every world placement (board floor stamp, fighter sprites, start rings, picks, VFX anchors) goes through
 *  THIS — no second copy of `(origin+cell)*TILE` anywhere, so the rendered board + entities can never disagree. */
export function cell_to_world(x, y, ox, oy, tile = 1) {
  return { x: (ox + x) * tile, z: (oy + y) * tile }
}
