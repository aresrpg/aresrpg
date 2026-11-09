// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { toZkLoginPublicIdentifier } from '@mysten/sui/zklogin'
import { hosted_challenge_message } from '@aresrpg/protocol'

import { create_agent_identity } from '../../../sdk/src/agent_multisig.ts'
import { prepare_agent_pairing } from '../../../sdk/src/agent_signer.ts'

const service = 'https://bot.fixture.example'
const owner = '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f'
const fixture_challenge = (url: string, body: Record<string, unknown>, resource: string, expires_at: number) => {
  const page_url = new URL(url)
  const review = page_url.searchParams.has('authorization_id')
    ? {
        client_id: 'fixture-client',
        redirect_uri: 'https://assistant.fixture.example/callback',
        scopes: ['bot:observe'],
      }
    : { client_id: 'first-party', redirect_uri: page_url.origin, scopes: [] }
  return hosted_challenge_message({
    purpose: body.purpose as 'session' | 'consent',
    issuer: service,
    network: 'mainnet',
    authority_generation: 'generation',
    authorization_id: 'fixture-auth',
    session_hash: 'session',
    nonce: 'fixture-challenge',
    owner: body.owner as string,
    zklogin_public_identifier: body.zklogin_public_identifier as string,
    client_id: review.client_id,
    redirect_uri: review.redirect_uri,
    resource,
    scopes: review.scopes,
    expires_at,
    consent:
      body.purpose === 'consent'
        ? {
            bot_id: body.bot_id as string,
            generation: body.generation as number,
            policy_revision: body.policy_revision as number,
            address: body.address as string,
            multisig_public_key: body.multisig_public_key as string,
          }
        : null,
  })
}
const mock_hosted = async (page: Page, resource = `${service}/mcp`) => {
  // Public deterministic test fixture, never a real credential or network signer.
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
  const identity = create_agent_identity({
    agent_public_key: key.getPublicKey(),
    zklogin_public_identifier: toZkLoginPublicIdentifier(1n, 'https://accounts.google.com', { legacyAddress: false }),
  })
  const bot = {
    id: 'fixture-bot',
    address: identity.address,
    multisig_public_key: identity.public_key.toBase64(),
    generation: 1,
    policy_revision: 1,
    status: 'ready',
  }
  const requests: { path: string; body: Record<string, unknown> }[] = []
  await page.route(`${service}/connect/**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const body = request.method() === 'POST' ? (request.postDataJSON() as Record<string, unknown>) : {}
    requests.push({ path, body })
    if (path === '/connect/bots' && request.method() === 'GET') {
      await route.fulfill({
        status: 400,
        headers: {
          'access-control-allow-origin': new URL(page.url()).origin,
          'access-control-allow-credentials': 'true',
        },
        json: { error: 'owner_authentication_required' },
      })
      return
    }
    const expires_at = Date.now() + 60_000
    const replies: Record<string, unknown> = {
      '/connect/request': {
        authorization_id: 'fixture-auth',
        client_name: 'Fixture assistant',
        client_id: 'fixture-client',
        redirect_uri: 'https://assistant.fixture.example/callback',
        scopes: ['bot:observe'],
        resource,
        network: 'mainnet',
      },
      '/connect/challenge': {
        authorization_id: 'fixture-auth',
        challenge_id: 'fixture-challenge',
        message: path === '/connect/challenge' ? fixture_challenge(page.url(), body, resource, expires_at) : '',
        expires_at,
      },
      '/connect/verify': { owner, bots: [bot] },
      '/connect/cancel': { cancelled: true },
      '/connect/authorize': { redirect_url: 'https://assistant.fixture.example/callback?code=fixture-code' },
    }
    const proof =
      path === '/connect/proof'
        ? await prepare_agent_pairing(body.request, {
            storage: 'persistent',
            public_key: key.getPublicKey(),
            sign_personal_message: (bytes) => key.signPersonalMessage(bytes),
            sign_transaction: async () => {
              throw new Error('Transactions forbidden in fixture')
            },
          })
        : null
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-credentials': 'true',
      },
      body: JSON.stringify(proof ? { status: 'ready', proof: proof.response } : replies[path]),
    })
  })
  await page.route('https://assistant.fixture.example/**', (route) =>
    route.fulfill({ body: 'Fixture authorization callback' })
  )
  return { requests, bot }
}
const open = async (page: Page, query = '') => {
  await page.goto(`/e2e/fixtures/agent_pairing.html${query}`)
  await page.getByRole('button', { name: 'Connect your agent', exact: true }).click()
  await page.getByRole('button', { name: 'Claude', exact: true }).click()
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
}
const verify = async (page: Page) => {
  await page.getByRole('combobox', { name: 'Hosted bot' }).selectOption('fixture-bot')
  await page.getByRole('button', { name: 'Verify hosted signer', exact: true }).click()
  await expect(page.getByText('Hosted signer verified. Public recovery identity saved.')).toBeVisible()
}

test('fresh hosted proof saves recovery but never confirms a transfer recipient or active AI', async ({ page }) => {
  const { requests, bot } = await mock_hosted(page)
  await open(page)
  await verify(page)
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', 'host-persistent')
  await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'false')
  await expect(page.locator('.agent-prompt')).toHaveText(`${service}/mcp`)
  await expect(page.getByText(/This does not mean AI is playing/)).toBeVisible()
  const saved = await page.evaluate((address) => localStorage.getItem(`aresrpg.agent-identities:${address}`), owner)
  expect(JSON.parse(saved!)).toEqual([{ address: bot.address, multisig_public_key: bot.multisig_public_key }])
  expect(requests.some(({ path }) => path === '/connect/authorize')).toBe(false)
  await page.screenshot({ path: 'test-results/hosted-agent-ready.png' })
})

test('OAuth shows the exact client, bot, scopes without an extra spending allowance before explicit approval', async ({
  page,
}) => {
  const { requests, bot } = await mock_hosted(page)
  await open(page, '?authorization_id=fixture-auth')
  await verify(page)
  await expect(page.getByText('Fixture assistant', { exact: true })).toBeVisible()
  await expect(page.getByText('bot:observe', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  expect(requests.some(({ path, body }) => path === '/connect/challenge' && body.purpose === 'consent')).toBe(false)
  await page.screenshot({ path: 'test-results/hosted-agent-consent.png' })
  await page.getByRole('button', { name: 'Approve this bot and access', exact: true }).click()
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
    await open(page, '?slow_signature')
    await expect(page.locator('html')).toHaveAttribute('data-fixture-signing', 'true')
    if (action === 'close') await page.keyboard.press('Escape')
    else await page.evaluate(() => dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 })))
    await expect.poll(() => requests.some(({ path }) => path === '/connect/cancel')).toBe(true)
    await page.evaluate(() => dispatchEvent(new Event('fixture/signature')))
    await page.waitForTimeout(100)
    expect(requests.some(({ path }) => path === '/connect/verify')).toBe(false)
    expect(requests.filter(({ path }) => path === '/connect/challenge')).toHaveLength(1)
    await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', '')
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
  await page.getByRole('button', { name: 'Approve this bot and access', exact: true }).click()
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
  await open(page)
  await page.getByRole('combobox', { name: 'Hosted bot' }).selectOption('fixture-bot')
  await page.getByRole('button', { name: 'Verify hosted signer', exact: true }).click()
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
  await open(page)
  await page.getByRole('button', { name: 'Create hosted bot', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', '')
  await expect(page.locator('.agent-prompt')).toHaveCount(0)
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
  await verify(page)
  await page.getByRole('button', { name: 'Copy setup request', exact: true }).click()
  await expect(page.getByText('Copy failed. Select and copy the request above manually.')).toBeVisible()
  await expect(page.locator('.agent-prompt')).toHaveText(`${service}/mcp`)
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
    const approval = page.getByRole('button', { name: 'Approve this bot and access', exact: true })
    await approval.scrollIntoViewIfNeeded()
    await expect(approval).toBeVisible()
    const modal = await page.locator('[data-agent-setup]').boundingBox()
    expect(modal!.x).toBeGreaterThanOrEqual(0)
    expect(modal!.x + modal!.width).toBeLessThanOrEqual(viewport.width)
    await page.screenshot({ path: `test-results/hosted-agent-consent-${viewport.width}.png` })
  })
}
