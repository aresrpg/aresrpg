// AO terrace-stripe A/B (scope-add). Captures the target scenario — a GENTLE terraced dirt
// slope (all 1-block steps, gen-scan verified at (50,144) y≈115) close-up — so the flattened AO_LEVELS
// curve's effect on the horizontal-striping defect is visible. Run TWICE from the runner: once with
// AO_LEVELS reverted to the OLD linear ramp (writes ao_terrace_before.png), once with the shipped
// curve (writes ao_terrace_after.png). The label is passed via the AO_AB env var so one spec produces
// both frames without code edits between runs.

import { writeFile, mkdir } from 'node:fs/promises'

import { test } from '@playwright/test'

import { seize_camera, park_camera, settle_stream } from './_shared.js'
import { goto_demo } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts'
// Two dirt/grass terrace close-ups (gen-scan verified gentle 1-block staircases). Framed low + shallow
// so single-block treads fill the frame at a close-up angle.
const DIRT = { wx: 50, wz: 144, y: 115 }
const GRASS = { wx: 122, wz: 86, y: 133 }

test('AO terrace stripe A/B capture', async ({ page }) => {
  test.setTimeout(120_000)
  await mkdir(OUT, { recursive: true })
  const label = process.env.AO_AB || 'after'

  await goto_demo(page, { seed: undefined, timeout_ms: 60_000 })
  await seize_camera(page)

  /** @param {string} name @param {{wx:number,wz:number,y:number}} t */
  const shoot = async (name, t) => {
    // Camera sits back + slightly above the terrace, looking down the staircase at a close-up angle.
    await park_camera(page, [t.wx - 14, t.y + 12, t.wz - 14], Math.PI / 4, -0.4)
    await settle_stream(page, { min_ms: 1500, deadline_ms: 15000 })
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const buf = await page.locator('#canvas').screenshot()
    await writeFile(`${OUT}/${name}_${label}.png`, buf)
    console.log(`[ao_ab] wrote ${name}_${label}.png`)
  }

  await shoot('ao_terrace_dirt', DIRT)
  await shoot('ao_terrace_grass', GRASS)
})
