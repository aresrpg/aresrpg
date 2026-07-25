// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect } from '@playwright/test'

// PROOF (#812) — flipping HACK MODE in settings swaps the world PRESENTATION live: the terrain systems tear
// down and the retrowave grid is constructed in place, with NO page reload and the session intact. It rides
// the SAME live-swap home a graphics-quality change rides (quality_live_swap.spec.ts) — engine_flags.js's
// apply_wireable_flag → reboot_voxel_session_tier — so this spec is that one's sibling and asserts the same
// no-reload / re-create oracles, plus the three surfaces the mode signal drives:
//   • the WORLD: the hack oracle answers a constant plane (is_column_resident is true everywhere) and the
//     streaming ring is never constructed (resident_chunks === 0) — engine probes, never pixels (§3.7 of
//     docs/design/hack_mode_spec.md: the grid shimmer makes the world canvas non-deterministic by design).
//   • the RADIO widget, which mounts on the reducer-door mode signal.
//   • the MINIMAP, which re-branches to the neon lattice off the SAME signal — asserted on the minimap's own
//     2-D canvas (a static painter, unlike the world) by its documented ground colour.
// And back: toggling OFF returns the real terrain. The player's x,z survives both swaps.
const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

// Real WebGPU needs system Chrome + the unsafe-webgpu flag, headed so a real GPU adapter is present (the
// quality_live_swap.spec.ts rationale). The hack presentation is WebGPU-only — on the WebGL floor the engine
// warns and renders the real terrain, so the swap assertions self-gate on the backend readout.
test.use({
  channel: 'chrome',
  headless: false,
  launchOptions: { args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU'] },
})

const HACK_GROUND = { r: 0x0a, g: 0x01, b: 0x18 } // hack_palette.js `ground` — the lattice slab's base fill

type Probe = {
  fps: number
  backend: string
  resident: number
  flat_oracle: boolean | null
  pos: [number, number, number] | null
  radio: number
  hack_minimap_pixels: number
  sampled_pixels: number
  sentinel: string | null
}

test('the hack-mode toggle swaps the world presentation live — no page reload', async ({ page }, testInfo) => {
  test.setTimeout(420_000)
  const page_errors: string[] = []
  page.on('pageerror', (e) => page_errors.push(String(e?.stack || e)))

  await page.addInitScript((dev_key: string) => {
    ;(window as unknown as { __ARES_DEV_KEY?: string }).__ARES_DEV_KEY = dev_key
    try {
      localStorage.setItem('aresrpg.hack_mode_enabled', '0') // start from the real terrain, whatever ran before
    } catch {
      /* private mode — the default is OFF anyway */
    }
  }, DEV_KEY)

  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('[data-nav="game-world"]')).toContainText('World', { timeout: 30_000 })

  // Mint a throwaway character if this identity's roster is empty (the world_lobby_movement guard) — it may
  // reload once, which is fine: the no-reload sentinel below is planted afterwards.
  const play = page.locator('button:has-text("PLAY")')
  let needs_create = false
  for (let i = 0; i < 10 && !needs_create; i++) {
    needs_create = await play.isVisible().catch(() => false)
    if (!needs_create) await page.waitForTimeout(3000)
  }
  if (needs_create) {
    await page.getByPlaceholder('Enter name...').fill(`HackSwap${Date.now() % 100000}`)
    await play.click()
    await expect(play, 'character mint clears the create screen').not.toBeVisible({ timeout: 60_000 })
  }

  const engine_live = () =>
    page.waitForFunction(
      () => {
        const stats = (window as any).__voxel_engine?.get_stats?.()
        return !!stats && stats.fps > 0
      },
      null,
      { timeout: 90_000 }
    )
  const probe = (): Promise<Probe> =>
    page.evaluate((ground) => {
      const engine = (window as any).__voxel_engine
      const stats = engine?.get_stats?.()
      // The minimap is a plain 2-D canvas painted by render_hack_grid_map / render_oblique — sample a coarse
      // lattice of it and count the pixels sitting on the hack slab's own ground colour.
      let hack_pixels = 0
      let sampled = 0
      const map = document.querySelector('canvas.mm-canvas') as HTMLCanvasElement | null
      const ctx = map?.getContext('2d', { willReadFrequently: true })
      if (map && ctx && map.width > 0) {
        const { data } = ctx.getImageData(0, 0, map.width, map.height)
        for (let y = 0; y < map.height; y += 4) {
          for (let x = 0; x < map.width; x += 4) {
            const i = (y * map.width + x) * 4
            if (data[i + 3] < 200) continue // the island floats on transparency — only painted texels count
            sampled += 1
            if (
              Math.abs(data[i] - ground.r) <= 6 &&
              Math.abs(data[i + 1] - ground.g) <= 6 &&
              Math.abs(data[i + 2] - ground.b) <= 6
            )
              hack_pixels += 1
          }
        }
      }
      return {
        fps: Math.round(stats?.fps ?? 0),
        backend: stats?.renderer_backend ?? '?',
        resident: stats?.resident_chunks ?? 0,
        // THE DEEP SEAM: hack mode answers residency for every column (the constant plane); the streaming
        // world only ever answers true for columns the ring actually loaded — 400 km out is never one.
        flat_oracle: (() => {
          try {
            return engine?.is_column_resident?.(400_000, 400_000) ?? null
          } catch {
            return null
          }
        })(),
        pos: (window as any).__voxel_ctl?.get_transform?.()?.position ?? null,
        radio: document.querySelectorAll('.gw-radio').length,
        hack_minimap_pixels: hack_pixels,
        sampled_pixels: sampled,
        sentinel: (window as any).__no_nav ?? null,
      }
    }, HACK_GROUND)

  await engine_live()
  await page.waitForFunction(() => ((window as any).__voxel_engine?.get_stats?.().resident_chunks ?? 0) > 0, null, {
    timeout: 90_000,
  })

  // Walk off spawn so "the session survived" is a real claim (a broken pose flush snaps back to spawn).
  const canvas_box = await page.locator('canvas.roam-canvas').boundingBox()
  if (canvas_box) await page.mouse.click(canvas_box.x + canvas_box.width / 2, canvas_box.y + canvas_box.height / 2)
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1500)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(600)

  // The airtight no-reload oracle: an SPA-only sentinel. A hard reload mints a fresh window and drops it.
  await page.evaluate(() => {
    ;(window as any).__no_nav = 'alive'
  })
  const before = await probe()
  console.log('[proof] BEFORE — terrain:', before)
  await page.screenshot({ path: testInfo.outputPath('1_before_terrain.png') })
  const webgpu = before.backend === 'webgpu'
  expect(before.radio, 'no radio on the terrain world').toBe(0)
  if (webgpu) {
    expect(before.flat_oracle, 'the streaming world does not claim residency 400 km out').toBe(false)
    expect(before.resident, 'the terrain world streams chunks').toBeGreaterThan(0)
  }

  /** Flip the settings toggle and wait for the world session to be re-created in place. */
  const flip_hack_mode = async (on: boolean) => {
    const old_canvas = await page.evaluateHandle(() => document.querySelector('canvas.roam-canvas'))
    await page.locator('[data-nav="settings"]').first().click()
    const toggle = page.getByRole('switch', { name: /hack mode/i })
    await expect(toggle, 'the hack-mode row is reachable in the render options').toBeVisible({ timeout: 20_000 })
    await expect(toggle).toHaveAttribute('aria-checked', String(!on))
    await toggle.click()
    // The in-place re-create disposes the old container and appends a fresh one — the world canvas ELEMENT
    // identity flips. That is the positive proof the session genuinely re-booted rather than doing nothing.
    await page.waitForFunction(
      (old) => {
        const c = document.querySelector('canvas.roam-canvas')
        return !!c && c !== old
      },
      old_canvas,
      { timeout: 60_000 }
    )
    await old_canvas.dispose()
    // A fight/dungeon refusal reverts the preference and toasts — assert we took the applied path.
    await expect(toggle, 'the toggle held (no fight-block revert)').toHaveAttribute('aria-checked', String(on))
    expect(
      await page.evaluate(() => localStorage.getItem('aresrpg.hack_mode_enabled')),
      'the preference persisted'
    ).toBe(on ? '1' : '0')
    await engine_live()
    await page.locator('[data-nav="game-world"]').first().click()
    await page.waitForTimeout(4000)
  }

  await flip_hack_mode(true)
  const on = await probe()
  console.log('[proof] AFTER hack ON:', on)
  await page.screenshot({ path: testInfo.outputPath('2_hack_on_grid.png') })

  expect(on.sentinel, 'hack ON: NO page reload — the SPA sentinel survived').toBe('alive')
  expect(on.fps, 'hack ON: the freshly-booted engine is ticking').toBeGreaterThan(0)
  expect(on.radio, 'hack ON: the radio widget mounted off the mode signal').toBe(1)
  expect(await page.locator('canvas.roam-canvas').count(), 'hack ON: exactly one world canvas').toBe(1)
  if (webgpu) {
    expect(on.flat_oracle, 'hack ON: the constant-plane oracle answers every column').toBe(true)
    expect(on.resident, 'hack ON: no streaming ring was constructed').toBe(0)
    expect(on.sampled_pixels, 'hack ON: the minimap painted something').toBeGreaterThan(50)
    expect(
      on.hack_minimap_pixels / Math.max(1, on.sampled_pixels),
      'hack ON: the minimap re-branched to the neon lattice slab'
    ).toBeGreaterThan(0.3)
  }

  await flip_hack_mode(false)
  const off = await probe()
  console.log('[proof] AFTER hack OFF:', off)
  await page.screenshot({ path: testInfo.outputPath('3_hack_off_terrain.png') })

  expect(off.sentinel, 'hack OFF: still no page reload across BOTH swaps').toBe('alive')
  expect(off.fps, 'hack OFF: the engine is ticking again').toBeGreaterThan(0)
  expect(off.radio, 'hack OFF: the radio unmounted with the grid').toBe(0)
  if (webgpu) {
    expect(off.flat_oracle, 'hack OFF: the real streaming oracle is back').toBe(false)
    await page.waitForFunction(() => ((window as any).__voxel_engine?.get_stats?.().resident_chunks ?? 0) > 0, null, {
      timeout: 90_000,
    })
    const settled = await probe()
    expect(settled.resident, 'hack OFF: the terrain streams again').toBeGreaterThan(0)
    expect(
      settled.hack_minimap_pixels / Math.max(1, settled.sampled_pixels),
      'hack OFF: the minimap paints the real relief again'
    ).toBeLessThan(0.1)
  }

  // The session survived both swaps: same player, same x,z (Y is presentation-owned — the grid's plane is at
  // 138, the terrain's ground is wherever the column says).
  if (before.pos && on.pos && off.pos) {
    const drift = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[2] - b[2])
    console.log(`[proof] x,z drift — into the grid: ${drift(before.pos, on.pos).toFixed(2)}m · back: ${drift(before.pos, off.pos).toFixed(2)}m`) // prettier-ignore
    expect(drift(before.pos, on.pos), 'position preserved into the grid').toBeLessThan(12)
    expect(drift(before.pos, off.pos), 'position preserved back on the terrain').toBeLessThan(12)
  }

  expect(page_errors, `unexpected page errors:\n${page_errors.join('\n')}`).toEqual([])
})
