// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

const PAGES = [
  ['/', 'Un monde, on-chain.'],
  ['/docs', 'Ce qu’est AresRPG'],
  ['/kares', 'Connectez-vous pour staker'],
  ['/world?intent=connect-agent', 'Connecter votre agent'],
  ['/dapp', 'Envoyez vos héros en expédition'],
] as const

for (const [path, french] of PAGES)
  test(`${path} has the language switcher in its header, and the page follows it without a reload`, async ({
    page,
  }) => {
    let documents = 0
    page.on('request', (request) => {
      if (request.isNavigationRequest()) documents++
    })
    await page.goto(path)
    const language = page.getByRole('button', { name: 'Language', exact: true }).first()
    await expect(language).toBeVisible({ timeout: 20_000 })
    const box = (await language.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(36)
    expect(await language.locator('svg').evaluate((icon) => icon.getBoundingClientRect().width)).toBeGreaterThan(12)
    await language.click()
    await page.getByRole('button', { name: /Français/ }).click()
    await expect(page.getByText(french, { exact: false }).first()).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    expect(documents).toBe(1)
  })
