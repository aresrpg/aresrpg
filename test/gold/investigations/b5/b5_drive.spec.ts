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
const SHOTS = path.join(HERE, '..', 'shots')
mkdirSync(SHOTS, { recursive: true })

const PROD_ORIGIN = 'https://testnet.aresrpg.world'
const WALLET_NAME = 'AresRPG Prod Smoke Wallet'
const SUI_CHAIN = 'sui:testnet'
const SUI_GRPC_URL = 'https://fullnode.testnet.sui.io:443'

// alice — read in-script, NEVER logged. CanaryAlice lives under this key.
const ALICE_KEY: string = JSON.parse(readFileSync('/Users/sceatstudio/dev/aresrpg/.dev/keys.json', 'utf8')).alice

const log_lines: string[] = []
const L = (s: string) => {
  const line = `[${new Date().toISOString().slice(11, 23)}] ${s}`
  log_lines.push(line)

  console.log(line)
}

function prod_signer() {
  const secret = decodeSuiPrivateKey(ALICE_KEY).secretKey
  const keypair = Ed25519Keypair.fromSecretKey(secret)
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
    sign_personal: async (message: number[]) => keypair.signPersonalMessage(new Uint8Array(message)),
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
      if (!executed) throw new Error('testnet execute returned no transaction result')
      if (!(executed.effects?.status.success ?? false))
        throw new Error(executed.effects?.status.error?.message ?? `transaction ${executed.digest} failed`)
      return { digest: executed.digest, bytes: toBase64(bytes), signature }
    },
  }
}

function require_prod_origin(frame_url: string) {
  if (new URL(frame_url).origin !== PROD_ORIGIN)
    throw new Error(`refused non-production origin: ${new URL(frame_url).origin}`)
}

async function install_dev_wallet(page: Page) {
  const signer = prod_signer()
  L(`alice address (public): ${signer.address}`)
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
        __ares_prod_smoke_sign_personal: (m: number[]) => Promise<{ bytes: string; signature: string }>
        __ares_prod_smoke_sign_transaction: (j: string) => Promise<{ bytes: string; signature: string }>
        __ares_prod_smoke_sign_and_execute: (j: string) => Promise<{ digest: string; bytes: string; signature: string }>
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
      const register = ({ register }: { register: (...w: unknown[]) => void }) => register(wallet)
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
      window.addEventListener('wallet-standard:app-ready', (event) =>
        register((event as CustomEvent<{ register: (...w: unknown[]) => void }>).detail)
      )
      localStorage.setItem('last_wallet', wallet_name)
      localStorage.setItem('ares_tutorial_seen', '1')
      localStorage.setItem('ares_tutorial_seen_v2', '1')
    },
    { address: signer.address, public_key: signer.public_key, wallet_name: WALLET_NAME, chain: SUI_CHAIN }
  )
}

async function enter_live_world(page: Page) {
  await install_dev_wallet(page)
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' })
  L(`root status: ${response?.status()}`)
  await page.locator('[data-app-sidebar]').waitFor({ state: 'visible', timeout: 180_000 })
  L('sidebar visible — wallet reconnected')
  await Promise.any([
    page.locator('[data-testid="game-world-viewport"]').waitFor({ state: 'visible', timeout: 180_000 }),
    page.locator('.gw-hud').waitFor({ state: 'visible', timeout: 180_000 }),
  ])
  L('world mounted (viewport/.gw-hud visible)')
}

const attack_prompt = (page: Page) =>
  page
    .locator('.gw-prompt-stack .gw-npc-prompt')
    .filter({ has: page.locator('kbd.gw-npc-prompt__key', { hasText: /^R$/ }) })

async function shot(page: Page, name: string) {
  const p = path.join(SHOTS, `${name}.png`)
  await page.screenshot({ path: p }).catch((e) => L(`shot ${name} failed: ${e}`))
  return p
}

