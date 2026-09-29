import { expect, test } from '@playwright/test'

test('reference-sized windows preserve landscape bounds, allocation and focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/demo#ui')
  const navigation = page.locator('.ui-workshop-navigation')
  await expect(page.locator('.ui-workshop canvas')).toHaveCount(0)
  await navigation.getByRole('button', { name: 'Equipment', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-character-preview]')).toHaveCount(1)
  await expect(dialog.locator('.inventory-page-controls')).toHaveCount(0)
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 932, height: 430 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(async () => {
      const portrait = (await dialog.locator('.inv__portrait').boundingBox())!
      expect(portrait.x).toBeGreaterThanOrEqual(0)
      expect(portrait.width).toBeGreaterThan(60)
      if (viewport.height < 500) {
        const scrolls = await dialog
          .locator('[data-character-panel]')
          .evaluate((root) =>
            [root, ...root.querySelectorAll('*')]
              .filter(
                (el) =>
                  ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1
              )
              .map((el) => el.className)
          )
        expect(scrolls).toEqual([])
      }
    }).toPass()
  }
  await page.keyboard.press('Escape')
  await navigation.getByRole('button', { name: 'Stats', exact: true }).click()
  await expect(dialog.locator('.aui-character-sheet')).toBeVisible()
  await expect(dialog.locator('.aui-attribute-copy p')).toHaveCount(6)
  await expect(dialog.getByRole('button', { name: /^(Summary|Details|Allocate)$/ })).toHaveCount(0)
  const rows_before = await dialog.locator('.aui-attribute-list').boundingBox()
  await dialog.getByRole('button', { name: 'Add a point to Vitality', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled()
  expect(await dialog.locator('.aui-attribute-list').boundingBox()).toEqual(rows_before)
  const footer = (await dialog.locator('.aui-character-points').boundingBox())!
  expect(footer.y + footer.height).toBeLessThanOrEqual(390)
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-character-preview]')).toHaveCount(0)
  await navigation.getByRole('button', { name: 'Controls', exact: true }).click()
  const trigger = page.getByRole('button', { name: 'Open dialog', exact: true })
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await navigation.getByRole('button', { name: 'Combat', exact: true }).click()
  await expect(page.locator('.aui-health-fill')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toHaveCount(0)
  const slot = page.locator('.fight-hud__spell').first(),
    box = (await slot.boundingBox())!,
    icon = (await slot.locator('img').boundingBox())!
  expect(icon.width).toBeGreaterThan(box.width * 0.85)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.ui-workshop-rotate')).toBeVisible()
})

test('mobile preview renders the same inventory in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/demo#ui')
  await page.getByRole('button', { name: 'Mobile · 932 × 430', exact: true }).click()
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
  const frame = page.locator('.aui-preview-surface')
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(frame.locator('[data-character-panel="equipment"]')).toBeVisible()
  await expect(frame.locator('[data-character-preview]')).toHaveCount(1)
  const box = (await frame.boundingBox())!
  expect(box.width).toBeGreaterThan(box.height)
  expect(box.height).toBeLessThanOrEqual(430)
})

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

