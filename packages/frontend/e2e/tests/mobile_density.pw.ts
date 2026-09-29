import { expect, test, type Page } from '@playwright/test'

test.use({ hasTouch: true })
const workshop = async (page: Page, name: string) => {
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name, exact: true }).click()
}

test('mobile jobs stay in a vertical rail and forge keeps three columns', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await workshop(page, 'Jobs')
  const rail = page.locator('.jobs__list')
  await expect(rail).toBeVisible()
  expect(await rail.evaluate((el) => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true)
  await page.locator('.jobs__list-row').filter({ hasText: 'Baker' }).click()
  await expect(page.locator('.jobs__detail-title-row')).toContainText('Baker')
  await page.locator('.jobs__recipe').first().click()
  const ingredients = page.locator('.aui-floating-window .jobs__ingredients')
  await expect(ingredients).toBeVisible()
  expect(await ingredients.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  const bar = page.locator('.aui-floating-window .jobs__craft-bar')
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(48)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Runeforge', exact: true }).click()
  const panels = page.locator('.chr-forge__panels')
  await expect(panels).toBeVisible()
  expect(await panels.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(3)
  expect(await panels.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: '/private/tmp/mobile-forge.png' })
})

test('mobile character dropdown and compact map use the real actions', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_world_hud.html?mobile')
  await expect(page.locator('.aui-minimap')).toBeHidden()
  const trigger = page.locator('.character-switcher-trigger')
  await expect(trigger.locator('svg')).toBeVisible()
  await expect(page.locator('.world-map-trigger svg')).toBeVisible()
  await trigger.click()
  await expect(page.locator('[data-character-tabs]')).toBeVisible()
  await page.locator('[data-character-tab="character-1"]').click()
  await expect(page.locator('[data-character-tabs]')).toBeHidden()
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-character-tabs]')).toBeHidden()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await page.locator('.world-map-trigger').click()
  await expect(page.locator('.aui-map-interaction')).toBeVisible()
})

