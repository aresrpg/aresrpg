// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from '@playwright/test'

import { open_responsive_preview } from '../support/responsive_preview.ts'

for (const width of [1920, 1366, 1024]) {
  test(`shell and world share geometry at ${width}px without losing account controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world&locale=fr')
    const sidebar = page.locator('[data-app-sidebar]')
    const header = page.locator('[data-app-header]')
    const frame = page.locator('[data-world-frame]')
    await expect(sidebar).toBeVisible()
    const side = (await page.locator('[data-app-account-panel]').boundingBox())!
    expect(side.width).toBeGreaterThan(0)
    expect(side.width).toBeLessThanOrEqual(200)
    const tab = (await header.boundingBox())!
    const world = (await frame.boundingBox())!
    expect(Math.abs(tab.x - world.x)).toBeLessThan(1)
    expect(world.y).toBeGreaterThan(tab.y + tab.height)
    expect(world.y - tab.y - tab.height).toBeLessThanOrEqual(16)
    const connection = (await page.locator('[data-connection-card]').boundingBox())!
    expect(connection.y + connection.height).toBeLessThanOrEqual(768)
    expect(connection.width).toBe(side.width)
    await page.locator('[data-wallet-trigger]').click()
    for (const button of await page.locator('[data-wallet-card] button').all()) {
      await button.scrollIntoViewIfNeeded()
      await expect(button).toBeInViewport()
    }
    await page.keyboard.press('Escape')
    const chat = (await page.locator('.gw-worldchat').boundingBox())!
    const map = (await page.locator('[data-minimap]').boundingBox())!
    expect(world.y + world.height - chat.y - chat.height).toBeLessThanOrEqual(20)
    expect(world.x + world.width - map.x - map.width).toBeLessThanOrEqual(20)
    await page.screenshot({ path: `test-results/responsive-shell-${width}.png` })
  })
}

test('narrow marketplace preserves buying, sale controls, and complete history', async ({ page }) => {
  await page.setViewportSize({ width: 590, height: 850 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=marketplace&locale=de')
  // This layout fixture already selects and hydrates the hat page without a server observer.
  await expect(page.locator('[data-marketplace-listing-row]')).toHaveCount(5)
  const buy = page.locator('[data-marketplace-listing-row] button').last()
  await buy.scrollIntoViewIfNeeded()
  await expect(buy).toBeInViewport()
  await page.getByRole('tab').nth(1).click()
  await page.locator('.market-inventory button').last().click()
  const form = page.locator('.market-sale-form')
  await form.locator('input').fill('1')
  await form.getByRole('button', { name: '×1000', exact: true }).click()
  await expect(form.getByRole('button', { name: 'Zum Verkauf anbieten', exact: true })).toBeEnabled()
  await page.getByRole('tab').nth(2).click()
  await expect(page.locator('.market-history-row')).toHaveCount(30)
  await page.locator('.market-history > div:last-child > button').click()
  await expect(page.locator('.market-history-row')).toHaveCount(35)
  const last = page.locator('.market-history-row').last()
  await expect(last).toContainText('1,25')
  await expect(last).toContainText('Käufer')
  const overflow = await page.locator('.app-content').evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('phone picker search, selection, and close remain reachable in a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 })
  await page.goto('/e2e/fixtures/interaction.html')
  await page.getByRole('button', { name: 'Open picker', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Items', exact: true })
  const search = picker.getByPlaceholder('Search items')
  await expect(search).toBeFocused()
  await expect(search).toHaveCSS('font-size', '16px')
  await search.fill('Item 39')
  await picker.getByRole('button', { name: 'Item 39 Hat', exact: true }).click()
  await expect(page.getByLabel('Selected item')).toHaveText('39')
  await page.getByRole('button', { name: 'Open picker', exact: true }).click()
  const close = picker.getByRole('button', { name: 'Close', exact: true })
  await expect(close).toBeInViewport()
  const box = (await close.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
  await close.click()
  await expect(picker).toHaveCount(0)
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click()
  const wallet = page.getByRole('dialog', { name: 'Wallet', exact: true })
  await wallet.getByRole('button', { name: 'Close wallet', exact: true }).click()
  await expect(wallet).toHaveCount(0)
})

test('narrow encyclopedia keeps filters on back and exposes ordinary and rare resource links', async ({ page }) => {
  await page.setViewportSize({ width: 590, height: 850 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=encyclopedia')
  const search = page.locator('.enc-browser__list input').first()
  await search.fill('Fuwa Hat')
  await page
    .locator('.enc-browser__list')
    .getByRole('button', { name: /^Fuwa Hat /i })
    .click()
  await expect(page.locator('.enc-browser__list')).toBeHidden()
  await page.locator('.enc-browser__back').click()
  await expect(search).toHaveValue('Fuwa Hat')
  for (const tab of await page.locator('.enc-page > nav button').all()) {
    await tab.click()
    await expect(tab).toBeInViewport()
  }
  for (const index of [0, 1]) {
    await page.locator('.enc-page > nav button').nth(3).click()
    await page
      .locator('.enc-browser__list')
      .getByRole('button', { name: /^Herbalist\b/i })
      .click()
    const resource = page
      .locator('.enc-gather-row')
      .filter({ has: page.locator('button') })
      .first()
      .getByRole('button')
      .nth(index)
    const name = await resource.locator('span').last().innerText()
    await resource.click()
    await expect(page.locator('.enc-browser__detail')).toContainText(name)
  }
})

test('narrow Kolizeum keeps the wager review and cancellation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 590, height: 850 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=kolizeum')
  await page.locator('.kz-lobby').last().click()
  await page.locator('.kz-join-side.is-b').click()
  const review = page.locator('.kz-join-confirm')
  await expect(review).toContainText('1.25')
  for (const button of await review.getByRole('button').all()) {
    await expect(button).toBeInViewport()
    await expect.poll(async () => (await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await review.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(review).toHaveCount(0)
})

test('narrow staking preserves both accounts and withdrawal limits', async ({ page }) => {
  await page.setViewportSize({ width: 626, height: 850 })
  await page.goto('/e2e/fixtures/staking.html')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await page.getByRole('button', { name: 'Test wallet', exact: true }).click()
  const account = page.locator('[data-staking-account="0xparticipant"]')
  const external = page.locator('[data-staking-account="0xexternal"]')
  await expect(account).toBeVisible()
  await expect(external).toBeVisible()
  await external.getByRole('button', { name: 'Withdraw stake', exact: true }).click()
  await external.getByRole('textbox').fill('31')
  await expect(external.getByRole('button', { name: 'Withdraw stake', exact: true }).last()).toBeDisabled()
  await external.getByRole('button', { name: 'Max', exact: true }).click()
  await expect(external.getByRole('textbox')).toHaveValue('30.000000000')
  const overflow = await page
    .locator('[data-page-slot]')
    .evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

// Keep the full shell while exercising a phone-sized routed-content container.
for (const width of [590, 920, 1920]) {
  test(`character controls remain reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=equipment')
    for (const tab of ['equipment', 'stats', 'spells', 'jobs', 'runeforge']) {
      await page.locator(`[data-character-detail-tab="${tab}"]`).click()
      const body = page.locator(
        { equipment: '.chr-equip', stats: '.stats', spells: '.sb', jobs: '.jobs', runeforge: '.chr-forge' }[tab]!
      )
      await expect(body).toBeVisible()
      await expect(async () => {
        const overflow = await page
          .locator('.app-content')
          .evaluate((element) => element.scrollWidth - element.clientWidth)
        expect(overflow).toBeLessThanOrEqual(1)
      }).toPass()
    }
    await page.locator('[data-character-detail-tab="jobs"]').click()
    await page.locator('.jobs__recipe').first().click()
    await expect(page.locator('.jobs__item-detail')).toBeVisible()
    await page.locator('.jobs__detail-close').click()
    await expect(page.locator('.jobs__browse')).toBeVisible()
    await page.locator('[data-character-detail-tab="equipment"]').click()
    await page.locator('.chr-equip__grid button').last().click({ button: 'right' })
    const recipes = page.getByRole('link', { name: 'View recipes', exact: true })
    await expect(recipes).toBeInViewport()
    await recipes.click()
    await expect(page.locator('.chr-tabs')).toHaveCount(0)
  })
}

