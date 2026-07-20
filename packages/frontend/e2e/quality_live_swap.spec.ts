// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect } from '@playwright/test'

// PROOF — a live graphics-tier change re-boots the render pipeline IN PLACE with NO page reload (the prior
// regression: changing render quality fully refreshed the app instead of swapping in place).
// Drives the REAL app authenticated via the dev wallet, then switches
// low → medium → high → medium through the actual QualitySelect dropdown and asserts, per swap:
//   • ZERO real main-frame navigation (a location.reload would bump the counter) + an SPA-only sentinel
//     survives (a hard reload mints a fresh window and drops it),
//   • the <canvas>/session was genuinely RE-CREATED (element identity flips) while exactly ONE canvas stays
//     in the DOM — no leaked GPU context piling up across N swaps,
//   • the fps HUD keeps ticking on the freshly-booted engine, and (WebGPU only) the tier + render-scale in
//     engine stats actually moved,
//   • same-tier content counts return to baseline (the two MEDIUM re-boots) — no unbounded accumulation,
//   • the player POSE is preserved across the swaps (the session_position flush) — never snapped to spawn.
// Modeled on world_lobby_movement.spec.ts (the proven dev-login + reach-the-world path).

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

// Real WebGPU needs system Chrome + the unsafe-webgpu flag (Playwright's bundled Chromium ships without it),
// headed so a real GPU adapter is present. On a host without WebGPU the engine boots its WebGL heightmap floor
// — the re-create / no-reload / no-leak proof is engine-agnostic and still holds; only the tier-in-stats
// assertion is gated on backend === 'webgpu'.
test.use({
  channel: 'chrome',
  headless: false,
  launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU'] },
})

type Reading = {
  fps: number
  tier: string
  render_scale: number
  resident: number
  quads: number
  backend: string
}