test('profession level-up resolves the canonical job and renders its unlock', async ({ page }) => {
  await page.goto('/demo#ui')
  await page
    .locator('.ui-workshop-navigation')
    .getByRole('button', { name: 'Profession level up', exact: true })
    .click()
  await expect(page.getByRole('dialog', { name: 'Profession level up', exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.locator('.aui-progression header')).toContainText('Miner')
  await expect(page.locator('.aui-progression-hero .aui-job-emblem .lucide-pickaxe')).toBeVisible()
  await expect(page.locator('.aui-progression-hero img')).toHaveCount(0)
  await expect(page.locator('.aui-unlocks .aui-reward img')).toHaveCount(1)
})

test('mob details retain tappable spell rules and loot quantities on landscape', async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Mob group', exact: true }).click()
  await page.locator('.aui-mob-spells button').first().click()
  await expect(page.locator('[data-spell-detail-card]')).toBeVisible()
  await expect(page.locator('[data-spell-ap-cost]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.aui-mob')).toBeVisible()
  await page.locator('.aui-mob-loot button').first().click()
  await expect(page.locator('.aui-drop-facts')).toContainText('Quantity')
  await expect(page.locator('.aui-drop-facts')).toContainText('%')
  await expect(page.locator('[data-item-detail-view]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.aui-mob')).toBeVisible()
})

test('item details keep full titles and compose the guarded crafting controls', async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search inventory…' }).fill('Gale Lorito')
  await page.locator('.chr-cell:not(.chr-cell--empty)').first().click()
  const detail = page.locator('.chr-equip__detail')
  await expect(detail.locator('.jobs__craft')).toBeVisible()
  await expect(detail.locator('.jobs__craft-btn')).toBeDisabled()
  await expect(detail.getByRole('spinbutton')).toHaveValue('1')
  expect(await detail.locator('[data-item-detail-name]').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(
    true
  )
  const card = (await detail.boundingBox())!
  expect(card.y).toBeGreaterThanOrEqual(0)
  expect(card.y + card.height).toBeLessThanOrEqual(430)
  await page.setViewportSize({ width: 844, height: 390 })
  const compact_card = (await detail.boundingBox())!
  expect(compact_card.y).toBeGreaterThanOrEqual(0)
  expect(compact_card.y + compact_card.height).toBeLessThanOrEqual(390)
  await detail.locator('.jobs__ingredient').first().click()
  await expect(page.locator('.aui-inspection--item')).toBeVisible()
  await page.locator('.aui-inspection--item').last().locator('.jobs__ingredient').first().click()
  const resource = page.locator('.aui-inspection--item').last()
  await expect(resource.locator('.jobs__craft')).toHaveCount(0)
  expect((await resource.boundingBox())!.width).toBeLessThanOrEqual(560)
  await expect(resource.locator('.aui-item-sources')).toBeVisible()
})

test('combat forfeit and character level-up use the same interactive shared surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 })
  await page.goto('/demo#ui')
  const navigation = page.locator('.ui-workshop-navigation')
  await navigation.getByRole('button', { name: 'Combat', exact: true }).click()
  await page.locator('.aui-combat-utilities button').click()
  await expect(page.locator('.aui-confirm')).toBeVisible()
  await page.keyboard.press('Escape')
  await navigation.getByRole('button', { name: 'Level up', exact: true }).click()
  await expect(page.locator('.aui-progression-hero')).toContainText('100')
  await page.getByRole('button', { name: 'Allocate points', exact: true }).click()
  await expect(page.locator('.aui-character-sheet')).toBeVisible()
})

