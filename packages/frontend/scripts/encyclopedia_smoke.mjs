// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// ENCYCLOPEDIA SMOKE — issue #165 regression tooth. Incident: the prod encyclopedia rendered with
// ~zero item icons and empty stats, and no gate caught it. Root cause + fix: #160 (chain_icon_slug —
// derive the icon key from the live /v1 row when the seed catalog is empty, since this tree's
// virtual:item_catalog is ALWAYS empty here — vite.config.ts catalog_fallback_plugin). This drive
// replays the icon + detail assertions against the real component tree so a regression on either axis
// fails LOUD instead of shipping silently again.
//
// AUTH NOTE — why this leg cannot reuse boot_smoke.mjs's prod build/preview: `/encyclopedia/*` only
// mounts once a wallet is connected (app.tsx AppBody: `in_app = !!address`; a logged-out visitor sees
// the spectate landing, never the router — verified empirically: 0 /v1 requests fire when driving the
// prod `vite build` + `vite preview` bundle at this route). There is deliberately NO production auth
// bypass (auth/dev_wallet.ts: "TESTNET ONLY... no prod escape hatch — DEV is the only gate"), so this
// leg drives the Vite DEV SERVER instead: DEV=true unlocks the SAME native-wallet bypass dev_wallet.ts
// documents as built for exactly this ("Lets Playwright / a local browser play the REAL rendered UI
// authenticated by a local Ed25519 keypair... NO Google/Enoki popup"). A FRESH, throwaway, UNFUNDED
// keypair is generated per run — nothing to leak, nothing to fund, no committed secret (the page is
// read-only). VITE_RPC_URL is pinned to the exact live-testnet host env.ts itself falls back to in a
// prod build, so this drives the same live encyclopedia data a logged-in player sees. The catalog
// emptiness that drives the actual #165 bug is NOT gated on DEV vs PROD (catalog_fallback_plugin has
// no `apply: 'serve'` restriction — it degrades empty in every mode, in this public tree), so this
// substitution cannot mask or fabricate the regression it's guarding against.
//
// SAMPLE CHOICE — ARMOR, not the default ALL view: the incident screenshot showed nearly zero armor
// icons specifically. #160's bug was category-shaped: cosmetics (hat/cloak) resolve through a SEPARATE
// path (cosmetic_icon_of) unaffected by the empty catalog, so the default level-sorted ALL view mixes
// in enough cosmetics to dilute the signal (measured: the pre-#160 resolver still showed ~27% "success"
// on the first 30 ALL-view rows — too close to any reasonable floor to be a clean gate). ARMOR has zero
// cosmetics by construction (CATEGORY_GROUPS ARMOR = helmet/chestplate/belt/gauntlets/pants/boots
// only), so it swings cleanly between the two states: measured 0/30 replaying the pre-#160 resolver
// locally, 24/30 on today's fix — wide margin on both sides of the floor below.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, '..')
const PORT = Number(process.env.ENCYCLOPEDIA_SMOKE_PORT ?? 4174)
const BASE = `http://localhost:${PORT}/`
const PROOF_DIR = process.env.SMOKE_PROOF_DIR ?? resolve(FRONTEND, 'smoke-out')
// The exact live-testnet host env.ts falls back to in a PROD build (`import.meta.env.DEV` false),
// pinned explicitly: the dev server this leg boots has DEV=true, whose own fallback is localhost:3000.
const LIVE_TESTNET_RPC = 'https://rpc.aresrpg.world'

const GRID_SELECTOR = 'div[style*="repeat(auto-fill"]' // items_tab.tsx's item grid (its inline gridTemplateColumns)
const DETAIL_ROOT_SELECTOR = '[class*="max-w-2xl"]' // ItemDetailView's own root (item_detail_view.tsx)

// ICON TRUTH threshold — TUNABLE. 30% is a floor far below a healthy encyclopedia (measured today:
// ~80% on this exact ARMOR/first-30 sample) but comfortably above the #165 failure mode (measured
// ~0%, by locally replaying the pre-#160 resolver) — wide margin on both sides so this never flaps on
// a handful of genuinely unpublished items.
const ICON_SUCCESS_FLOOR_PERCENT = 30
const ICON_SAMPLE_SIZE = 30

