// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { execFileSync as exec_file_sync } from 'node:child_process'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { expect, test, type Page } from '@playwright/test'

import { mock_funding } from '../support/funding.ts'
import { bootstrap_setup_link } from '../../../sdk/examples/agent_setup.ts'
import { prepare_agent_pairing } from '../../../sdk/src/agent_signer.ts'
import { bootstrap_disposable_agent } from '../../../sdk/examples/agent_bootstrap.ts'

const origin = 'http://127.0.0.1:5198'
const open_setup = async (page: Page, query = '') => {
  await page.goto(`/e2e/fixtures/agent_pairing.html${query}`)
  await page.getByRole('button', { name: 'Connect your agent' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'ChatGPT', exact: true }).click()
  return dialog
}
const setup_url = (prompt: string) => {
  const match = prompt.match(/http:\/\/127\.0\.0\.1:5198\/api\/agent-setup\?id=[0-9a-f-]+#[A-Za-z0-9_-]{43}/)
  if (!match) throw new Error('Missing setup link')
  return new URL(match[0])
}
const authorized = (url: URL) => ({ headers: { authorization: `Bearer ${url.hash.slice(1)}` } })

test('disposable proof still authenticates locally but never connects or enables custody', async ({ page }) => {
  const dialog = await open_setup(page)
  const warning = dialog.getByText(
    'Public-key verification only. This disposable key is lost when the agent process exits. Never send assets to this identity.'
  )
  await expect(warning).toBeHidden()
  await expect(dialog.locator('details')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/agent-chooser-subtitle.png' })
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  const prompt = dialog.locator('.agent-prompt')
  await expect(prompt).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Connect your agent', exact: true })).toBeVisible()
  await expect(dialog.locator('.agent-pair-sigil')).toBeVisible()
  await expect(dialog.getByText('Waiting for your assistant…')).toBeVisible()
  await expect(dialog.locator('textarea')).toHaveCount(0)
  await expect(dialog.locator('.agent-provider-card')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0)
  await expect(warning).toBeHidden()
  await expect(dialog.getByText('Pairing alone moves no assets.')).toHaveCount(0)
  const payload = (await prompt.textContent())!
  expect(payload).toContain(`${new URL(page.url()).origin}/agents/client.txt`)
  expect(payload).toContain('does not authorize asset transfers or gameplay')
  const url = setup_url(payload)
  const signer = await bootstrap_setup_link(url.href, { fetch, bootstrap: bootstrap_disposable_agent })
  await expect(dialog.getByRole('alert')).toContainText('temporary credentials', { timeout: 10_000 })
  await expect(page.locator('[data-agent-connected-hint]')).toHaveCount(0)
  await expect(prompt).toHaveCount(0)
  const uuid = crypto.randomUUID()
  const proof = await signer.sign_personal_message(new TextEncoder().encode(`aresrpg::${uuid}`))
  const result = exec_file_sync(
    process.env.ARES_TEST_BUN ?? 'bun',
    [
      '-e',
      "globalThis.fetch = async () => { throw new Error('RPC_FORBIDDEN') }; const { verify_login } = await import('./packages/server/src/auth.ts'); if (!await verify_login(await Bun.stdin.json())) process.exit(1); console.log('authenticated');",
    ],
    { input: JSON.stringify({ ...proof, address: signer.address, uuid }), encoding: 'utf8' }
  )
  expect(result).toContain('authenticated')
  await page.screenshot({ path: 'test-results/agent-pairing-verified.png' })
  await page.keyboard.press('Escape')
  await page.reload()
  const restored = await open_setup(page)
  await expect(restored.getByText('Saved agent recovery', { exact: true })).toHaveCount(0)
  await expect(restored.locator('[data-agent-transfer-review]')).toHaveCount(0)
})

test('persistent signed proof replaces setup with a hint and retains only an unconfirmed session candidate', async ({
  page,
}) => {
  const dialog = await open_setup(page, '?character')
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  const prompt = dialog.locator('.agent-prompt')
  await expect(prompt).toBeVisible()
  const key = new Ed25519Keypair()
  await bootstrap_setup_link(setup_url((await prompt.textContent())!).href, {
    fetch,
    bootstrap: (input) =>
      prepare_agent_pairing(input, {
        storage: 'persistent',
        public_key: key.getPublicKey(),
        sign_personal_message: (bytes) => key.signPersonalMessage(bytes),
        sign_transaction: async () => {
          throw new Error('No transactions in this fixture')
        },
      }),
  })
  await expect(page.locator('[data-agent-connected-hint]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-agent-setup]')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const hint = page.locator('[data-agent-connected-hint]')
  await expect(hint.locator('.agent-hint-pointer')).toHaveCSS('z-index', '2')
  await expect(hint.locator('.agent-hint-menu')).toHaveCSS('z-index', 'auto')
  await expect(hint).toContainText('Right-click your character portrait or tab')
  await page.screenshot({ path: 'test-results/agent-connected-nonmodal.png' })
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', 'host-persistent')
  await expect(page.locator('html')).toHaveAttribute('data-agent-confirmed', 'false')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', 'host-persistent')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-agent-candidate', '')
})

test('cancel and expiry retire the link and reject late public proofs', async ({ page, request }) => {
  const dialog = await open_setup(page)
  const begin = dialog.getByRole('button', { name: 'Connect', exact: true })
  const prompt = dialog.locator('.agent-prompt')
  await begin.click()
  await expect(prompt).toBeVisible()
  const cancelled = setup_url((await prompt.textContent())!)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(prompt).toHaveCount(0)
  await expect.poll(async () => (await request.get(cancelled.href, authorized(cancelled))).status()).toBe(403)
  await begin.click()
  await expect(prompt).toBeVisible()
  const expired = setup_url((await prompt.textContent())!)
  const pending = await request.get(expired.href, authorized(expired)).then((reply) => reply.json())
  const agent = await bootstrap_disposable_agent(pending)
  await request.post(`${origin}/fixture/expire?id=${expired.searchParams.get('id')}`)
  await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 10_000 })
  await expect(prompt).toHaveCount(0)
  expect((await request.post(expired.href, { ...authorized(expired), data: agent.response })).status()).toBe(403)
  await expect(dialog.locator('[data-paired-address]')).toHaveCount(0)
  await expect(dialog.locator('.agent-provider-card')).toHaveCount(0)
  await expect(dialog.getByRole('alert')).toContainText('Setup expired or could not complete')
  await begin.click()
  await expect(prompt).toBeVisible()
  expect(setup_url((await prompt.textContent())!).hash).not.toBe(expired.hash)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Choose your agent', exact: true })).toBeVisible()
  await expect(dialog.locator('.agent-provider-card')).toHaveCount(2)
})

