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

test('initial discovery failure exposes an explicit retry without a permanent refresh control', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&agent-fail')
  const agent = page.getByRole('region', { name: 'Agent kiosk' })
  await expect(agent.getByRole('alert')).toBeVisible()
  await expect(agent.getByRole('button', { name: 'Refresh inventory' })).toHaveCount(0)
  await agent.getByRole('button', { name: 'Try again' }).click()
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
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(0)
  await modal.locator('.agent-coin-actions').getByRole('button', { name: 'Withdraw to player' }).click()
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(1)
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
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(2)
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
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(2)
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

test('verified pending items recover automatically in one receipt group without manual item controls', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&pending-items')
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(1)
  const writes = await page.evaluate(() => window.agent_confirmed)
  expect(writes[0]).toMatchObject({ sender: '0xowner', intent: { kind: 'asset_claim' } })
  expect(writes[0]!.intent.kind === 'asset_claim' && writes[0]!.intent.items.length).toBe(2)
  for (const name of [
    'Claim selected items',
    'Cancel selected item returns',
    'Refresh inventory',
    'Withdraw to player',
  ])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
})

test('independent pending receipts never join one recovered selection', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&pending-items&independent-caps')
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(2)
  const writes = await page.evaluate(() => window.agent_confirmed)
  expect(writes.every(({ intent }) => intent.kind === 'asset_claim' && intent.items.length === 1)).toBe(true)
})

test('claim preflight errors show their cause and never loop across packet replay or inventory remount', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&pending-items&claim-failure')
  await expect(page.getByText('Fixture claim policy refused', { exact: true }).first()).toBeVisible()
  for (let index = 0; index < 3; index++)
    await page.evaluate(() => {
      window.replay_agent_inventory()
    })
  await page.getByRole('button', { name: 'Close inventory', exact: true }).click()
  await page.getByRole('button', { name: 'Open inventory', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.agent_prepared.length)).toBe(1)
  expect(await page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.agent_prepared.length)).toBe(0)
})

for (const outcome of ['uncertain', 'executed'])
  test(`an ${outcome} original drag claim cannot automatically replay as a recovery intent after reload`, async ({
    page,
  }) => {
    await page.goto(`/e2e/fixtures/inventory.html?agent&claim-outcome=${outcome}`)
    const player = page.locator('[data-inventory-owner="player"]'),
      agent = page.locator('[data-inventory-owner="agent"]')
    await player.getByRole('button', { name: 'Resources', exact: true }).click()
    await drag(page, player.getByRole('button', { name: 'Wheat', exact: true }), agent)
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.agent_prepared.map(({ intent }) => intent.kind))).toEqual([
      'asset_offer',
      'asset_claim',
    ])
    await page.reload()
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    expect(await page.evaluate(() => window.agent_prepared.length)).toBe(0)
    expect(await page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(0)
  })

test('a consumed cap stays fenced while discovery lags and indexed ownership alone retires its placeholder', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&stale-caps&hold-index')
  const player = page.locator('[data-inventory-owner="player"]'),
    agent = page.locator('[data-inventory-owner="agent"]')
  await player.getByRole('button', { name: 'Resources', exact: true }).click()
  await drag(page, player.getByRole('button', { name: 'Wheat', exact: true }), agent)
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(2)
  await expect(agent.locator('.is-incoming')).toBeVisible()
  for (let index = 0; index < 3; index++)
    await page.evaluate(() => {
      window.replay_agent_inventory()
    })
  expect(await page.evaluate(() => window.agent_prepared.length)).toBe(2)
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    window.release_agent_caps()
    window.release_agent_projection()
  })
  await expect(agent.locator('.is-incoming')).toHaveCount(0)
  expect(await page.evaluate(() => window.agent_prepared.length)).toBe(2)
})

