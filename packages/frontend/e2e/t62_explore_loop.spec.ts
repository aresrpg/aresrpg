// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect, type Page, type Locator } from '@playwright/test'
import { SDK } from '@aresrpg/sdk/sui'

// ─────────────────────────────────────────────────────────────────────────────
// T62 idle-explore golden path — headless END-TO-END PROOF, REAL app, ON-CHAIN.
// Replaces the retired expedition_loop.spec.ts (that drove the DEAD demo deploy/leave/withdraw surface).
//
// The LIVE surface at /game-world is ExploreHud.jsx (T69), wired to the T62 staking pkg 0xd2c2207f:
//   create ✅ → "Send to explore" (staking::explore_world, kiosk-escrows the char) → the char accrues
//   loot over real elapsed time → "Stop exploring" (staking::recall_character, mints loot + returns the
//   char to the kiosk) → loot Item(s) minted to the wallet.
//
// This is the plan's regression item (h): explore → recall → loot. Every gameplay tx is self-paid by the
// dev wallet (sign + executeTransactionBlock); we hook window.fetch to capture each digest + status, and
// assert loot on-chain by reading the RECALL tx's objectChanges for created `::item::Item` objects.
//
// Loot is TIME-GATED (recall mints expected_count(item_rate=50, chance, elapsed)); the _for_testing
// backdate helpers are #[test_only] (unpublished), so we accrue REAL time. ACCRUE_MS below is sized so
// the mean loot count is comfortably ≥1 on The Verge (item_rate 50 → ~50 items/hour at chance 0).
//
// Uses QA-User's second isolated identity (funded 0.3 SUI from server-authority; NEVER a live wallet key). It
// already owns a kiosk-locked character from the create-verification run; the CREATE branch below is a
// fallback if that state is ever reset.
// ─────────────────────────────────────────────────────────────────────────────

// QA-User Identity B (testnet only, isolated — see workspace keys.local.md). Overridable via env.
const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

// Real exploration time before recall. item_rate 50 + chance≈0 → mean loot ≈ 50 × hours. 280s ≈ 0.078h →
// mean ≈ 3.9 items, so ≥1 is near-certain against roll_around variance.
const ACCRUE_MS = 280_000

type Captured = { digests: Array<{ digest: string; status: string | null }>; execErrors: string[] }
const read = (page: Page) => page.evaluate(() => (window as any).__E2E as Captured)
const digestCount = (page: Page) => page.evaluate(() => (window as any).__E2E.digests.length as number)
const visible = (l: Locator) => l.isVisible().catch(() => false)

async function waitNewDigest(page: Page, before: number, label: string, timeout = 120_000) {
  await page.waitForFunction((n) => (window as any).__E2E.digests.length > n, before, { timeout })
  const cap = await read(page)
  const d = cap.digests[cap.digests.length - 1]

  console.log(`  ↳ TX [${label}] digest=${d.digest} status=${d.status}`)
  expect(d.digest, `[${label}] expected a tx digest`).toBeTruthy()
  expect(d.status, `[${label}] tx must succeed on-chain`).toBe('success')
  return d
}

let sdk_p: Promise<any> | null = null

// Read a tx's object changes through the same gRPC-backed SDK as sibling live E2Es and count
// CREATED `::item::Item` objects (the loot).
async function createdLootItems(digest: string): Promise<string[]> {
  sdk_p = sdk_p ?? SDK({ network: 'testnet' })
  const sdk = await sdk_p
  const result = await sdk.grpc_client.core.getTransaction({
    digest,
    include: { effects: true, objectTypes: true },
  })
  const transaction = result.Transaction ?? result.FailedTransaction
  const object_types: Record<string, string> = transaction?.objectTypes ?? {}
  return (transaction?.effects?.changedObjects ?? [])
    .filter(
      (change: any) => change.idOperation === 'Created' && /::item::Item\b/.test(object_types[change.objectId] ?? '')
    )
    .map((change: any) => change.objectId)
}

