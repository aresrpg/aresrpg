import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

// embed_voxel owns a browser-flavoured dependency graph. Patch only the import-time surface; this test drives
// the pure lifecycle verdict and deliberately avoids process-global mock.module stubs.
const restore_browser_globals = install_browser_globals()

const { should_reuse_pending_session } = await import('./embed_voxel.js')

afterAll(restore_browser_globals)

describe('pending voxel session identity', () => {
  test('world A cannot be reused by an immediate world B mount', () => {
    expect(should_reuse_pending_session('0xWORLD_A', '0xWORLD_B')).toBe(false)
  })

  test('an immediate same-world remount preserves the reuse fast path', () => {
    expect(should_reuse_pending_session('0xWORLD_A', '0xWORLD_A')).toBe(true)
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
