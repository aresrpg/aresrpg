// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [MEMORY perf-③ #1] Engine teardown MUST free the terrain renderer and release its window
// diagnostics hook, or window.__terrain_renderer pins the full fixed-pool renderer (~299 MB of GPU
// pools + capacity-sized CPU ArrayBuffers) across every scene swap / tier reboot. dispose_terrain is
// the seam create_engine.dispose() rides; these drive it against a REAL create_terrain_renderer and a
// fake window so the teardown is provable headlessly (no GPU, no browser).
//
// RED at HEAD: the module does not exist — the free-and-clear behavior is absent from teardown, which
// is exactly the reported leak (engine.dispose omits terrain_renderer.dispose()).

import { describe, expect, test } from 'bun:test'
import { Scene } from 'three'

import { create_terrain_renderer } from './pool_renderer.js'
import { dispose_terrain } from './dispose_terrain.js'

/** @param {Scene} scene */
const make = (scene) => create_terrain_renderer({ renderer: null, scene, camera: null })
const mesh_count = (/** @type {Scene} */ scene) => {
  let n = 0
  scene.traverse((o) => {
    if (/** @type {{isMesh?: boolean}} */ (o).isMesh) n += 1
  })
  return n
}

describe('dispose_terrain — engine teardown frees the terrain renderer + clears the window hook', () => {
  test('disposes the REAL renderer (scene meshes detached) and clears the hook when it points at this instance', () => {
    const scene = new Scene()
    const terrain = make(scene)
    const win = { __terrain_renderer: terrain }
    expect(mesh_count(scene)).toBe(6) // solid/foliage/cutout/canopy/liquid pools + foliage's scene_depth_mesh

    dispose_terrain(terrain, win)

    expect(mesh_count(scene)).toBe(0) // real GPU-side teardown ran through the seam
    expect(win.__terrain_renderer).toBeUndefined() // the diagnostics root is released
  })

  test('leaves the hook untouched when it already points at a DIFFERENT (replacement) instance', () => {
    // Tier-reboot ordering: an old engine.dispose() must never nuke the hook a newer engine installed.
    const replacement = {}
    const win = { __terrain_renderer: replacement }
    const scene = new Scene()
    dispose_terrain(make(scene), win)
    expect(win.__terrain_renderer).toBe(replacement)
  })

  test('is idempotent + exception-isolated: a second call and a throwing disposer never strand teardown', () => {
    const scene = new Scene()
    const terrain = make(scene)
    const win = { __terrain_renderer: terrain }
    expect(() => {
      dispose_terrain(terrain, win)
      dispose_terrain(terrain, win) // double teardown (dispose_session wraps engine.dispose in a try)
    }).not.toThrow()
    expect(() =>
      dispose_terrain(
        {
          dispose: () => {
            throw new Error('boom')
          },
        },
        win
      )
    ).not.toThrow()
  })

  test('no-ops safely on a null renderer and an undefined global (node/tests have no window)', () => {
    expect(() => dispose_terrain(null, undefined)).not.toThrow()
    expect(() => dispose_terrain(undefined, { __terrain_renderer: undefined })).not.toThrow()
  })

  test('RE-INIT GUARD: after teardown a FRESH renderer mounts and functions (no leak-for-crash trade)', () => {
    const scene = new Scene()
    dispose_terrain(make(scene), { __terrain_renderer: null })
    // Next scene mount builds a brand-new renderer — must construct, upload, and report cleanly.
    const scene2 = new Scene()
    const next = make(scene2)
    expect(mesh_count(scene2)).toBe(6)
    // one solid grass-top quad (x=y=z=0,w=h=32,face=2,block=3) in the frozen 8-byte wire format
    const word_a = ((31 << 18) | (31 << 23) | (2 << 28)) >>> 0
    const word_b = (3 | (15 << 12) | (0xff << 20)) >>> 0
    next.upload_chunk([0, 0, 0], new Uint32Array([word_a, word_b]), 1)
    expect(next.get_stats().chunk_count).toBe(1)
    next.dispose()
    // 30s timeout (#580/#641): this test builds TWO full renderers (the disposed one + the re-init
    // one), each an atlas bake + quad-pool alloc — the default 5s flakes under full-suite/CI-runner
    // load while passing isolated (same class as column_gen.test.js's documented 15s precedent).
  }, 30000)
})