test('pre-submission offer failure restores the source cell and removes the incoming placeholder', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&offer-failure')
  const player = page.locator('[data-inventory-owner="player"]'),
    agent = page.locator('[data-inventory-owner="agent"]')
  await player.getByRole('button', { name: 'Resources', exact: true }).click()
  await drag(page, player.getByRole('button', { name: 'Wheat', exact: true }), agent)
  await expect(page.getByText('Fixture offer refused', { exact: true }).first()).toBeVisible()
  await expect(agent.locator('.is-incoming')).toHaveCount(0)
  await expect(player.getByRole('button', { name: 'Wheat', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(0)
})

for (const action of ['close', 'wallet'])
  test(`pending item recovery cannot sign after ${action}`, async ({ page }) => {
    await page.goto('/e2e/fixtures/inventory.html?agent&pending-items&pending-transfer')
    await expect.poll(() => page.evaluate(() => window.agent_prepared?.[0]?.intent.kind)).toBe('asset_claim')
    if (action === 'close') await page.getByRole('button', { name: 'Close inventory', exact: true }).click()
    else await page.evaluate(() => window.replace_agent_wallet())
    await page.evaluate(() => window.resolve_agent_transaction())
    if (action === 'close') {
      await page.getByRole('button', { name: 'Open inventory', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    } else await expect(page.getByRole('button', { name: 'SUI', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => window.agent_confirmed.length)).toBe(0)
    expect(await page.evaluate(() => window.agent_prepared.length)).toBe(1)
  })

test('attempt-storage failure after a certified claim cannot turn success into an unhandled failure or a second claim', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    const storage = window.sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: (key: string) => storage.getItem(key),
        removeItem: (key: string) => storage.removeItem(key),
        setItem: (key: string, value: string) => {
          if (key.startsWith('aresrpg:item-claim-attempts:') && value.includes('complete'))
            throw new Error('Fixture quota failure')
          storage.setItem(key, value)
        },
      },
    })
  })
  await page.goto('/e2e/fixtures/inventory.html?agent&pending-items&stale-caps')
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(1)
  await page.evaluate(() => window.replay_agent_inventory())
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.agent_prepared.length)).toBe(1)
  expect(errors).toEqual([])
})

test('two recovered receipts retain the first optimistic cells until indexed ownership arrives', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&pending-items&independent-caps&hold-index')
  const player = page.locator('[data-inventory-owner="player"]'),
    agent = page.locator('[data-inventory-owner="agent"]')
  await expect.poll(() => page.evaluate(() => window.agent_confirmed?.length ?? 0)).toBe(1)
  await expect(player.locator('.is-incoming[data-selection-id="agent-0xitem9"]')).toBeVisible()
  await agent.getByRole('button', { name: 'Resources', exact: true }).click()
  await expect(agent.locator('[data-selection-id="agent-0xitem9"]')).toBeDisabled()
  for (let index = 0; index < 3; index++) await page.evaluate(() => window.replay_agent_inventory())
  expect(await page.evaluate(() => window.agent_prepared.length)).toBe(1)
  await expect(player.locator('.is-incoming[data-selection-id="agent-0xitem9"]')).toBeVisible()
  await page.evaluate(() => window.release_agent_projection())
  await expect.poll(() => page.evaluate(() => window.agent_confirmed.length)).toBe(2)
  await expect(player.locator('.is-incoming[data-selection-id="agent-0xitem9"]')).toHaveCount(0)
  await expect(player.locator('.is-incoming[data-selection-id="agent-0xitem10"]')).toBeVisible()
  await page.evaluate(() => window.release_agent_projection())
  await expect(player.locator('.is-incoming')).toHaveCount(0)
  expect(await page.evaluate(() => window.agent_prepared.length)).toBe(2)
})

test('a new drag cannot replace a certified but unreconciled transfer preview', async ({ page }) => {
  await page.goto('/e2e/fixtures/inventory.html?agent&hold-index')
  const player = page.locator('[data-inventory-owner="player"]'),
    agent = page.locator('[data-inventory-owner="agent"]')
  await player.getByRole('button', { name: 'Resources', exact: true }).click()
  await drag(page, player.getByRole('button', { name: 'Wheat', exact: true }), agent)
  await expect.poll(() => page.evaluate(() => window.agent_confirmed.length)).toBe(2)
  await expect(agent.locator('.is-incoming')).toBeVisible()
  const next = player.locator('[data-selection-id="0xitem11"]')
  await expect(next).toBeDisabled()
  await drag(page, next, agent)
  expect(await page.evaluate(() => window.agent_prepared.length)).toBe(2)
  await expect(agent.locator('.is-incoming[data-selection-id="0xitem9"]')).toBeVisible()
  await page.evaluate(() => window.release_agent_projection())
  await expect(agent.locator('.is-incoming')).toHaveCount(0)
  await expect(next).toBeEnabled()
})
