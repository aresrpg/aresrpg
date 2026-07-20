import { test, expect } from '@playwright/test'

// WS-B — World tab free (mouse-or-keys) locomotion (final-design plan decision #7: the World tab is
// the interactive p2p social lobby — port the legacy character controller, NOT click-to-move).
// Proves against the REAL app: (1) the sidebar tab reads "World", (2) the interactive avatar loads
// (GameWorldHost's 'lobby' scene_key, not the decorative backdrop), (3) holding W visibly pans the
// world/camera, (4) a bare ground click no longer teleports/paths the avatar.

// Root .env's key (the live :5173 session identity). If its roster is empty the test mints a
// throwaway character first (sponsored testnet tx, same pattern as expedition_loop.spec.ts) so it lands
// in the roam scene instead of stopping at character-create.
const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

test('World tab: mouse-or-keys locomotion replaces click-to-move', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))

  await page.addInitScript((devKey: string) => {
    ;(window as any).__ARES_DEV_KEY = devKey
  }, DEV_KEY)

  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  // sidebar tab rename: stable data-nav hook, not fragile text matching.
  await expect(page.locator('[data-nav="game-world"]')).toContainText('World', { timeout: 30_000 })

  // The create-character screen only appears once the chain-direct roster read confirms "empty" (a real
  // testnet RPC round trip) — poll rather than a single early check, which races the read.
  const createAndPlay = page.locator('button:has-text("PLAY")')
  let needsCreate = false
  for (let i = 0; i < 15 && !needsCreate; i++) {
    needsCreate = await createAndPlay.isVisible().catch(() => false)
    if (!needsCreate) await page.waitForTimeout(3000)
  }
  if (needsCreate) {
    await page.getByPlaceholder('Enter name...').fill(`WSBSmoke${Date.now() % 100000}`)
    await createAndPlay.click()
    await expect(createAndPlay, 'character mint must clear the create screen').not.toBeVisible({ timeout: 40_000 })
  }

  // the interactive scene mounts the real roam canvas.
  const canvas = page.locator('canvas.roam-canvas')
  await expect(canvas).toBeVisible({ timeout: 60_000 })
  // let the scene resolve the roster character + first world stream before sampling frames.
  await page.waitForTimeout(6000)

  // Read the REAL Three.js player.position via the DEV-only __ARES_PLAYER hook (roam.js) — a direct,
  // deterministic signal instead of a screenshot heuristic (the scene's continuous ambient animation —
  // dust motes, forest sway, day/night grade, character idle breathing — makes pixel/PNG-size diffing
  // unreliable noise).
  const pos = () => page.evaluate(() => (window as any).__ARES_PLAYER?.position() as [number, number, number])
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

  const before_w = await pos()
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1200)
  await page.keyboard.up('KeyW')
  const after_w = await pos()
  expect(dist(before_w, after_w), 'holding W should move player.position by a real distance').toBeGreaterThan(0.3)

  // bare ground click must NOT move the avatar (click-to-move removed — mouse-or-keys only now).
  await page.waitForTimeout(800)
  const before_click = await pos()
  const box = await canvas.boundingBox()
  if (box) await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.15)
  await page.waitForTimeout(1500)
  const after_click = await pos()
  expect(dist(before_click, after_click), 'a bare ground click must not move the avatar at all').toBe(0)

  expect(pageErrors, `unexpected console/page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