for (const viewport of [
  { width: 1024, height: 600 },
  { width: 800, height: 500 },
  { width: 640, height: 360 },
]) {
  test(`zoom-sized world overlays fit at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
    const bounds = (selector: string) => page.locator(selector).boundingBox()
    await expect(page.locator('.gw-minimap__frame')).toBeVisible()
    const world = (await bounds('[data-world-frame]'))!
    const map = (await bounds('.gw-minimap__frame'))!
    const chat = (await bounds('.gw-worldchat'))!
    const hud = (await bounds('.fight-hud--overworld .fight-hud__bar'))!
    // Small viewports retain the minimap’s 96px readability floor.
    expect(map.width).toBeGreaterThanOrEqual(96)
    expect(map.width).toBeLessThanOrEqual(Math.max(96, world.height * 0.31))
    expect(chat.height).toBeLessThanOrEqual(Math.min(320, world.height * 0.4) + 1)
    for (const box of [map, chat, hud]) {
      expect(box.x).toBeGreaterThanOrEqual(world.x)
      expect(box.x + box.width).toBeLessThanOrEqual(world.x + world.width + 1)
      expect(box.y + box.height).toBeLessThanOrEqual(world.y + world.height + 1)
    }
    expect(chat.x + chat.width <= hud.x || hud.y + hud.height <= chat.y).toBe(true)
    await page.screenshot({ path: `test-results/compact-world-${viewport.width}.png` })
  })

  test(`all six stat controls remain reachable at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=stats')
    const rows = page.locator('.stats__card--primary .stats__prow')
    await expect(rows).toHaveCount(6)
    for (const row of await rows.all()) {
      const add = row.getByRole('button').last()
      await add.scrollIntoViewIfNeeded()
      await expect(add).toBeInViewport()
      await add.click()
      await expect(row.locator('.stats__prow-pending')).toBeVisible()
    }
    const clipping = await page.locator('.stats__scroll').evaluate((element) => getComputedStyle(element).overflowY)
    expect(clipping).toBe('visible')
    await page.locator('.stats__assign').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `test-results/compact-stats-${viewport.width}.png` })
  })
}

