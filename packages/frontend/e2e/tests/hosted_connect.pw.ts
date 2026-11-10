// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'

import { create_agent_identity } from '../../../sdk/src/agent_multisig.ts'
import { service, owner, connector_fixture, mock_hosted } from '../fixtures/hosted_service.ts'

const open = async (page: Page, query = '') => {
  await page.goto(`/e2e/fixtures/agent_pairing.html${query}`)
  await page.getByRole('button', { name: 'Connect your agent', exact: true }).click()
  if (!new URLSearchParams(query).has('authorization_id')) {
    await page.getByRole('button', { name: 'Claude', exact: true }).click()
  }
}
const verify = async (page: Page) => {
  await expect(page.locator('[data-hosted-phase]')).toHaveAttribute('data-hosted-phase', 'ready')
}

test('standalone provider installation never starts owner proof, provisioning, or consent', async ({ page }) => {
  const { requests } = await mock_hosted(page)
  await open(page)
  for (const provider of ['ChatGPT', 'Claude', 'Grok']) {
    await page.getByRole('button', { name: provider, exact: true }).click()
    await expect(page.locator('[data-provider-guide]')).toHaveAttribute('data-provider-guide', provider)
    await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0)
  }
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', '')
  await expect(page.locator('[data-hosted-phase]')).toHaveAttribute('data-hosted-phase', 'idle')
  await page.keyboard.press('Escape')
  expect(requests).toEqual([])
  expect(
    await page.evaluate((address) => localStorage.getItem(`aresrpg.agent-identities:${address}`), owner)
  ).toBeNull()
})

test('fresh hosted proof saves recovery but never confirms a transfer recipient or active AI', async ({ page }) => {
  const { requests, bot } = await mock_hosted(page)
  await open(page, '?authorization_id=fixture-auth')
  await verify(page)
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', 'host-persistent')
  await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'false')
  await expect(page.locator('[data-provider-guide]')).toHaveCount(0)
  await expect(page.getByRole('combobox')).toHaveCount(0)
  const saved = await page.evaluate((address) => localStorage.getItem(`aresrpg.agent-identities:${address}`), owner)
  expect(JSON.parse(saved!)).toEqual([{ address: bot.address, multisig_public_key: bot.multisig_public_key }])
  expect(requests.some(({ path }) => path === '/connect/authorize')).toBe(false)
  await page.screenshot({ path: 'test-results/hosted-agent-ready.png' })
})

test('OAuth shows the callback destination and meaningful access before explicit connection', async ({ page }) => {
  const { requests, bot } = await mock_hosted(page)
  await open(page, '?authorization_id=fixture-auth')
  await verify(page)
  await expect(page.getByText('assistant.fixture.example', { exact: true })).toBeVisible()
  await expect(page.getByText('Can view this bot.', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  expect(requests.some(({ path, body }) => path === '/connect/challenge' && body.purpose === 'consent')).toBe(false)
  await page.screenshot({ path: 'test-results/hosted-agent-consent.png' })
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page).toHaveURL('https://assistant.fixture.example/callback?code=fixture-code')
  expect(requests.find(({ body }) => body.purpose === 'consent')?.body).toMatchObject({
    bot_id: bot.id,
    policy_revision: 1,
    generation: bot.generation,
    address: bot.address,
    multisig_public_key: bot.multisig_public_key,

    owner,
  })
})

for (const action of ['close', 'wallet'] as const) {
  test(`${action} during wallet approval cancels the session and ignores the late signature`, async ({ page }) => {
    const { requests } = await mock_hosted(page)
    await open(page, '?authorization_id=fixture-auth&slow_signature')
    await expect(page.locator('html')).toHaveAttribute('data-fixture-signing', 'true')
    if (action === 'close') await page.keyboard.press('Escape')
    else await page.evaluate(() => dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 })))
    await expect.poll(() => requests.some(({ path }) => path === '/connect/cancel')).toBe(true)
    await page.evaluate(() => dispatchEvent(new Event('fixture/signature')))
    await page.waitForTimeout(100)
    expect(requests.some(({ path }) => path === '/connect/verify')).toBe(false)
    expect(requests.filter(({ path }) => path === '/connect/challenge')).toHaveLength(1)
    await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', '')
    if (action === 'wallet') {
      await expect(page.getByRole('alert')).toContainText('Start the connection again in your assistant.')
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
    }
  })
}

test('foreign MCP resource is rejected before asking the wallet to sign', async ({ page }) => {
  const { requests } = await mock_hosted(page, 'https://other.fixture.example/mcp')
  await open(page, '?authorization_id=fixture-auth')
  await expect(page.getByRole('alert')).toBeVisible()
  expect(requests.some(({ path }) => path === '/connect/challenge')).toBe(false)
})

