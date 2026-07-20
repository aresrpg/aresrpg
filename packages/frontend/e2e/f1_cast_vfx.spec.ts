import { writeFileSync, mkdirSync } from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// F1 INTEGRATION SMOKE (own vite port 5293). Boots the real app with the shipped DEV voxel hooks and fires the
// cast_vfx beat (flare → orb → impact) against the LIVE engine scene, asserting it runs end-to-end: the
// billboards spawn into the real scene and the orb LANDS (on_impact fires once — the impact instant the adapter
// keys SFX/shake/flash off). This is the CI-safe half of the proof.
//
// ENVIRONMENT SEAM (why there is no automated PIXEL burst here): headless Chromium in this env has no usable
// WebGPU — the engine reroutes to its WebGL heightmap fallback, in which (a) the WebGPU-only tactical board
// cannot even build (occlusion/TSL are no-ops), and (b) this dev key has no character, so the roam world is
// occluded by the create screen. The cast_vfx billboards are renderer-agnostic (plain MeshBasicMaterial) and
// DO render on a WebGPU browser over the real board — that pixel proof runs on live hardware (:5273),
// per the project's verify-the-pixels-on-a-real-GPU law. Screenshots below are best-effort diagnostics only.

const SNAP_DIR = '/tmp/f1_cast_vfx_snaps'
mkdirSync(SNAP_DIR, { recursive: true })
const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

const shoot = async (page: Page, name: string) => {
  try {
    // viewport page shot (composites the 3D canvas) — the embed canvas is unclassed + replaceWith()-swapped by
    // the D155 WebGL reroute, so a canvas locator is unreliable; a page shot always captures what's on screen.
    const buf = await page.screenshot({ timeout: 6000 })
    writeFileSync(`${SNAP_DIR}/${name}.png`, buf)
  } catch {
    /* GPU stall — ignore */
  }
}

test('F1 cast_vfx beat runs end-to-end against the live engine', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e?.stack || e)))
  await page.addInitScript((k: string) => {
    ;(window as any).__ARES_DEV_KEY = k
    try {
      localStorage.setItem('ares_tutorial_seen', '1')
    } catch {
      /* ignore */
    }
  }, DEV_KEY)
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  const logs: string[] = []
  page.on('console', (m) => logs.push(m.text()))
  // the DEV voxel hooks come up once embed_voxel mounts + installs its dev rig. This is the reliable boot
  // signal (the roam canvas class varies between the WebGPU + WebGL-fallback paths); screenshots are
  // best-effort. NOTE (environment seam): headless Chromium here has NO WebGPU — the engine reroutes to the
  // WebGL heightmap fallback, in which the WebGPU-only tactical board does not RENDER (so the snapshots are
  // blank), but the cast beat still EXECUTES as JS through the real board handle (the asserts below).
  await page
    .waitForFunction(
      () => !!(window as any).__voxel_engine && !!(window as any).__voxel_board && !!(window as any).__voxel_canvas,
      { timeout: 90_000 }
    )
    .catch(() => {
      throw new Error(`voxel hooks never mounted headless. boot logs:\n${logs.slice(-25).join('\n')}`)
    })
  await page.waitForTimeout(3000)
  await shoot(page, '00_lobby') // baseline: the roam world renders in the WebGL fallback

  // The WebGPU-only tactical BOARD cannot build headless (occlusion/TSL are no-ops in the WebGL fallback), so
  // this proof targets the part that DOES render in the fallback: the cast_vfx flipbook billboards (plain
  // MeshBasicMaterial planes). We spawn the SAME beat play_cast fires — flare → orb → impact — directly in the
  // roam scene, ~8m in front of the live camera, spanning left→right, and burst-capture across the 1.0s beat.
  // (On a WebGPU browser these same billboards ride the real board over the avatars; the board cues
  // — shake/flash_entity/ripple — are proven by the engine suite.)
  await page.evaluate(() => {
    const engine = (window as any).__voxel_engine
    let adds = 0
    const real_add = engine.add_to_scene?.bind(engine)
    if (real_add)
      engine.add_to_scene = (o: any) => {
        adds += 1
        return real_add(o)
      }
    ;(window as any).__f1 = { adds: () => adds, impacts: 0 }
  })
  await shoot(page, '01_ready')

  // FIRE the cast beat in front of the camera.
  await page.evaluate(async () => {
    const { cast_vfx } = await import('/src/game/fight_cast_vfx.js')
    const engine = (window as any).__voxel_engine
    const f1 = (window as any).__f1
    const cam = engine.get_camera()
    const m = cam.matrixWorld.elements
    const right = [m[0], m[1], m[2]]
    const fwd = [-m[8], -m[9], -m[10]] // camera looks down -Z
    const p = [cam.position.x, cam.position.y, cam.position.z]
    const at = (d: number, side: number) =>
      [
        p[0] + fwd[0] * d + right[0] * side,
        p[1] + fwd[1] * d + right[1] * side + 0.5,
        p[2] + fwd[2] * d + right[2] * side,
      ] as [number, number, number]
    cast_vfx({
      engine,
      from: at(9, -3.2), // "caster" side
      to: at(9, 3.2), // "target" side
      element: 'fire',
      on_impact: () => {
        f1.impacts += 1
      },
    })
  })

  // 8-frame burst across the ~1.0s master beat (≈120ms cadence): flare → orb → impact.
  for (let i = 0; i < 8; i++) {
    await shoot(page, `beat_${i}`)
    await page.waitForTimeout(120)
  }

  const after = await page.evaluate(() => ({
    adds: (window as any).__f1?.adds?.() ?? 0,
    impacts: (window as any).__f1?.impacts ?? 0,
  }))
  // the beat ran end-to-end against the REAL engine scene: the flare+orb spawned (≥2 adds) and the orb landed
  // (on_impact fired exactly once — the impact instant the adapter keys SFX/shake/flash off).
  expect(after.adds, 'the cast VFX must have added billboards to the live scene').toBeGreaterThan(1)
  expect(after.impacts, 'the orb must have landed (on_impact fired once)').toBe(1)
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})