test('zoom-sized spells, jobs and forge expose complete inner panels', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=spells')
  for (const [tab, panel, inner] of [
    ['spells', '.sb', '.sb__rows'],
    ['jobs', '.jobs', '.jobs__browse'],
    ['runeforge', '.chr-forge', '.chr-forge__panels'],
  ]) {
    await page.locator(`[data-character-detail-tab="${tab}"]`).click()
    await expect(page.locator(panel!)).toBeVisible()
    expect(await page.locator(inner!).evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible')
    expect(
      await page.locator('.app-content').evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeLessThanOrEqual(1)
    const last = page.locator(panel!).getByRole('button').last()
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport()
    await page.locator('.app-content').evaluate((element) => {
      element.scrollTop = 0
    })
    await page.screenshot({ path: `test-results/compact-${tab}.png` })
  }
})

for (const width of [1920, 1366, 1024, 800]) {
  test(`overworld HUD stays as close to world center as chat allows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
    const hud = page.locator('.fight-hud--overworld .fight-hud__bar')
    await expect(hud).toBeVisible()
    const frame = (await page.locator('[data-world-frame]').boundingBox())!
    const chat = (await page.locator('.gw-worldchat').boundingBox())!
    const box = (await hud.boundingBox())!
    const ideal_left = frame.x + (frame.width - box.width) / 2
    expect(Math.abs(box.x - Math.max(ideal_left, chat.x + chat.width + 10))).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `test-results/centered-hud-${width}.png` })
  })
}

test('roomy desktop preserves the original single-column 600px stat sheet', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=stats')
  const sheet = page.locator('.stats')
  await expect(sheet).toBeVisible()
  expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(600)
  const rows = await page.locator('.stats__card--primary .stats__prow').all()
  const first = (await rows[0]!.boundingBox())!
  const second = (await rows[1]!.boundingBox())!
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1)
})

for (const height of [801, 900, 1100]) {
  test(`stats never clip allocation rows above the compact breakpoint at height ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=stats')
    const card = page.locator('.stats__card--primary')
    await expect(card).toBeVisible()
    // Visibility alone misses children painted outside their parent's overflow clip.
    expect(await card.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1)
    for (const row of await card.locator('.stats__prow').all()) {
      const add = row.getByRole('button').last()
      await add.scrollIntoViewIfNeeded()
      await add.click()
      await expect(row.locator('.stats__prow-pending')).toBeVisible()
    }
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 600 },
  { width: 800, height: 500 },
]) {
  test(`complete character workspaces fit without scrolling at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=stats')
    for (const tab of ['stats', 'spells', 'runeforge']) {
      await page.locator(`[data-character-detail-tab="${tab}"]`).click()
      const workspace = page.locator(`[data-workspace="${tab}"]`)
      const sheet = workspace.locator('.character-workspace__content')
      await expect(workspace).toBeVisible()
      await expect(async () => {
        const box = (await workspace.boundingBox())!
        const content = (await sheet.boundingBox())!
        expect(Math.abs(content.x - box.x - (box.width - content.width) / 2)).toBeLessThanOrEqual(1)
        expect(content.x + content.width).toBeLessThanOrEqual(box.x + box.width + 1)
        expect(content.y + content.height).toBeLessThanOrEqual(box.y + box.height + 1)
        const overflow = await page.locator('.chr-page-body').evaluate((el) => el.scrollHeight - el.clientHeight)
        expect(overflow).toBeLessThanOrEqual(1)
      }).toPass()
      if (tab === 'stats') {
        for (const button of await sheet.locator('.stats__prow button:last-child').all()) {
          await expect(button).toBeInViewport()
          await button.click()
        }
      }
      await page.screenshot({ path: `test-results/fit-${tab}-${viewport.width}.png` })
    }
  })
}

for (const height of [360, 600, 900, 1440]) {
  test(`sidebar preserves desktop text and cards remain reachable at ${height}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
    const sidebar = page.locator('[data-app-account-panel]')
    const scroll = sidebar.locator('.sidebar-viewport__content')
    await expect(sidebar).toBeVisible()
    await expect(sidebar).toHaveCSS('width', '200px')
    await expect(scroll).toHaveCSS('transform', 'none')
    await expect(page.locator('[data-page="world"] span').first()).toHaveCSS('font-size', '11px')
    const footer = page.locator('[data-connection-card]')
    const before = (await footer.boundingBox())!
    for (const selector of [
      '[data-app-sidebar] button[data-page="settings"]',
      '[data-language-card] button',
      '[data-public-sale-card]',
    ]) {
      const control = sidebar.locator(selector).first()
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport()
      await expect(footer).toBeInViewport({ ratio: 0.999 })
    }
    expect((await footer.boundingBox())!.y).toBeCloseTo(before.y, 1)
    expect(await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    if (height <= 900) expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await page.screenshot({ path: `test-results/readable-sidebar-${height}.png` })
  })
}

