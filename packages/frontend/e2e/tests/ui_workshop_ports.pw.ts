import { expect, test } from '@playwright/test'

const open_workshop = async (page: import('@playwright/test').Page, name: string) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name, exact: true }).click()
}

test('map drags pan, short taps set an exact destination, and multitouch never travels', async ({ page }) => {
  await open_workshop(page, 'World map')
  await expect(page.locator('.aui-map-worlds')).toHaveCount(0)
  const lens = page.locator('.aui-map-interaction')
  const bounds = (await lens.boundingBox())!
  const x = bounds.x + bounds.width * 0.5,
    y = bounds.y + bounds.height * 0.5
  const start = await page.locator('.aui-map-readout').innerText()
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 60, y + 15, { steps: 4 })
  await page.mouse.up()
  await expect(page.locator('[data-map-destination]')).toHaveCount(0)
  await expect(page.locator('.aui-map-readout')).not.toHaveText(start, { useInnerText: true })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { id: 1, x, y },
      { id: 2, x: x + 35, y: y + 20 },
    ],
  })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('[data-map-destination]')).toHaveCount(0)
  await page.mouse.click(x + 17, y + 9)
  await expect(page.locator('[data-map-destination]')).toBeVisible()
  const first = await page.locator('[data-map-destination]').innerText()
  await page.mouse.click(x + 22, y + 9)
  await expect(page.locator('[data-map-destination]')).not.toHaveText(first)
})

test('compact map control and all party members fit together on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_world_hud.html?mobile')
  const map = (await page.locator('.world-map-trigger').boundingBox())!
  const party = page.locator('.party-frame')
  await expect(party.locator('.party-frame__member')).toHaveCount(6)
  const box = (await party.boundingBox())!
  expect(box.y).toBeGreaterThan(map.y + map.height)
  expect(box.y + box.height).toBeLessThanOrEqual(390)
  const follow = party.getByRole('switch', { name: 'Follow leader', exact: true })
  await follow.check()
  await expect(follow).toBeChecked()
})

test('marketplace keeps every offer reachable and preserves separate stackable lots', async ({ page }) => {
  await open_workshop(page, 'Marketplace')
  const listings = page.locator('[data-marketplace-listings]')
  await expect(listings.locator('.market-ask')).toHaveCount(3)
  await listings.locator('.market-ask').last().getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(page.getByRole('dialog').last()).toContainText('no transaction is submitted')
  await page.keyboard.press('Escape')
  await page
    .locator('[data-marketplace-general-categories]')
    .getByRole('button', { name: /Resources/ })
    .click()
  await expect(page.locator('[data-marketplace-lot-market]')).toBeVisible()
  await expect(page.locator('[data-marketplace-price-history]')).toHaveCount(1)
  await expect(page.locator('[data-marketplace-item-type-column] input')).toBeVisible()
})

test('jobs expose every profession and forge preserves rune effects and rolled item details', async ({ page }) => {
  await open_workshop(page, 'Jobs')
  await page.locator('.jobs__list-row').filter({ hasText: 'Baker' }).click()
  await expect(page.locator('.jobs__detail-title-row')).toContainText('Baker')
  await expect(page.locator('.jobs__table')).toHaveCount(0)
  await page.locator('.jobs__recipe').first().click()
  await expect(page.locator('.aui-floating-window [data-item-detail-view]')).toBeVisible()
  await expect(page.locator('.aui-floating-window')).toContainText('Ingredients')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Runeforge', exact: true }).click()
  await page.locator('.chr-forge__pool button').first().click()
  await page.locator('.chr-forge__inventory>div:nth-child(2)>button').last().click()
  await page.locator('.chr-forge__pool button').first().click()
  await expect(page.locator('[data-rune-effect]')).toBeVisible()
  await expect(page.locator('.chr-forge__inspection [data-item-stats]')).toBeVisible()
})

test('arena creation and admin charts retain usable mobile bounds', async ({ page }) => {
  await open_workshop(page, 'Kolizeum')
  await page.locator('.aui-arena-create-trigger').click()
  const create = page.locator('.kz-create-button')
  await expect(create).toBeEnabled()
  const bounds = (await create.boundingBox())!
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(390)
  await create.click()
  await expect(page.getByRole('dialog').last()).toContainText('no transaction is submitted')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Admin', exact: true }).click()
  const charts = page.locator('[data-admin-charts] [role=img]')
  await expect(charts).toHaveCount(6)
  const heights = await charts.evaluateAll((rows) =>
    rows.map((row) => ({ height: row.clientHeight, content: row.scrollHeight }))
  )
  expect(heights.every((row) => row.height >= 64 && row.content <= row.height + 1)).toBe(true)
})