test('cancelling a pending consent signature cannot submit authorization', async ({ page }) => {
  const { requests } = await mock_hosted(page)
  await open(page, '?authorization_id=fixture-auth')
  await verify(page)
  await page.evaluate(() => document.documentElement.setAttribute('data-delay-next-signature', ''))
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect.poll(() => requests.some(({ body }) => body.purpose === 'consent')).toBe(true)
  await page.keyboard.press('Escape')
  await expect.poll(() => requests.some(({ path }) => path === '/connect/cancel')).toBe(true)
  await page.evaluate(() => dispatchEvent(new Event('fixture/signature')))
  await page.waitForTimeout(100)
  expect(requests.some(({ path }) => path === '/connect/authorize')).toBe(false)
})

test('invalid hosted proof cannot publish a custody candidate', async ({ page }) => {
  await mock_hosted(page)
  await page.route(`${service}/connect/proof`, (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
      json: {
        status: 'ready',
        proof: { signer_mode: 'host-persistent', agent_public_key: 'invalid', signature: 'invalid' },
      },
    })
  )
  await open(page, '?authorization_id=fixture-auth')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', '')
})

test('unconfigured provisioning stays unavailable without a fake funded or connected state', async ({ page }) => {
  await mock_hosted(page)
  await page.route(`${service}/connect/verify`, (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
      json: { owner, bots: [] },
    })
  )
  await page.route(`${service}/connect/bots`, (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
      status: 503,
      json: { error: 'managed_signer_unconfigured' },
    })
  )
  await open(page, '?authorization_id=fixture-auth')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', '')
  await expect(page.locator('.agent-provider-example-url')).toHaveCount(0)
})