test('a late begin reply cannot restore a cancelled attempt', async ({ page, request }) => {
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let issued: URL | null = null
  await page.route(`${origin}/fixture/session`, async (route) => {
    if (route.request().postDataJSON().request.action !== 'begin') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const result = await response.json()
    issued = new URL(`${origin}/api/agent-setup?id=${result.pairing_id}#${result.token}`)
    await gate
    await route.fulfill({ response })
  })
  const dialog = await open_setup(page)
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect.poll(() => issued !== null).toBe(true)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  release()
  await expect.poll(async () => (await request.get(issued!.href, authorized(issued!))).status()).toBe(403)
  await expect(dialog.locator('textarea')).toHaveCount(0)
  await expect(dialog.locator('[data-paired-address]')).toHaveCount(0)
})

test('account replacement and close cancel their owning setup', async ({ page, request }) => {
  const dialog = await open_setup(page)
  const begin = dialog.getByRole('button', { name: 'Connect', exact: true })
  const prompt = dialog.locator('.agent-prompt')
  await begin.click()
  await expect(prompt).toBeVisible()
  const old = setup_url((await prompt.textContent())!)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 })))
  await expect(prompt).toHaveCount(0)
  await expect.poll(async () => (await request.get(old.href, authorized(old))).status()).toBe(403)
  await begin.click()
  await expect(prompt).toBeVisible()
  const closed = setup_url((await prompt.textContent())!)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect.poll(async () => (await request.get(closed.href, authorized(closed))).status()).toBe(403)
})

for (const [payer, address] of [
  ['human', '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f'],
  ['multisig', null],
] as const) {
  test(`agent gas refusal reuses funding for the ${payer} payer without sending funds`, async ({ page }) => {
    await page.goto(`/e2e/fixtures/agent_pairing.html?funding=${payer}`)
    await page.getByRole('button', { name: 'Check transaction', exact: true }).click()
    const funding = page.locator('[data-add-funds]')
    await expect(funding).toBeVisible()
    await expect(funding).toContainText(address ?? (await page.locator('html').getAttribute('data-funding-pairing'))!)
    await expect(page.locator('[data-agent-transfer-review]')).toContainText('No valid gas coins')
  })
}

