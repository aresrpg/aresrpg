// Live overworld SPAWN SNAPSHOT — the read seam between world_spawns.js (the 3-D rig driver + the SPEC §14
// zone-spawns reader/reconciler) and the HUD minimap overlay. world_spawns.js already fetches + reconciles
// the discovered 3×3 zone neighbourhood's mob GROUPS + resource NODES (event-fresh: the search fast-path tops
// it up chain-direct on cert); this store just PUBLISHES that reconciled set as flat rows the minimap can plot,
// so there is no second poll (the "reused, never a second loop" law). Written on every reconcile / search
// merge / template-name resolve; read by Minimap + MinimapModal. Anchors are the CHAIN row (x,z) world-space
// — stable (mobs roam a few blocks around it; the compass/claim use the same anchor).
//
// One home per fact: positions/ids come from world_spawns.js's `entries`; nothing here fetches or decodes.

import { create } from 'zustand'

/**
 * @typedef {object} SpawnMarker
 * @property {string} key stable entry key `zx:zy:kind:spawn_id`
 * @property {'mob'|'resource'} kind
 * @property {number} x world-x anchor (blocks, signed world space)
 * @property {number} z world-z anchor
 * @property {string} spawn_id chain spawn id (the marker-click contract id + claim/gather handle)
 * @property {number} zx zone x
 * @property {number} zy zone y
 * @property {string} template_id mob MobTemplate object id (mobs) / resource template id
 * @property {number} [job] resource job id (→ marker kind/letter)
 * @property {number} [tier] resource/mob tier
 * @property {string} [name] resolved display name (mob roster name / resource item name), when known
 * @property {number} [level_min] mob template level band low (when the template read has landed)
 * @property {number} [level_max] mob template level band high
 */

/**
 * @typedef {object} WorldSpawnsState
 * @property {SpawnMarker[]} spawns the current reconciled overworld spawn set (discovered neighbourhood)
 * @property {(spawns: SpawnMarker[]) => void} set_spawns replace the snapshot (world_spawns.js is the one writer)
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<WorldSpawnsState>>} */
export const use_world_spawns = create((set) => ({
  spawns: [],
  set_spawns: (spawns) => set({ spawns }),
}))
