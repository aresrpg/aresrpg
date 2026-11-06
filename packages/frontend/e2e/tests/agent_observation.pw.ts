// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import { serve_portrait } from '../../server/portrait.ts'

test('real world keyboard and touch remain read-only while observing, owned movement resumes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/e2e/fixtures/agent_observation.html')
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'observed')
  const probe = async () =>
    page.evaluate(() => {
      window.dispatchEvent(new Event('probe'))
      return { pose: JSON.parse(document.body.dataset.pose!), remote: document.body.dataset.remote }
    })
  await expect.poll(async () => (await probe()).remote).toBe('true')
  await page.keyboard.down('KeyW')
  await page.keyboard.down('Space')
  await page.waitForTimeout(300)
  await page.keyboard.up('Space')
  await page.keyboard.up('KeyW')
  const joystick = await page.locator('.mobile-joystick').boundingBox()
  if (!joystick) throw new Error('Touch joystick missing')
  await page.mouse.move(joystick.x + joystick.width / 2, joystick.y + joystick.height / 2)
  await page.mouse.down()
  await page.mouse.move(joystick.x + joystick.width / 2, joystick.y)
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.locator('.mobile-jump').press('Space')
  expect((await probe()).pose).toBeNull()
  await page.evaluate(() => window.dispatchEvent(new Event('own')))
  await expect.poll(async () => (await probe()).pose?.character_id).toBe('own')
  const { pose: before } = await probe()
  await page.locator('canvas').click({ position: { x: 640, y: 300 } })
  await page.keyboard.down('KeyW')
  await expect
    .poll(async () => {
      const { pose } = await probe()
      return Math.hypot(pose.x - before.x, pose.z - before.z)
    })
    .toBeGreaterThan(0.1)
  await page.keyboard.up('KeyW')
  expect(errors).toEqual([])
})

test('real fight board and keyboard cannot invoke placement when watching an otherwise owned seat', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/fight_placement_race.html?agent')
  await expect(page.getByLabel('Participants', { exact: true })).toHaveText('2')
  await expect(page.getByRole('button', { name: 'Ready', exact: true })).toHaveCount(0)
  await page
    .locator('canvas')
    .first()
    .click({ position: { x: 70, y: 300 } })
  await page.keyboard.press('F1')
  await page.getByRole('button', { name: 'Place and join', exact: true }).click()
  await expect(page.getByLabel('Participants', { exact: true })).toHaveText('3')
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '0')
  await page.goto('/e2e/fixtures/fight_placement_race.html')
  await page.getByRole('button', { name: 'Place and join', exact: true }).click()
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '1')
})

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`spectator keeps real informational HUD and read-only party at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.route('**/api/portrait?**', async (route) => {
      const response = await serve_portrait(new Request(route.request().url()))
      await route.fulfill({
        status: response.status,
        contentType: 'image/png',
        body: Buffer.from(await response.arrayBuffer()),
      })
    })
    await page.goto('/e2e/fixtures/agent_observation.html?hud')
    await expect(page.locator('[data-agent-spectator]')).toBeVisible()
    await expect(page.locator('[data-minimap] canvas')).toBeVisible()
    await expect(page.locator('[data-compass-strip]')).toBeVisible()
    await expect(page.locator('.agent-spectator-world-vitals .aui-health')).toBeVisible()
    await expect(page.locator('.agent-spectator-world-vitals .aui-vital-token')).toHaveCount(2)
    await expect(page.locator('.world-status select')).toBeVisible()
    await expect(page.locator('.world-online-count b').first()).toHaveText('7')
    await expect(page.locator('.world-online-count b').last()).toHaveText('12')
    await expect(page.locator('.party-frame')).toContainText('Companion')
    await expect(page.locator('.party-frame button,.party-frame input')).toHaveCount(0)
    await expect(page.locator('.gw-minimap button')).toHaveCount(0)
    await expect(page.locator('.agent-spectator-portrait img').first()).toHaveJSProperty('complete', true)
    await expect
      .poll(() =>
        page
          .locator('.agent-spectator-portrait img')
          .first()
          .evaluate((img) => (img as HTMLImageElement).naturalWidth)
      )
      .toBeGreaterThan(0)
    await page.keyboard.press('KeyM')
    await page.locator('.party-frame__member').first().click()
    await page.evaluate(() => window.dispatchEvent(new Event('probe')))
    await expect(page.locator('body')).toHaveAttribute('data-dialog', 'null')
    await expect(page.locator('body')).toHaveAttribute('data-run', 'null')
    await expect(page.locator('body')).toHaveAttribute('data-pose', 'null')
    await expect(page.locator('body')).toHaveAttribute('data-displayed_pose', /remote/)
    for (const selector of [
      '[data-minimap] canvas',
      '[data-compass-strip]',
      '.agent-spectator-world-vitals .aui-health',
      '.world-status select',
      '.party-frame',
    ]) {
      const box = await page.locator(selector).boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
    }
    const bounds = await page.locator('.agent-spectator-portrait').boundingBox()
    expect(bounds!.width).toBeGreaterThanOrEqual(120)
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.y).toBeGreaterThanOrEqual(0)
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1)
    await page.screenshot({ path: test.info().outputPath('spectator-hud.png') })
    await page.evaluate(() => window.dispatchEvent(new Event('party-empty')))
    await expect(page.locator('.party-frame')).toHaveCount(0)
  })
}

test('observed combat displays the selected fighter health/AP/MP without ready or turn controls', async ({ page }) => {
  await page.goto('/e2e/fixtures/fight_placement_race.html?agent&spell')
  await expect(page.locator('[data-agent-fight-vitals] .aui-health')).toBeVisible()
  await expect(page.locator('[data-agent-fight-vitals] .aui-vital-token')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Ready', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'End turn', exact: true })).toHaveCount(0)
  await page.keyboard.press('F1')
  await expect(page.locator('body')).toHaveAttribute('data-placement_calls', '0')
})

test('spectator funding routes player and verified agent separately and closes on target/account change', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/agent_observation.html?hud')
  await page.locator('.agent-funding summary').click()
  await page.locator('.agent-funding-menu').getByRole('button', { name: 'Add funds', exact: true }).click()
  await expect(page.locator('.aui-funding-address')).toContainText('human')
  await page.keyboard.press('Escape')
  await page.locator('.agent-funding-menu').getByRole('button', { name: 'Add funds to agent', exact: true }).click()
  await expect(page.locator('.aui-funding-address')).toContainText('agent')
  await expect(page.locator('[data-add-funds]')).toContainText('Add funds to agent')
  await page.screenshot({ path: test.info().outputPath('agent-funding.png') })
  await page.evaluate(() => window.dispatchEvent(new Event('rewatch')))
  await expect(page.locator('[data-add-funds]')).toHaveCount(0)
  await page.locator('.agent-funding summary').click()
  await expect(
    page.locator('.agent-funding-menu').getByRole('button', { name: 'Add funds to agent', exact: true })
  ).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('disconnect')))
  await expect(page.locator('[data-add-funds]')).toHaveCount(0)
  await page.locator('.agent-funding summary').click()
  await expect(
    page.locator('.agent-funding-menu').getByRole('button', { name: 'Add funds', exact: true })
  ).toBeDisabled()
})