test('live quality swap re-boots the pipeline in place — no page reload', async ({ page }, testInfo) => {
  test.setTimeout(360_000)
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))

  // The airtight no-reload oracle: count REAL main-frame navigations. Only the initial goto (and a mint
  // reload, if the roster is empty) may bump this — never a tier swap.
  let navs = 0
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navs++
  })

  await page.addInitScript((devKey: string) => {
    ;(window as unknown as { __ARES_DEV_KEY?: string }).__ARES_DEV_KEY = devKey
  }, DEV_KEY)

  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-nav="game-world"]')).toContainText('World', { timeout: 30_000 })

  // Mint a throwaway character if this identity's roster is empty (same guard as world_lobby_movement) — this
  // may reload once (CharacterMenu drops ?dev), which is fine: the swap-navigation baseline is taken AFTER.
  const play = page.locator('button:has-text("PLAY")')
  let needsCreate = false
  for (let i = 0; i < 15 && !needsCreate; i++) {
    needsCreate = await play.isVisible().catch(() => false)
    if (!needsCreate) await page.waitForTimeout(3000)
  }
  if (needsCreate) {
    await page.getByPlaceholder('Enter name...').fill(`QSwap${Date.now() % 100000}`)
    await play.click()
    await expect(play, 'character mint clears the create screen').not.toBeVisible({ timeout: 60_000 })
  }

  const engine_live = () =>
    page.waitForFunction(
      () => {
        const s = (
          window as unknown as { __voxel_engine?: { get_stats?: () => { fps: number } } }
        ).__voxel_engine?.get_stats?.()
        return !!s && s.fps > 0
      },
      null,
      { timeout: 90_000 }
    )
  const world_resident = () =>
    page.waitForFunction(
      () => {
        const s = (
          window as unknown as { __voxel_engine?: { get_stats?: () => { resident_chunks: number } } }
        ).__voxel_engine?.get_stats?.()
        return (s?.resident_chunks ?? 0) > 0
      },
      null,
      { timeout: 90_000 }
    )
  const stats = (): Promise<Reading> =>
    page.evaluate(() => {
      const s = (
        window as unknown as { __voxel_engine: { get_stats: () => Record<string, number & string> } }
      ).__voxel_engine.get_stats()
      return {
        fps: s.fps as unknown as number,
        tier: s.tier as unknown as string,
        render_scale: s.render_scale as unknown as number,
        resident: s.resident_chunks as unknown as number,
        quads: s.quad_count as unknown as number,
        backend: s.renderer_backend as unknown as string,
      }
    })
  const canvas_count = () => page.evaluate(() => document.querySelectorAll('canvas').length)
  const player_pos = () =>
    page.evaluate(
      () =>
        (
          window as unknown as { __voxel_ctl?: { get_transform?: () => { position: [number, number, number] } } }
        ).__voxel_ctl?.get_transform?.()?.position ?? null
    )

  // World live.
  await engine_live()
  await world_resident()

  // Move the player OFF spawn so the pose-preservation check is meaningful (a broken flush would snap the
  // re-created session back to spawn/checkpoint). Focus the canvas, hold W, confirm a real displacement.
  const box = await page.locator('canvas').first().boundingBox()
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const pos_start = await player_pos()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1500)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(400)
  const pos_moved = await player_pos()
  const moved = !!pos_start && !!pos_moved && Math.hypot(pos_moved[0] - pos_start[0], pos_moved[2] - pos_start[2]) > 0.3
  console.log(`[proof] moved off spawn: ${moved} (${JSON.stringify(pos_start)} -> ${JSON.stringify(pos_moved)})`)

  // Baseline (AFTER any mint reload): one canvas, sentinel planted, navigation frozen.
  await page.evaluate(() => {
    ;(window as unknown as { __no_nav?: string }).__no_nav = 'alive'
  })
  const baseline_navs = navs
  expect(await canvas_count(), 'exactly one live canvas at baseline').toBe(1)
  const base = await stats()
  console.log(`[proof] baseline`, base)

  const RENDER_SCALE: Record<string, number> = { low: 0.66, medium: 1.0, high: 1.0 }
  const seq = ['low', 'medium', 'high', 'medium'] as const
  const readings: Reading[] = []

  for (const tier of seq) {
    const old_canvas = await page.evaluateHandle(() => document.querySelector('canvas'))
    await page.selectOption('.gw-quality__sel', tier)
    // The in-place re-create disposes the old container (canvas out of the DOM) and appends a fresh one — the
    // canvas ELEMENT identity flips. This is the positive proof the session genuinely re-booted.
    await page.waitForFunction(
      (old) => {
        const c = document.querySelector('canvas')
        return !!c && c !== old
      },
      old_canvas,
      { timeout: 45_000 }
    )
    await old_canvas.dispose()
    // The fresh engine boots + re-streams behind the boot veil — fps ticks again, the world becomes resident.
    await engine_live()
    await world_resident()

    expect(navs, `tier→${tier}: ZERO page navigation on a live swap`).toBe(baseline_navs)
    expect(await canvas_count(), `tier→${tier}: exactly ONE canvas (no leaked GPU context)`).toBe(1)
    expect(
      await page.evaluate(() => (window as unknown as { __no_nav?: string }).__no_nav),
      `tier→${tier}: no hard reload`
    ).toBe('alive')
    const s = await stats()
    expect(s.fps, `tier→${tier}: fps HUD keeps ticking on the fresh engine`).toBeGreaterThan(0)
    if (s.backend === 'webgpu') {
      expect(s.tier, `tier→${tier}: engine re-styled to the new tier`).toBe(tier)
      expect(s.render_scale, `tier→${tier}: render scale rides the tier`).toBeCloseTo(RENDER_SCALE[tier], 2)
    }
    readings.push(s)
    console.log(`[proof] after swap → ${tier}`, s, `| navs=${navs} canvases=${await canvas_count()}`)
    await page.screenshot({ path: testInfo.outputPath(`quality_${readings.length}_${tier}.png`) })
  }

  // No unbounded accumulation: the two MEDIUM re-boots (same tier ⇒ same radius/atlas) land within tolerance.
  const meds = readings.filter((r) => r.tier === 'medium')
  if (meds.length === 2 && meds[0].backend === 'webgpu' && meds[0].resident > 0) {
    expect(
      Math.abs(meds[1].resident - meds[0].resident),
      'MEDIUM resident-chunk count returns to baseline (no leak)'
    ).toBeLessThan(meds[0].resident * 0.5 + 30)
  }

  // Pose preserved across the four re-boots (the session_position flush) — only asserted when movement took.
  if (moved) {
    const pos_end = await player_pos()
    expect(!!pos_end, 'controller alive after swaps').toBe(true)
    if (pos_end && pos_moved) {
      const drift = Math.hypot(pos_end[0] - pos_moved[0], pos_end[2] - pos_moved[2])
      console.log(
        `[proof] pose drift across 4 swaps: ${drift.toFixed(2)}m (moved=${JSON.stringify(pos_moved)} end=${JSON.stringify(pos_end)})`
      )
      expect(drift, 'player resumes their pose across swaps — never snapped back to spawn').toBeLessThan(12)
    }
  }

  expect(pageErrors, `unexpected console/page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
