// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { asset_url, configure_assets } from '@aresrpg/sdk/jobs'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import {
  assert_signed_and_executed,
  dev_key_or_throw,
  executed_digest,
  record_signature,
  type signing_entry,
} from './signing_ledger.ts'

const PROD_ORIGIN = process.env.PROD_SMOKE_ORIGIN ?? 'https://testnet.aresrpg.world'
const DEV_KEY = process.env.VITE_DEV_KEY
const WALLET_NAME = 'AresRPG Prod Smoke Wallet'
const SUI_CHAIN = 'sui:testnet'
const SUI_GRPC_URL = process.env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443'

type live_asset_manifest = {
  aggregator?: string
  sequences?: Record<string, Array<{ url_class?: string; filename?: string }> | undefined>
}

// Every guard, verdict and ledger decision below lives in signing_ledger.ts and is driven through all of
// its polarities off CI (signing_ledger_test.ts). What stays here is only the SDK wiring.
function prod_signer() {
  const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(dev_key_or_throw(DEV_KEY)).secretKey)
  const grpc_client = new SuiGrpcClient({ network: 'testnet', baseUrl: SUI_GRPC_URL })
  const address = keypair.getPublicKey().toSuiAddress()
  // Born here, only ever replaced — the ledger is this signer's own value, never shared state.
  let ledger: readonly signing_entry[] = []

  const build_bytes = async (json: string) => {
    const transaction = Transaction.from(json)
    transaction.setSenderIfNotSet(address)
    return transaction.build({ client: grpc_client })
  }

  return {
    address,
    public_key: [...keypair.getPublicKey().toRawBytes()],
    // The oracle #1723 found missing: what this signer really did, in order.
    ledger: () => ledger,
    sign_personal: async (message: number[]) => {
      const signed = await keypair.signPersonalMessage(new Uint8Array(message))
      ledger = record_signature(ledger, { op: 'personal' })
      return signed
    },
    sign_transaction: async (json: string) => {
      const bytes = await build_bytes(json)
      const { signature } = await keypair.signTransaction(bytes)
      ledger = record_signature(ledger, { op: 'sign' })
      return { bytes: toBase64(bytes), signature }
    },
    sign_and_execute: async (json: string) => {
      const bytes = await build_bytes(json)
      const { signature } = await keypair.signTransaction(bytes)
      const digest = executed_digest(
        await grpc_client.core.executeTransaction({
          transaction: bytes,
          signatures: [signature],
          include: { effects: true },
        })
      )
      ledger = record_signature(ledger, { op: 'execute', digest })
      return { digest, bytes: toBase64(bytes), signature }
    },
  }
}

function require_prod_origin(frame_url: string) {
  if (new URL(frame_url).origin !== PROD_ORIGIN)
    throw new Error(`prod-smoke signer refused non-production origin: ${new URL(frame_url).origin}`)
}

// The product's `?dev` module is intentionally tree-shaken from production. Register a test-only
// Wallet Standard provider before boot instead: VITE_DEV_KEY stays in this Node process, while the
// deployed page can request signatures through origin-checked Playwright bindings.
async function install_dev_wallet(page: Page) {
  const signer = prod_signer()
  await page.exposeBinding('__ares_prod_smoke_sign_personal', async ({ frame }, message: number[]) => {
    require_prod_origin(frame.url())
    return signer.sign_personal(message)
  })
  await page.exposeBinding('__ares_prod_smoke_sign_transaction', async ({ frame }, json: string) => {
    require_prod_origin(frame.url())
    return signer.sign_transaction(json)
  })
  await page.exposeBinding('__ares_prod_smoke_sign_and_execute', async ({ frame }, json: string) => {
    require_prod_origin(frame.url())
    return signer.sign_and_execute(json)
  })
  await page.addInitScript(
    ({ address, public_key, wallet_name, chain }) => {
      const bindings = window as unknown as {
        __ares_prod_smoke_sign_personal: (message: number[]) => Promise<{ bytes: string; signature: string }>
        __ares_prod_smoke_sign_transaction: (json: string) => Promise<{ bytes: string; signature: string }>
        __ares_prod_smoke_sign_and_execute: (
          json: string
        ) => Promise<{ digest: string; bytes: string; signature: string }>
      }
      const account = Object.freeze({
        address,
        publicKey: new Uint8Array(public_key),
        chains: [chain],
        features: ['sui:signPersonalMessage', 'sui:signTransaction', 'sui:signAndExecuteTransaction'],
      })
      const wallet = Object.freeze({
        name: wallet_name,
        version: '1.0.0',
        icon: '',
        chains: [chain],
        accounts: [account],
        features: {
          'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
          'standard:disconnect': { version: '1.0.0', disconnect: async () => undefined },
          'standard:events': { version: '1.0.0', on: () => () => undefined },
          'sui:signPersonalMessage': {
            version: '1.1.0',
            signPersonalMessage: async ({ message }: { message: Uint8Array }) =>
              bindings.__ares_prod_smoke_sign_personal([...message]),
          },
          'sui:signTransaction': {
            version: '2.0.0',
            signTransaction: async ({ transaction }: { transaction: { toJSON: () => Promise<string> } }) =>
              bindings.__ares_prod_smoke_sign_transaction(await transaction.toJSON()),
          },
          'sui:signAndExecuteTransaction': {
            version: '2.0.0',
            signAndExecuteTransaction: async ({ transaction }: { transaction: { toJSON: () => Promise<string> } }) =>
              bindings.__ares_prod_smoke_sign_and_execute(await transaction.toJSON()),
          },
        },
      })
      const register = ({ register }: { register: (...wallets: unknown[]) => void }) => register(wallet)
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
      window.addEventListener('wallet-standard:app-ready', (event) =>
        register((event as CustomEvent<{ register: (...wallets: unknown[]) => void }>).detail)
      )
      localStorage.setItem('last_wallet', wallet_name)
      localStorage.setItem('ares_tutorial_seen', '1')
      localStorage.setItem('ares_tutorial_seen_v2', '1')
    },
    { address: signer.address, public_key: signer.public_key, wallet_name: WALLET_NAME, chain: SUI_CHAIN }
  )
  // Handed back so a row can assert what the deployed page really made this wallet sign.
  return signer
}

