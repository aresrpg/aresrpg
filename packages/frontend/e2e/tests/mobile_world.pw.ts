// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test.use({ hasTouch: true, isMobile: true, viewport: { width: 960, height: 540 } })

test('touch prompts show tap instructions and activate their own actions', async ({ page }) => {
  await page.goto('/e2e/fixtures/mobile_world.html')
  for (const [label, action] of [
    ['Tap to attack', 'attack'],
    ['Tap to gather Wood', 'gather'],
    ['Tap to collect all', 'all'],
    ['Tap to mount', 'mount'],
    ['Tap to dismount', 'dismount'],
    ['Tap to travel to another world', 'travel'],
  ]) {
    const button = page.getByRole('button', { name: label!, exact: true })
    await expect(button).toBeVisible()
    if (action === 'attack') expect((await button.boundingBox())!.height).toBeLessThanOrEqual(28)
    else expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await button.tap()
    await expect(page.getByLabel('Last action')).toHaveText(action!)
  }
  await expect(page.locator('kbd:visible')).toHaveCount(0)
  await page.getByLabel('Character').tap({ position: { x: 100, y: 100 } })
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: 'Invite to group' }).tap()
  await expect(page.getByLabel('Last action')).toHaveText('invite')
})

test('camera drags and cancelled touches never open a character menu', async ({ page }) => {
  await page.goto('/e2e/fixtures/mobile_world.html')
  const canvas = page.getByLabel('Character')
  const touch = { pointerId: 7, pointerType: 'touch', clientX: 100, clientY: 200, button: 0 }
  await canvas.dispatchEvent('pointerdown', touch)
  await canvas.dispatchEvent('pointermove', { ...touch, clientX: 160 })
  await canvas.dispatchEvent('pointermove', touch)
  await canvas.dispatchEvent('pointerup', touch)
  await canvas.dispatchEvent('click', touch)
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByLabel('Last action')).toHaveText('rotate')
  await canvas.dispatchEvent('pointerdown', touch)
  await canvas.dispatchEvent('pointercancel', touch)
  await canvas.dispatchEvent('pointerup', touch)
  await canvas.dispatchEvent('click', touch)
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test.describe('desktop inputs', () => {
  test.use({ hasTouch: false, isMobile: false })
  test('keyboard hints remain visible and right-click opens the same menu', async ({ page }) => {
    await page.goto('/e2e/fixtures/mobile_world.html')
    await expect(page.getByRole('button', { name: 'Press F to attack', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Tap to attack', exact: true })).toHaveCount(0)
    await page.getByLabel('Character').click({ button: 'right', position: { x: 100, y: 100 } })
    await expect(page.getByRole('menu')).toBeVisible()
    await expect(page.getByLabel('Last action')).toHaveText('')
  })
})

for (const first_thumb of ['joystick', 'camera']) {
  test(`two thumbs move and rotate together when ${first_thumb} starts first`, async ({ page }) => {
    await page.goto('/e2e/fixtures/mobile_world.html?controls')
    const bounds = (await page.locator('.mobile-joystick').boundingBox())!
    const joystick = { id: 1, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const camera = { id: 2, x: 600, y: 260 }
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [first_thumb === 'joystick' ? joystick : camera],
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [joystick, camera] })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { ...joystick, x: joystick.x + 36 },
        { ...camera, x: camera.x + 80, y: camera.y + 30 },
      ],
    })
    await expect(page.locator('body')).toHaveAttribute('data-movement', JSON.stringify({ forward: 0, strafe: 1 }))
    await expect(page.locator('body')).toHaveAttribute('data-rotation-x', '240')
    await expect(page.locator('body')).toHaveAttribute('data-rotation-y', '90')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect(page.locator('body')).toHaveAttribute('data-movement', JSON.stringify({ forward: 0, strafe: 0 }))
    await expect(page.getByRole('menu')).toHaveCount(0)
  })
}
