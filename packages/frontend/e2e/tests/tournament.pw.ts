// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'

const visit = (page: Page, query = '') => page.goto(`/e2e/fixtures/tournament.html${query}`)
const calls = async (page: Page): Promise<unknown[]> =>
  JSON.parse((await page.locator('body').getAttribute('data-calls')) ?? '[]')
const fixture = async (page: Page, method: string, ...args: unknown[]) => {
  await page.waitForFunction(() => 'tournament_fixture' in window)
  return page.evaluate(
    ({ method, args }) => {
      const runtime = window as unknown as { tournament_fixture: Record<string, (...values: unknown[]) => unknown> }
      return runtime.tournament_fixture[method](...args)
    },
    { method, args }
  )
}
const podium = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Tournament sections' })
    .getByRole('button', { name: 'Podium & prizes', exact: true })
    .click()
const review_contribution = async (page: Page, amount = '1.250000001') => {
  await podium(page)
  await page.getByRole('textbox', { name: 'Amount', exact: true }).fill(amount)
  await page.getByRole('button', { name: 'Contribute', exact: true }).click()
  return page.getByRole('dialog', { name: 'Review contribution', exact: true })
}

test('contribution review preserves exact amounts and waits for certified completion', async ({ page }) => {
  await visit(page, '?pending')
  const dialog = await review_contribution(page)
  await expect(dialog.getByText('1.250000001 SUI', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Contributions are final.', { exact: false })).toBeVisible()
  expect(await calls(page)).toEqual([])
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(dialog.getByText('Waiting for transaction confirmation…')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled()
  expect(await calls(page)).toEqual([{ kind: 'donate', args: { id: 'cup', asset: 'sui', amount: '1250000001' } }])
  await fixture(page, 'complete')
  await expect(dialog.getByText('Contribution confirmed.', { exact: false })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0)
  await expect(page.locator('.tourney-podium .tourney-pool-lines .tourney-coin').first()).toBeVisible()
})

test('gas refusal retains the reviewed contribution and offers explicit recovery', async ({ page }) => {
  await visit(page, '?failure')
  const dialog = await review_contribution(page)
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByText('1.250000001 SUI', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled()
  await page.waitForTimeout(300)
  expect(await calls(page)).toHaveLength(1)
})

test('mainnet gas recovery opens funding above the review and restores the entered contribution', async ({ page }) => {
  await visit(page, '?failure&funding')
  const review = await review_contribution(page)
  await review.getByRole('button', { name: 'Confirm', exact: true }).click()
  const funding = page.getByRole('dialog', { name: 'Add Funds', exact: true })
  await funding.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(review).toBeVisible()
  await expect(review.getByText('1.250000001 SUI', { exact: true })).toBeVisible()
  await expect(review.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled()
  expect(await calls(page)).toHaveLength(1)
})

test('funding completion never resurrects a retired tournament window', async ({ page }) => {
  await visit(page, '?failure&funding')
  const review = await review_contribution(page)
  await review.getByRole('button', { name: 'Confirm', exact: true }).click()
  const funding = page.getByRole('dialog', { name: 'Add Funds', exact: true })
  await expect(funding).toBeVisible()
  await fixture(page, 'close_feature')
  await funding.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('.tourney-panel')).toHaveCount(0)
  await expect(page.locator('dialog[open]')).toHaveCount(0)
})

test('a newer native dialog stays above restored tournament windows', async ({ page }) => {
  await visit(page, '?failure&funding')
  const review = await review_contribution(page)
  await review.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Add Funds', exact: true })).toBeVisible()
  await fixture(page, 'urgent')
  await expect(page.getByRole('dialog', { name: 'Newer dialog', exact: true })).toBeVisible()
  await fixture(page, 'close_funding')
  await page.getByRole('button', { name: 'Close newer dialog', exact: true }).click()
  await expect(review).toBeVisible()
  await expect(review.getByText('1.250000001 SUI', { exact: true })).toBeVisible()
})

test('finding a team explains automatic entry before registering the selected character', async ({ page }) => {
  await visit(page)
  await page.locator('.tourney-dock').getByRole('button', { name: 'Find a team', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Find a team', exact: true })
  await expect(dialog.getByText('Find a team for Nox and register this character?')).toBeVisible()
  await expect(dialog.getByText('Stay online;', { exact: false })).toBeVisible()
  expect(await calls(page)).toEqual([])
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect.poll(() => calls(page)).toHaveLength(1)
})

test('adding another owned character names the actual character before consent', async ({ page }) => {
  await visit(page, '?scenario=add_owned')
  await page.locator('.tourney-dock').getByRole('button', { name: 'Add your character', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Take seat', exact: true })
  await expect(dialog.getByText('Register Kaori with Moon Owls?')).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .poll(() => calls(page))
    .toEqual([
      {
        kind: 'join',
        args: { tournament: 'cup', team: 0, revision: '3', character_id: 'third', custody: { kiosk: 'third-kiosk' } },
      },
    ])
})

test('failed team creation keeps the entered name and explicit retry', async ({ page }) => {
  await visit(page, '?failure')
  await page.locator('.tourney-teams').getByRole('button', { name: 'Create team', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create team', exact: true })
  await dialog.getByLabel('Team name', { exact: true }).fill('Night Watch')
  await dialog.getByRole('button', { name: 'Create team', exact: true }).click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByLabel('Team name', { exact: true })).toHaveValue('Night Watch')
  await expect(dialog.getByRole('button', { name: 'Create team', exact: true })).toBeEnabled()
  expect(await calls(page)).toHaveLength(1)
})

test('each seat requests consent and preserves its reviewed team revision and character', async ({ page }) => {
  await visit(page)
  await page.getByRole('button', { name: 'Take seat', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Take seat', exact: true })
  await expect(dialog.getByText('Register Nox with Moon Owls?')).toBeVisible()
  expect(await calls(page)).toEqual([])
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .poll(() => calls(page))
    .toEqual([
      {
        kind: 'join',
        args: { tournament: 'cup', team: 0, revision: '3', character_id: 'hero', custody: { kiosk: 'kiosk' } },
      },
    ])
})

test('a changed roster cannot reuse an open join confirmation', async ({ page }) => {
  await visit(page)
  await page.getByRole('button', { name: 'Take seat', exact: true }).first().click()
  await fixture(page, 'update', {
    version: '8',
    teams: [{ name: 'Replacement', revision: '4', allowed: [], place: 0, seats: [] }],
  })
  await expect(
    page.getByRole('dialog', { name: 'Take seat', exact: true }).getByRole('button', { name: 'Confirm', exact: true })
  ).toBeDisabled()
  expect(await calls(page)).toEqual([])
})

test('reserved seats are not registered and only the named selected character can take one', async ({ page }) => {
  await visit(page, '?scenario=restricted')
  const row = page.locator('.tourney-team').first()
  await expect(row.getByText('Tamsin', { exact: true })).toBeVisible()
  await expect(row.getByText('Open to anyone')).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Take seat', exact: true })).toHaveCount(1)
  await page.getByLabel('Character', { exact: true }).selectOption('alt')
  await expect(row.getByRole('button', { name: 'Take seat', exact: true })).toHaveCount(0)
  await expect(row.getByText('Nox', { exact: true })).toBeVisible()
  await expect(row.getByText('This character is not named on this team')).toBeVisible()
})

test('leaving another owned seat uses that seat rather than the selected character', async ({ page }) => {
  await visit(page, '?scenario=registered')
  await page.getByRole('button', { name: 'Remove Rin from the team', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Leave', exact: true })
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .poll(() => calls(page))
    .toEqual([{ kind: 'leave', args: { tournament: 'cup', team: 0, character: 'alt' } }])
})

test('one coin claim per owned seat combines positive assets while item claims stay separate', async ({ page }) => {
  await visit(page, '?scenario=finished')
  await expect(page.locator('.tourney-personal-seat')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Claim coins', exact: true })).toHaveCount(2)
  await page.getByRole('button', { name: 'Claim coins', exact: true }).first().click()
  await expect
    .poll(async () => (await calls(page))[0])
    .toEqual({ kind: 'coins', args: { id: 'cup', team: 0, seat: 0, assets: { sui: true, pool: 'pool' } } })
  await expect(page.locator('.tourney-personal-item').getByRole('button', { name: 'Claim', exact: true })).toHaveCount(
    2
  )
})

test('item-only events never offer an empty coin claim and amounts truncate rather than round', async ({ page }) => {
  await visit(page, '?scenario=items_only')
  await expect(page.getByRole('button', { name: 'Claim coins', exact: true })).toHaveCount(0)
  await expect(page.locator('.tourney-personal-item').getByRole('button', { name: 'Claim', exact: true })).toHaveCount(
    2
  )
  await visit(page, '?scenario=finished')
  await expect(page.locator('.tourney-pedestal.is-place-1 .tourney-coin').first()).toHaveText('125.06 SUI')
  await expect(page.locator('.tourney-pedestal.is-place-1 .tourney-coin').first()).toHaveAttribute(
    'title',
    '125.061728394 SUI'
  )
})

test('timeout recovery remains available in an owned mounted fight and requires confirmation', async ({ page }) => {
  await visit(page, '?scenario=timeout')
  await expect.poll(() => fixture(page, 'state')).toEqual({ page: 'kolizeum', fight_mounted: true })
  await expect(page.getByRole('button', { name: 'Wagered', exact: true })).toBeDisabled()
  await page.locator('.tourney-dock').getByRole('button', { name: 'End without winner', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'End without winner', exact: true })
  await expect(dialog.getByText('Neither team advances', { exact: false })).toBeVisible()
  expect(await calls(page)).toEqual([])
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .poll(() => calls(page))
    .toEqual([{ kind: 'crank', args: { tournament: 'cup', index: 1, fight: 'fight-1' } }])
})

test('closed admission starts a linked fight but reviews an unopened no-show as no winner', async ({ page }) => {
  await visit(page, '?scenario=start_due')
  await expect(page.locator('.tourney-match.is-force_due').first()).toContainText('Admission closed')
  await page.locator('.tourney-dock').getByRole('button', { name: 'Start match', exact: true }).click()
  await expect
    .poll(() => calls(page))
    .toEqual([{ kind: 'crank', args: { tournament: 'cup', index: 1, fight: 'fight-1' } }])
  await visit(page, '?scenario=no_show')
  await expect(page.locator('.tourney-dock').getByRole('button', { name: 'Start match', exact: true })).toHaveCount(0)
  await page.locator('.tourney-dock').getByRole('button', { name: 'End without winner', exact: true }).click()
  expect(await calls(page)).toEqual([])
  await page
    .getByRole('dialog', { name: 'End without winner', exact: true })
    .getByRole('button', { name: 'Confirm', exact: true })
    .click()
  await expect.poll(() => calls(page)).toEqual([{ kind: 'crank_unopened', args: { tournament: 'cup', index: 1 } }])
})

test('dependency recovery names the actual match while the dock keeps the player’s next round', async ({ page }) => {
  await visit(page, '?scenario=dependency_timeout')
  await expect(page.locator('.tourney-dock-match')).toContainText('Final')
  await expect(page.locator('.tourney-dock-match')).toContainText('Winner of M3')
  await page.locator('.tourney-dock').getByRole('button', { name: 'End without winner', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'End without winner', exact: true })
  await expect(dialog.getByText('Match 3 · Semifinals', { exact: true })).toBeVisible()
  await expect(dialog).toContainText('Iron Foxes — Golden Cranes')
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect
    .poll(() => calls(page))
    .toEqual([{ kind: 'crank', args: { tournament: 'cup', index: 2, fight: 'fight-2' } }])
})

test('an open no-winner confirmation cannot submit after its chain clock goes stale', async ({ page }) => {
  await visit(page, '?scenario=timeout')
  await page.locator('.tourney-dock').getByRole('button', { name: 'End without winner', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'End without winner', exact: true })
  await fixture(page, 'clock', 1_905_000, -20_000)
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled()
  expect(await calls(page)).toEqual([])
})

test('a failed automatic admission exposes the manual join action without inventing entry', async ({ page }) => {
  await visit(page, '?scenario=entry_failure')
  await expect(page.locator('.tourney-dock').getByRole('alert')).toBeVisible()
  await page.locator('.tourney-dock').getByRole('button', { name: 'Join match', exact: true }).click()
  await expect
    .poll(async () => (await calls(page))[0])
    .toEqual({
      kind: 'enter',
      args: { tournament: 'cup', index: 1, character_id: 'hero', custody: { kiosk: 'kiosk' }, fight: 'fight-1' },
    })
})

test('expired registration exposes permissionless closure and hides contributions', async ({ page }) => {
  await visit(page, '?scenario=expired')
  await podium(page)
  await expect(page.getByRole('button', { name: 'Contribute', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close expired registration', exact: true }).click()
  await expect.poll(() => calls(page)).toEqual([{ kind: 'expire', args: { id: 'cup', pool: 'pool' } }])
})

for (const query of ['unknown_clock', 'stale_clock'])
  test(`${query} cannot authorize registration or deadline recovery`, async ({ page }) => {
    await visit(page, `?${query}`)
    await expect(page.locator('.tourney-dock').getByRole('status')).toHaveText('Waiting for a fresh chain clock')
    await expect(page.getByRole('button', { name: 'Take seat', exact: true })).toHaveCount(0)
    await visit(page, `?scenario=timeout&${query}`)
    await expect(
      page.locator('.tourney-dock').getByRole('button', { name: 'End without winner', exact: true })
    ).toHaveCount(0)
  })

test('loading, unavailable and confirmed empty feeds remain distinct', async ({ page }, info) => {
  for (const [width, height] of [
    [1440, 900],
    [667, 375],
  ]) {
    await page.setViewportSize({ width, height })
    await visit(page, '?scenario=loading')
    await expect(page.getByText('Loading tournament state…', { exact: true })).toBeVisible()
    await expect(page.getByText('No tournament announced.', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`loading-${width}.png`) })
    await visit(page, '?scenario=empty')
    await expect(page.getByText('No tournament announced.', { exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`empty-${width}.png`) })
    await visit(page, '?scenario=unavailable')
    await expect(page.getByRole('heading', { name: 'Autumn Championship', exact: true })).toBeVisible()
    await expect(page.getByText('Tournament state is unavailable.', { exact: false }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Take seat', exact: true })).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`unavailable-${width}.png`) })
  }
})

test('failed reads retain known results but block writes', async ({ page }) => {
  await visit(page)
  await fixture(page, 'disconnect')
  await expect(page.getByRole('heading', { name: 'Autumn Championship', exact: true })).toBeVisible()
  await expect(page.getByText('Tournament state is unavailable.', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take seat', exact: true })).toHaveCount(0)
  await podium(page)
  await expect(page.getByRole('button', { name: 'Contribute', exact: true })).toBeDisabled()
})

test('finished results survive deleted fight objects and no-winner events promise no podium prizes', async ({
  page,
}) => {
  await visit(page, '?scenario=finished')
  await page.getByRole('button', { name: 'Bracket', exact: true }).click()
  await expect(page.locator('.tourney-match.is-done')).toHaveCount(8)
  await expect(page.getByRole('button', { name: 'Watch', exact: true })).toHaveCount(0)
  await visit(page, '?scenario=no_champion')
  await expect(page.getByText('This tournament ended without a champion.').first()).toBeVisible()
  await expect(page.locator('.tourney-pedestal .tourney-coin')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Claim coins', exact: true })).toHaveCount(0)
})

test('older events with rewards remain selectable without becoming the primary open event', async ({ page }) => {
  await visit(page, '?scenario=recovery')
  await expect(page.getByRole('heading', { name: 'Autumn Championship', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Event', exact: true }).selectOption('old-cup')
  await expect(page.getByRole('heading', { name: 'Previous Championship', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Claim coins', exact: true })).toHaveCount(2)
})

test('admin reviews exact percentages and rejects excess precision', async ({ page }) => {
  await visit(page, '?admin')
  await page.locator('.tourney-admin > summary').click()
  await page.getByLabel('AdminCap object ID', { exact: true }).fill('0x1')
  await page.getByLabel('Name', { exact: true }).fill('Exact cup')
  await page.getByLabel('Latest start', { exact: true }).fill('2027-01-01T12:00')
  const values = ['0.14', '12.34', '23.45', '34.56', '29.51']
  for (const [index, value] of values.entries()) await page.getByLabel(`SUI ${index + 1}`, { exact: true }).fill(value)
  await expect(page.getByRole('button', { name: 'Create tournament', exact: true })).toBeEnabled()
  await page.getByLabel('SUI 1', { exact: true }).fill('0.140')
  await expect(page.getByRole('button', { name: 'Create tournament', exact: true })).toBeDisabled()
  await page.getByLabel('SUI 1', { exact: true }).fill('0.14')
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm · Create tournament', exact: true })
  await expect(dialog.getByText('29.51', { exact: true })).toBeVisible()
  await expect(dialog.getByText('These settings cannot be edited.', { exact: false })).toBeVisible()
})

test('admin selects a canonical item and cannot mint multiple copies of unstackable gear per reward', async ({
  page,
}) => {
  await visit(page, '?admin')
  await page.locator('.tourney-admin > summary').click()
  await page.getByLabel('AdminCap object ID', { exact: true }).fill('0x1')
  await page.getByLabel('Name', { exact: true }).fill('Equipment cup')
  await page.getByLabel('Latest start', { exact: true }).fill('2027-01-01T12:00')
  await page.getByRole('button', { name: 'Add item reward', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose reward item', exact: true })
  await picker.getByPlaceholder('Search items').fill('Golden Lorito Amulet')
  await picker.getByRole('button', { name: /^Golden Lorito Amulet/ }).click()
  const quantity = page.getByLabel('Quantity for reward 1', { exact: true })
  await expect(quantity).toHaveAttribute('max', '1')
  await quantity.fill('2')
  await expect(page.getByRole('button', { name: 'Create tournament', exact: true })).toBeDisabled()
  await quantity.fill('1')
  await expect(page.getByRole('button', { name: 'Create tournament', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Item template ID', { exact: true })).toHaveCount(0)
})

test('admin start review shows excluded teams and refuses a changed event', async ({ page }) => {
  await visit(page, '?scenario=admin_start')
  await page.locator('.tourney-admin > summary').click()
  await page.getByRole('button', { name: 'Start tournament', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm · Start tournament', exact: true })
  await expect(dialog.getByText('Excluded incomplete teams: Incomplete', { exact: true })).toBeVisible()
  await fixture(page, 'update', { version: '8' })
  await expect(dialog.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled()
  await expect(dialog.getByText('The event changed', { exact: false })).toBeVisible()
})

test('confirmation keeps background controls inert and Escape restores the seat trigger', async ({ page }) => {
  await visit(page)
  const trigger = page.getByRole('button', { name: 'Take seat', exact: true }).first()
  await trigger.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Take seat', exact: true })
  await expect(dialog).toBeVisible()
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab')
    // Native dialogs may yield Tab to browser chrome, represented by BODY, but never background controls.
    expect(
      await dialog.evaluate(
        (element) => document.activeElement === document.body || element.contains(document.activeElement)
      )
    ).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

const scenarios = [
  'open_funded',
  'open_sui',
  'restricted',
  'registered',
  'entry_failure',
  'admission',
  'live8',
  'byes',
  'dense',
  'two',
  'three',
  'sixteen',
  'sixv6',
  'timeout',
  'start_due',
  'no_show',
  'recording',
  'finished',
  'items_only',
  'expired',
  'cancelled',
  'recovery',
  'no_champion',
]
for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [844, 390],
  [667, 375],
]) {
  test(`required tournament scenarios fit ${width}×${height} with a visible action dock`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    for (const scenario of scenarios) {
      await visit(page, `?scenario=${scenario}`)
      await expect(page.locator('.tourney-dock')).toBeVisible()
      await page.evaluate(async () => {
        await document.fonts.ready
      })
      const box = await page.locator('.tourney-dock').boundingBox()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(height)
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight
        )
      ).toBe(true)
      if (scenario === 'admission') {
        const timer = page.locator('.tourney-dock-state time')
        await expect(timer).toBeVisible()
        const bounds = await timer.evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          right: element.getBoundingClientRect().right,
          limit: element.parentElement!.getBoundingClientRect().right,
        }))
        expect(bounds.width).toBeGreaterThan(0)
        expect(bounds.right).toBeLessThanOrEqual(bounds.limit + 0.5)
      }
      if (scenario === 'dense') {
        const cards = await page.locator('.tourney-round').first().locator('.tourney-match').all()
        const first = await cards[0].boundingBox(),
          next = await cards[1].boundingBox()
        expect(first!.y + first!.height).toBeLessThanOrEqual(next!.y)
      }
      await page.screenshot({ path: info.outputPath(`${scenario}-${width}x${height}.png`) })
    }
    await visit(page, '?admin')
    await page.locator('.tourney-admin > summary').click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`admin-${width}x${height}.png`) })
    expect(errors).toEqual([])
  })
}

test('landscape touch HUD opens the same full-screen window and retains 44px primary targets', async ({
  browser,
}, info) => {
  const context = await browser.newContext({ viewport: { width: 667, height: 375 }, hasTouch: true })
  const page = await context.newPage()
  await visit(page, '?hud')
  await expect(page.locator('.tourney-hud-mobile')).toBeVisible()
  await expect(page.locator('.tourney-hud-desktop')).toBeHidden()
  expect((await page.locator('.tourney-hud-mobile').boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.locator('.tourney-hud-mobile').tap()
  await expect(page.locator('.tourney-panel')).toBeVisible()
  const button = page.locator('.tourney-dock .aui-button--primary')
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: info.outputPath('touch-window.png') })
  await context.close()
})

test('exact coin amounts can be revealed by touch and keyboard without closing the tournament', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })
  const page = await context.newPage()
  await visit(page, '?scenario=finished')
  const amount = page.getByRole('button', { name: '125.061728394 SUI', exact: true })
  await amount.tap()
  await expect(page.locator('.tourney-exact-amount:popover-open')).toHaveText('125.061728394 SUI')
  await page.keyboard.press('Escape')
  await expect(page.locator('.tourney-panel')).toBeVisible()
  await amount.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.tourney-exact-amount:popover-open')).toBeVisible()
  await context.close()
})

test('all eleven locales render complete tournament surfaces without raw translation keys', async ({ page }, info) => {
  await page.setViewportSize({ width: 844, height: 390 })
  for (const locale of ['de', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'uk', 'vi', 'zh']) {
    await visit(page, `?scenario=finished&locale=${locale}`)
    await expect(page.locator('.tourney-panel')).toBeVisible()
    expect(await page.locator('.tourney-panel').innerText()).not.toMatch(/reason_|action_|podium_claims|{{\w+}}/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`locale-${locale}.png`) })
  }
})

test('Blast remains the HUD default until a tournament packet proves an event exists', async ({ page }) => {
  for (const [width, height] of [
    [1440, 900],
    [667, 375],
  ]) {
    await page.setViewportSize({ width, height })
    await visit(page, '?hud&scenario=loading')
    const blast = page.locator('.blast-sale-card')
    const tournament = page.locator('.tourney-hud-card, .tourney-hud-mobile')
    await expect(blast).toHaveCount(1)
    await expect(tournament).toHaveCount(0)
    if (width > 1023) await expect(blast).toBeVisible()
    await fixture(page, 'disconnect')
    await expect(blast).toHaveCount(1)
    await expect(tournament).toHaveCount(0)
    await fixture(page, 'publish')
    await expect(blast).toHaveCount(0)
    const event = page.locator(width > 1023 ? '.tourney-hud-card' : '.tourney-hud-mobile')
    await expect(event).toBeVisible()
    await fixture(page, 'disconnect')
    await expect(event).toBeVisible()
    await expect(event).toHaveAttribute('aria-label', 'Open Autumn Championship tournament')
    await fixture(page, 'empty')
    await expect(blast).toHaveCount(1)
    await expect(tournament).toHaveCount(0)
    expect(await calls(page)).toEqual([])
  }
})
