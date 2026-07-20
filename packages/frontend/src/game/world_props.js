// WORLD PROPS — DISABLED: the bonfire ambience camps were cut, nobody asked to add any.
//
// This module USED to dust the overworld with sparse FlameFX ambience camps (a bonfire brazier + candle
// torches) on a deterministic grid. Cut: scattering bare flames on random terrain with no
// physical fire camp and no scene composition reads as "blue smoke out of nowhere". There is no world-building
// wave that places camps at meaningful anchors (ruins / spawn sites / POIs) yet, so the overworld mounts ZERO
// ambience fixtures. The matching FlameFX bonfire/candle pack scenes are JUSTIFIED-REJECTED in the utilization
// census (scripts/vfx_scene_consumers.json) — paid, kept, but shelved until a real world-building wave.
//
// Kept as a no-op stub (not deleted) because embed_voxel.js still constructs/hides/disposes it — the mount
// site is off-limits. It honours the { set_hidden, count, dispose } contract and places nothing. When camps
// return, they belong in a composed scene (a real fire camp), never bare particles — re-implement here then.

/**
 * No-op overworld ambience placer. Mounts nothing. Honours the lifecycle contract so the
 * embed_voxel call site is unchanged. @param {{ engine: any, get_player_pos: () => ArrayLike<number> }} _args
 * @returns {{ set_hidden: (h:boolean)=>void, count: ()=>number, dispose: ()=>void }}
 */
export function create_world_props(_args) {
  return {
    set_hidden() {},
    count() {
      return 0
    },
    dispose() {},
  }
}
