// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect } from '@playwright/test'

import { angle_delta, body_visible, boot_world, expect_walk_session, eye_frame, transform } from './world_rig'

// WORLD CAMERA RIG — the PORT of world_lobby_camera.spec.ts onto the live rig (#872). What it proves is the
// WIRING (camera_rig's math has its own unit tests): the app's shoulder camera actually drives the render eye,
// hides the own body in first person, and the body still jumps.
//   1. rotate() orbits the RENDER eye, not just the rig's number,
//   2. a long look-up drag swings the eye BELOW the head and clamps at the rig ceiling (D223 — the eye must be
//      able to look further up; this REPLACES the retired spec's "never below the floor (<90°)" assertion,
//      which the D223 range change made false),
//   3. a look-down drag clamps at the top-down cap,
//   4. dollying fully in hides the own body (first person) and dollying out restores it,
//   5. Space lifts the body off the floor and it settles back on the ground.
// Drives go through `__voxel_cam` — pointer lock is BLOCKED under automation (D195), so the retired spec's
// mouse-drag orbit could never have proven anything here. WASD locomotion is NOT re-asserted: golden_path's
// `wasd_move` step and session_position_restore.spec.ts both own it. Fight framing is NOT re-asserted: the
// fight camera is a separate writer (embed_voxel_fight_camera.js), driven by fight_camera_pan_zoom.spec.ts.
// Run HEADED (WebGPU) — see world_rig.ts for the prerequisites.

const MAX_POLAR = (135 * Math.PI) / 180 // camera_rig ceiling (D223)
const rotate = (page: import('@playwright/test').Page, dx: number, dy: number) =>
  page.evaluate(([x, y]) => (window as any).__voxel_cam.rotate(x, y), [dx, dy])
const dolly = (page: import('@playwright/test').Page, meters: number) =>
  page.evaluate((m) => (window as any).__voxel_cam.dolly(m), meters)

test('world camera: rotate orbits the render eye, the look range clamps, FP hides the body, Space jumps', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e?.stack || e)))

  await boot_world(page)
  await expect_walk_session(page) // …and the follow spring + zoom easing converge while it watches

  // ── (1) ORBIT: 400 px of yaw drag = 1.0 rad (ROTATE_SENSITIVITY 0.0025 rad/px) on BOTH the rig and the eye ──
  const yaw_before = await page.evaluate(() => (window as any).__voxel_cam.get_yaw() as number)
  const frame_before = await eye_frame(page)
  expect(frame_before, 'the render camera must be live before the orbit drive').not.toBeNull()
  await rotate(page, 400, 0)
  await page.waitForTimeout(600)
  const yaw_after = await page.evaluate(() => (window as any).__voxel_cam.get_yaw() as number)
  expect(angle_delta(yaw_after, yaw_before), 'rotate() must swing the rig azimuth ~1 rad').toBeGreaterThan(0.6)
  const frame_after = await eye_frame(page)
  expect(
    angle_delta(frame_after!.azimuth, frame_before!.azimuth),
    'the RENDER eye must orbit with the rig — a number that moves while the camera does not is the bug this catches'
  ).toBeGreaterThan(0.5)

  // ── (2) LOOK UP: D223 — the eye swings past the horizon (below the head, looking UP at the character) and
  //    stops at the 135° ceiling. The old "<90° cage" assertion is dead product law, not a regression. ────────
  await rotate(page, 0, -2000)
  await page.waitForTimeout(800)
  const up = await eye_frame(page)
  expect(up!.dist, 'a fully collided arm would make the angle meaningless — stand in the open').toBeGreaterThan(0.3)
  expect(
    up!.polar,
    'a long look-up drag must put the eye BELOW the head (past 90° — the cage is gone)'
  ).toBeGreaterThan(Math.PI / 2)
  expect(up!.polar, 'and clamp at the rig ceiling (135°)').toBeLessThan(MAX_POLAR + 0.15)

  // ── (3) LOOK DOWN: clamps at the top-down cap (12° from straight up; the derived angle carries the shoulder
  //    bias + follow lag, hence the generous bound — it is a CLAMP proof, not a precision one). ───────────────
  await rotate(page, 0, 2000)
  await page.waitForTimeout(800)
  const down = await eye_frame(page)
  expect(down!.polar, 'a long look-down drag must park the eye near straight above the head').toBeLessThan(0.5)

  // ── (4) FIRST PERSON: the own body hides when the eye reaches the head (`visible = pose.distance > 1.0`). ──
  await rotate(page, 0, -400) // back to a normal over-shoulder polar first
  await dolly(page, -20) // clamps to the FP floor (1.0 m, below FP_ENTER 1.2)
  await expect
    .poll(() => body_visible(page), { timeout: 20_000, intervals: [300], message: 'the own model must hide in FP' })
    .toBe(false)
  const fp = await eye_frame(page)
  expect(fp!.dist, 'the first-person eye sits on the head anchor').toBeLessThan(1.1)

  await dolly(page, 20) // back out past FP_EXIT (1.4 m)
  await expect
    .poll(() => body_visible(page), {
      timeout: 20_000,
      intervals: [300],
      message: 'the own model must come back on zoom-out',
    })
    .toBe(true)
  const tp = await eye_frame(page)
  expect(tp!.dist, 'zooming out must leave first person').toBeGreaterThan(1.4)

  // ── (5) JUMP: Space lifts the body (approved apex 1.44 m) and gravity brings it back to the ground. ────────
  const start = await transform(page)
  await page.keyboard.down('Space')
  await page.waitForTimeout(120)
  await page.keyboard.up('Space')
  let peak = -Infinity
  for (let i = 0; i < 20; i += 1) {
    peak = Math.max(peak, (await transform(page))!.position[1])
    await page.waitForTimeout(80)
  }
  expect(peak - start!.position[1], 'Space must lift the body off the floor').toBeGreaterThan(0.5)
  await expect
    .poll(
      async () => {
        const now = await transform(page)
        return !!now?.on_ground && Math.abs(now.position[1] - start!.position[1]) < 0.3
      },
      { timeout: 20_000, intervals: [300], message: 'the body must fall back to the floor after the hop' }
    )
    .toBe(true)

  expect(errors, `unexpected page errors:\n${errors.join('\n')}`).toEqual([])
})
