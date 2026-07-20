// World-join physics readiness. A checkpoint/session restore carries x/z only and seeds a provisional Y, so
// readiness can never be inferred from the single voxel at `seed_y - 1`. The streamed column is the truth:
// once its generated-ground chunk is resident, raw ground is available and the analytic collision floor keeps
// every still-unloaded neighbor/support chunk solid until voxel truth arrives.

import { ground_surface_y } from '@aresrpg/engine3/player'

/**
 * Read the resident spawn-column gate and, where it is open ground, resolve the standing Y immediately.
 * A resident forest/water column is still ready: the caller releases physics and lets voxel collision handle
 * the drop/swim while the existing entombment rescue covers a grown-over saved pose.
 * @param {{
 *   spawn: [number, number, number],
 *   is_column_resident: (x:number,z:number) => boolean,
 *   sample_block: (x:number,y:number,z:number) => number,
 * }} args
 * @returns {{ ready: boolean, ground_y: number | null }}
 */
export function read_spawn_column_gate({ spawn, is_column_resident, sample_block }) {
  const x = Math.floor(spawn[0])
  const z = Math.floor(spawn[2])
  if (!is_column_resident(x, z)) return { ready: false, ground_y: null }
  return { ready: true, ground_y: ground_surface_y(sample_block, x, z) }
}
