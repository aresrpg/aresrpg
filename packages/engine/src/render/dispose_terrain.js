// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [MEMORY perf-③ #1] The terrain renderer holds the world's fixed GPU pools (~221 MB medium base +
// ~78 MB canopy) plus capacity-sized CPU ArrayBuffers, and create_engine roots it on
// window.__terrain_renderer for the bench pool-stats harness. engine.dispose() used to free every
// other subsystem but omit this one, so a scene swap / tier reboot stranded the whole stale renderer
// behind the window hook. This is the single teardown seam that frees it and releases the hook.

/**
 * Free the terrain renderer and release its window diagnostics hook. Idempotent and
 * exception-isolated (dispose_session wraps engine.dispose in a try; a disposer throw must never
 * strand the rest of teardown). The hook is cleared ONLY when it still points at THIS instance — a
 * tier-reboot replacement session may already have installed its own, and an old engine's late
 * teardown must not nuke the live one.
 *
 * @param {{ dispose: () => void } | null | undefined} terrain_renderer
 * @param {Record<string, unknown> | undefined} global_obj  the window (undefined under node/tests)
 */
export function dispose_terrain(terrain_renderer, global_obj) {
  if (!terrain_renderer) return
  try {
    terrain_renderer.dispose()
  } catch (error) {
    console.error('[engine] terrain_renderer.dispose failed', error)
  }
  if (global_obj && global_obj.__terrain_renderer === terrain_renderer) {
    global_obj.__terrain_renderer = undefined
  }
}