// Best-effort HUD read (no dev hooks on prod): countdown text + any MP/AP-ish numbers + a coarse hash of
// the fight controls region, so a move-commit that changes MP/position is detectable from the DOM too.
async function hud_read(page: Page) {
  return page.evaluate(() => {
    const txt = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? null
    const canvases = [...document.querySelectorAll('canvas')].map((c) => {
      const r = c.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) }
    })
    return {
      countdown: txt('.hud-fightctl__countdown'),
      end_present: !!document.querySelector('.hud-fightctl__end'),
      end_disabled: (document.querySelector('.hud-fightctl__end') as HTMLButtonElement | null)?.disabled ?? null,
      ready_present: !!document.querySelector('.hud-fightctl__ready'),
      controlled_char: document.querySelector('.hud-fightctl')?.getAttribute('data-controlled-character') ?? null,
      fightctl_text: txt('.hud-fightctl'),
      canvases,
    }
  })
}

// Are the DEV board hooks present on the live build? (expected: NO — tree-shaken)
async function hook_probe(page: Page) {
  return page.evaluate(() => {
    const w = window as any
    return {
      __ARES_ENGINE: typeof w.__ARES_ENGINE,
      __voxel_board: typeof w.__voxel_board,
      __voxel_canvas: typeof w.__voxel_canvas,
      __ARES_DEV_CELL_SCREEN: typeof w.__ARES_DEV_CELL_SCREEN,
    }
  })
}

function largest_canvas(canvases: Array<{ w: number; h: number; left: number; top: number }>) {
  return canvases.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null
}

// THE ANCHOR gesture, byte-for-byte (fight_mouse_helpers.ts:52-56 press_release): down, wait, up — NO
// pointermove between down and up. Zero drift. The suspected harness rot.
async function anchor_press(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 8 }) // click_cell approach (:835)
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.waitForTimeout(90)
  await page.mouse.up()
  await page.waitForTimeout(220)
}

// A REAL HUMAN gesture: approach, press, DRIFT within the 6px slop while held, release.
async function human_press(page: Page, x: number, y: number, drift: number) {
  await page.mouse.move(x, y, { steps: 6 })
  await page.waitForTimeout(90)
  await page.mouse.down()
  await page.waitForTimeout(70)
  const a = Math.random() * Math.PI * 2
  await page.mouse.move(x + Math.cos(a) * drift, y + Math.sin(a) * drift, { steps: 3 })
  await page.waitForTimeout(50)
  await page.mouse.up()
  await page.waitForTimeout(300)
}

