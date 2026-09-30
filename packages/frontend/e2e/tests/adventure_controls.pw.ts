// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'
import type {} from '../fixtures/adventure_controls.tsx'

test.use({ hasTouch: true, isMobile: true, viewport: { width: 667, height: 300 } })

test('the adventure joystick moves the real hero while a second finger jumps and turns the camera', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/adventure_controls.html')
  const joystick = page.getByRole('group', { name: 'Move', exact: true })
  await expect(joystick).toBeVisible()
  const jump = page.getByRole('button', { name: 'Jump', exact: true })
  await expect(jump).toBeVisible()
  await expect(joystick).toHaveCSS('opacity', '0')
  await expect(jump).toHaveCSS('opacity', '0')
  await page.waitForFunction(() => window.adventure_pose()?.character_id === 'adventure_senshi')
  const origin = (await page.evaluate(() => window.adventure_pose()))!
  const stick = (await joystick.boundingBox())!
  const button = (await jump.boundingBox())!
  expect(stick.x).toBeLessThan(667 / 2)
  expect(button.x).toBeGreaterThan(667 / 2)
  const cdp = await page.context().newCDPSession(page)
  const finger = { id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] })
  await expect(joystick).toHaveCSS('opacity', '1')
  await expect(jump).toHaveCSS('opacity', '0')
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
  await expect(joystick).toHaveCSS('opacity', '0')
  await expect(jump).toHaveCSS('opacity', '0')
  // Settle the jump before choosing exposed canvas: projected mob cards move with the airborne camera.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const start = window.adventure_pose()!
        const until = performance.now() + 500
        do {
          await new Promise(requestAnimationFrame)
        } while (performance.now() < until)
        const end = window.adventure_pose()!
        return Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
      })
    )
    .toBeLessThan(0.1)
  const point = await page.locator('main > canvas').evaluate((element) => {
    const box = element.getBoundingClientRect()
    return [0.45, 0.4, 0.25, 0.1]
      .flatMap((x) => [0.25, 0.45, 0.55].map((y) => ({ x: box.x + box.width * x, y: box.y + box.height * y })))
      .find(({ x, y }) => document.elementFromPoint(x, y) === element)
  })
  expect(point).toBeDefined()
  expect(point!.x).toBeLessThan(667 / 2)
  const camera = { id: 3, ...point! }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [camera] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...camera, x: camera.x + 50 }] })
  await expect.poll(() => page.evaluate(() => window.adventure_pose()!.yaw)).not.toBe(origin.yaw)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(joystick).not.toBeVisible()
})
