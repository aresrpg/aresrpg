// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test, type Page } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { prepare_agent_pairing } from '@aresrpg/sdk/agent-signer'
import type { AgentPairingRequest } from '@aresrpg/sdk/agent-pairing'

const hosted = async (page: Page, hold = false) => {
  const key = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7))
  const member = {
    public_key: key.getPublicKey(),
    storage: 'persistent' as const,
    sign_personal_message: (bytes: Uint8Array) => key.signPersonalMessage(bytes),
    sign_transaction: async () => {
      throw new Error('No fixture transactions')
    },
  }
  const released = Promise.withResolvers<void>()
  const calls: string[] = []
  let request: AgentPairingRequest
  let bot: {
    id: string
    address: string
    multisig_public_key: string
    generation: number
    policy_revision: number
    status: string
  } | null = null
  await page.route('https://bot.fixture.invalid/**', async (route) => {
    const url = new URL(route.request().url())
    calls.push(url.pathname)
    const body = route.request().postDataJSON() as Record<string, unknown>
    let response: unknown
    switch (url.pathname) {
      case '/connect/challenge': {
        request = {
          version: 1,
          network: 'mainnet',
          nonce: crypto.randomUUID(),
          owner: String(body.owner),
          zklogin_public_identifier: String(body.zklogin_public_identifier),
        }
        const expires_at = Date.now() + 60_000
        response = {
          authorization_id: 'fixture-session',
          challenge_id: 'nonce',
          expires_at,
          message:
            'AresRPG hosted bot session v1\n' +
            JSON.stringify({
              purpose: 'session',
              issuer: url.origin,
              network: 'mainnet',
              authority_generation: 'generation',
              authorization_id: 'fixture-session',
              session_hash: 'session',
              nonce: 'nonce',
              owner: request.owner,
              zklogin_public_identifier: request.zklogin_public_identifier,
              client_id: 'first-party',
              redirect_uri: 'http://127.0.0.1:5180',
              resource: `${url.origin}/mcp`,
              scopes: [],
              expires_at,
              consent: null,
            }),
        }
        break
      }
      case '/connect/verify':
        response = { owner: request!.owner, bots: bot ? [bot] : [] }
        break
      case '/connect/bots': {
        const pairing = await prepare_agent_pairing(request!, member)
        bot = {
          id: 'fixture-bot',
          address: pairing.signer.address,
          multisig_public_key: pairing.signer.public_key.toBase64(),
          generation: 1,
          policy_revision: 1,
          status: 'ready',
        }
        if (hold) await released.promise
        response = { status: 'ready', bot }
        break
      }
      case '/connect/proof': {
        const pairing = await prepare_agent_pairing(body.request as AgentPairingRequest, member)
        response = { status: 'ready', proof: pairing.response }
        break
      }
      case '/connect/cancel':
        response = { ok: true }
        break
      default:
        throw new Error(`Unexpected hosted action: ${url.pathname}`)
    }
    await route.fulfill({ json: response })
  })
  return { calls, release: () => released.resolve(), address: () => bot?.address }
}
const open = async (page: Page, query = '') => {
  await page.goto(`/e2e/fixtures/suins_settings.html${query}`)
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  return page.locator('[data-suins-settings]')
}

test('owned parent creates the two exact final-target names without arbitrary input and fits mobile', async ({
  page,
}) => {
  const service = await hosted(page)
  await page.setViewportSize({ width: 480, height: 800 })
  const section = await open(page)
  await expect(section.getByRole('textbox')).toHaveCount(0)
  await section.getByRole('combobox', { name: 'Owned names' }).selectOption('branch.mine.sui')
  await expect(section).toContainText('aresrpg.branch.mine.sui')
  await expect(section).toContainText('In game and on leaderboards: @branch.mine')
  await expect(section).toContainText('Your existing names stay in your wallet')
  await section.getByRole('button', { name: 'Apply' }).click()
  await expect(section.getByRole('status').last()).toContainText('Player and agent names applied')
  await expect(section.locator('strong')).toHaveText('@branch.mine')
  await expect(section.locator('strong')).toHaveAttribute('title', 'aresrpg.branch.mine.sui')
  await expect(page.locator('body')).toHaveAttribute('data-agent-default', 'aresrpgagent.branch.mine.sui')
  await expect(page.locator('body')).toHaveAttribute('data-agent-target', service.address()!)
  expect(service.calls.filter((path) => path === '/connect/bots')).toHaveLength(1)
  expect(service.calls).not.toContain('/connect/authorize')
  expect(service.calls).toContain('/connect/cancel')
  expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test('external wallets only display their existing verified nested default', async ({ page }) => {
  const service = await hosted(page)
  const section = await open(page, '?state=external')
  await expect(section.locator('strong')).toHaveText('@branch.owner')
  await expect(section.getByRole('combobox')).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Apply' })).toHaveCount(0)
  await section.getByRole('button', { name: 'Refresh names' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-human-writes', '0')
  expect(service.calls).toEqual([])
})

test('unfunded agent leaves honest partial completion and only retries explicitly', async ({ page }) => {
  const service = await hosted(page)
  const section = await open(page, '?state=partial')
  await section.getByRole('combobox').selectOption('branch.mine.sui')
  await section.getByRole('button', { name: 'Apply' }).click()
  await expect(section.getByRole('status').last()).toContainText('agent display name needs SUI')
  await expect(section.getByRole('button', { name: 'Fund agent wallet' })).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-human-writes', '1')
  await expect(page.locator('body')).toHaveAttribute('data-agent-writes', '0')
  await expect(page.locator('body')).toHaveAttribute('data-agent-attempts', '1')
  await section.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-agent-attempts', '2')
  await expect(page.locator('body')).toHaveAttribute('data-human-writes', '1')
  expect(service.calls.filter((path) => path === '/connect/bots')).toHaveLength(1)
})

for (const stage of ['validation', 'setup']) {
  test(`closing Settings cancels unsigned work during ${stage}`, async ({ page }) => {
    const service = await hosted(page, stage === 'setup')
    const section = await open(page, stage === 'validation' ? '?hold=validation' : '')
    await section.getByRole('combobox').selectOption('branch.mine.sui')
    await section.getByRole('button', { name: 'Apply' }).click()
    if (stage === 'validation') await expect(page.locator('body')).toHaveAttribute('data-name-stage', 'validation')
    else await expect.poll(() => service.calls.includes('/connect/bots')).toBe(true)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByText('Settings closed')).toBeVisible()
    if (stage === 'validation') await page.evaluate(() => document.dispatchEvent(new Event('fixture/release')))
    service.release()
    if (stage === 'setup') await expect.poll(() => service.calls.includes('/connect/cancel')).toBe(true)
    await expect(page.locator('body')).toHaveAttribute('data-human-writes', '0')
    await expect(page.locator('body')).toHaveAttribute('data-agent-writes', '0')
  })
}
