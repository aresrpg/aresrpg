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
