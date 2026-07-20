// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-8 owner-bug fix verification (2026-07-03 rate-limit-killed fix-wave resume). Proves the THREE
// landed character-controller fixes on the LIVE render, records a ~15 s .webm + 3 stills:
//   (1) CAMERA PITCH — drag UP (movementY<0) eases toward the horizon (pitch RISES); drag DOWN
//       (movementY>0) tilts top-down (pitch DROPS). Anchor is dir_y=+cos(polar) (eye above the head at
//       the default frame → looks down). Matches the shipped dapp's camera-controls sense.
//   (2) FORWARD — W walks the avatar AWAY from the camera (its back to the eye): the eye→avatar
//       distance GROWS while W is held (it must not shrink, which is the "walks toward the camera" bug),
//       and the avatar faces its travel direction (rotation.y == facing_yaw, no +π flip).
//   (3) SPEED — steady-state run speed sits at the retuned RUN_SPEED (10.5), not the old 13.
//
// Camera rotation is driven through window.__walk.camera.rotate(dx, dy) (pointer lock is blocked under
// automation); dx/dy are in the same pixel units as movementX/Y, so dy<0 == mouse-up.

import { mkdir, writeFile } from 'node:fs/promises'

import { expect } from '@playwright/test'

import { CONTROLLER_CONSTANTS } from '../src/player/controller.js'

import { test, open_recorded_page, settle_stream } from './_shared.js'

const ART = '/tmp/aresrpg-engine-artifacts'
const SHOTS = `${ART}/eng8_fix`

const read_state = (page) => page.evaluate(() => /** @type {any} */ (window).__walk.get_state())
// Authoritative live camera readout from the frozen engine facade: get_stats().camera_yaw_pitch is
// [yaw, pitch] read off the real three camera (fly_camera.apply made it authoritative this frame);
// camera_position is the world eye (rounded to integers — coarse but fine for the large recede delta).
const read_pose = (page) =>
  page.evaluate(() => {
    const w = /** @type {any} */ (window)
    const st = w.__engine.get_stats()
    return {
      pitch: st.camera_yaw_pitch[1],
      eye: st.camera_position,
      yaw: w.__walk.camera.get_yaw(),
      avatar_rot_y: w.__walk.avatar.object3d.rotation.y,
    }
  })

async function enable_walk(page) {
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })))
  await page.waitForFunction(() => /** @type {any} */ (window).__walk?.avatar?.ready === true, null, { timeout: 15000 })
}

async function hold(page, codes, ms) {
  await page.evaluate((cs) => cs.forEach((c) => window.dispatchEvent(new KeyboardEvent('keydown', { code: c }))), codes)
  await page.waitForTimeout(ms)
  await page.evaluate((cs) => cs.forEach((c) => window.dispatchEvent(new KeyboardEvent('keyup', { code: c }))), codes)
}