for (const height of [500, 1440]) {
  test(`layout anchors survive sidebar scrolling at ${height}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=stats')
    await expect(page.locator('.stats')).toBeVisible()
    await expect(async () => {
      const sidebar = (await page.locator('[data-app-account-panel]').boundingBox())!
      const account = (await page.locator('[data-app-account-panel]').boundingBox())!
      const footer = (await page.locator('[data-connection-card]').boundingBox())!
      const pane = (await page.locator('[data-app-content]').boundingBox())!
      const gap = await page.locator('.app-shell-row').evaluate((el) => parseFloat(getComputedStyle(el).gap))
      expect(Math.abs(pane.x - sidebar.x - sidebar.width - gap)).toBeLessThanOrEqual(1)
      expect(Math.abs(footer.y + footer.height - account.y - account.height)).toBeLessThanOrEqual(1)
      const stats = (await page.locator('.stats').boundingBox())!
      expect(Math.abs(stats.x + stats.width / 2 - pane.x - pane.width / 2)).toBeLessThanOrEqual(1)
    }).toPass()
    await page.locator('[data-character-detail-tab="equipment"]').click()
    const bag = (await page.locator('.chr-equip__bag').boundingBox())!
    const body = (await page.locator('.chr-page-body').boundingBox())!
    expect(bag.y + bag.height).toBeGreaterThanOrEqual(body.y + body.height - 17)
    await page.screenshot({ path: `test-results/anchored-equipment-${height}.png` })
  })
}

test('the bottom border stays inside the sidebar clip with fractional card sizes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 601 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=world')
  await expect(page.locator('[data-connection-card]')).toBeVisible()
  // Font metrics and zoom produce fractional heights; integer DOM measurements must not clip the border.
  await page.addStyleTag({
    content:
      '.sidebar-viewport__content > :first-child { height: 2000.49px; } [data-connection-card] { height: 200.49px; }',
  })
  await expect(async () => {
    const row = (await page.locator('.app-shell-row').boundingBox())!
    const footer = (await page.locator('[data-connection-card]').boundingBox())!
    // Allow one browser layout subpixel, not a whole pixel of hidden border.
    expect(footer.y + footer.height).toBeLessThanOrEqual(row.y + row.height + 1 / 64)
    expect(row.y + row.height - footer.y - footer.height).toBeLessThan(1)
  }).toPass()
})

test('roomy spells keep the original centered list and equipment stays top aligned', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=spells')
  await expect(page.locator('.sb')).toBeVisible()
  const pane = (await page.locator('.chr-page-body').boundingBox())!
  const spellbook = (await page.locator('.sb').boundingBox())!
  expect(spellbook.width).toBe(1280)
  expect(Math.abs(spellbook.x + spellbook.width / 2 - pane.x - pane.width / 2)).toBeLessThan(1)
  const rows = await page.locator('.sb__rowbtn').all()
  const first = (await rows[0]!.boundingBox())!
  const second = (await rows[1]!.boundingBox())!
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height)
  await page.screenshot({ path: 'test-results/restored-spells-desktop.png' })
  await page.locator('[data-character-detail-tab="equipment"]').click()
  await expect(page.locator('.chr-equip__chip')).toBeVisible()
  const equipment = (await page.locator('.chr-equip').boundingBox())!
  const identity = (await page.locator('.chr-equip__chip').boundingBox())!
  expect(identity.y - equipment.y).toBe(16)
})

test('roomy jobs retain the centered original sidebar and single resource table', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=jobs')
  await expect(page.locator('.jobs')).toBeVisible()
  const pane = (await page.locator('.chr-page-body').boundingBox())!
  const jobs = (await page.locator('.jobs').boundingBox())!
  expect(jobs.width).toBe(1440)
  expect(Math.abs(jobs.x + jobs.width / 2 - pane.x - pane.width / 2)).toBeLessThan(1)
  expect((await page.locator('.jobs__list').boundingBox())!.width).toBe(420)
  const rows = await page.locator('.jobs__table-row').all()
  const first = (await rows[0]!.boundingBox())!
  const second = (await rows[1]!.boundingBox())!
  expect(second.x).toBe(first.x)
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height)
  await page.screenshot({ path: 'test-results/restored-jobs-desktop.png' })
})

test('roomy Rune Forge preserves its centered original panel widths', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1600 })
  await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=runeforge')
  await expect(page.locator('.chr-forge')).toBeVisible()
  const pane = (await page.locator('.chr-page-body').boundingBox())!
  const forge = (await page.locator('.chr-forge').boundingBox())!
  expect(forge.width).toBe(1440)
  expect(Math.abs(forge.x + forge.width / 2 - pane.x - pane.width / 2)).toBeLessThan(1)
  expect((await page.locator('.chr-forge__inspection').boundingBox())!.width).toBe(300)
  expect((await page.locator('.chr-forge__inventory').boundingBox())!.width).toBe(320)
  await expect(page.locator('.chr-forge')).toHaveCSS('padding', '16px')
  await page.screenshot({ path: 'test-results/restored-runeforge-desktop.png' })
})

for (const width of [590, 1920]) {
  test(`marketplace shows both rolling volume windows at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=marketplace')
    await expect(page.locator('[data-marketplace-volume="24h"]')).toContainText('1,284.50')
    await expect(page.locator('[data-marketplace-volume="30d"]')).toContainText('5,678.90')
    await expect(page.locator('[data-marketplace-volume="24h"]')).toBeInViewport()
    await expect(page.locator('[data-marketplace-volume="30d"]')).toBeInViewport()
    await expect(page.locator('[data-marketplace-volume="30d"]')).toHaveAttribute(
      'title',
      'Public marketplace sales in the last 30 days, before fees.'
    )
    expect(await page.locator('.app-content').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `test-results/market-volumes-${width}.png` })
  })
}

for (const height of [500, 900]) {
  test(`opening a recipe keeps every job name readable at height ${height}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height })
    await open_responsive_preview(page, '/e2e/fixtures/responsive_preview.html?page=jobs')
    await page.locator('.jobs__recipe').first().click()
    await expect(page.locator('.jobs__item-detail')).toBeVisible()
    for (const name of await page.locator('.jobs__list-name').all()) {
      expect(await name.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: `test-results/job-names-${height}.png` })
  })
}