// ENG-20 RUNNER HONESTY (#2202). A GitHub runner has NO GPU, so every row that waited on a real WebGPU
// adapter was impossible by construction. This suite therefore drives the game's WEBGL COMPATIBILITY FLOOR
// deliberately — the exact path a player whose browser ships no WebGPU implementation gets — through the
// PRODUCT's own selection seam, never a test-only hack: pick_renderer_backend
// (packages/engine/src/core/quality/backend.js) picks 'webgl' SYNCHRONOUSLY when `navigator.gpu` is nullish,
// so shadowing it before boot forks the deployed bundle straight into render/webgl_fallback.js with no
// failed-adapter detour. `ares_debug` turns the app's OWN boot verdict (core/log.js prints game_log lines
// under it) into a console line, so "we really ran on the floor" is a fact the page states, never an
// assumption this file makes. Returns the collected verdict lines for the row to assert on.
async function force_webgl_floor(page: Page) {
  const verdicts: string[] = []
  page.on('console', (message) => {
    const text = message.text()
    if (/webgl floor active|WebGL heightmap fallback|initialized on 'webgl|\[webgl-fallback\]/i.test(text))
      verdicts.push(text)
  })
  await page.addInitScript(() => {
    // An OWN property shadows the Navigator.prototype accessor — always writable, never a strict-mode throw.
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })
    localStorage.setItem('ares_debug', '1')
  })
  return () => [...verdicts]
}

async function enter_live_world(page: Page) {
  const floor_verdicts = await force_webgl_floor(page)
  const signer = await install_dev_wallet(page)
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
  expect(response?.status(), 'the deployed root must answer 200').toBe(200)
  await expect(
    page.locator('[data-app-sidebar]'),
    'the VITE_DEV_KEY wallet must reconnect through Wallet Standard on the deployed build'
  ).toBeVisible({ timeout: 180_000 })
  // TWO-TIER WORLD-MOUNT WAIT (SELECTOR-ROT, 2ea13bb7 deleted the old [data-game-world-viewport] hook
  // with zero replacement): race the stable host testid against .gw-hud, an independent world-mounted
  // proof present in every gold artifact regardless of the host's own selector. Either resolving proves
  // the world is up, so one renamed/dead locator never burns the whole 180s budget alone — no single
  // locator cliff. A joint timeout throws WITH an inlined ARIA page snapshot: this suite's reporter is
  // list-only, so the console line is the only diagnostic a red CI run gets without pulling the trace.
  await Promise.any([
    page.locator('[data-testid="game-world-viewport"]').waitFor({ state: 'visible', timeout: 180_000 }),
    page.locator('.gw-hud').waitFor({ state: 'visible', timeout: 180_000 }),
  ]).catch(async () => {
    const snapshot = await page
      .locator('body')
      .ariaSnapshot()
      .catch((snapshot_error) => `<page snapshot unavailable: ${snapshot_error}>`)
    throw new Error(
      `enter_live_world: neither [data-testid="game-world-viewport"] nor .gw-hud became visible within 180s.\n--- page snapshot ---\n${snapshot}`
    )
  })
  return { signer, floor_verdicts }
}