test('B5 LIVE move-click verdict drive', async ({ page }) => {
  page.on('console', (m) => log_lines.push(`  [console.${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => log_lines.push(`  [pageerror] ${e.message}`))

  const summary: any = { attempts: [], hooks: null, reached_fight: false, engaged: false }
  try {
    await enter_live_world(page)
    summary.hooks = await hook_probe(page)
    L(`HOOK PROBE (dev hooks on prod): ${JSON.stringify(summary.hooks)}`)
    await shot(page, '01_world')

    // ---- reach a fight (prod-smoke row c flow: resume OR engage) ----
    const controls = page.locator('.hud-fightctl')
    const engage = attack_prompt(page).first()
    L('waiting for resumed fight controls OR a claimable [R] mob (120s)...')
    await controls.or(engage).first().waitFor({ state: 'visible', timeout: 120_000 })
    if (await controls.isVisible().catch(() => false)) {
      L('RESUMED an existing fight (.hud-fightctl already present)')
      summary.reached_fight = true
    } else {
      L('found a claimable [R] mob — engaging')
      await engage.click()
      summary.engaged = true
      await controls.waitFor({ state: 'visible', timeout: 180_000 })
      L('fight controls mounted after engage')
      summary.reached_fight = true
    }
    await shot(page, '02_fight_mounted')

    // placement → READY if present
    const ready = page.locator('.hud-fightctl__ready')
    const end_turn = page.locator('.hud-fightctl__end')
    await ready.or(end_turn).first().waitFor({ state: 'visible', timeout: 180_000 })
    if (await ready.isVisible().catch(() => false)) {
      L('placement phase — pressing READY')
      await page.waitForTimeout(1500)
      await shot(page, '03_placement')
      await ready.click({ trial: false }).catch((e) => L(`ready click issue: ${e}`))
      // (some builds require a placement pick first; if READY is gated, we still proceed to wait for a turn)
    }
    L('waiting for an ACTIONABLE turn (end_turn visible + enabled, up to 180s)...')
    await end_turn.waitFor({ state: 'visible', timeout: 180_000 })
    await page.locator('.hud-fightctl__end:not([disabled])').waitFor({ state: 'visible', timeout: 180_000 })
    L('ACTIONABLE TURN reached (end_turn enabled)')

    const hud0 = await hud_read(page)
    L(`HUD at first turn: ${JSON.stringify(hud0)}`)
    const canv = largest_canvas(hud0.canvases)
    if (!canv) throw new Error('no canvas found for the board')
    L(`board canvas: ${JSON.stringify(canv)}`)
    const cx = canv.left + canv.w / 2
    const cy = canv.top + canv.h / 2

    // ---- MOVE-CLICK DRIVE over several turns ----
    // Geometric fan of candidate reachable cells around the framed active character (camera-centred).
    // Perspective board: adjacent/near cells sit ~40-120px from centre. Try a ring, human-gesture each,
    // detect a registered move by (a) HUD/position change across before/after screenshots (vision) and
    // (b) any change in the fightctl/countdown DOM. Alternate gesture types across turns to A/B.
    const rings = [60, 95, 130]
    const dirs = [
      [0, -1],
      [1, -0.6],
      [1, 0.4],
      [0, 1],
      [-1, 0.4],
      [-1, -0.6],
    ]
    const TURNS = 5
    for (let turn = 1; turn <= TURNS; turn++) {
      const armed = await page
        .locator('.hud-fightctl__end:not([disabled])')
        .isVisible()
        .catch(() => false)
      if (!armed) {
        L(`turn ${turn}: no armed end-turn; fight likely ended. stopping drive.`)
        break
      }
      const gesture_kind = turn % 2 === 1 ? 'human_drift' : 'anchor_zero_drift'
      const drift = turn === 1 ? 3 : turn === 3 ? 4 : turn === 5 ? 2 : 0
      L(`--- TURN ${turn} · gesture=${gesture_kind} drift=${drift}px ---`)
      const before = await shot(page, `t${turn}_0_before`)
      const hud_before = await hud_read(page)

      let registered_here = false
      let ci = 0
      outer: for (const r of rings) {
        for (const [dxu, dyu] of dirs) {
          ci++
          const x = Math.round(cx + dxu * r)
          const y = Math.round(cy + dyu * r)
          L(
            `  click #${ci}: (${x},${y}) [center+(${Math.round(dxu * r)},${Math.round(dyu * r)})] gesture=${gesture_kind}`
          )
          if (gesture_kind === 'human_drift') await human_press(page, x, y, drift)
          else await anchor_press(page, x, y)
          const hud_after = await hud_read(page)
          const shotp = await shot(page, `t${turn}_c${ci}_after`)
          const changed =
            hud_after.countdown !== hud_before.countdown || hud_after.fightctl_text !== hud_before.fightctl_text
          summary.attempts.push({
            turn,
            click: ci,
            x,
            y,
            gesture: gesture_kind,
            drift,
            hud_dom_changed: changed,
            shot: path.basename(shotp),
          })
          if (changed) {
            L(`  -> HUD DOM changed after click #${ci} (countdown/fightctl text delta) — candidate registration`)
            registered_here = true
            break outer
          }
        }
      }
      L(`turn ${turn}: registered_by_dom=${registered_here} (vision review of shots is the primary oracle)`)

      // advance the turn
      const et = page.locator('.hud-fightctl__end:not([disabled])').first()
      if (await et.isVisible().catch(() => false)) {
        L(`turn ${turn}: pressing END TURN to advance`)
        await et.click().catch((e) => L(`end-turn click issue: ${e}`))
      }
      // wait for next actionable turn or fight end
      await page
        .locator('.hud-fightctl__end:not([disabled])')
        .waitFor({ state: 'visible', timeout: 90_000 })
        .catch(() => L(`turn ${turn}: next turn did not arm within 90s (fight ended or presenting)`))
      await shot(page, `t${turn}_9_endofturn`)
    }
    await shot(page, '99_final')
  } catch (err) {
    L(`DRIVE ERROR: ${(err as Error).message}`)
    await shot(page, 'ZZ_error')
  } finally {
    summary.log_tail = log_lines.slice(-40)
    writeFileSync(path.join(HERE, '..', 'summary.json'), JSON.stringify(summary, null, 2))
    writeFileSync(path.join(HERE, '..', 'console.log'), log_lines.join('\n'))
    L(`WROTE summary.json + console.log (${log_lines.length} lines)`)
  }
})
