import { expect, test } from '@playwright/test'

test('equipped profession and level fit the jobs rail without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Jobs', exact: true }).click()
  const rail = page.locator('.jobs__list')
  const equipped = rail.getByRole('button', { name: /Herbalist.*Equipped.*Lv 100/ })
  await expect(equipped).toBeVisible()
  expect(await rail.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(
    await equipped.locator('.jobs__list-name').evaluate((element) => element.scrollWidth <= element.clientWidth)
  ).toBe(true)
})

test('recipe groups separate job-level access while locked recipes remain inspectable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Jobs', exact: true }).click()
  await page
    .locator('.jobs__list')
    .getByRole('button', { name: /Jeweler/ })
    .click()
  const unlocked = page.getByRole('region', { name: 'Unlocked', exact: true })
  const locked = page.getByRole('region', { name: 'Locked', exact: true })
  await expect(unlocked).toBeVisible()
  await expect(locked).toBeVisible()
  await expect(unlocked.locator('.jobs__recipe.is-locked')).toHaveCount(0)
  expect(await unlocked.locator('.jobs__recipe').count()).toBeGreaterThan(0)
  expect(await locked.locator('.jobs__recipe').count()).toBeGreaterThan(0)
  expect(await locked.locator('.jobs__recipe:not(.is-locked)').count()).toBe(0)
  await expect(locked.locator('.aui-collection-corner-badge')).toHaveCount(0)
  const missing_chain = unlocked
    .locator('.jobs__recipe')
    .filter({ has: page.locator('.aui-collection-corner-badge') })
    .first()
  const badge = missing_chain.locator('.aui-collection-corner-badge')
  await expect(badge).toHaveText('~')
  await expect(badge).toHaveAccessibleName(/job levels.*ingredient recipes/)
  await expect(missing_chain).toBeEnabled()
  await expect(unlocked.locator('.is-best-progress')).toHaveCSS('border-top-color', 'rgb(118, 173, 135)')
  const tile_box = (await missing_chain.boundingBox())!
  const badge_box = (await badge.boundingBox())!
  expect(badge_box.x).toBeGreaterThan(tile_box.x + tile_box.width / 2)
  expect(badge_box.y + badge_box.height).toBeLessThan(tile_box.y + tile_box.height / 2)
  await missing_chain.click()
  const inspection = page.locator('.aui-floating-window:popover-open')
  await expect(inspection.locator('.jobs__chain-note')).toContainText('bought or dropped ingredients')
  await page.keyboard.press('Escape')
  expect((await unlocked.boundingBox())!.y).toBeLessThan((await locked.boundingBox())!.y)
  await locked.locator('.jobs__recipe').first().click()
  await expect(page.locator('.aui-floating-window:popover-open')).toBeVisible()
})
