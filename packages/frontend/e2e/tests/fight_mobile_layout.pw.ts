import { expect, test } from '@playwright/test'

test.use({ hasTouch: true })
for (const viewport of [
  { width: 667, height: 375 },
  { width: 980, height: 640 },
]) {
  test(`fight actions stay in two rows and confirmation clears them at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e/fixtures/mobile_fight.html')
    const spells = page.locator('.aui-combat-spells .fight-hud__spell')
    await expect(spells.first()).toBeVisible()
    await expect(page.locator('.aui-combat-spells .fight-hud__spell img').first()).toBeVisible()
    const rows = await spells.evaluateAll(
      (nodes) => new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().y))).size
    )
    expect(rows).toBe(2)
    const dock = (await page.locator('.aui-combat-hud').boundingBox())!
    expect(dock.x).toBeGreaterThanOrEqual(0)
    expect(dock.x + dock.width).toBeLessThanOrEqual(viewport.width)
    const confirmation = (await page.locator('[data-touch-fight-confirm]').boundingBox())!
    expect(confirmation.y + confirmation.height).toBeLessThan(dock.y)
    await expect(page.locator('[data-touch-fight-confirm] button svg')).toHaveCount(2)
    await page.locator('.chat__toggle').click()
    const filters = page.locator('.chat__filter')
    await expect(filters.first()).toBeVisible()
    expect(
      await filters.evaluateAll((nodes) => new Set(nodes.map((node) => node.getBoundingClientRect().y)).size)
    ).toBe(1)
    await page.screenshot({ path: `/private/tmp/fight-mobile-${viewport.width}.png` })
  })
}

test('fight camera pans with one finger, pinches both ways, and detaches cleanly', async ({ page }) => {
  await page.goto('/e2e/fixtures/camera_drag.html?fight')
  const cdp = await page.context().newCDPSession(page)
  const touch = async (
    type: 'touchStart' | 'touchMove' | 'touchEnd',
    points: { id: number; x: number; y: number }[]
  ) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
  }
  const state = async () =>
    JSON.parse((await page.locator('body').getAttribute('data-camera'))!) as {
      pan_x: number
      pan_z: number
      zoom: number
    }
  await touch('touchStart', [{ id: 1, x: 160, y: 160 }])
  await touch('touchMove', [{ id: 1, x: 163, y: 161 }])
  expect((await state()).pan_x).toBe(0)
  await touch('touchMove', [{ id: 1, x: 210, y: 185 }])
  expect((await state()).pan_x).not.toBe(0)
  await touch('touchStart', [
    { id: 1, x: 210, y: 185 },
    { id: 2, x: 310, y: 185 },
  ])
  await touch('touchMove', [
    { id: 1, x: 180, y: 185 },
    { id: 2, x: 340, y: 185 },
  ])
  await expect.poll(async () => (await state()).zoom).toBeLessThan(0)
  await touch('touchMove', [
    { id: 1, x: 230, y: 185 },
    { id: 2, x: 290, y: 185 },
  ])
  await expect.poll(async () => (await state()).zoom).toBeGreaterThan(0)
  await touch('touchEnd', [])
  await page.getByRole('button', { name: 'Inventory' }).click()
  const detached = await state()
  await touch('touchStart', [{ id: 1, x: 160, y: 160 }])
  await touch('touchMove', [{ id: 1, x: 210, y: 190 }])
  await touch('touchEnd', [])
  expect(await state()).toEqual(detached)
})