test('MCP endpoint copy remains selectable when clipboard permission is refused', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Fixture clipboard denial')
        },
      },
    })
  )
  await mock_hosted(page)
  await open(page)
  await page.getByRole('button', { name: 'Copy connection URL', exact: true }).click()
  await expect(page.getByText('Copy failed. Select and copy the request above manually.')).toBeVisible()
  await expect(page.locator('.agent-provider-example-url')).toHaveText(`${service}/mcp`)
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  test(`hosted consent stays usable at ${viewport.width} by ${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await mock_hosted(page)
    await open(page, '?authorization_id=fixture-auth')
    await verify(page)
    const approval = page.getByRole('button', { name: 'Connect', exact: true })
    await approval.scrollIntoViewIfNeeded()
    await expect(approval).toBeVisible()
    const modal = await page.locator('[data-agent-setup]').boundingBox()
    expect(modal!.x).toBeGreaterThanOrEqual(0)
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: `test-results/hosted-agent-consent-${viewport.width}.png` })
  })
}

const open_custody = (page: Page, query = '') => page.goto(`/e2e/fixtures/agent_pairing.html?custody&character${query}`)
const connected_inventory = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Agent connected', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'true')
  await expect(page.getByRole('combobox')).toHaveCount(0)
  await expect(page.getByText('I compared this full address', { exact: false })).toHaveCount(0)
  await expect(page.getByText('Saved agent recovery', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'SUI', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Deposit to agent', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Offer fixture character', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fixture-offer', 'true')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await page.keyboard.press('Escape')
}

test('OAuth approval, callback and return restore one verified inventory target without another consent', async ({
  page,
}) => {
  const f = await mock_hosted(page)
  await open(page, '?authorization_id=fixture-auth')
  await verify(page)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page).toHaveURL('https://assistant.fixture.example/callback?code=fixture-code')
  await open_custody(page)
  await connected_inventory(page)
  expect(f.requests.filter(({ path }) => path === '/connect/authorize')).toHaveLength(1)
  expect(f.requests.filter(({ path }) => path === '/connect/proof')).toHaveLength(2)
  expect(
    f.requests.filter(({ path, body }) => path === '/connect/challenge' && body.purpose === 'consent')
  ).toHaveLength(1)
  const identities = await page.evaluate(
    (address) => JSON.parse(localStorage.getItem(`aresrpg.agent-identities:${address}`)!),
    owner
  )
  expect(identities).toEqual([{ address: f.bot.address, multisig_public_key: f.bot.multisig_public_key }])
})

test('original tab resolves the backend bot after another tab authorizes, ignoring historical identities', async ({
  page,
  context,
}) => {
  const connection = connector_fixture()
  const f = await mock_hosted(page, `${service}/mcp`, connection)
  const older = create_agent_identity({
    agent_public_key: Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8)).getPublicKey(),
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
  })
  await page.goto('/e2e/fixtures/agent_pairing.html')
  await page.evaluate(
    ({ owner, address, multisig_public_key }) =>
      localStorage.setItem(`aresrpg.agent-identities:${owner}`, JSON.stringify([{ address, multisig_public_key }])),
    { owner, address: older.address, multisig_public_key: older.public_key.toBase64() }
  )
  await open_custody(page)
  await expect.poll(() => f.requests.some(({ path }) => path === '/connect/status')).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'false')
  const provider = await context.newPage()
  await mock_hosted(provider, `${service}/mcp`, connection)
  await open(provider, '?authorization_id=fixture-auth')
  await verify(provider)
  await provider.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(provider).toHaveURL('https://assistant.fixture.example/callback?code=fixture-code')
  await page.bringToFront()
  await page.evaluate(() => dispatchEvent(new Event('focus')))
  await connected_inventory(page)
  expect(f.requests.some(({ path }) => path === '/connect/authorize')).toBe(false)
  const identities = await page.evaluate(
    (address) => JSON.parse(localStorage.getItem(`aresrpg.agent-identities:${address}`)!),
    owner
  )
  expect(identities.map((row: { address: string }) => row.address).sort()).toEqual(
    [older.address, f.bot.address].sort()
  )
  await provider.close()
})

for (const reason of ['expired', 'ambiguous', 'stale_proof', 'revoke_during_proof'] as const) {
  test(`owner refresh rejects ${reason} without enabling custody or granting consent`, async ({ page }) => {
    const f = await mock_hosted(page)
    f.connection.authorized = true
    f.connection[reason] = true
    await open_custody(page)
    if (reason === 'ambiguous') await expect(page.getByRole('alert')).toContainText('More than one hosted wallet')
    else await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'false')
    await expect(page.getByRole('button', { name: 'Agent connected', exact: true })).toHaveCount(0)
    expect(f.requests.some(({ path }) => path === '/connect/authorize')).toBe(false)
    expect(f.requests.some(({ path, body }) => path === '/connect/challenge' && body.purpose === 'consent')).toBe(false)
    if (reason === 'expired') {
      f.connection.expired = false
      await page.getByRole('button', { name: 'Try again', exact: true }).click()
      await connected_inventory(page)
    }
  })
}

test('revocation clears an established target and connected status on the next owner check', async ({ page }) => {
  const f = await mock_hosted(page)
  f.connection.authorized = true
  await open_custody(page)
  await connected_inventory(page)
  f.connection.authorized = false
  await page.evaluate(() => dispatchEvent(new Event('focus')))
  await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'false')
  await expect(page.getByRole('button', { name: 'Agent connected', exact: true })).toHaveCount(0)
  expect(f.requests.some(({ path }) => path === '/connect/authorize')).toBe(false)
})

for (const action of ['cancel', 'wallet'] as const) {
  test(`owner refresh ${action} retires late signatures; cancellation permits explicit retry`, async ({ page }) => {
    const f = await mock_hosted(page)
    f.connection.authorized = true
    await open_custody(page, '&slow_signature')
    await expect(page.locator('html')).toHaveAttribute('data-fixture-signing', 'true')
    if (action === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    else await page.evaluate(() => dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 })))
    await expect.poll(() => f.requests.some(({ path }) => path === '/connect/cancel')).toBe(true)
    await page.evaluate(() => dispatchEvent(new Event('fixture/signature')))
    await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'false')
    expect(f.requests.some(({ path }) => path === '/connect/proof')).toBe(false)
    if (action === 'cancel') {
      await page.getByRole('button', { name: 'Try again', exact: true }).click()
      await expect(page.locator('html')).toHaveAttribute('data-fixture-signatures', '2')
      await page.evaluate(() => dispatchEvent(new Event('fixture/signature')))
      await connected_inventory(page)
    }
  })
}

test('dismissing a malformed provider request restores owner status without another tab focus', async ({ page }) => {
  const f = await mock_hosted(page)
  f.connection.authorized = true
  await open_custody(page, '&authorization_id=invalid')
  await page
    .getByRole('region', { name: 'Agent kiosk' })
    .getByRole('button', { name: 'Connect your agent', exact: true })
    .click()
  await expect(page.getByRole('alert')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/authorization_id/)
  await expect(page.getByRole('button', { name: 'Agent connected', exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'true')
  expect(f.requests.some(({ path }) => path === '/connect/authorize')).toBe(false)
})
