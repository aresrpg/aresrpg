// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT-VIEW CULL — a world-layer remote-player rig must never render on the tactical board (
// screenshot: "the other player model still appear in the middle of the board like if we were in the world and
// it wasn't removed properly" — a peer's WORLD avatar stood mid-board like a ghost). The cull keys on VIEW MODE
// (a fight/dungeon session is LIVE), never on who's fighting — reusing the EXACT signal world_spawns.js already
// veils mobs/resources on for the identical bug class (a 2026-07-15 report: "i'm not supposed to see other mobs
// while in a fight"; 2026-07-19 "gahterable ressource appear above the fight board"): never a bespoke flag,
// one home for "is a WORLD fight active", and never a simulator-session cull.
//
// remote_players.js owns a browser+network dependency graph (a DOM chip layer, a self-contained rAF render
// loop, a real /v1 fetch at construction, THREE avatar/mount/aura creation via @aresrpg/engine3) that a unit
// test has no business booting — house law is pure injection over mock.module (world_checkpoint.test.js's own
// header; kiosk_cap_cache.test.js's "own bun mock.module law"). So this proves the fix at the SAME grain
// embed_voxel_lifecycle.test.js already established one file over: (1) the exported pure predicate behaves
// correctly in isolation, and (2) SOURCE-TEXT assertions pin that the predicate is actually the ONE thing
// wired at every render-output site (avatar body / mount / aura / nameplate) inside the SHARED per-rig loop —
// so a peer who joins mid-fight is caught by the same gate on its very first render pass, never a
// spawn-time-only special case a fresh join could slip through, and there is no second, competing hide path.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

const restore_browser_globals = install_browser_globals()
// MISSING-ARTIFACT (#117): remote_players.js's engine3 avatar/mount/aura graph unconditionally imports
// character_avatar.js — a static import of the absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js.
const { remote_rig_visible } = SENSHI_MALE_GLB_AVAILABLE ? await import('./remote_players.js') : {}
restore_browser_globals()

const source = readFileSync(new URL('./remote_players.js', import.meta.url), 'utf8')

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('remote_rig_visible — fight view owns the board, never a bespoke flag', () => {
  it('fight-view-active input → remote rig hidden (the board-leak repro)', () => {
    expect(remote_rig_visible(true)).toBe(false)
  })

  it('fight exit → restored', () => {
    expect(remote_rig_visible(false)).toBe(true)
  })

  it('keys on the SAME fight-session signal spawn_veil.js already veils mobs/resources on — never a new flag', () => {
    expect(source).toContain('world_fight_active(fight_store.getState())')
  })

  it('wired at every render-output site — avatar body, mount, pet, aura, and nameplate all gate on it', () => {
    expect(source).toContain('r.avatar.object3d.visible = remote_rig_visible(fight_active)')
    expect(source).toContain('r.mount.set_visible(remote_rig_visible(fight_active))')
    expect(source).toContain('r.pet.set_visible(remote_rig_visible(fight_active))') // #553 — public pets
    expect(source).toContain('r.aura.set_active(remote_rig_visible(fight_active))')
    expect(source).toContain('remote_rig_visible(fight_active) && px')
  })

  it('a peer joining mid-fight never mounts a world rig: the gate lives in the SHARED per-rig loop (after ' +
    'spawn_rig), not a spawn-time-only branch a fresh join could skip', () => {
    const loop_start = source.indexOf('for (const [id, r] of rigs)')
    const spawn_call = source.indexOf('spawn_rig(id, entry)')
    const gate_call = source.indexOf('r.avatar.object3d.visible = remote_rig_visible(fight_active)')
    expect(spawn_call).toBeGreaterThan(-1)
    expect(loop_start).toBeGreaterThan(-1)
    expect(gate_call).toBeGreaterThan(-1)
    // spawn happens earlier in the SAME frame_body tick; the gate sits inside the shared per-rig loop that
    // runs for EVERY rig every frame (not inside spawn_rig itself) — a rig created THIS frame still passes
    // through it before the frame is ever painted, exactly like every already-resident rig.
    expect(gate_call).toBeGreaterThan(spawn_call)
    expect(gate_call).toBeGreaterThan(loop_start)
  })
})