const attack_prompt = (page: Page) =>
  page
    .locator('.gw-prompt-stack .gw-npc-prompt')
    .filter({ has: page.locator('kbd.gw-npc-prompt__key', { hasText: /^R$/ }) })

async function asset_response(request: APIRequestContext, url: string) {
  const response = await request.get(url, { timeout: 60_000 })
  expect(response.status(), `${url} must answer 200`).toBe(200)
}

test('PROD-SMOKE a · app boots and the login gate renders', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
  expect(response?.status()).toBe(200)
  expect(new URL(page.url()).origin).toBe(PROD_ORIGIN)
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 120_000 })
  await expect(page.getByRole('heading', { name: 'AresRPG' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Watch the live world' })).toBeVisible()
})

test('PROD-SMOKE b · VITE_DEV_KEY session reaches the world', async ({ page }) => {
  await enter_live_world(page)
  await expect(page.locator('[data-nav="game-world"]')).toHaveClass(/active/)
  await expect(page.locator('.gw-chat__input')).toBeVisible({ timeout: 180_000 })
})

test('PROD-SMOKE c · fight engagement reaches an actionable first turn on the WebGL floor', async ({ page }) => {
  const { signer, floor_verdicts } = await enter_live_world(page)
  // #2202 — this row used to demand a real WebGPU adapter on a GPU-less runner: an impossible red that never
  // passed once in 500+ runs and buried this job's relay/corpus/heartbeat probes with it. It now drives the
  // COMPATIBILITY FLOOR on purpose, which is also the low-end cohort's standing driven gate. The tactical
  // BOARD is an engine no-op down there (webgl_fallback.js warns and stubs it); what this row asserts is the
  // fight MACHINE reaching an actionable turn, and that is DOM truth — FightControls mounts off the fight
  // phase (DungeonBoardControls.jsx), never off the rendered board.
  const gpu = await page.evaluate(() => (navigator as Navigator & { gpu?: unknown }).gpu ?? null)
  expect(gpu, 'the floor drive must reach the deployed page — navigator.gpu must be nullish before boot').toBeNull()
  // The page's own verdict, not ours: an empty list means the bundle booted some OTHER backend and this row
  // would be measuring something it did not name. Loud, never silent.
  expect(
    floor_verdicts(),
    'the deployed engine must state its WebGL-floor boot (game_log "[voxel] webgl floor active …" / a [webgl-fallback] stub warn)'
  ).not.toEqual([])
  console.log(`PROD-SMOKE c · renderer floor verdict · ${floor_verdicts().join(' | ')}`)

  const controls = page.locator('.hud-fightctl')
  const engage = attack_prompt(page).first()
  await expect(
    controls.or(engage).first(),
    'a resumed fight or a claimable mob must eventually reach the live client'
  ).toBeVisible({ timeout: 120_000 })
  const resumed = await controls.isVisible().catch(() => false)
  if (!resumed) {
    await engage.click()
    await expect(controls, 'fight controls must mount after the live engage receipt reconciles').toBeVisible({
      timeout: 180_000,
    })
    // An engage is a CHAIN WRITE. Before #1723 this row could reach mounted controls off a shim that never
    // signed anything and still read green; the ledger is now the row's own oracle for the signature it
    // just claimed to have driven. Asserted only on the branch that really engaged — a resumed fight
    // reconciles from chain state and signs nothing, and a conditional truth must never be asserted flat.
    // WHICH op appears is left open on purpose: the deployed build's own door is `sui:signTransaction`
    // (the sender half, station-executed) while self-pay uses `sui:signAndExecuteTransaction`, so
    // demanding a digest here would red the row for taking the sponsored route. The op is logged instead —
    // it is the only place a run states which of the two the live page actually took.
    const ops = signer.ledger().map((entry) => entry.op)
    expect(
      ops,
      'a live engage must reach this wallet — through signTransaction or signAndExecuteTransaction'
    ).not.toEqual([])
    console.log(`PROD-SMOKE c · live engage signed through the shim · ops=${ops.join(',')}`)
  }

  const ready = page.locator('.hud-fightctl__ready')
  const end_turn = page.locator('.hud-fightctl__end')
  await expect(
    ready.or(end_turn).first(),
    'the mounted fight must reconcile to placement or an already-active turn'
  ).toBeVisible({ timeout: 180_000 })
  if (await ready.isVisible().catch(() => false)) {
    await expect(ready).toBeEnabled({ timeout: 120_000 })
    await ready.click()
  }
  await expect(end_turn, 'the ACTIVE fight must eventually hand the dev character its first turn').toBeVisible({
    timeout: 180_000,
  })
  await expect(end_turn, 'first-turn input must become actionable after the minimum-turn floor').toBeEnabled({
    timeout: 180_000,
  })
})

// #2202 — the row asserted "at least one item quilt sample" against a shape that no longer exists: the quilt
// (and the retired blob store it was keyed by, whose codename this repo's asset-codename gate now forbids in
// text) DIED in 8e77502a0 `fix(frontend): mob icons resolve through the asset host …`, so `classes.item.quilts`
// is permanently absent and the row was a permanent red measuring a dead schema. Every icon resolves through
// the asset host now. The live manifest's ACTUAL contract is the mapping law in @aresrpg/sdk/jobs: an `aggregator`
// plus per-class `published` flags turn the refs the manifest SEALS into asset-host URLs. This row now feeds
// the LIVE manifest to the PRODUCT's own resolver (never a re-implementation of the URL shapes — one home)
// and demands the resulting bytes exist. `asset_url` returning null IS the unpublished-class failure, so the
// published gate is derived here, never restated. #2199's class of bug — a sealed ref naming a key the bucket
// never held — is exactly what this probes against the deployed origin.
test('PROD-SMOKE d · the live manifest resolves its sealed refs to bytes that answer 200', async ({ request }) => {
  const manifest_response = await request.get(`${PROD_ORIGIN}/asset_manifest.json`, { timeout: 60_000 })
  expect(manifest_response.status()).toBe(200)
  const manifest = (await manifest_response.json()) as live_asset_manifest
  if (typeof manifest.aggregator !== 'string') throw new Error('the live asset manifest has no aggregator')
  configure_assets(manifest)
  const refs = Object.values(manifest.sequences ?? {})
    .flatMap((sequence) => sequence ?? [])
    .filter((ref): ref is { url_class: string; filename: string } => !!ref.url_class && !!ref.filename)
  expect(refs.length, 'the live manifest must seal at least one asset ref for the client to preload').toBeGreaterThan(0)
  for (const { url_class, filename } of refs) {
    const url = asset_url(url_class, filename)
    expect(
      url,
      `${url_class}/${filename} is sealed in the live manifest but its class resolves to nothing`
    ).not.toBeNull()
    await asset_response(request, url as string)
  }
})

test('PROD-SMOKE e · shop renders a nonzero catalog', async ({ page }) => {
  await enter_live_world(page)
  await page.locator('[data-nav="shop"]').click()
  await expect(page).toHaveURL(`${PROD_ORIGIN}/shop`)
  await expect.poll(() => page.locator('.shop-grid .vitrine').count(), { timeout: 180_000 }).toBeGreaterThan(0)
})

test('PROD-SMOKE f · world join and presence state reach the client', async ({ page }) => {
  await enter_live_world(page)
  const world = page.locator('.gw-worlds__now')
  await expect
    .poll(async () => (await world.getAttribute('data-world')) ?? '', { timeout: 180_000 })
    .toMatch(/^0x[0-9a-f]+$/i)
  const online_count = page.locator('.gw-chat__title b')
  await expect
    .poll(async () => Number((await online_count.textContent()) ?? 0), { timeout: 180_000 })
    .toBeGreaterThan(0)
})

// #1723's DoD, and the row that makes this suite's name true. Rows a/b/d/e/f never sign anything and row c
// only signs on the branch that engages, so until this row existed the whole "real-signing smoke" could pass
// end to end with a signing route that was dead — the shim was never once proven to have produced a
// signature that testnet accepted. This row is deliberately the SMALLEST possible chain write (one MIST split
// back to the sender), so what it measures is the ROUTE — build → resolve → sign → execute — and never
// product state: it is the same shim function the deployed page calls for every sponsored or self-paid
// action, and it either cites a digest or reds.
test('PROD-SMOKE g · the wallet shim really signs and executes on testnet (#1723)', async () => {
  const signer = prod_signer()
  const transaction = new Transaction()
  const [coin] = transaction.splitCoins(transaction.gas, [1])
  transaction.transferObjects([coin], signer.address)
  const { digest } = await signer.sign_and_execute(await transaction.toJSON())
  expect(assert_signed_and_executed(signer.ledger()), 'the executed digest must come from THIS signer').toEqual([
    digest,
  ])
  console.log(`PROD-SMOKE g · REAL signed transaction executed on testnet · digest=${digest}`)
  // The scope limit #1726 requires every drive verdict to carry, printed by the instrument itself rather
  // than left to whoever writes the report: this suite signs with a dev keypair that self-pays gas, which
  // is a route only QA uses. Auth and money live on the Enoki zkLogin + sponsored-station path, and the
  // smoke does not touch it. Delete this line the day an Enoki test identity drives a sponsored row here.
  console.log(
    'PROD-SMOKE scope limit (#1726) · verified via dev-wallet keypair signing; the Enoki/sponsored path ' +
      'real players use is NOT exercised'
  )
})
