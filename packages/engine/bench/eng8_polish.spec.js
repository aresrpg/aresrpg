// ENG-8 owner feel-polish acceptance (2026-07-03): (1) FALL anim only past a >3-block drop — terrace
// walks / 2-block drops / jump arcs keep the locomotion cycle or a brief airborne coast; (2) auto-step
// rendered as a ~STEP_SMOOTH_MS visual ease (sim/collision snap unchanged) instead of a teleport read.
// Records a ≥15 s .webm of the drive (terrace climb → 2-block drop → 5-block drop) + 3 stills, and
// asserts the behavior numerically via an in-page per-frame collector (anim, sim y, visual y, grounded).

import { mkdir, writeFile } from 'node:fs/promises'

import { expect } from '@playwright/test'

import { CONTROLLER_CONSTANTS } from '../src/player/controller.js'

import { test, open_recorded_page, settle_stream } from './_shared.js'

const ART = '/tmp/aresrpg-engine-artifacts'
const SHOTS = `${ART}/eng8_polish`

async function enable_walk(page) {
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })))
  await page.waitForFunction(() => /** @type {any} */ (window).__walk?.avatar?.ready === true, null, { timeout: 15000 })
}

/** Install a rAF frame collector: __polish.frames grows with {anim, y(sim), v(visual), g(grounded)}. */
const install_collector = (page) =>
  page.evaluate(() => {
    const w = /** @type {any} */ (window)
    w.__polish = { on: false, frames: [] }
    const tick = () => {
      if (w.__polish.on && w.__walk) {
        const s = w.__walk.get_state()
        w.__polish.frames.push({ anim: s.anim, y: s.position[1], v: s.visual_y, g: s.on_ground })
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
const start_collect = (page) =>
  page.evaluate(() => {
    const c = /** @type {any} */ (window).__polish
    c.frames.length = 0
    c.on = true
  })
const stop_collect = (page) =>
  page.evaluate(() => {
    const c = /** @type {any} */ (window).__polish
    c.on = false
    return c.frames
  })

/** Per-frame max deltas + anim set + ease-tail size over a collected frame run. `ease_frames` counts
 *  frames with a PARTIAL upward visual move (0.03–0.6) — a smoothed step spreads its rise over several
 *  of these; a teleport read has at most one big jump and no tail. Robust to collector frame drops
 *  (a dropped frame merges 2-3 sim ticks into one delta, so absolute per-frame bounds are brittle).
 *  @param {{anim:string,y:number,v:number,g:boolean}[]} frames */
function analyze(frames) {
  let max_dy = 0
  let max_dv = 0
  let ease_frames = 0
  const anims = new Set()
  for (let i = 0; i < frames.length; i += 1) {
    anims.add(frames[i].anim)
    if (i > 0) {
      const dy = Math.abs(frames[i].y - frames[i - 1].y)
      const dv = frames[i].v - frames[i - 1].v
      max_dy = Math.max(max_dy, dy)
      max_dv = Math.max(max_dv, Math.abs(dv))
      if (dv > 0.03 && dv < 0.6) ease_frames += 1
    }
  }
  return { max_sim_step: max_dy, max_visual_step: max_dv, ease_frames, anims: [...anims] }
}

test.describe('ENG-8 feel polish', () => {
  test('terrace smooth-step, 2-block drop no FALL, 5-block drop FALL + landing', async ({ browser }) => {
    test.setTimeout(180000)
    await mkdir(SHOTS, { recursive: true })
    const { page, finish } = await open_recorded_page(browser, 'eng8_polish')
    /** @type {Record<string, unknown>} */
    const report = {
      knobs: {
        fall_anim_threshold: CONTROLLER_CONSTANTS.FALL_ANIM_THRESHOLD,
        step_smooth_ms: CONTROLLER_CONSTANTS.STEP_SMOOTH_MS,
      },
    }
    try {
      await page.goto('./?tier=high&seed=aresrpg')
      await page.waitForFunction(() => !!(/** @type {any} */ (window).__engine), null, { timeout: 30000 })
      await settle_stream(page, { min_ms: 4000, deadline_ms: 45000 })
      await enable_walk(page)
      await page.waitForTimeout(1500) // settle onto ground
      await install_collector(page)

      // ── TERRACE CLIMB: find a REAL 2-step ground staircase nearby (base→+1→+2 along one axis on
      // walkable ground ids — NOT tree canopy, which is also solid), teleport to its base, face it and
      // walk up. Prove: no FALL anim, sim y snapped ≥0.8 in one frame (collision auto-step untouched)
      // while the RENDERED feet never moved more than ~0.6/frame (the smoothing absorbed the teleport). ──
      const stair = await page.evaluate(() => {
        const w = /** @type {any} */ (window)
        const eng = w.__engine
        const [cx, cy, cz] = w.__walk.get_state().position
        const GROUND = [1, 2, 3, 4, 8] // grass/dirt/sand/stone/snow (walk_mode GROUND_IDS)
        // standing y on WALKABLE ground with 3 air above (skips canopies — leaves are solid but not ground)
        const gy = (/** @type {number} */ x, /** @type {number} */ z) => {
          for (let y = Math.floor(cy) + 8; y >= Math.floor(cy) - 8; y -= 1) {
            const id = eng.sample_block(x, y, z)
            if (id === 0) continue
            if (
              GROUND.includes(id) &&
              eng.sample_block(x, y + 1, z) === 0 &&
              eng.sample_block(x, y + 2, z) === 0 &&
              eng.sample_block(x, y + 3, z) === 0
            )
              return y + 1
            return null // topmost solid isn't standable ground — not a stair column
          }
          return null
        }
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
        for (let r = 0; r <= 50; r += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            for (let dz = -r; dz <= r; dz += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
              const x = Math.floor(cx) + dx
              const z = Math.floor(cz) + dz
              const y0 = gy(x, z)
              if (y0 === null) continue
              for (const [ux, uz] of dirs) {
                if (gy(x + ux, z + uz) !== y0 + 1) continue // step 1
                if (gy(x + 2 * ux, z + 2 * uz) !== y0 + 2) continue // step 2
                if (gy(x - ux, z - uz) !== y0) continue // flat approach cell behind the base
                // face the stair: move_direction forward = (−sin yaw, −cos yaw) = (ux, uz)
                return { base: [x - ux + 0.5, y0, z - uz + 0.5], yaw: Math.atan2(-ux, -uz) }
              }
            }
          }
        }
        return null
      })
      expect(stair).not.toBeNull() // a natural 2-step ground staircase exists in range
      report.stair = stair

      await page.evaluate((s) => {
        const w = /** @type {any} */ (window)
        w.__walk.set_position(s.base)
        w.__walk.camera.rotate((w.__walk.camera.get_yaw() - s.yaw) / 0.0025, 0)
      }, stair)
      await page.waitForTimeout(400) // settle grounded + camera
      await start_collect(page)
      const start_y = await page.evaluate(() => /** @type {any} */ (window).__walk.get_state().position[1])
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })))
      // stop as soon as both steps are climbed (bounded so we never sprint off a far cliff)
      await page
        .waitForFunction((y0) => /** @type {any} */ (window).__walk.get_state().position[1] >= y0 + 1.9, start_y, {
          timeout: 3000,
        })
        .catch(() => {}) // timeout → the rise assert below reports it honestly
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })))
      await page.waitForTimeout(400) // let the visual offset finish easing (sampled by the collector)
      const climb_frames = await stop_collect(page)
      await page.locator('#canvas').screenshot({ path: `${SHOTS}/01_terrace_climb.png` })

      const climb_stats = analyze(climb_frames)
      const climb_rise = Math.max(...climb_frames.map((f) => f.y)) - climb_frames[0].y
      report.climb = { frames: climb_frames.length, rise_m: Number(climb_rise.toFixed(2)), ...climb_stats }
      expect(climb_rise).toBeGreaterThan(1.9) // climbed both steps
      expect(climb_stats.anims).not.toContain('FALL') // terrace never flashes the fall pose
      expect(climb_stats.max_sim_step).toBeGreaterThan(0.8) // collision auto-step still snaps (authority)
      // …but the rendered feet EASE: worst visible jump strictly smaller than the sim snap (even when a
      // dropped collector frame merges 2-3 sim ticks) AND the rise spreads over an easing tail of frames
      // (a teleport read = one full-height jump, no tail).
      expect(climb_stats.max_visual_step).toBeLessThan(Math.min(0.85, climb_stats.max_sim_step * 0.85))
      expect(climb_stats.ease_frames).toBeGreaterThanOrEqual(3)

      // ── clear column for the drops: nearest ground with ≥8 air above (fits a 5-block drop + body) ──
      const col = await page.evaluate(() => {
        const w = /** @type {any} */ (window)
        const eng = w.__engine
        const [cx, cy, cz] = w.__walk.get_state().position
        for (let r = 0; r <= 40; r += 1) {
          for (let dx = -r; dx <= r; dx += 1) {
            for (let dz = -r; dz <= r; dz += 1) {
              if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
              const x = Math.floor(cx + dx)
              const z = Math.floor(cz + dz)
              for (let y = Math.floor(cy) + 4; y >= Math.floor(cy) - 6; y -= 1) {
                const id = eng.sample_block(x, y, z)
                if (id === 0) continue
                if (![1, 2, 3, 4, 8].includes(id)) break // canopy/log top — not a landing pad
                let air = 0
                while (air < 8 && eng.sample_block(x, y + 1 + air, z) === 0) air += 1
                if (air >= 8) return { x: x + 0.5, feet_y: y + 1, z: z + 0.5 }
                break // ground found but not enough headroom — next column
              }
            }
          }
        }
        return null
      })
      expect(col).not.toBeNull()
      report.drop_column = col
      const drop = async (/** @type {number} */ blocks, /** @type {string} */ shot) => {
        await page.evaluate((c) => /** @type {any} */ (window).__walk.set_position([c.x, c.feet_y, c.z]), col)
        await page.waitForTimeout(250) // settle grounded
        await start_collect(page)
        await page.evaluate(
          ({ c, blocks }) => /** @type {any} */ (window).__walk.set_position([c.x, c.feet_y + blocks, c.z]),
          { c: col, blocks }
        )
        await page.waitForFunction(() => /** @type {any} */ (window).__walk.get_state().on_ground === true, null, {
          timeout: 5000,
        })
        await page.waitForTimeout(150) // a few grounded frames so the landing anim is sampled
        const frames = await stop_collect(page)
        if (shot) await page.locator('#canvas').screenshot({ path: `${SHOTS}/${shot}` })
        return analyze(frames)
      }

      const small = await drop(2, '02_drop2_no_fall.png')
      report.drop_2 = small
      expect(small.anims).not.toContain('FALL') // 2-block drop: no fall anim (design rule)

      const big = await drop(5, '03_drop5_fall.png')
      report.drop_5 = big
      expect(big.anims).toContain('FALL') // 5-block drop: the fall pose plays…
      expect(big.anims.some((a) => a === 'IDLE' || a === 'WALK' || a === 'RUN')).toBe(true) // …and lands back into the cycle

      report.video = await finish('polish')
      await writeFile(`${ART}/eng8_polish_report.json`, JSON.stringify(report, null, 2))
      console.log('[eng8_polish]', JSON.stringify(report, null, 2))
    } finally {
      await finish('polish')
    }
  })
})
