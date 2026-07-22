// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'
import { test, type Page } from '@playwright/test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOTS = path.join(HERE, '..', 'shots3')
mkdirSync(SHOTS, { recursive: true })

const PROD_ORIGIN = 'https://testnet.aresrpg.world'
const WALLET_NAME = 'AresRPG Prod Smoke Wallet'
const SUI_CHAIN = 'sui:testnet'
const SUI_GRPC_URL = 'https://fullnode.testnet.sui.io:443'
const ALICE_KEY: string = JSON.parse(readFileSync('/Users/sceatstudio/dev/aresrpg/.dev/keys.json', 'utf8')).alice

const log_lines: string[] = []
const L = (s: string) => {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${s}`
  log_lines.push(line)

  console.log(line)
}

function prod_signer() {
  const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(ALICE_KEY).secretKey)
  const grpc_client = new SuiGrpcClient({ network: 'testnet', baseUrl: SUI_GRPC_URL })
  const address = keypair.getPublicKey().toSuiAddress()
  const build_bytes = async (json: string) => {
    const transaction = Transaction.from(json)
    transaction.setSenderIfNotSet(address)
    return transaction.build({ client: grpc_client })
  }
  return {
    address,
    public_key: [...keypair.getPublicKey().toRawBytes()],
    sign_personal: async (m: number[]) => keypair.signPersonalMessage(new Uint8Array(m)),
    sign_transaction: async (json: string) => {
      const bytes = await build_bytes(json)
      const { signature } = await keypair.signTransaction(bytes)
      return { bytes: toBase64(bytes), signature }
    },
    sign_and_execute: async (json: string) => {
      const bytes = await build_bytes(json)
      const { signature } = await keypair.signTransaction(bytes)
      const result = await grpc_client.core.executeTransaction({
        transaction: bytes,
        signatures: [signature],
        include: { effects: true },
      })
      const executed = result.Transaction ?? result.FailedTransaction
      if (!executed) throw new Error('no tx result')
      if (!(executed.effects?.status.success ?? false))
        throw new Error(executed.effects?.status.error?.message ?? `tx ${executed.digest} failed`)
      return { digest: executed.digest, bytes: toBase64(bytes), signature }
    },
  }
}
const require_prod_origin = (u: string) => {
  if (new URL(u).origin !== PROD_ORIGIN) throw new Error(`refused origin ${new URL(u).origin}`)
}

async function install_dev_wallet(page: Page) {
  const signer = prod_signer()
  L(`alice address: ${signer.address}`)
  await page.exposeBinding('__ares_prod_smoke_sign_personal', async ({ frame }, m: number[]) => {
    require_prod_origin(frame.url())
    return signer.sign_personal(m)
  })
  await page.exposeBinding('__ares_prod_smoke_sign_transaction', async ({ frame }, j: string) => {
    require_prod_origin(frame.url())
    return signer.sign_transaction(j)
  })
  await page.exposeBinding('__ares_prod_smoke_sign_and_execute', async ({ frame }, j: string) => {
    require_prod_origin(frame.url())
    return signer.sign_and_execute(j)
  })
  await page.addInitScript(
    ({ address, public_key, wallet_name, chain }) => {
      const b = window as any
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
            signPersonalMessage: async ({ message }: any) => b.__ares_prod_smoke_sign_personal([...message]),
          },
          'sui:signTransaction': {
            version: '2.0.0',
            signTransaction: async ({ transaction }: any) =>
              b.__ares_prod_smoke_sign_transaction(await transaction.toJSON()),
          },
          'sui:signAndExecuteTransaction': {
            version: '2.0.0',
            signAndExecuteTransaction: async ({ transaction }: any) =>
              b.__ares_prod_smoke_sign_and_execute(await transaction.toJSON()),
          },
        },
      })
      const register = ({ register }: any) => register(wallet)
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
      window.addEventListener('wallet-standard:app-ready', (e: any) => register(e.detail))
      localStorage.setItem('last_wallet', wallet_name)
      localStorage.setItem('ares_tutorial_seen', '1')
      localStorage.setItem('ares_tutorial_seen_v2', '1')
    },
    { address: signer.address, public_key: signer.public_key, wallet_name: WALLET_NAME, chain: SUI_CHAIN }
  )
}
async function enter_live_world(page: Page) {
  await install_dev_wallet(page)
  const r = await page.goto('/', { waitUntil: 'domcontentloaded' })
  L(`root: ${r?.status()}`)
  await page.locator('[data-app-sidebar]').waitFor({ state: 'visible', timeout: 180_000 })
  await Promise.any([
    page.locator('[data-testid="game-world-viewport"]').waitFor({ state: 'visible', timeout: 180_000 }),
    page.locator('.gw-hud').waitFor({ state: 'visible', timeout: 180_000 }),
  ])
  L('world mounted')
}

const shot = async (page: Page, n: string) => {
  const p = path.join(SHOTS, `${n}.png`)
  await page.screenshot({ path: p }).catch(() => {})
  return p
}
const armed = (page: Page) =>
  page
    .locator('.hud-fightctl__end:not([disabled])')
    .isVisible()
    .catch(() => false)

async function human_press(page: Page, x: number, y: number, drift: number) {
  await page.mouse.move(x, y, { steps: 6 })
  await page.waitForTimeout(80)
  await page.mouse.down()
  await page.waitForTimeout(70)
  const a = Math.random() * Math.PI * 2
  await page.mouse.move(x + Math.cos(a) * drift, y + Math.sin(a) * drift, { steps: 3 })
  await page.waitForTimeout(50)
  await page.mouse.up()
  await page.waitForTimeout(350)
}
async function anchor_press(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 8 })
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.mouse.up()
  await page.waitForTimeout(350)
}

// board-right region (left HUD pushes the arena right — measured off 02_fight_mounted)
const BOARD_CX = 905
const BOARD_CY = 420
const RING_DIRS: Array<[number, number]> = [
  [0, -1],
  [0.9, -0.5],
  [0.9, 0.5],
  [0, 1],
  [-0.9, 0.5],
  [-0.9, -0.5],
]

test('B5 fresh-fight human-click verdict', async ({ page }) => {
  page.on('console', (m) => log_lines.push(`  [c.${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => log_lines.push(`  [pageerror] ${e.message}`))
  const summary: any = { phase: 'start', clicks: [], forfeited: false, engaged_fresh: false, reached_turn: false }
  try {
    await enter_live_world(page)
    await shot(page, '01_world')
    const controls = page.locator('.hud-fightctl')
    const engage = page
      .locator('.gw-prompt-stack .gw-npc-prompt')
      .filter({ has: page.locator('kbd.gw-npc-prompt__key', { hasText: /^R$/ }) })
      .first()

    // present state: fight OR world
    await controls.or(engage).first().waitFor({ state: 'visible', timeout: 120_000 })
    let in_fight = await controls.isVisible().catch(() => false)
    L(`initial state: ${in_fight ? 'IN A FIGHT (resumed)' : 'IN WORLD (mob prompt)'}`)
    await shot(page, '02_initial')

    // If resumed into a fight: give the turn 45s to arm; else FORFEIT to escape limbo.
    if (in_fight) {
      L('resumed fight — waiting up to 45s for END TURN to arm...')
      const got = await page
        .locator('.hud-fightctl__end:not([disabled])')
        .waitFor({ state: 'visible', timeout: 45_000 })
        .then(() => true)
        .catch(() => false)
      if (!got) {
        L('END TURN never armed (limbo) — FORFEITING to start fresh')
        await shot(page, '03_limbo')
        await page
          .locator('.hud-fightctl__abandon')
          .click()
          .catch((e) => L(`abandon click: ${e}`))
        await page
          .locator('.confirm-dialog__btn--danger')
          .click({ timeout: 15_000 })
          .catch((e) => L(`confirm: ${e}`))
        summary.forfeited = true
        L('forfeit confirmed — waiting for world + a fresh [R] mob prompt (120s)...')
        await engage.waitFor({ state: 'visible', timeout: 120_000 })
        await shot(page, '04_world_after_forfeit')
        in_fight = false
      }
    }

    // Engage a fresh mob if in the world
    if (!in_fight) {
      L('engaging a fresh mob via [R] prompt')
      await engage.click().catch((e) => L(`engage click: ${e}`))
      summary.engaged_fresh = true
      await controls.waitFor({ state: 'visible', timeout: 180_000 })
      L('fight controls mounted after fresh engage')
      await shot(page, '05_fresh_mounted')

      // Placement: click a right-biased fan of start-cell candidates, then READY.
      const ready = page.locator('.hud-fightctl__ready')
      if (await ready.isVisible().catch(() => false)) {
        L('PLACEMENT phase — fanning start-cell clicks (human gesture)')
        let placed_anchor: { x: number; y: number } | null = null
        for (const r of [0, 45, 80]) {
          for (const [dx, dy] of RING_DIRS) {
            const x = Math.round(BOARD_CX + dx * r)
            const y = Math.round(BOARD_CY + dy * r)
            await human_press(page, x, y, 3)
            placed_anchor = { x, y }
            // a legal placement pick renders the fighter; READY stays enabled — good enough to proceed
            if (r === 0) break
          }
          await shot(page, `06_placement_r${r}`)
        }
        summary.placed_anchor = placed_anchor
        L('pressing READY')
        await ready.click().catch((e) => L(`ready click: ${e}`))
      }
    }

    // Wait for an ACTIONABLE turn
    L('waiting for END TURN to arm (my turn, up to 180s)...')
    await page.locator('.hud-fightctl__end').waitFor({ state: 'visible', timeout: 180_000 })
    await page.locator('.hud-fightctl__end:not([disabled])').waitFor({ state: 'visible', timeout: 180_000 })
    summary.reached_turn = true
    L('=== ACTIONABLE TURN REACHED — starting MOVE-CLICK drive ===')
    await page.waitForTimeout(1200)
    await shot(page, '10_myturn_before')

    // MOVE fan anchored on the board-right region. Inner rings first (most-likely reachable). Human gesture
    // by default; ONE anchor zero-drift press (A/B) at the same inner cell class the harness uses.
    const anchor = (summary.placed_anchor as { x: number; y: number } | null) ?? { x: BOARD_CX, y: BOARD_CY }
    let ci = 0
    for (const r of [45, 80, 115]) {
      for (const [dx, dy] of RING_DIRS) {
        if (!(await armed(page))) {
          L('END TURN no longer armed mid-fan (turn advanced/presenting) — stopping fan')
          break
        }
        ci++
        const x = Math.round(anchor.x + dx * r)
        const y = Math.round(anchor.y + dy * r)
        const gesture = ci === 3 ? 'anchor_zero_drift' : 'human_drift'
        const drift = ci % 2 === 0 ? 4 : 2
        L(`move-click #${ci} (${x},${y}) r=${r} gesture=${gesture} drift=${gesture === 'human_drift' ? drift : 0}`)
        await shot(page, `11_c${ci}_before`)
        if (gesture === 'anchor_zero_drift') await anchor_press(page, x, y)
        else await human_press(page, x, y, drift)
        const sp = await shot(page, `11_c${ci}_after`)
        summary.clicks.push({
          i: ci,
          x,
          y,
          r,
          gesture,
          drift: gesture === 'human_drift' ? drift : 0,
          shot: path.basename(sp),
        })
      }
    }
    await shot(page, '20_after_fan')

    // COMMIT: press END TURN — if any move draft registered, the character walks the drafted path now.
    if (await armed(page)) {
      L('pressing END TURN to COMMIT any drafted move')
      await page
        .locator('.hud-fightctl__end:not([disabled])')
        .first()
        .click()
        .catch((e) => L(`end-turn: ${e}`))
      await page.waitForTimeout(7000)
      await shot(page, '21_after_commit')
    }
    await shot(page, '99_final')
    L('drive complete')
  } catch (err) {
    L(`ERROR: ${(err as Error).message}`)
    await shot(page, 'ZZ_error')
  } finally {
    writeFileSync(path.join(HERE, '..', 'summary3.json'), JSON.stringify(summary, null, 2))
    writeFileSync(path.join(HERE, '..', 'console3.log'), log_lines.join('\n'))
    L('wrote summary3.json + console3.log')
  }
})
