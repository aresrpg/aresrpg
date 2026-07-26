// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/dev_seams.js — the QA DRIVE SEAMS on the simulator surface (#1025). DEV BUILDS ONLY.
//
// The world registers `__ARES_DEV_CAST` / `__ARES_DEV_CELL_SCREEN` (and their siblings) from GameWorldHud, over
// the board handles `game/embed_voxel_dev.js` publishes for the voxel session. This page has no voxel session,
// so it registered NEITHER: a headless driver on /simulator could not name a cell and could not land a spell —
// every pick was a 3D raycast to pixel-hunt for, at minutes per action (#1012's measurement).
//
// It re-implements NOTHING. The same two modules, the same window names, the same behaviour, so one rig drives
// both surfaces. All this file adds is the three board handles they read — which on the world come from a
// session this page does not have.
//
// THE SEAM IS CLIENT-LOCAL, AND HERE IT CANNOT BE ANYTHING ELSE. `__ARES_DEV_CAST` commits through
// `use_dungeon.commit_turn`, which fight_shim.js seeded with the LOCAL sim submit; this page has no PTB
// composer behind it and is structurally unable to sign a transaction. A cast through the seam is exactly what
// a click could do.
//
// PROD ABSENCE is pinned mechanically, not by this comment: the caller gates on `import.meta.env.DEV` and
// imports this file dynamically (so the whole tree drops), and packages/frontend/scripts/assert_clean_bundle.mjs
// FAILS any built bundle carrying a `__ARES_DEV_` name — CI's bundle-gate leg runs it on every PR (#1006's
// standing ruling: these seams never reach a production bundle).

/**
 * Publish the board handles and register the drive seams. Idempotent (both registrars are).
 * @param {{ engine: any, board: any, canvas: HTMLCanvasElement }} rig
 * @returns {Promise<void>}
 */
export async function register_sim_dev_seams({ engine, board, canvas }) {
  if (typeof window === 'undefined') return
  const w = /** @type {any} */ (window)
  w.__voxel_engine = engine
  w.__voxel_board = board
  // THE CANVAS IS NOT A CONSTANT (engine.js D155/D181). When WebGPU init fails the engine reroutes to the WebGL
  // floor and REPLACES its canvas with a clone — so the node handed in here goes detached moments later and its
  // bounding rect reads 0×0. Every cell would then project onto the same (0,0) pixel and a driver would click
  // the page corner forever. __ARES_DEV_CELL_SCREEN reads this handle for exactly that rect, so it resolves
  // LIVE: the original while it is still mounted, else whatever canvas took its place in the same parent. The
  // parent is captured now, because `replaceWith` leaves the old node parentless.
  const slot = canvas.parentElement
  Object.defineProperty(w, '__voxel_canvas', {
    configurable: true,
    get: () => (canvas.isConnected ? canvas : (slot?.querySelector('canvas') ?? canvas)),
  })
  const [probe, cast] = await Promise.all([import('../game/dev/dev_probe.js'), import('../game/dev/dev_cast.js')])
  probe.register_dev_probe()
  cast.register_dev_cast()
}
