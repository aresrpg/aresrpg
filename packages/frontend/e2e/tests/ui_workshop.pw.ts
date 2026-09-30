import { expect, test } from '@playwright/test'

test('continuous inventory search, cosmetics and equip reuse the character controller', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
  const inventory = page.locator('[data-character-panel="equipment"]'),
    cells = inventory.locator('.chr-cell:not(.chr-cell--empty)')
  await expect(cells).toHaveCount(50)
  await inventory.getByRole('searchbox', { name: 'Search inventory…' }).fill('no-such-item')
  await expect(cells).toHaveCount(0)
  await inventory.getByRole('searchbox', { name: 'Search inventory…' }).fill('Zukin')
  await expect(cells).toHaveCount(1)
  const layout_before = await inventory.locator('.inv__portrait').boundingBox()
  await cells.first().click()
  await inventory.getByRole('button', { name: 'Equip', exact: true }).click()
  expect(await inventory.locator('.inv__portrait').boundingBox()).toEqual(layout_before)
  await inventory.getByRole('button', { name: 'Accept', exact: true }).click()
  expect(await inventory.locator('.inv__portrait').boundingBox()).toEqual(layout_before)
  await expect(inventory.locator('[data-equipment-slot="hat"] img')).toHaveCount(1)
  await expect(inventory.getByRole('button', { name: 'Cosmetics', exact: true })).toHaveCount(0)
  await expect(inventory.locator('[data-equipment-slot="cosmetic_hat"]')).toBeVisible()
  await expect(inventory.locator('[data-equipment-slot="hat"]')).toBeVisible()
  await expect(inventory.locator('[data-equipment-slot="cosmetic_cloak"]')).toBeVisible()
})

test('drag selection keeps inspection closed and exposes the exact batch to crushing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
  const cells = page.locator('.chr-equip__grid [data-selection-id]')
  const first = (await cells.nth(0).boundingBox())!,
    second = (await cells.nth(1).boundingBox())!
  await page.mouse.move(first.x + 20, first.y + 20)
  await page.mouse.down()
  await page.mouse.move(second.x + 20, second.y + 20, { steps: 8 })
  await expect(page.locator('.aui-selection-marquee')).toHaveCount(0)
  await page.mouse.up()
  await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(2)
  await expect(page.locator('.chr-equip__detail')).toHaveCount(0)
  await page.mouse.move(first.x + 10, first.y + 10)
  await page.mouse.down()
  await page.mouse.move(second.x + 35, second.y + 70, { steps: 5 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(2)
  await page.locator('.inventory-selection-tools').getByRole('button', { name: 'Item actions', exact: true }).click()
  await page.getByRole('menu').getByRole('button', { name: /Crush/ }).click()
  await expect(page.locator('[data-crush-item]')).toHaveCount(2)
  await expect(page.locator('.aui-item-confirm .aui-button--danger')).toBeDisabled()
})

test('touch selection cancels cleanly and ordinary touch scrolling remains available', async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
  await expect(
    page.locator('.inventory-selection-tools').getByRole('button', { name: 'Select', exact: true })
  ).toHaveCount(0)
  const cells = page.locator('.chr-equip__grid [data-selection-id]')
  const first = (await cells.nth(0).boundingBox())!,
    second = (await cells.nth(1).boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const start = { x: first.x + 20, y: first.y + 20, id: 1 },
    end = { x: second.x + 20, y: second.y + 20, id: 1 }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
  await page.waitForTimeout(400)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] })
  await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(2)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
  await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(0)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
  await page.waitForTimeout(400)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(2)
  await expect(page.locator('.chr-equip__detail')).toHaveCount(0)
  const third = (await cells.nth(2).boundingBox())!
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: third.x + 20, y: third.y + 20, id: 1 }],
  })
  await page.waitForTimeout(400)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(3)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.chr-equip__detail')).toBeVisible()
  await page.locator('.inventory-item-close').click()
  await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(3)
  const header = (await page.locator('.inv__portrait').boundingBox())!
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: header.x + header.width / 2, y: header.y + header.height / 2, id: 1 }],
  })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(0)
  await expect(page.locator('.chr-equip__detail')).toHaveCount(0)
  const grid = page.locator('.chr-equip__grid'),
    bounds = (await grid.boundingBox())!
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width - 60, y: bounds.y + 50, id: 1 }],
  })
  for (const distance of [40, 80, 120, 160])
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: bounds.x + bounds.width - 60 - distance, y: bounds.y + 50, id: 1 }],
    })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => grid.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  await expect(page.locator('.chr-equip__detail')).toHaveCount(0)
})

test('release outside the inventory cancels a pending long press', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
  const grid = page.locator('.aui-selection-grid')
  const bounds = (await grid.boundingBox())!
  await page.mouse.move(bounds.x + 3, bounds.y + 3)
  await page.mouse.down()
  await page.mouse.move(bounds.x - 20, bounds.y - 20)
  await page.mouse.up()
  await page.waitForTimeout(450)
  const selected = await page.locator('.chr-cell.is-selected').count()
  await page.mouse.move(bounds.x + 100, bounds.y + 100)
  await expect(page.locator('.chr-cell.is-selected')).toHaveCount(selected)
})
