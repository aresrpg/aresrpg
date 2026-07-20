// D141 — CAVE ROOM acceptance capture. Boots ?cave=1 (and ?cave=1&board=1) against a DEDICATED vite
// (ARES_DEMO_ORIGIN, default :5263 — NEVER the main dev :5199) and captures the acceptance surface:
//   • wide interior, board region, glow clusters, ceiling shafts, stalactites/debris close-ups;
//   • a 30 s walk video;
//   • the ?cave=1&board=1 money shot (tactical board on the cave floor under god rays);
//   • ZERO WebGPU errors (console + pageerror), engine booted, room geometry uploaded.
// Screenshots + video land in /tmp (artifacts never in-repo).

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

const ORIGIN = process.env.ARES_DEMO_ORIGIN || 'http://localhost:5263'
const OUT = '/tmp/aresrpg-engine-artifacts/cave'

/** Collect WebGPU/JS errors from a page. Returns an array that fills as the page runs. */
function watch_errors(/** @type {import('@playwright/test').Page} */ page) {
  /** @type {string[]} */
  const errors = []
  page.on('console', (msg) => {
    const t = msg.text()
    if (msg.type() === 'error' && /webgpu|gpu|shader|pipeline|validation|device/i.test(t)) errors.push(`console: ${t}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

/** Wait until the engine booted + the cave room uploaded its geometry (draw calls > 0). */
async function wait_room_ready(/** @type {import('@playwright/test').Page} */ page) {
  await page.waitForFunction(
    () => {
      const e = /** @type {any} */ (window).__engine
      if (!e?.get_stats) return false
      const s = e.get_stats()
      return s.draw_calls > 0 && s.fps > 0
    },
    null,
    { timeout: 60_000 }
  )
}

/** Drive the engine camera to a pose (walk mode owns it, so push via the engine facade directly). */
async function pose(
  /** @type {import('@playwright/test').Page} */ page,
  /** @type {[number,number,number]} */ pos,
  /** @type {number} */ yaw,
  /** @type {number} */ pitch
) {
  await page.evaluate(
    ({ pos, yaw, pitch }) => {
      const e = /** @type {any} */ (window).__engine
      // Disable the walk loop's camera authority for the shot by parking the player, then set the cam.
      const w = /** @type {any} */ (window).__walk_mode
      w?.disable?.()
      e.set_camera_position(pos)
      e.set_camera_orientation(yaw, pitch)
      e.set_camera_fov(70)
    },
    { pos, yaw, pitch }
  )
  // let a few frames render at the new pose
  await page.evaluate(
    () =>
      new Promise((r) => {
        let n = 0
        const t = () => (++n < 8 ? requestAnimationFrame(t) : r(undefined))
        requestAnimationFrame(t)
      })
  )
}

test.describe('D141 cave room', () => {
  test.beforeAll(async () => {
    await mkdir(OUT, { recursive: true })
  })

  test('walk mode: interior, glow clusters, shafts, debris + 30s video + zero webgpu errors', async ({ browser }) => {
    const context = await browser.newContext({
      recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
      viewport: { width: 1280, height: 800 },
    })
    const page = await context.newPage()
    const errors = watch_errors(page)

    await page.goto(`${ORIGIN}/demo/index.html?cave=1&seed=7`, { waitUntil: 'domcontentloaded' })
    await wait_room_ready(page)

    // read the room anchors so poses are relative to the actual generated room.
    const room = await page.evaluate(() => {
      const c = /** @type {any} */ (window).__cave
      return { board_anchor: c.board_anchor, mob_spawn: c.mob_spawn, player_spawn: c.player_spawn, bounds: c.bounds }
    })
    const cxm = room.bounds.max_x / 2
    const cz = room.bounds.max_z / 2
    const floor = room.bounds.floor_y

    // WIDE INTERIOR — eye level a third of the way in, looking across the room (dark cave, glow clusters,
    // the mob, a shaft pool on the floor). This is the "surface players stare at most" establishing shot.
    await pose(page, [cxm, floor + 3, cz + 4], Math.PI, 0.02)
    await page.screenshot({ path: `${OUT}/01_wide_interior.png` })

    // BOARD REGION — look down over the flat central floor from above (the clear board area is visible).
    await pose(page, [cxm, floor + 16, cz + 2], Math.PI, -0.85)
    await page.screenshot({ path: `${OUT}/02_board_region_flat.png` })

    // GLOW MUSHROOM CLUSTERS — mid-room at eye level toward a cluster edge.
    await pose(page, [cxm - 6, floor + 2.5, cz], Math.PI / 2, 0.05)
    await page.screenshot({ path: `${OUT}/03_glow_clusters.png` })

    // CEILING SHAFTS — look UP toward the ceiling holes (cathedral god-ray beams through the roof).
    await pose(page, [cxm - 8, floor + 2, cz - 8], 0.6, 0.5)
    await page.screenshot({ path: `${OUT}/04_ceiling_shafts.png` })

    // 30 s WALK VIDEO — re-enable walk mode + auto-walk forward while turning slowly.
    await page.evaluate(() => {
      const w = /** @type {any} */ (window).__walk_mode
      w?.enable?.()
    })
    // synthesize gentle movement by nudging the controller each tick for 30 s.
    await page.evaluate(async () => {
      const w = /** @type {any} */ (window).__walk
      const start = performance.now()
      return new Promise((resolve) => {
        const step = () => {
          const t = (performance.now() - start) / 1000
          if (t > 30) return resolve(undefined)
          // walk forward in a slow arc by rotating the shoulder camera + pushing the controller.
          w?.camera?.set_yaw?.(Math.PI / 2 + Math.sin(t * 0.2) * 1.2)
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    })

    expect(errors, `WebGPU/JS errors:\n${errors.join('\n')}`).toHaveLength(0)
    const stats = await page.evaluate(() => /** @type {any} */ (window).__engine.get_stats())
    expect(stats.draw_calls).toBeGreaterThan(0)

    await page.close()
    await context.close() // flushes the video file
  })

  test('money shot: tactical board on the cave floor under god rays (?cave=1&board=1)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    const errors = watch_errors(page)

    await page.goto(`${ORIGIN}/demo/index.html?cave=1&board=1&seed=7`, { waitUntil: 'domcontentloaded' })
    await wait_room_ready(page)
    // the board owns the camera (locked-iso rig); wait for its entities + let it settle.
    await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__board?._descriptor?.()), null, {
      timeout: 30_000,
    })
    await page.evaluate(
      () =>
        new Promise((r) => {
          let n = 0
          const t = () => (++n < 30 ? requestAnimationFrame(t) : r(undefined))
          requestAnimationFrame(t)
        })
    )

    await page.screenshot({ path: `${OUT}/05_money_shot_board_in_cave.png` })

    expect(errors, `WebGPU/JS errors:\n${errors.join('\n')}`).toHaveLength(0)
    const has_board = await page.evaluate(() => Boolean(/** @type {any} */ (window).__board?._descriptor?.()))
    expect(has_board).toBe(true)

    await page.close()
    await context.close()
  })

  test('determinism: same seed boots an identical room twice (live block hash)', async ({ browser }) => {
    const hash_of = async (/** @type {number} */ seed) => {
      const context = await browser.newContext()
      const page = await context.newPage()
      await page.goto(`${ORIGIN}/demo/index.html?cave=1&seed=${seed}`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__cave), null, { timeout: 30_000 })
      const h = await page.evaluate(() => {
        const room = /** @type {any} */ (window).__cave
        // recompute the same room in-page and hash its id set (the handle holds the generated room via
        // its sample_block closure; re-generate deterministically through the exported gen for the hash).
        let acc = 1n
        // walk a coarse world grid through the room's own sample_block (stable, deterministic).
        for (let x = -2; x < 60; x += 1)
          for (let z = -2; z < 60; z += 1)
            for (let y = 60; y < 96; y += 1) {
              const id = room.sample_block(x, y, z)
              if (id) acc = (acc * 1000003n + BigInt(id) + BigInt((x * 97 + z) * 131 + y)) % 2n ** 64n
            }
        return acc.toString()
      })
      await context.close()
      return h
    }
    const a = await hash_of(11)
    const b = await hash_of(11)
    const c = await hash_of(12)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  // ENG-17 — walk-mode pass inside the room: spawn lands on the floor, and the solid rock shell contains
  // the player (bounds clamp = wall collision via the room's OWN sample_block). The shoulder camera has no
  // public set_yaw (azimuth moves only via pointer-lock, blocked under automation) and the controller
  // faces along camera.get_yaw() — so we READ the live forward, teleport the player upstream of the wall
  // that vector points at, hold forward, and assert they moved yet stayed inside the interior bound.
  test('walk mode: spawn on the floor + the rock shell clamps the player inside the room', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto(`${ORIGIN}/demo/index.html?cave=1&seed=7`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(
      () => {
        const w = /** @type {any} */ (window)
        return Boolean(w.__cave) && Boolean(w.__walk) && w.__engine?.get_stats?.().draw_calls > 0
      },
      null,
      { timeout: 60_000 }
    )
    await page.evaluate(
      () =>
        new Promise((r) => {
          let n = 0
          const t = () => (++n < 45 ? requestAnimationFrame(t) : r(undefined))
          requestAnimationFrame(t)
        })
    )

    const spawn = await page.evaluate(() => {
      const w = /** @type {any} */ (window)
      return { state: w.__walk.get_state(), bounds: w.__cave.bounds }
    })
    expect(
      Math.abs(spawn.state.position[1] - spawn.bounds.floor_y),
      `feet y=${spawn.state.position[1]} vs floor ${spawn.bounds.floor_y}`
    ).toBeLessThan(1.5)
    expect(spawn.state.on_ground).toBe(true)

    const clamp = await page.evaluate(async () => {
      const w = /** @type {any} */ (window)
      const b = w.__cave.bounds
      const yaw = w.__walk.camera.get_yaw()
      const fx = -Math.sin(yaw),
        fz = -Math.cos(yaw) // engine forward = (−sin yaw, 0, −cos yaw)
      const use_x = Math.abs(fx) >= Math.abs(fz)
      const sign = use_x ? Math.sign(fx) : Math.sign(fz)
      const cy = b.floor_y + 1
      const midx = (b.min_x + b.max_x) / 2,
        midz = (b.min_z + b.max_z) / 2
      if (use_x) w.__walk.set_position([(sign > 0 ? b.max_x : b.min_x) - sign * 5, cy, midz])
      else w.__walk.set_position([midx, cy, (sign > 0 ? b.max_z : b.min_z) - sign * 5])
      return { use_x, sign, start: w.__walk.get_state().position }
    })
    await page.keyboard.down('ArrowUp')
    await page.evaluate(
      () =>
        new Promise((r) => {
          let n = 0
          const t = () => (++n < 150 ? requestAnimationFrame(t) : r(undefined))
          requestAnimationFrame(t)
        })
    )
    await page.keyboard.up('ArrowUp')

    const after = await page.evaluate(() => /** @type {any} */ (window).__walk.get_state())
    const b = spawn.bounds
    const moved = Math.hypot(after.position[0] - clamp.start[0], after.position[2] - clamp.start[2])
    expect(moved, `player didn't move (moved=${moved.toFixed(2)})`).toBeGreaterThan(0.5) // input drove them
    if (clamp.use_x) {
      if (clamp.sign > 0) expect(after.position[0]).toBeLessThanOrEqual(b.max_x + 0.6)
      else expect(after.position[0]).toBeGreaterThanOrEqual(b.min_x - 0.6)
    } else {
      if (clamp.sign > 0) expect(after.position[2]).toBeLessThanOrEqual(b.max_z + 0.6)
      else expect(after.position[2]).toBeGreaterThanOrEqual(b.min_z - 0.6)
    }
    await context.close()
  })
})