test('item actions reuse confirmation flows without permitting local destructive writes', async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search inventory…' }).fill('Gale Lorito')
  const first_item = page.locator('.chr-cell:not(.chr-cell--empty)').first()
  await first_item.click()
  const actions = page.locator('.inventory-item-actions')
  await expect(actions.getByRole('button', { name: 'Equip', exact: true })).toBeVisible()
  await expect(actions.getByRole('button', { name: 'Select', exact: true })).toBeVisible()
  await actions.getByRole('button', { name: /Crush/ }).click()
  await expect(page.locator('[data-crush-selection]')).toBeVisible()
  await expect(page.locator('.aui-item-confirm .aui-button--danger')).toBeDisabled()
  await page.keyboard.press('Escape')
  await first_item.click()
  await actions.getByRole('button', { name: 'Destroy', exact: true }).click()
  await expect(page.locator('.aui-item-confirm')).toContainText('Gale Lorito')
  await expect(page.locator('.aui-item-confirm .aui-button--danger')).toBeDisabled()
  await page.keyboard.press('Escape')
  await first_item.click()
  await actions.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(first_item).toHaveAttribute('aria-pressed', 'true')
  await first_item.click()
  await actions.getByRole('button', { name: 'Deselect', exact: true }).click()
  await expect(first_item).toHaveAttribute('aria-pressed', 'false')
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

test('a drag onto an equipment slot still stages the item without moving the preview', async ({ page }) => {
  await page.setViewportSize({ width: 932, height: 430 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
  const item = (await page.locator('.chr-equip__grid [data-selection-id]').first().boundingBox())!
  const hat = page.locator('[data-equipment-slot="hat"]'),
    slot = (await hat.boundingBox())!
  const preview = await page.locator('.inv__portrait').boundingBox()
  await page.mouse.move(item.x + 20, item.y + 20)
  await page.mouse.down()
  await page.mouse.move(slot.x + 20, slot.y + 20, { steps: 12 })
  await page.mouse.up()
  await expect(hat).toHaveClass(/is-filled/)
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
  expect(await page.locator('.inv__portrait').boundingBox()).toEqual(preview)
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

test('spell details retain every rule and keep critical information unbroken in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Spells', exact: true }).click()
  const card = page.locator('.sb__detail')
  await expect(card.locator('[data-spell-ap-cost]')).toBeVisible()
  for (const label of [
    'RANGE MODIFIABILITY',
    'LINE OF SIGHT',
    'CAST LINE',
    'MUST BE EMPTY',
    'CASTS / TURN',
    'CASTS / TARGET',
    'COOLDOWN',
  ]) {
    const row = card.getByText(label, { exact: true })
    await expect(row).toBeVisible()
    const bounds = (await row.boundingBox())!,
      window = (await card.boundingBox())!
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(window.y + window.height)
  }
  const critical = card.locator('[data-spell-critical-badge]')
  await expect(critical.first()).toBeVisible()
  expect(await critical.first().evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('nowrap')
  expect(await card.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
})

test('mob spell subtitle omits invented unlock requirements and rank controls do not scroll', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Mob group', exact: true }).click()
  await page.locator('.aui-mob-spells button').first().click()
  const card = page.locator('.aui-inspection--spell')
  await expect(card.locator('.spell-unlock')).toHaveText('Spell level 1')
  await expect(card.locator('.spell-rank-button')).toHaveAttribute('aria-pressed', 'true')
  expect(
    await card
      .locator('[data-spell-level-tabs]')
      .evaluate((el) => ({ vertical: el.scrollHeight > el.clientHeight, horizontal: el.scrollWidth > el.clientWidth }))
  ).toEqual({ vertical: false, horizontal: false })
})

test('service catalogue bounds mobile windows while allowing collection scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  const navigation = page.locator('.ui-workshop-navigation')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const name of [
    'Minimap',
    'World map',
    'Trade',
    'Mastery',
    'Your stake. Your share.',
    'Marketplace',
    'Airdrops',
    'Jobs',
    'Runeforge',
    'Leaderboard',
    'Encyclopedia',
    'Kolizeum',
    'Admin',
    'Settings',
    'Account',
    'Language',
    'Connected',
  ]) {
    await navigation.getByRole('button', { name, exact: true }).click()
    const dialogs = page.locator('dialog[open]')
    if (await dialogs.count()) {
      await expect(async () => {
        const bounds = (await dialogs.last().boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(845)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(391)
        const window = dialogs.last().locator(':scope > .aui-window')
        if (await window.count()) {
          const panel = (await window.boundingBox())!
          expect(panel.x).toBeGreaterThanOrEqual(0)
          expect(panel.y).toBeGreaterThanOrEqual(0)
          expect(panel.x + panel.width).toBeLessThanOrEqual(845)
          expect(panel.y + panel.height).toBeLessThanOrEqual(391)
        }
        expect(await dialogs.last().innerText()).not.toContain('{{')
      }).toPass()
      await page.keyboard.press('Escape')
    }
  }
  expect(errors).toEqual([])
})

test('nested map and account launchers reopen after dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  const navigation = page.locator('.ui-workshop-navigation')
  await navigation.getByRole('button', { name: 'Minimap', exact: true }).click()
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('.aui-minimap-lens').click()
    await expect(page.locator('.aui-world-map')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.aui-world-map')).toHaveCount(0)
  }
  await navigation.getByRole('button', { name: 'Connected', exact: true }).click()
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('[data-wallet-trigger]').click()
    await expect(page.locator('[data-wallet-card]:popover-open')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-wallet-card]:popover-open')).toHaveCount(0)
  }
})