async function wait_for_server(url, timeout_ms = 60_000) {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`dev server never became ready at ${url}`)
}

mkdirSync(PROOF_DIR, { recursive: true })

const dev_server = spawn('bunx', ['vite', '--port', String(PORT), '--strictPort'], {
  cwd: FRONTEND,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_RPC_URL: LIVE_TESTNET_RPC },
})
let server_log = ''
dev_server.stdout.on('data', (d) => (server_log += d))
dev_server.stderr.on('data', (d) => (server_log += d))

const failures = []
let browser

try {
  await wait_for_server(BASE)

  browser = await chromium.launch()
  const page = await browser.newPage()
  // The sanctioned Playwright hook (auth/dev_wallet.ts) — a fresh, unfunded, throwaway testnet keypair.
  // No secret: generated per run, never persisted, never funded (the encyclopedia is a read-only page).
  const dev_key = Ed25519Keypair.generate().getSecretKey()
  await page.addInitScript((k) => {
    window.__ARES_DEV_KEY = k
  }, dev_key)

  // Generous: a cold dev-server first request also triggers esbuild's dependency pre-bundle scan over
  // this app's heavy deps (three.js, the Sui SDKs, node polyfills) — slower than serving a prebuilt dist.
  await page.goto(`${BASE}encyclopedia/items?dev&group=ARMOR`, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  let grid_seen = true
  try {
    await page.waitForSelector(GRID_SELECTOR, { timeout: 25_000 })
  } catch {
    grid_seen = false
  }

  if (!grid_seen) {
    // 4-way HARNESS candidate list (#698 added the 4th): a stale BUNDLED seed manifest can starve this
    // same grid exactly like a dev-login failure or a dead /v1 route — its ids simply don't exist against
    // the live-pinned packages. Discriminator: an item template_id read from the bundled manifest that
    // does NOT resolve in a live /v1 response means staleness (the #698 class), not an outage — a genuine
    // outage or route regression fails every id alike, not a lineage-shaped subset.
    failures.push(
      'HARNESS: the ARMOR items grid never rendered (dev-login failed, /v1/encyclopedia never resolved, ' +
        'the route regressed, or the bundled seed manifest is stale against the release.json pins — #698 ' +
        'class; discriminate by checking whether an item template_id from packages/move/scripts/out/' +
        'seed_manifest.json still resolves in a live /v1 response: present in the manifest but absent from ' +
        '/v1 means staleness, not an outage) — cannot evaluate icon/detail truth. See the proof report for ' +
        'the server log.'
    )
  } else {
    // Let the eager-loaded row icons' fallback chains (candidate -> onError -> next candidate) finish
    // resolving before sampling — mirrors boot_smoke's SETTLE_MS rationale (async resolution after mount).
    await page.waitForTimeout(8000)

    // ---- (a) ICON TRUTH ----
    const icon_hits = await page.evaluate(
      ({ selector, n }) => {
        const grid = document.querySelector(selector)
        const rows = Array.from(grid.children).slice(0, n)
        return rows.map((row) => {
          const img = row.querySelector('img')
          return !!img && img.naturalWidth > 0
        })
      },
      { selector: GRID_SELECTOR, n: ICON_SAMPLE_SIZE }
    )
    const real_icon_count = icon_hits.filter(Boolean).length
    const icon_percent = icon_hits.length > 0 ? (real_icon_count / icon_hits.length) * 100 : 0
    if (icon_hits.length === 0) {
      failures.push('HARNESS: the ARMOR group rendered zero rows — cannot sample icon truth.')
    } else if (icon_percent < ICON_SUCCESS_FLOOR_PERCENT) {
      failures.push(
        `ICON TRUTH: only ${real_icon_count}/${icon_hits.length} (${icon_percent.toFixed(1)}%) of the first ` +
          `${ICON_SAMPLE_SIZE} ARMOR rows rendered a real icon (img with naturalWidth > 0) — below the ` +
          `${ICON_SUCCESS_FLOOR_PERCENT}% floor. The rest fell back to the placeholder glyph (issue #165 class).`
      )
    }

    // ---- (b) DETAIL TRUTH ----
    const first_row = await page.evaluateHandle(
      (selector) => document.querySelector(selector)?.children[0] ?? null,
      GRID_SELECTOR
    )
    await page.evaluate((el) => el?.click(), first_row)

    let detail_seen = true
    try {
      await page.waitForSelector(DETAIL_ROOT_SELECTOR, { timeout: 15_000 })
    } catch {
      detail_seen = false
    }

    if (!detail_seen) {
      failures.push('DETAIL TRUTH: clicking the first ARMOR row never opened the item detail panel.')
    } else {
      await page.waitForTimeout(1500)
      const detail = await page.evaluate(
        ({ root_selector }) => {
          const root = document.querySelector(root_selector)
          const spans = Array.from(root.querySelectorAll('span')).map((s) => s.textContent)
          // Scoped to the header's name/category/description column (item_detail_view.tsx: the ONLY
          // `div.flex.flex-col.gap-1` at this point in document order — the icon/supply column beside it
          // uses gap-1.5/gap-0.5, and the Characteristics damages block using the same classes renders
          // LATER in the tree). Scoping here (not a bare root-wide italic search) matters: the supply
          // block's "Marketcap Unknown" text is ALSO italic and would otherwise be picked up first.
          const name_column = root.querySelector('div.flex.flex-col.gap-1')
          const desc_el = name_column?.querySelector('span[style*="italic"]')
          return {
            name: spans.find((s) => s && s.length > 0 && !/^\d/.test(s)) || '(unknown)',
            has_recipe_header: spans.includes('RECIPE'),
            has_dropped_by_header: spans.includes('DROPPED BY'),
            has_no_recipe_text: spans.includes('No recipe data available'),
            has_no_drops_text: spans.includes('No known drop sources'),
            description: (desc_el?.textContent ?? '').trim(),
          }
        },
        { root_selector: DETAIL_ROOT_SELECTOR }
      )

      if (!detail.has_recipe_header || !detail.has_dropped_by_header) {
        failures.push(
          `DETAIL TRUTH: the detail panel for "${detail.name}" is missing its RECIPE/DROPPED BY sections ` +
            `entirely (found RECIPE=${detail.has_recipe_header}, DROPPED BY=${detail.has_dropped_by_header}).`
        )
      } else {
        if (!detail.description) {
          failures.push(`DETAIL TRUTH: "${detail.name}" has an empty description.`)
        }
        const has_obtention = !detail.has_no_recipe_text || !detail.has_no_drops_text
        if (!has_obtention) {
          failures.push(
            `DETAIL TRUTH: "${detail.name}" shows the honest-empty state for BOTH the recipe and drop ` +
              `sections — no obtention path at all.`
          )
        }
      }

      // STATS BLOCK — SKIPPED, not asserted. The "Characteristics" stat/damage block still joins the
      // PRIVATE, build-time-empty virtual:item_catalog (items_tab.tsx: `tmpl?.stats`/`tmpl?.damages`),
      // never a live /v1 projection, so it degrades honestly-empty for every item in this tree today
      // REGARDLESS of regression. Asserting on it now would be a permanent, un-satisfiable red.
      // Re-enable once #219 (the live stats projection) deploys.
      console.log('STATS BLOCK: SKIPPED — #219 (live stats projection) has not deployed; see comment above.')
    }
  }
} catch (err) {
  failures.push(`HARNESS ERROR: ${String(err?.stack || err)}`)
} finally {
  const report = [
    `ENCYCLOPEDIA SMOKE ${failures.length === 0 ? 'PASS' : 'FAIL'} — ${BASE}encyclopedia/items?group=ARMOR`,
    ...failures.map((f, i) => `  [${i}] ${f}`),
    '',
  ].join('\n')
  writeFileSync(resolve(PROOF_DIR, 'encyclopedia_smoke_report.txt'), report + server_log)
  process.stdout.write(report)

  if (browser) await browser.close().catch(() => {})
  dev_server.kill('SIGTERM')
  // Give vite a beat to release the port; SIGKILL if it clings (mirrors boot_smoke.mjs).
  await new Promise((r) => setTimeout(r, 1000))
  if (!dev_server.killed) dev_server.kill('SIGKILL')

  if (failures.length > 0) {
    process.stderr.write('\nENCYCLOPEDIA SMOKE FAILED — see the per-assert messages above.\n')
    process.exitCode = 1
  } else {
    process.stdout.write('\nENCYCLOPEDIA SMOKE PASSED.\n')
  }
}
