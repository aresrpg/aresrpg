// Projects core/modules/presence.js's `visible_characters` Map into minimap marker rows — the SAME
// {x,z,kind,key} shape world_spawns_store.js already feeds the minimap (Minimap.jsx concatenates this with
// its spawn markers; minimap_engine.js's draw_marker dispatches on `kind`, and 'peer' paints a small cyan dot
// — cyan is the house player-dot convention already established by the retired WorldMinimap.jsx: "owner 807:
// dots — you cyan, mobs red"). Distinct from the self marker (the gold player arrow render_oblique always
// draws at centre) by both colour and shape.
//
// Reads `target_position` first — remote_players.js's own precedent for "the peer's REAL broadcast position"
// (used there for its range test), not the local eased render state (that lives per-rig inside
// remote_players.js, never written back to the shared entry) — falling back to `position` (the spawn-time
// seed, presence.js's SPAWN branch). PURE, no React/canvas.
//
// Deliberately NOT memoized by callers: `visible_characters` is a stable Map mutated in place (presence.js's
// header: "never reallocates the Map itself"), so a dependency-array memo keyed on the Map reference would
// never see a peer move. Minimap.jsx re-renders on the throttled player_pose heartbeat (~6/s, embed_voxel_player.js)
// regardless of movement, so calling this fresh every render already tracks peer motion at that cadence for free.

/**
 * @param {Map<string, { position?: {x:number,z:number}, target_position?: {x:number,z:number} }>} visible_characters
 * @returns {Array<{x:number, z:number, kind:'peer', key:string}>}
 */
export function peer_markers(visible_characters) {
  return Array.from(visible_characters, ([key, peer]) => ({ key, pos: peer.target_position ?? peer.position }))
    .filter((row) => row.pos)
    .map(({ key, pos }) => ({ x: pos.x, z: pos.z, kind: 'peer', key }))
}