test('T62 idle-explore loop: explore → accrue → recall → loot minted on-chain', async ({ page }, testInfo) => {
  test.setTimeout(540_000)
  const consoleLogs: string[] = []
  const pageErrors: string[] = []
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))

  // Inject the dev key + pre-dismiss the first-run tour (UI preference flag) + the digest-capture hook.
  await page.addInitScript((devKey: string) => {
    ;(window as any).__ARES_DEV_KEY = devKey
    try {
      localStorage.setItem('ares_tutorial_seen', '1')
    } catch {
      /* storage unavailable */
    }
    const w = window as any
    w.__E2E = { digests: [], execErrors: [] } as Captured
    const orig = window.fetch.bind(window)
    const collect = (j: any) => {
      if (j && j.result && j.result.digest)
        w.__E2E.digests.push({ digest: j.result.digest, status: j.result?.effects?.status?.status ?? null })
      else if (j && j.error)
        w.__E2E.execErrors.push(typeof j.error === 'object' ? JSON.stringify(j.error) : String(j.error))
    }
    window.fetch = async (input: any, init?: any) => {
      let body = ''
      try {
        if (init && typeof init.body === 'string') ({ body } = init)
      } catch {
        /* ignore */
      }
      const isExec = body.includes('"sui_executeTransactionBlock"')
      const res = await orig(input, init)
      if (isExec) {
        try {
          const j = await res.clone().json()
          Array.isArray(j) ? j.forEach(collect) : collect(j)
        } catch {
          /* non-json */
        }
      }
      return res
    }
  }, DEV_KEY)

  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  // Entry states: idle character, ALREADY-exploring (resume — a prior run staked the char), or the creator.
  // StrictMode double-mounts the creator overlay in dev → scope to the live `.cc` when we need it.
  const exploreBtn = page.getByRole('button', { name: /Send to explore/i }).first()
  const stopBtn = page.getByRole('button', { name: /Stop exploring/i }).first()
  const nameInput = page.locator('.cc [data-name]').last()

  await expect(
    exploreBtn.or(stopBtn).or(nameInput),
    'ExploreHud (idle/exploring char) or the creator must render'
  ).toBeVisible({ timeout: 120_000 })

  const resumedExploring = await visible(stopBtn)
  if (resumedExploring) {
    // RESUME: the character is already staked on-chain (accruing since a prior explore) → skip straight to
    // recall. Avoids a long headless idle (the 3D scene destabilises after minutes) AND the already-elapsed
    // on-chain time guarantees loot.

    console.log('STEP: resumed into an active stake → recall immediately (time already accrued on-chain)')
  } else {
    // CREATE fallback (only if Identity B ever loses its character): drive the class-deck creator.
    if (!(await visible(exploreBtn)) && (await visible(nameInput))) {
      console.log('STEP: no character → creating one (senshi auto-selected, sponsored mint)')
      await nameInput.fill(`QA${Date.now().toString().slice(-8)}`)
      await page.locator('.cc [data-create]').last().press('Enter')
      await expect(exploreBtn, 'after create the idle char + explore button must render').toBeVisible({
        timeout: 200_000,
      })
    }

    // 1) SEND TO EXPLORE — real staking::explore_world (kiosk-escrows the character).

    console.log('STEP: Send to explore')
    const beforeExplore = await digestCount(page)
    await exploreBtn.click()
    await waitNewDigest(page, beforeExplore, 'explore_world')
    await expect(stopBtn, 'explore must move the char into the "Exploring" state').toBeVisible({ timeout: 40_000 })

    // 2) ACCRUE real time so recall mints loot (time-gated).

    console.log(
      `STEP: accruing ${ACCRUE_MS / 1000}s of real exploration (item_rate 50 → mean ~${Math.round((50 * ACCRUE_MS) / 3_600_000)} items)`
    )
    await page.waitForTimeout(ACCRUE_MS)
  }

  // 3) STOP EXPLORING — real staking::recall_character (mints loot + returns the char to the kiosk).

  console.log('STEP: Stop exploring (recall)')
  const beforeRecall = await digestCount(page)
  await expect(stopBtn).toBeEnabled({ timeout: 10_000 })
  await stopBtn.click()
  const recall = await waitNewDigest(page, beforeRecall, 'recall_character')
  // Char returns to idle → the "Send to explore" button must render again.
  await expect(exploreBtn, 'after recall the char returns to idle (deployable again)').toBeVisible({ timeout: 60_000 })

  // 4) LOOT PROOF — read the recall tx's objectChanges for created ::item::Item objects (the drop mints).
  const loot = await createdLootItems(recall.digest)

  console.log(`  ↳ recall minted ${loot.length} loot Item(s): ${loot.join(', ')}`)

  const cap = await read(page)
  const proof = {
    verdict: loot.length >= 1 ? 'PASS' : 'NO_LOOT',
    explore_digest: resumedExploring ? '(resumed — explore fired in a prior run)' : (cap.digests[0]?.digest ?? null),
    recall_digest: recall.digest,
    loot_item_ids: loot,
    all_digests: cap.digests,
    exec_errors: cap.execErrors,
    page_errors: pageErrors,
  }

  console.log(
    '\n==== T62 EXPLORE LOOP PROOF ====\n' + JSON.stringify(proof, null, 2) + '\n================================'
  )
  await testInfo.attach('t62-explore-proof.json', {
    body: JSON.stringify(proof, null, 2),
    contentType: 'application/json',
  })
  await testInfo.attach('console.log', { body: consoleLogs.join('\n'), contentType: 'text/plain' })

  expect(cap.execErrors, 'no on-chain execute errors').toEqual([])
  expect(loot.length, 'recall must mint ≥1 loot Item on-chain (explore→recall→loot)').toBeGreaterThanOrEqual(1)
})