test('canonical settings and signed-out wallet remain usable in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  const navigation = page.locator('.ui-workshop-navigation')
  await navigation.getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Volume', exact: true }).click()
  const music = dialog.getByRole('switch', { name: 'Music', exact: true })
  await music.uncheck()
  await expect(music).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Quality', exact: true }).click()
  await dialog.getByRole('button', { name: 'Volume', exact: true }).click()
  await expect(music).not.toBeChecked()
  await page.keyboard.press('Escape')
  await navigation.getByRole('button', { name: 'Account', exact: true }).click()
  await page.locator('[data-wallet-trigger]').click()
  await expect(page.locator('[data-wallet-card]').getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
  await expect(
    page.locator('[data-wallet-card]').getByRole('link', { name: 'Sign in to play', exact: true })
  ).toBeVisible()
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

test('canonical marketplace sell remains reachable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  const navigation = page.locator('.ui-workshop-navigation')
  const dialog = page.getByRole('dialog')
  await navigation.getByRole('button', { name: 'Marketplace', exact: true }).click()
  await dialog.getByRole('button', { name: 'Sell', exact: true }).click()
  await expect(dialog.locator('.market-own-listings')).toBeVisible()
  await expect(dialog.locator('.market-sale-form')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Inspect', exact: true })).toHaveCount(0)
})

test('mastery assignment and staking rewards keep their account identity', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/demo#ui')
  const navigation = page.locator('.ui-workshop-navigation')
  await navigation.getByRole('button', { name: 'Mastery', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Start daily quest', exact: true }).click()
  await expect(dialog.locator('.mastery-quests')).toContainText('Nauvis')
  await expect(dialog.locator('.mastery-quests')).not.toContainText('Unknown dungeon')
  await expect(dialog.locator('[data-world-card]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await navigation.getByRole('button', { name: 'Your stake. Your share.', exact: true }).click()
  const accounts = dialog.locator('.staking-account')
  await expect(accounts).toHaveCount(2)
  await expect(accounts.first()).toContainText('2,500')
  await expect(accounts.last()).toContainText('800')
  await accounts.first().getByRole('button', { name: 'Claim rewards', exact: true }).click()
  await expect(page.getByRole('dialog').last()).toContainText('no transaction is submitted')
  await page.keyboard.press('Escape')
  await expect(accounts.last().getByRole('button', { name: 'Claim rewards', exact: true })).toBeEnabled()
})

for (const width of [1440, 844]) {
  test(`empty inventory space clears painted selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 390 })
    await page.goto('/demo#ui')
    await page.locator('.ui-workshop-navigation').getByRole('button', { name: 'Equipment', exact: true }).click()
    const cells = page.locator('.chr-equip__grid [data-selection-id]')
    const first = (await cells.nth(0).boundingBox())!
    const second = (await cells.nth(1).boundingBox())!
    await page.mouse.move(first.x + 20, first.y + 20)
    await page.mouse.down()
    await page.mouse.move(second.x + 20, second.y + 20, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(2)
    const gap = { x: first.x + first.width + 1, y: first.y + 20 }
    await page.mouse.click(gap.x, gap.y)
    await expect(page.locator('.chr-equip__grid [aria-pressed="true"]')).toHaveCount(0)
    await expect(page.locator('.chr-equip__detail')).toHaveCount(0)
    await cells.first().click()
    await expect(page.locator('.chr-equip__detail')).toBeVisible()
  })
}
