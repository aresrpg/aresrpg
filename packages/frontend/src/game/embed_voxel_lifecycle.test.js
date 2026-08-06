// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

// embed_voxel owns a browser-flavoured dependency graph. Patch only the import-time surface; this test drives
// the pure lifecycle verdict and deliberately avoids process-global mock.module stubs.
import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'
import { should_reuse_pending_session } from './voxel_session_identity.js'

const restore_browser_globals = install_browser_globals()

// MISSING-ARTIFACT (#117): embed_voxel.js imports @aresrpg/engine3, whose board_entities.js/
// character_controller.js unconditionally import character_avatar.js — a static import of the
// absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js.
const { owns_ambient_music } = SENSHI_MALE_GLB_AVAILABLE ? await import('./embed_voxel.js') : {}

afterAll(restore_browser_globals)

const identity = (mode, world_id, character_id, follow = false) => ({ mode, world_id, character_id, follow })

describe('pending voxel session identity', () => {
  test('world A cannot be reused by an immediate world B mount', () => {
    expect(
      should_reuse_pending_session(
        identity('session', '0xWORLD_A', '0xCHAR_A'),
        identity('session', '0xWORLD_B', '0xCHAR_A')
      )
    ).toBe(false)
  })

  test('an immediate same-world remount preserves the reuse fast path', () => {
    const resident = identity('session', '0xWORLD_A', '0xCHAR_A')
    expect(should_reuse_pending_session(resident, { ...resident })).toBe(true)
  })

  test('a same-world character switch cannot reuse the outgoing avatar/controller session', () => {
    expect(
      should_reuse_pending_session(
        identity('session', '0xWORLD_A', '0xCHAR_A'),
        identity('session', '0xWORLD_A', '0xCHAR_B')
      )
    ).toBe(false)
  })

  test('mode and follow changes cannot reuse a resident session', () => {
    const resident = identity('session', '0xWORLD_A', '0xCHAR_A')
    expect(should_reuse_pending_session(resident, identity('spectate', '0xWORLD_A', null))).toBe(false)
    expect(should_reuse_pending_session(resident, identity('session', '0xWORLD_A', '0xCHAR_A', true))).toBe(false)
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('voxel lifecycle with the engine fixture', () => {
  // ISSUE #17 "double music playback": a follow session must never independently arm ambient_music.js's
  // zone-music channel — follow.ts (src/follow.ts) is its EXCLUSIVE owner while following (it arms the
  // FOLLOWED character's world, which can differ from this session's own bound_world). Before this fix
  // create_session's inline `!spectate && bound_world` gate ignored `follow` entirely, so a follow session
  // ALSO armed its own (potentially different) zone against the SAME ambient_music.js singleton — two
  // owners fighting over one channel.
  test('a normal resident session (not spectate, not follow) owns its zone music', () => {
    expect(owns_ambient_music(false, false, '0xWORLD_A')).toBe(true)
  })
  test('spectate never owns zone music (display-only, OFF-BY-DEFAULT)', () => {
    expect(owns_ambient_music(true, false, '0xWORLD_A')).toBe(false)
  })
  test('follow never owns zone music — the follow store holds that channel exclusively', () => {
    expect(owns_ambient_music(false, true, '0xWORLD_A')).toBe(false)
  })
  test('no bound world means nothing to own regardless of mode', () => {
    expect(owns_ambient_music(false, false, null)).toBe(false)
  })

  test('disposing a resident session stops its world music before the next session arms', () => {
    const source = readFileSync(new URL('./embed_voxel.js', import.meta.url), 'utf8')
    const cleanup = source.match(/const cleanup = \(\) => \{([\s\S]*?)\n\s{2}\}/g)?.at(-1) ?? ''
    expect(cleanup).toContain('stop_zone_music()')
  })

  test('bfcache pagehide suspends before its early return and pageshow resumes', () => {
    const source = readFileSync(new URL('./embed_voxel.js', import.meta.url), 'utf8')
    const pagehide = source.slice(source.indexOf("window.addEventListener('pagehide'"), source.indexOf('// D158/HMR'))
    expect(pagehide).toContain('suspend_zone_music()')
    expect(pagehide.indexOf('suspend_zone_music()')).toBeLessThan(pagehide.indexOf('e.persisted'))
    expect(source).toContain("window.addEventListener('pageshow'")
  })

  test('route pause releases fight-camera input through one scene lifecycle seam', () => {
    const source = readFileSync(new URL('./embed_voxel.js', import.meta.url), 'utf8')
    const pause = source.slice(source.indexOf('const set_frame_paused'), source.indexOf('// FIGHT-ENTRY'))
    expect(pause).toContain('fight_camera.set_paused(paused)')
    expect(source.match(/fight_camera\.set_paused\(paused\)/g)).toHaveLength(1)
  })
})

// UNGATED (no senshi_male.glb needed — pure readFileSync, never imports embed_voxel.js): the GLB-gated
// describe block above still SKIPS entirely on this public repo (SENSHI_MALE_GLB_AVAILABLE is false here),
// so it never actually asserts the fix landed in the shipped source on THIS checkout. Issue #17's real
// regression check needs to run unconditionally — same source-text-extraction idiom as the tests above,
// just outside the gate.
describe('issue #17 — zone-music channel ownership wiring (source-verified, GLB-independent)', () => {
  const source = readFileSync(new URL('./embed_voxel.js', import.meta.url), 'utf8')

  test('create_session receives a follow parameter (no longer a dropped no-op)', () => {
    const signature = source.slice(source.indexOf('function create_session('), source.indexOf(') {', source.indexOf('function create_session(')))
    expect(signature).toContain('follow')
  })

  test('the region-follower creation gates on owns_ambient_music, not a raw follow-blind condition', () => {
    const region_follower_decl = source.slice(
      source.indexOf('const owns_music ='),
      source.indexOf('const region_base_biome =')
    )
    expect(region_follower_decl).toContain('const owns_music = owns_ambient_music(')
    expect(region_follower_decl).toContain('const region_follower = owns_music')
  })

  test('the boot-time zone-music arm gates on owns_ambient_music, not a raw follow-blind condition', () => {
    const boot_arm = source.slice(source.indexOf('const engine = spectate'), source.indexOf('engine.set_zone_bounds'))
    expect(boot_arm).toContain('if (owns_music) set_zone_music(region_base_biome)')
  })

  test('mount_voxel_scene threads follow into create_session instead of voiding it', () => {
    // mount_voxel_scene is the LAST export in the file — slice to EOF, same "known-tail" idiom the other
    // source-text tests in this file use for their own function boundaries.
    const mount_fn = source.slice(source.indexOf('export function mount_voxel_scene'))
    expect(mount_fn).not.toContain('void follow')
    expect(mount_fn).toMatch(/create_session\([^)]*\bfollow\b[^)]*\)/)
  })

  test('a live tier reboot preserves the session\'s own follow flag across recreation', () => {
    const reboot_fn = source.slice(source.indexOf('export function reboot_voxel_session_tier'), source.indexOf('export function mount_voxel_scene'))
    expect(reboot_fn).toMatch(/create_session\([^)]*\bfollow\b[^)]*\)/)
  })

})
