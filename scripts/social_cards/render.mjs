// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Renders the hand-composed social cards from cards.html. Data-bearing cards (encyclopedia
// entries and counts) are derived at build time by packages/frontend/social_cards.ts instead.
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const repo_file = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url))
const page_card = (name) => [name, `seed/icons/social/${name}.jpg`]
const OUTPUTS = Object.freeze(
  Object.fromEntries([
    ...['home', 'gift', 'marketplace', 'leaderboard', 'mastery', 'kares', 'allocation', 'agents', 'links'].map(
      page_card
    ),
    ['links_loot', 'packages/frontend/public/links/loot.jpg'],
    ['links_logo', 'packages/frontend/public/links/logo.png'],
    ['github', '.github/assets/social_preview.jpg'],
    ['readme', '.github/assets/readme_header.jpg'],
    ['discord', '.github/assets/discord_banner.png'],
  ])
)

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } })
  await page.goto(new URL('./cards.html', import.meta.url).href, { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  // The authoring backdrop must not bleed into a transparent PNG.
  await page.addStyleTag({ content: 'body { background: none }' })
  const missing = await page.evaluate(() =>
    [...document.images].filter((image) => image.src && !image.naturalWidth).map((image) => image.src)
  )
  if (missing.length) throw new Error(`Social card art missing: ${missing.join(', ')}`)
  const cards = await page.locator('.card').evaluateAll((elements) => elements.map(({ id }) => id))
  const unknown = cards.filter((id) => !OUTPUTS[id])
  if (unknown.length || cards.length !== Object.keys(OUTPUTS).length)
    throw new Error(`Social card template and output table disagree: ${unknown.join(', ') || 'missing card'}`)
  for (const id of cards) {
    const path = OUTPUTS[id]
    await page
      .locator(`#${id}`)
      .screenshot(
        path.endsWith('.png')
          ? { path: repo_file(path), omitBackground: true }
          : { path: repo_file(path), type: 'jpeg', quality: 88 }
      )
  }
} finally {
  await browser.close()
}
