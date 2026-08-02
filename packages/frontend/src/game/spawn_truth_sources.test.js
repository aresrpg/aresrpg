// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #596 SPAWN-TRUTH CONSOLIDATION — the source-shape gate. The disease was map, compass, 3-D world markers, and
// engage each reading its OWN spawn source (the map a renderer-published `use_world_spawns` copy; the compass a
// private `zone_rows_v1` fetch), so they disagreed after a refresh (consumed groups lingering) and after a paid
// search (revealed groups the world couldn't reach). The cure is ONE store (spawns_adapter → @aresrpg/world
// spawns_zones) with pure projections (spawn_markers / spawn_rows / engage_candidates). These lock the private
// homes as DELETED and every surface as a reader of the one store — since the consumer wiring lives in React
// effects/closures a fold test can't reach, the shape is the honest artifact.

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('#596 — the private spawn-source homes are deleted', () => {
  test('the renderer-published minimap store (world_spawns_store.js) no longer exists', () => {
    expect(existsSync(new URL('./world_spawns_store.js', import.meta.url))).toBe(false)
  })

  test('nothing imports the deleted use_world_spawns copy store', () => {
    for (const rel of [
      './world_spawns.js',
      './screens/hud/Minimap.jsx',
      './screens/hud/MinimapModal.jsx',
    ]) {
      const src = read(rel)
      expect(src, `${rel} must not read the deleted use_world_spawns`).not.toContain('use_world_spawns')
      expect(src, `${rel} must not import world_spawns_store`).not.toContain('world_spawns_store')
    }
  })
})

describe('#596 — every surface projects from the ONE store', () => {
  test('the big map + minimap plot spawn_markers off the spawns store', () => {
    for (const rel of ['./screens/hud/Minimap.jsx', './screens/hud/MinimapModal.jsx']) {
      const src = read(rel)
      expect(src, `${rel} reads the spawns adapter`).toContain('spawns_adapter')
      expect(src, `${rel} projects spawn_markers`).toContain('spawn_markers')
    }
  })

  test('the compass reads spawn_markers from the store, never its own zone_rows_v1 fetch', () => {
    const src = read('./screens/hud/world/CompassStrip.jsx')
    expect(src, 'the private per-zone spawn fetch is gone').not.toContain('zone_rows_v1')
    expect(src, 'the compass plots the shared marker projection').toContain('spawn_markers')
  })

  test('the renderer feeds resolved templates back through the reducer door (map/hover names as data)', () => {
    const src = read('./world_spawns.js')
    expect(src, 'template reads re-enter as inputs, not a private cache the map cannot see').toContain(
      "type: 'template_resolved'"
    )
    expect(src, 'the render-published minimap copy (publish_spawns) is gone').not.toContain('publish_spawns')
  })
})

// #2007 — THE WORLD TOKEN HAS ONE WRITER. The spawns core's `world_id` is the character↔world binding, ferried
// by the binding adapter. The renderer poll was a SECOND writer of the same token (a null on any beat it read
// no world, a re-bind whenever the core disagreed with it), so a cadence tick could reset the core underneath a
// travel the binding never authorized. A poll that disagrees with the token now REJECTS the beat instead.
describe('#2007 — only the binding adapter issues the spawns world token', () => {
  test('the renderer poll never issues world_bound', () => {
    const src = read('./world_spawns.js')
    expect(src, 'the renderer must not write the world token').not.toContain("type: 'world_bound'")
  })

  test('the binding adapter is still the writer, driven by the session gate', () => {
    const src = read('../world-shell/spawns_adapter.js')
    expect(src, 'the ferry owns the token').toContain("type: 'world_bound'")
    expect(src, 'and it is driven by the one binding book').toContain('use_world_binding.subscribe')
  })
})