for (const viewport of [
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 390, height: 844 },
]) {
  test(`staking fits without scrolling at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 })
    await workshop(page, 'Your stake. Your share.')
    await page.setViewportSize(viewport)
    const accounts = page.locator('.staking-account')
    await expect(accounts).toHaveCount(2)
    for (const account of await accounts.all()) {
      const box = (await account.boundingBox())!
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
      expect(await account.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    }
    await accounts.first().getByRole('button', { name: 'Stake more', exact: true }).click()
    const amount = accounts.first().locator('.staking-amount')
    await expect(amount).toBeVisible()
    expect(await amount.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
    await amount.locator('input').fill('999999')
    await expect(amount.getByRole('alert')).toBeVisible()
    await amount.locator('input').fill('1')
    await expect(amount.getByRole('alert')).toHaveCount(0)
    const submit = (await amount.locator('[type="submit"]').boundingBox())!
    const account_box = (await accounts.first().boundingBox())!
    expect(submit.y + submit.height).toBeLessThanOrEqual(account_box.y + account_box.height)
    await page.screenshot({ path: `/private/tmp/mobile-staking-${viewport.width}.png` })
  })
}

test('mobile market reserves most height for browsing and item search shares the filter row', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await workshop(page, 'Marketplace')
  const browsing = (await page.locator('.market-browse').boundingBox())!
  expect(browsing.height / (await page.locator('.aui-market-port').boundingBox())!.height).toBeGreaterThan(0.75)
  await page.keyboard.press('Escape')
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.locator('[data-hud-page="encyclopedia"]').click()
  await expect(page.getByRole('spinbutton')).toHaveCount(0)
  const search = (await page.getByRole('searchbox').boundingBox())!
  const filters = (await page.locator('.aui-item-filters').boundingBox())!
  expect(Math.abs(search.y - filters.y)).toBeLessThan(8)
  await page.getByRole('searchbox').fill('Cloak')
  await expect(page.locator('.aui-collection-tile').first()).toContainText('Cloak')
})

test('touch demo HUD stays compact and mob close stays inside its card', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 640 })
  await page.goto('/play-demo')
  await expect(page.locator('.gw-compass__band')).toBeVisible({ timeout: 30000 })
  expect((await page.locator('.gw-compass-wrap').boundingBox())!.height).toBeLessThanOrEqual(40)
  expect((await page.locator('.journey-tracker').boundingBox())!.width).toBeLessThanOrEqual(230)
  expect((await page.locator('.aui-hud-shortcut-row').boundingBox())!.height).toBeLessThanOrEqual(90)
  await page.screenshot({ path: '/private/tmp/mobile-demo-hud.png' })
  await page.locator('[data-mob-pack] button').first().click()
  const card = page.locator('.aui-mob')
  await expect(card).toBeVisible()
  for (const viewport of [
    { width: 980, height: 640 },
    { width: 667, height: 375 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    const box = (await card.boundingBox())!
    const close = (await card.locator('footer button').boundingBox())!
    expect(close.y + close.height).toBeLessThanOrEqual(box.y + box.height)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  }
  await card.locator('footer button').click()
  await expect(card).toHaveCount(0)
})

test('compact mastery fits at least four offers across landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await workshop(page, 'Mastery')
  const offers = page.locator('.mastery-offers')
  await expect(offers).toBeVisible()
  expect(
    await offers.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  ).toBeGreaterThanOrEqual(4)
  await page.screenshot({ path: '/private/tmp/mobile-mastery.png' })
})

test('Orchid-Spore Blend recipe has one scroll owner and compact controls', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_world_hud.html')
  await page.locator('[data-hud-page="encyclopedia"]').click()
  await page.getByRole('searchbox').fill('Orchid-Spore Blend')
  await page.locator('.aui-collection-tile').first().click()
  const sheet = page.locator('.aui-floating-window .item-detail-view')
  await expect(sheet.locator('.jobs__ingredients')).toBeVisible()
  const nested_scrolls = await sheet.evaluate(
    (el) =>
      [...el.querySelectorAll('*')].filter(
        (child) =>
          ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) && child.scrollHeight > child.clientHeight + 1
      ).length
  )
  expect(nested_scrolls).toBe(0)
  const bar = sheet.locator('.jobs__craft-bar')
  expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(48)
  await page.screenshot({ path: '/private/tmp/mobile-ingredients.png' })
})

test('mobile utility rows align and vitals have room beside smaller shortcuts', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/e2e/fixtures/ui_world_hud.html?mobile')
  const character = (await page.locator('.character-switcher-trigger').boundingBox())!
  const fps = (await page.locator('.aui-performance').boundingBox())!
  expect(character.x + character.width).toBeLessThanOrEqual(fps.x)
  expect(Math.abs(character.y + character.height / 2 - fps.y - fps.height / 2)).toBeLessThan(2)
  const map = (await page.locator('.world-map-trigger').boundingBox())!
  const settings = (await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox())!
  expect(Math.abs(map.y + map.height / 2 - settings.y - settings.height / 2)).toBeLessThan(2)
  expect([character.width, character.height, settings.width, settings.height, map.width, map.height]).toEqual([
    44, 44, 44, 44, 44, 44,
  ])
  expect(Math.abs(character.y - map.y)).toBeLessThan(1)
  const styles = await page.locator('.world-utility-button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const style = getComputedStyle(button)
      return [style.backgroundColor, style.color, style.borderRadius, style.boxShadow].join('|')
    })
  )
  expect(new Set(styles).size).toBe(1)
  const heart = (await page.locator('.fight-hud--overworld .aui-health').boundingBox())!
  const tokens = (await page.locator('.fight-hud--overworld .aui-vital-tokens').boundingBox())!
  expect(heart.width).toBeGreaterThanOrEqual(68)
  expect(tokens.y).toBeGreaterThanOrEqual(heart.y + heart.height)
  expect((await page.locator('.aui-hud-shortcut-row > button').first().boundingBox())!.width).toBe(40)
  await page.screenshot({ path: '/private/tmp/mobile-hud-spacing.png' })
})

test('job resource cards contain names, levels, yields and XP on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await workshop(page, 'Jobs')
  await page.locator('.jobs__list-row').filter({ hasText: 'Farmer' }).click()
  const cards = page.locator('.jobs__gather-rows .jobs__table-row')
  await expect(cards.first()).toContainText('Wheat')
  for (const viewport of [
    { width: 844, height: 390 },
    { width: 980, height: 640 },
  ]) {
    await page.setViewportSize(viewport)
    const cropped = await cards.evaluateAll((nodes) =>
      nodes.flatMap((card) => {
        const bounds = card.getBoundingClientRect()
        return [...card.querySelectorAll('.jobs__col-name, .jobs__col-req, .jobs__col-yield, .jobs__col-xp')]
          .filter((text) => {
            const rect = text.getBoundingClientRect()
            return rect.bottom > bounds.bottom - 3 || rect.right > bounds.right - 3 || rect.top < bounds.top + 3
          })
          .map((text) => text.textContent)
      })
    )
    expect(cropped).toEqual([])
  }
  await page.screenshot({ path: '/private/tmp/mobile-jobs-resource-text.png' })
})
