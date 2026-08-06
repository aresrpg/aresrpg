// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (#1368) — the renderer rebuild guard was the THIRD reading of "a session holds the body".
//
// The copied guard also grew one term the canonical session projection does not have: a hydrated `dungeon`
// document by itself blocked a renderer rebuild even when no run/fight lifecycle identifier held the body.
// This suite makes that divergence constructible and pins the renderer to the one projection instead.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import * as position_edge from '../../src/world-shell/spawns_adapter.js'

const source = readFileSync(new URL('../../src/game/embed_voxel.js', import.meta.url), 'utf8')
const reboot_source = source.slice(
  source.indexOf('export function reboot_voxel_session_tier'),
  source.indexOf('export function mount_voxel_scene')
)

describe('#1368 — the renderer-rebuild guard has one body predicate home', () => {
  test('the session leaf projection owns the lifecycle vocabulary', () => {
    expect(typeof position_edge.session_holds_the_body).toBe('function')
    for (const phase of [
      { in_session: true },
      { run_pass_id: '0xpass' },
      { dungeon_id: '0xdungeon' },
      { fight_id: '0xfight' },
    ])
      expect(position_edge.session_holds_the_body(phase)).toBe(true)

    // A fetched document is not a lifecycle proof. The old renderer copy uniquely answered true here.
    expect(position_edge.session_holds_the_body({ dungeon: { id: 'cached-doc' } })).toBe(false)
  })

  test('reboot_voxel_session_tier derives from that projection instead of naming its terms', () => {
    expect(reboot_source).toContain('session_holds_the_body(dungeon)')
    for (const term of ['in_session', 'run_pass_id', 'dungeon', 'dungeon_id', 'fight_id'])
      expect(reboot_source).not.toContain(`dungeon.${term}`)
  })
})
