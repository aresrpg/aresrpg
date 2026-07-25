// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SHARED WORLD-SESSION RIG (#872) — the LIVE dev hooks the world drives read. The `__ARES_PLAYER` /
// `__ARES_MOBS` globals the old `world_lobby_*` specs drove died with roam.js (D139); the current rig is
// embed_voxel_dev.js: `__voxel_ctl` (character controller), `__voxel_cam` (shoulder camera), `__voxel_engine`
// (render camera), `__voxel_avatar` (the own-body handle). One boot + one set of readouts, one home.
//
// A page-side `import('/src/…')` is BANNED here — it binds a second, dead Vite module instance (dev_probe's
// documented trap, and half of why the retired specs read `undefined` in silence). Every read is a window hook.
//
// PREREQUISITES (declared, never minted here): VITE_DEV_KEY = the funded testnet QA key that ALREADY owns a
// character joined to a world. WEBGPU: the controller only ticks on the WebGPU path — run HEADED on a machine
// with a real adapter (the WebGL fallback has no controller physics; golden_path carries the same caveat).

import { expect, type Page } from '@playwright/test'

export const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

type Transform = { position: [number, number, number]; visual_y: number; on_ground: boolean }

/** The LIVE controller transform — interpolated position + ground truth (`__voxel_ctl.get_transform()`). */
export const transform = (page: Page): Promise<Transform | undefined> =>
  page.evaluate(() => (window as any).__voxel_ctl?.get_transform?.() as Transform | undefined)

/** Is the player's OWN body rendered? (`avatar.object3d.visible = pose.distance > 1.0` — the first-person hide.) */
export const body_visible = (page: Page): Promise<boolean | null> =>
  page.evaluate(() => (window as any).__voxel_avatar?.()?.object3d?.visible ?? null)

/**
 * The orbit frame DERIVED from the live render eye and the live head anchor — polar measured from straight UP,
 * exactly like camera_rig's own spherical math (the rig exposes no angle getters but `get_yaw`, and the eye is
 * where the wiring is actually provable). `dist` is the effective (collision-shortened) arm.
 */
export async function eye_frame(page: Page) {
  return page.evaluate(() => {
    const w = window as any
    const t = w.__voxel_ctl?.get_transform?.()
    const camera = w.__voxel_engine?.get_camera?.()
    if (!t || !camera) return null
    // camera_rig: head_y = feet_y + max(avatar eye_height, HEAD_HEIGHT 1.0) — read the live avatar, never guess.
    const head_y = t.visual_y + Math.max(w.__voxel_avatar?.()?.eye_height ?? 1.6, 1.0)
    const dx = camera.position.x - t.position[0]
    const dy = camera.position.y - head_y
    const dz = camera.position.z - t.position[2]
    const dist = Math.hypot(dx, dy, dz)
    return { dist, polar: Math.acos(Math.min(1, Math.max(-1, dy / dist))), azimuth: Math.atan2(dx, dz) }
  })
}

/** Shortest signed distance between two angles, in radians — orbit deltas wrap. */
export const angle_delta = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

/**
 * The world drives need the WALK rig to be the live camera writer. A QA character with an unsettled world
 * fight auto-resumes it on the first world_spawns poll (a few seconds after boot) — the fight camera takes
 * over, the walk avatar hides, the prompt stack empties, and every assertion below turns into a mystery.
 * Watch for that window and fail with the prerequisite instead. (Diagnosed the hard way on #872.)
 */
export async function expect_walk_session(page: Page) {
  for (let i = 0; i < 12; i += 1) {
    const in_fight = await page.evaluate(
      () => !!(window as any).__voxel_board?._descriptor?.() || !!document.querySelector('.hud-fightctl')
    )
    expect(
      in_fight,
      'the QA character resumed a live fight — the walk rig stands down (D230). Settle it (forfeit) or point VITE_DEV_KEY at an idle character.'
    ).toBe(false)
    await page.waitForTimeout(500)
  }
}

/** Boots the REAL world session on the dev wallet and waits for the live rig (controller + camera) to exist. */
export async function boot_world(page: Page) {
  await page.addInitScript((key: string) => {
    ;(window as any).__ARES_DEV_KEY = key
    try {
      localStorage.setItem('ares_tutorial_seen_v2', '1') // the tutorial backdrop eats canvas input
    } catch {
      /* storage unavailable — the skip loop below is the fallback */
    }
  }, DEV_KEY)
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () =>
              typeof (window as any).__voxel_cam?.rotate === 'function' &&
              Array.isArray((window as any).__voxel_ctl?.get_transform?.()?.position)
          )
          .catch(() => false),
      {
        timeout: 180_000,
        intervals: [2000],
        message:
          'the DEV world rig (__voxel_ctl + __voxel_cam) must boot — VITE_DEV_KEY must own a character already joined to a world, and the run must be HEADED (WebGPU)',
      }
    )
    .toBe(true)
  for (let i = 0; i < 8; i += 1) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const skip = page.locator('.tut__skip')
    if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {})
    await page.waitForTimeout(400)
  }
}
