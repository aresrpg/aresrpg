// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Locator, type Page } from '@playwright/test'

const drag = async (page: Page, from: Locator, to: Locator) => {
  const start = (await from.boundingBox())!,
    end = (await to.boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 })
  await page.mouse.up()
}

test('initial discovery failure can refresh without reopening inventory', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&agent-fail')
  const agent = page.getByRole('region', { name: 'Agent kiosk' })
  await expect(agent.getByRole('alert')).toBeVisible()
  await agent.getByRole('button', { name: 'Refresh inventory' }).click()
  await expect(agent.getByRole('button', { name: 'Siluri', exact: true })).toBeVisible()
})

test('both balance buttons offer both directions, exact Max and safe KARES unavailability', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?agent')
  const agent = page.getByRole('region', { name: 'Agent kiosk' })
  await agent.getByRole('button', { name: 'SUI', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Transfer SUI', exact: true })
  await expect(modal.locator('.agent-coin-directions').getByRole('button', { name: 'Deposit to agent' })).toBeEnabled()
  await expect(
    modal.locator('.agent-coin-directions').getByRole('button', { name: 'Withdraw to player' })
  ).toHaveAttribute('aria-pressed', 'true')
  await modal.getByRole('button', { name: 'MAX', exact: true }).click()
  await expect(modal.getByLabel('SUI amount', { exact: true })).toHaveValue('3.948000000')
  await expect.poll(() => page.evaluate(() => window.agent_confirmed.length)).toBe(0)
  await modal.locator('.agent-coin-actions').getByRole('button', { name: 'Withdraw to player' }).click()
  await expect.poll(() => page.evaluate(() => window.agent_confirmed.length)).toBe(1)
  await expect(modal).not.toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Transfer review', exact: true })).toHaveCount(0)
  await agent.getByRole('button', { name: 'KARES', exact: true }).click()
  const kares = page.getByRole('dialog', { name: 'Transfer KARES', exact: true })
  await expect(kares).toContainText('Not configured for this deployment')
  await kares.getByLabel('KARES amount', { exact: true }).fill('1')
  await expect(kares.locator('.agent-coin-actions').getByRole('button').first()).toBeDisabled()
  await kares.locator('.agent-coin-directions').getByRole('button', { name: 'Deposit to agent' }).click()
  await expect(kares.locator('.agent-coin-actions').getByRole('button').first()).toBeDisabled()
})

test('a drag follows the cursor and shows an unavailable destination until offer and claim complete', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&pending-transfer')
  const player = page.locator('[data-inventory-owner="player"]'),
    agent = page.locator('[data-inventory-owner="agent"]')
  await player.getByRole('button', { name: 'Resources', exact: true }).click()
  const item = player.getByRole('button', { name: 'Wheat', exact: true })
  const start = (await item.boundingBox())!,
    end = (await agent.boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 })
  await expect(page.locator('.aui-selection-drag')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.aui-selection-drag')).toHaveCount(0)
  await expect(agent.locator('.is-incoming')).toHaveAttribute('aria-busy', 'true')
  await expect(agent.locator('.is-incoming')).toBeDisabled()
  await expect(agent.locator('.is-incoming')).toHaveCSS('border-style', 'dashed')
  const spinner = agent.locator('.is-incoming .inventory-item-pending')
  await expect(spinner).toHaveCSS('width', '12px')
  await expect(spinner).toHaveCSS('bottom', '3px')
  await expect(spinner).toHaveCSS('right', '3px')
  await expect(spinner).toHaveCSS('border-top-color', 'rgb(138, 189, 225)')
  await page.screenshot({ path: test.info().outputPath('pending-inventory.png'), animations: 'disabled' })
  await expect.poll(() => page.evaluate(() => window.agent_prepared.at(-1)?.intent.kind)).toBe('asset_offer')
  await page.evaluate(() => window.resolve_agent_transaction())
  await expect.poll(() => page.evaluate(() => window.agent_prepared.at(-1)?.intent.kind)).toBe('asset_claim')
  await expect(agent.locator('.is-incoming')).toBeVisible()
  await page.evaluate(() => window.resolve_agent_transaction())
  await expect.poll(() => page.evaluate(() => window.agent_confirmed.length)).toBe(2)
  await expect(agent.locator('.is-incoming')).toHaveCount(0)
  expect(await page.evaluate(() => window.agent_confirmed.map(({ intent }) => intent.kind))).toEqual([
    'asset_offer',
    'asset_claim',
  ])
})

test('withdrawing a stack automatically claims it for the player', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?agent')
  const player = page.locator('[data-inventory-owner="player"]'),
    agent = page.locator('[data-inventory-owner="agent"]')
  await agent.getByRole('button', { name: 'Resources', exact: true }).click()
  await drag(page, agent.getByRole('button', { name: 'Wheat', exact: true }), player)
  await expect.poll(() => page.evaluate(() => window.agent_confirmed.length)).toBe(2)
  const operations = await page.evaluate(() => window.agent_confirmed)
  expect(operations[0]).toMatchObject({
    sender: '0xagent',
    intent: {
      kind: 'asset_offer',
      items: [{ item_id: 'agent-0xitem9' }, { item_id: 'agent-0xitem10' }],
      recipient: '0xowner',
    },
  })
  expect(operations[1]).toMatchObject({ sender: '0xowner', intent: { kind: 'asset_claim' } })
})

for (const width of [844, 667]) {
  test(`agent and player inventory retain square section tops at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 390 })
    await page.goto('/e2e/fixtures/inventory.html?agent')
    // This standalone fixture has no game window; supply its ordinary viewport container boundary.
    await page.locator('#root').evaluate((root) => {
      root.style.container = 'aui-viewport / size'
      root.style.height = '100dvh'
    })
    const sections = page.locator('.chr-equip__bag, .agent-kiosk, .inv__doll')
    for (const section of await sections.all()) {
      await expect(section).toHaveCSS('border-top-left-radius', '0px')
      await expect(section).toHaveCSS('border-top-right-radius', '0px')
    }
    await expect(
      page.getByRole('region', { name: 'Agent kiosk' }).getByRole('button', { name: 'Siluri', exact: true })
    ).toBeVisible()
    await page.screenshot({ path: test.info().outputPath(`inventory-${width}.png`), animations: 'disabled' })
  })
}
