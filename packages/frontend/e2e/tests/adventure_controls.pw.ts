// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'
import type {} from '../fixtures/adventure_controls.tsx'

for (const viewport of [
  { width: 667, height: 300 },
  { width: 1180, height: 820 },
]) {
  test.describe(`tutorial touch controls at ${viewport.width}px`, () => {
    test.use({ hasTouch: true, isMobile: true, viewport })

    test('the adventure joystick moves the real hero while a second finger jumps and turns the camera', async ({
      page,
    }) => {
      await page.goto('/e2e/fixtures/adventure_controls.html')
      await page.getByRole('button', { name: 'Collapse quests', exact: true }).click()
      const joystick = page.getByRole('group', { name: 'Move', exact: true })
      await expect(joystick).toBeVisible()
      const jump = page.getByRole('button', { name: 'Jump', exact: true })
      await expect(jump).toBeVisible()
      await expect(joystick).toHaveCSS('opacity', '0.55')
      await expect(jump).toHaveCSS('opacity', '0.55')
      await page.waitForFunction(() => window.adventure_pose()?.character_id === 'adventure_senshi')
      await page.locator('[data-world-loading]').waitFor({ state: 'hidden', timeout: 30_000 })
      const origin = (await page.evaluate(() => window.adventure_pose()))!
      const stick = (await joystick.boundingBox())!
      const button = (await jump.boundingBox())!
      expect(stick.x).toBeLessThan(viewport.width / 2)
      expect(button.x).toBeGreaterThan(viewport.width / 2)
      const cdp = await page.context().newCDPSession(page)
      const finger = { id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] })
      await expect(joystick).toHaveCSS('opacity', '1')
      await expect(jump).toHaveCSS('opacity', '0.55')
      const moving = { ...finger, y: finger.y - 32 }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [moving] })
      await expect
        .poll(() =>
          page.evaluate((origin) => {
            const pose = window.adventure_pose()!
            return Math.hypot(pose.x - origin.x, pose.z - origin.z)
          }, origin)
        )
        .toBeGreaterThan(0.5)
      const grounded = (await page.evaluate(() => window.adventure_pose()))!
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [moving, { id: 2, x: button.x + button.width / 2, y: button.y + button.height / 2 }],
      })
      await expect(joystick).toHaveCSS('opacity', '1')
      await expect(jump).toHaveCSS('opacity', '1')
      await expect.poll(() => page.evaluate(() => window.adventure_pose()!.y)).toBeGreaterThan(grounded.y + 0.3)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(joystick).toHaveCSS('opacity', '0.55')
      await expect(jump).toHaveCSS('opacity', '0.55')
      // Observe consecutive rendered frames: slow graphics stretch physics time beyond a short UI assertion budget.
      await page.waitForFunction(async () => {
        const start = window.adventure_pose()!
        for (let frame = 0; frame < 10; frame++) {
          await new Promise(requestAnimationFrame)
          const pose = window.adventure_pose()!
          if (Math.hypot(pose.x - start.x, pose.y - start.y, pose.z - start.z) >= 0.1) return false
        }
        return true
      })
      const point = await page.locator('main > canvas').evaluate((element) => {
        const box = element.getBoundingClientRect()
        return (
          [0.45, 0.4, 0.25, 0.1]
            .flatMap((x) =>
              [0.25, 0.45, 0.55, 0.75, 0.85].map((y) => ({ x: box.x + box.width * x, y: box.y + box.height * y }))
            )
            // A whole touch-sized patch must be exposed; a point beside an animated label is not a stable target.
            .find(({ x, y }) =>
              [-24, 0, 24].every((dx) =>
                [-24, 0, 24].every((dy) => document.elementFromPoint(x + dx, y + dy) === element)
              )
            )
        )
      })
      expect(point).toBeDefined()
      expect(point!.x).toBeLessThan(viewport.width / 2)
      const camera = { id: 3, ...point! }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [camera] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...camera, x: camera.x + 50 }] })
      await expect.poll(() => page.evaluate(() => window.adventure_pose()!.yaw)).not.toBe(origin.yaw)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.setViewportSize({ width: 1280, height: 720 })
      await expect(joystick).toBeVisible()
    })
  })
}