test.describe('ENG-8 fix verification', () => {
  test('pitch sense, forward-away, speed', async ({ browser }) => {
    test.setTimeout(180000)
    await mkdir(SHOTS, { recursive: true })
    const { page, finish } = await open_recorded_page(browser, 'eng8_fix')
    /** @type {Record<string, unknown>} */
    const report = {
      expected: { RUN_SPEED: CONTROLLER_CONSTANTS.RUN_SPEED, WALK_SPEED: CONTROLLER_CONSTANTS.WALK_SPEED },
    }
    try {
      await page.goto('./?tier=high&seed=aresrpg')
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__engine), null, { timeout: 30000 })
      await settle_stream(page, { min_ms: 4000, deadline_ms: 45000 })
      await enable_walk(page)
      await page.waitForTimeout(1500) // fall + settle onto ground

      // ── aim W into open ground (dense forest may wall the default facing) ──
      const open_yaw = await page.evaluate(() => {
        const eng = /** @type {any} */ (window).__engine
        const [x, y, z] = /** @type {any} */ (window).__walk.get_state().position
        let best = { yaw: 0, clear: -1 }
        for (let k = 0; k < 8; k += 1) {
          const yaw = (k / 8) * Math.PI * 2
          const fx = -Math.sin(yaw)
          const fz = -Math.cos(yaw)
          let clear = 0
          for (let d = 1; d <= 12; d += 1) {
            const ax = Math.floor(x + fx * d)
            const az = Math.floor(z + fz * d)
            if (
              eng.sample_block(ax, Math.floor(y + 0.5), az) === 0 &&
              eng.sample_block(ax, Math.floor(y + 1.3), az) === 0
            )
              clear += 1
            else break
          }
          if (clear > best.clear) best = { yaw, clear }
        }
        return best.yaw
      })
      await page.evaluate((y) => {
        const cam = /** @type {any} */ (window).__walk.camera
        cam.rotate((cam.get_yaw() - y) / 0.0025, 0) // invert ROTATE_SENSITIVITY → pixel delta
      }, open_yaw)
      await page.waitForTimeout(200)
      await page.locator('#canvas').screenshot({ path: `${SHOTS}/01_spawn.png` })

      // ── (2) FORWARD AWAY: capture eye + avatar, hold W, assert the avatar moved AWAY from the eye ──
      // Capture the camera FORWARD (look) direction on XZ + the player position. The shoulder cam
      // FOLLOWS the avatar, so eye→avatar distance stays ~constant — it can't tell toward from away.
      // The follow-independent invariant is DIRECTION: W must move the player along the camera's forward
      // look vector (fwd = (−sin yaw, −cos yaw), the rig/fly convention). dot(displacement, fwd) > 0 ⇒
      // walked the way the camera faces ⇒ AWAY from the eye (the bug walked it the opposite way).
      const cam_fwd = await page.evaluate(() => {
        const [yaw] = /** @type {any} */ (window).__engine.get_stats().camera_yaw_pitch
        return [-Math.sin(yaw), -Math.cos(yaw)]
      })
      const p0 = (await read_state(page)).position
      await hold(page, ['KeyW'], 2600) // ~2.6 s run (part of the 15 s clip)
      const p1 = (await read_state(page)).position
      await page.locator('#canvas').screenshot({ path: `${SHOTS}/02_forward_away.png` })

      const disp = [p1[0] - p0[0], p1[2] - p0[2]]
      const moved = Math.hypot(disp[0], disp[1])
      const along_fwd = (disp[0] * cam_fwd[0] + disp[1] * cam_fwd[1]) / (moved || 1) // cos angle vs look dir
      report.forward = { moved_m: Number(moved.toFixed(2)), along_camera_forward: Number(along_fwd.toFixed(3)) }
      expect(moved).toBeGreaterThan(3) // real locomotion happened
      expect(along_fwd).toBeGreaterThan(0.8) // moved in the camera's look direction ⇒ AWAY from it (fix #2)
      // facing has NO +π flip: the model faces its heading (rotation.y == facing_yaw)
      const face = await page.evaluate(() => {
        const w = /** @type {any} */ (window)
        return { rot_y: w.__walk.avatar.object3d.rotation.y, facing_yaw: w.__walk.get_state().facing_yaw }
      })
      const dyaw = Math.abs(Math.atan2(Math.sin(face.rot_y - face.facing_yaw), Math.cos(face.rot_y - face.facing_yaw)))
      report.forward.facing_matches_heading = dyaw < 1e-3
      expect(dyaw).toBeLessThan(1e-3)

      // ── (3) SPEED: steady run speed == retuned RUN_SPEED (10.5), not the old 13 ──
      // Re-aim into open ground, then hold W and take the PEAK horizontal speed over ~1.5 s (peak =
      // unobstructed steady run; a mid-run wall/ledge only ever lowers a sample, never inflates it).
      await page.evaluate(() => {
        const eng = /** @type {any} */ (window).__engine
        const w = /** @type {any} */ (window)
        const [x, y, z] = w.__walk.get_state().position
        let best = { yaw: 0, clear: -1 }
        for (let k = 0; k < 8; k += 1) {
          const yaw = (k / 8) * Math.PI * 2
          let clear = 0
          for (let d = 1; d <= 14; d += 1) {
            const ax = Math.floor(x - Math.sin(yaw) * d)
            const az = Math.floor(z - Math.cos(yaw) * d)
            if (
              eng.sample_block(ax, Math.floor(y + 0.5), az) === 0 &&
              eng.sample_block(ax, Math.floor(y + 1.3), az) === 0
            )
              clear += 1
            else break
          }
          if (clear > best.clear) best = { yaw, clear }
        }
        w.__walk.camera.rotate((w.__walk.camera.get_yaw() - best.yaw) / 0.0025, 0)
      })
      await page.waitForTimeout(150)
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })))
      let peak = 0
      for (let i = 0; i < 15; i += 1) {
        const s = await read_state(page)
        if (s.on_ground) peak = Math.max(peak, s.speed)
        await page.waitForTimeout(100)
      }
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })))
      report.speed = { peak_run: Number(peak.toFixed(2)), expected: CONTROLLER_CONSTANTS.RUN_SPEED }
      expect(peak).toBeGreaterThan(CONTROLLER_CONSTANTS.RUN_SPEED - 0.8)
      expect(peak).toBeLessThan(CONTROLLER_CONSTANTS.RUN_SPEED + 0.8) // NOT the old 13

      // ── (1) PITCH SENSE: drag DOWN → look top-down (pitch drops); drag UP → toward horizon (rises) ──
      await page.waitForTimeout(300)
      const pitch_level = (await read_pose(page)).pitch
      // drag DOWN (movementY > 0) over a few frames → more top-down
      for (let i = 0; i < 8; i += 1) {
        await page.evaluate(() => /** @type {any} */ (window).__walk.camera.rotate(0, 90))
        await page.waitForTimeout(30)
      }
      await page.waitForTimeout(300)
      const pitch_down = (await read_pose(page)).pitch
      await page.locator('#canvas').screenshot({ path: `${SHOTS}/03_look_down.png` })
      // drag UP (movementY < 0) hard → ease back toward the horizon
      for (let i = 0; i < 16; i += 1) {
        await page.evaluate(() => /** @type {any} */ (window).__walk.camera.rotate(0, -90))
        await page.waitForTimeout(30)
      }
      await page.waitForTimeout(300)
      const pitch_up = (await read_pose(page)).pitch

      report.pitch = {
        level: Number(pitch_level.toFixed(3)),
        after_drag_down: Number(pitch_down.toFixed(3)),
        after_drag_up: Number(pitch_up.toFixed(3)),
      }
      expect(pitch_down).toBeLessThan(pitch_level) // drag DOWN ⇒ more top-down (pitch more negative)
      expect(pitch_up).toBeGreaterThan(pitch_down) // drag UP ⇒ eased back toward the horizon (fix #1)

      report.video = await finish('fixes')
      await writeFile(`${ART}/eng8_fix_report.json`, JSON.stringify(report, null, 2))
      console.log('[eng8_fix]', JSON.stringify(report, null, 2))
    } finally {
      await finish('fixes')
    }
  })
})
