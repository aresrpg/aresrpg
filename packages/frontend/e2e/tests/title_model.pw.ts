// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

test('model titles retain hats and cloaks on individual and crowd characters', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) errors.push(message.text())
  })
  await page.goto('/e2e/fixtures/title_model.html')
  await expect.poll(() => page.evaluate(() => window.title_model_probe?.snapshot().frames ?? 0)).toBeGreaterThan(2)
  await expect.poll(() => page.evaluate(() => window.title_model_probe.snapshot().crowd.instances)).toBe(1)
  expect(await page.evaluate(() => window.title_model_probe.snapshot())).toMatchObject({
    head_parts: 1,
    cape_parts: 1,
    rider: true,
  })
  expect(await page.evaluate(() => window.title_model_probe.snapshot().body_url)).toContain('blast_girl')
  await expect
    .poll(() => page.evaluate(() => window.title_model_probe.snapshot().crowd_parts))
    .toBeGreaterThanOrEqual(2)
  const presence = await page.evaluate(() => window.title_model_probe.presence())
  expect(presence.title_loads).toBe(1)
  expect(presence.replacement.body_url).toContain('blast_girl')
  expect(presence.reverted.body_url).toContain('senshi_male')
  expect(presence.replacement.worn).toEqual(presence.reverted.worn)
  expect(presence.replacement.worn?.head?.url).toContain('solomonk')
  expect(presence.replacement.worn?.back?.url).toContain('cape_fuwa')
  expect(presence.selected).toMatchObject({
    id: 'hero',
    kind: 'character',
    presentation: 'crowd',
    appearance: presence.replacement,
    anchor: { kind: 'world', position: [7, 4, 11] },
  })
  expect(presence.latest).toMatchObject({ kind: 'character', appearance: presence.reverted })
  expect(presence.final).toMatchObject({ kind: 'character', appearance: presence.reverted })
  await page.screenshot({ path: 'test-results/title-model-front.png' })
  await page.evaluate(() => {
    window.title_model_probe.turn(Math.PI)
    window.title_model_probe.animate('RUN')
  })
  await page.screenshot({ path: 'test-results/title-model-back.png' })
  await page.evaluate(() => window.title_model_probe.mount())
  await expect.poll(() => page.evaluate(() => window.title_model_probe.snapshot().mounted_visible)).toBe(true)
  await expect.poll(() => page.evaluate(() => window.title_model_probe.snapshot().mounted_distance)).toBeLessThan(0.001)
  await page.screenshot({ path: 'test-results/title-model-mounted.png' })
  await expect.poll(() => page.evaluate(() => window.title_model_probe.fight.snapshot().status)).toBe('ready')
  const initial_loads = await page.evaluate(() => window.title_model_probe.fight.snapshot().loads)
  await page.evaluate(() => window.title_model_probe.fight.title('title_veteran'))
  await expect.poll(() => page.evaluate(() => window.title_model_probe.fight.snapshot().body)).toContain('blast_girl')
  await expect.poll(() => page.evaluate(() => window.title_model_probe.fight.snapshot().status)).toBe('ready')
  const repeated = await page.evaluate(() => window.title_model_probe.fight.title('title_veteran'))
  await expect.poll(() => page.evaluate(() => window.title_model_probe.fight.snapshot().committed)).toBe(repeated)
  expect(await page.evaluate(() => window.title_model_probe.fight.snapshot().loads)).toBe(initial_loads + 1)
  await page.evaluate(() => window.title_model_probe.fight.title(''))
  await expect.poll(() => page.evaluate(() => window.title_model_probe.fight.snapshot().body)).toContain('senshi_male')
  await page.evaluate(() => window.title_model_probe.equip(false))
  expect(await page.evaluate(() => window.title_model_probe.snapshot().body_url)).toContain('senshi_male')
  await expect.poll(() => page.evaluate(() => window.title_model_probe.snapshot().crowd.instances)).toBe(1)
  const reverted_loads = await page.evaluate(() => window.title_model_probe.fight.snapshot().loads)
  const aura_revision = await page.evaluate(() => window.title_model_probe.fight.aura_only())
  await expect.poll(() => page.evaluate(() => window.title_model_probe.fight.snapshot().committed)).toBe(aura_revision)
  await expect.poll(() => page.evaluate(() => window.title_model_probe.fight.snapshot().status)).toBe('ready')
  expect(await page.evaluate(() => window.title_model_probe.fight.snapshot().loads)).toBe(reverted_loads)
  expect(errors).toEqual([])
})