test('inventory selection preserves the chosen items, source kiosks, exact amounts and editable gas reserve', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/agent_pairing.html?inventory')
  const inventory = page.locator('[data-agent-inventory]')
  await inventory.getByRole('button', { name: 'Refresh inventory', exact: true }).click()
  await inventory.getByRole('button', { name: 'Available wool', exact: true }).click()
  await expect(inventory.getByRole('button', { name: 'Listed wool', exact: true })).toBeDisabled()
  await inventory.getByRole('button', { name: 'Check transaction', exact: true }).click()
  let reviewed = JSON.parse((await page.locator('html').getAttribute('data-inventory-review'))!)
  expect(reviewed.items).toEqual([{ item_id: 'available-item', kiosk: 'first-kiosk', version: '1' }])
  expect(reviewed.sui_mist).toBe('0')
  expect(reviewed.kares_mist).toBe('0')
  expect(reviewed.reserve_mist).toBe('50000000')
  await inventory.getByLabel('SUI amount', { exact: true }).fill('0.000000001')
  await inventory.getByLabel('KARES amount', { exact: true }).fill('2.5')
  await inventory.getByLabel('SUI to retain after fees', { exact: true }).fill('0')
  await inventory.getByRole('button', { name: 'Check transaction', exact: true }).click()
  reviewed = JSON.parse((await page.locator('html').getAttribute('data-inventory-review'))!)
  expect(reviewed.sui_mist).toBe('1')
  expect(reviewed.kares_mist).toBe('2500000000')
  expect(reviewed.reserve_mist).toBe('0')
  await expect(inventory).toContainText('0.000000001')
  await expect(inventory).toContainText('2.500000000')
  await expect(inventory).toContainText('first-kiosk')
})

test('a damaged incoming return cannot hide unrelated inventory and token recovery', async ({ page }) => {
  await page.goto('/e2e/fixtures/agent_pairing.html?inventory&incoming_failure')
  const inventory = page.locator('[data-agent-inventory]')
  await inventory.getByRole('button', { name: 'Refresh inventory', exact: true }).click()
  await expect(inventory.getByRole('alert')).toContainText('Incoming equipment capability is missing')
  await expect(inventory.getByRole('button', { name: 'Available wool', exact: true })).toBeVisible()
  await inventory.getByLabel('SUI amount', { exact: true }).fill('0.1')
  await inventory.getByRole('button', { name: 'Check transaction', exact: true }).click()
  const reviewed = JSON.parse((await page.locator('html').getAttribute('data-inventory-review'))!)
  expect(reviewed.items).toEqual([])
  expect(reviewed.sui_mist).toBe('100000000')
  await expect(inventory).not.toContainText('Claim selected items:')
})

test('Recall native SUI checkout authorizes the verified multisig outside spectator mode', async ({ page }) => {
  await mock_funding(page)
  await page.goto('/e2e/fixtures/agent_pairing.html?funding=multisig')
  await page.getByRole('button', { name: 'Check transaction', exact: true }).click()
  await page.getByRole('textbox', { name: /^Amount to add/ }).fill('0.1')
  await page.getByRole('button', { name: 'Pay 0.1 SUI', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-fake-payment')
  const payment = JSON.parse((await page.locator('html').getAttribute('data-fake-payment'))!)
  expect(payment).toEqual({
    address: await page.locator('html').getAttribute('data-funding-pairing'),
    amount: '100000000',
  })
})
test('Recall account replacement during funding preflight prevents submission', async ({ page }) => {
  await mock_funding(page)
  await page.goto('/e2e/fixtures/agent_pairing.html?funding=multisig&slow_estimate')
  await page.getByRole('button', { name: 'Check transaction', exact: true }).click()
  await page.getByRole('textbox', { name: /^Amount to add/ }).fill('0.1')
  await page.getByRole('button', { name: 'Pay 0.1 SUI', exact: true }).click()
  await page.evaluate(() => {
    dispatchEvent(new CustomEvent('fixture/wallet', { detail: 1 }))
    dispatchEvent(new Event('fixture/release_estimate'))
  })
  await expect(page.locator('[data-add-funds]')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-fake-payment')
})
