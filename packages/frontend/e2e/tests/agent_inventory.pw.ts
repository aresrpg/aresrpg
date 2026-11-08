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
  await expect(agent.getByRole('alert')).toHaveText('Synthetic inventory read failed')
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

test('dragging either stack direction submits every represented object without automatically claiming', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/inventory.html?agent')
  const player = page.locator('[data-inventory-owner="player"]'),
    agent = page.locator('[data-inventory-owner="agent"]')
  await player.getByRole('button', { name: 'Resources', exact: true }).click()
  await agent.getByRole('button', { name: 'Resources', exact: true }).click()
  await drag(page, player.getByRole('button', { name: 'Wheat', exact: true }), agent)
  await expect
    .poll(() => page.evaluate(() => window.agent_prepared.at(-1)?.intent))
    .toMatchObject({
      kind: 'asset_offer',
      items: [{ item_id: '0xitem9' }, { item_id: '0xitem10' }],
      recipient: '0xagent',
    })
  await expect.poll(() => page.evaluate(() => window.agent_confirmed.length)).toBe(1)
  await expect(agent.getByRole('button', { name: 'Wheat', exact: true })).toBeEnabled()
  await drag(page, agent.getByRole('button', { name: 'Wheat', exact: true }), player)
  await expect
    .poll(() => page.evaluate(() => window.agent_prepared.at(-1)?.intent))
    .toMatchObject({
      kind: 'asset_offer',
      items: [{ item_id: 'agent-0xitem9' }, { item_id: 'agent-0xitem10' }],
      recipient: '0xowner',
    })
  await expect.poll(() => page.evaluate(() => window.agent_confirmed.length)).toBe(2)
  expect(await page.evaluate(() => window.agent_confirmed.every(({ intent }) => intent.kind === 'asset_offer'))).toBe(
    true
  )
  await expect(page.getByRole('dialog', { name: 'Transfer review', exact: true })).toHaveCount(0)
})
