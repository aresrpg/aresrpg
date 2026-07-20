// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// [victim-reaction PROOF] The "got hit" flinch on the REAL GPU (headed Metal). Boots the ?team=1 flat
// open-sky board and drives scripted damage/heal/death beats on the fighters, capturing the recoil + the
// emissive tint at each impact frame:
//   reaction_idle.png  — the calm baseline (fighters on their seat rings).
//   reaction_hit.png   — BOTH enemies struck at once: each recoils AWAY off its ring + red-flashes
//                         (proves the universal flinch AND that simultaneous multi-hits stagger).
//   reaction_heal.png  — BOTH allies healed: a soft green pulse, NO recoil (they stay on their rings).
//   reaction_death.png — a killing crit on one enemy: it red-flashes + plays DEATH, but NEVER flinches.
//
// Like bench/team_outline.spec.js this is a CAPTURE, not a pass/fail gate: it asserts only that the render
// is real hardware and the board booted (+ no fatal page errors). The stills are the oracle — the flash is
// an emissive TINT that AgX desaturates toward white, so a raw pixel saturation gate reads it poorly; the
// eye does not. A per-still centre luma is logged as informational evidence. Each still is captured at the
// clip's impact apex (impact_fraction × the senshi ~2s ATTACK/DEATH clip + the ~0.15s tint rise).
//
// Run: `bun run bench bench/victim_reaction.spec.js --project=studio-metal-headed`.

import path from 'node:path'
import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN, probe_gpu_adapter } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts'
const ALLY = { x: 2, y: 4 } // an ally cell the struck enemies face (so they recoil AWAY from it — northward)
const ENEMY = { x: 5, y: 2 } // an enemy cell the healed allies face

/** Capture a full-canvas still + log its centre-crop luma (informational — an emissive flash raises luma). */
async function shot(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ name) {
  const buf = await page.locator('#canvas').screenshot({ path: path.join(OUT, name) })
  const url = `data:image/png;base64,${buf.toString('base64')}`
  return page.evaluate(async (u) => {
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = u
    })
    const off = document.createElement('canvas')
    off.width = img.width
    off.height = img.height
    const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, img.width, img.height).data
    let r = 0
    let gg = 0
    let b = 0
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]
      gg += d[i + 1]
      b += d[i + 2]
    }
    const px = d.length / 4
    return { luma: (0.2126 * r + 0.7152 * gg + 0.0722 * b) / px }
  }, url)
}

test('victim reaction — recoil + red flash on damage, green pulse on heal, death flashes but never flinches', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await mkdir(OUT, { recursive: true })

  /** @type {string[]} */
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`${DEMO_ORIGIN}/demo/index.html?team=1`)
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20_000 }).catch(async () => {
    throw new Error(`team board did not boot — gate says: "${await page.locator('#gate').textContent()}"`)
  })

  const gpu = await probe_gpu_adapter(page)
  expect(gpu.ok, `hardware GPU required (§7): ${gpu.reason ?? ''}`).toBe(true)

  // Dolly the locked iso rig in a little so the fighters + their seat rings read (the ring is the fixed
  // reference the recoil offset is measured against by eye).
  await page.evaluate(() => {
    const b = /** @type {any} */ (window).__board
    b.camera_rig.dolly_to(9)
    b.camera_rig.set_azimuth(0.35)
  })
  await page.waitForTimeout(450)
  const idle = await shot(page, 'reaction_idle.png')

  // DAMAGE — both enemies struck at once (simultaneous multi-hit): each plays its 'hit' beat, recoils AWAY
  // from the ally it faces, and red-flashes. `suppress_burst` skips the pre-existing impact-particle VFX so
  // the still isolates the BODY reaction (my feature) — the recoil offset off the seat ring + the red tint;
  // the float + reaction still fire. Captured near the ~0.64s recoil apex (0.3×~1.97s ATTACK + the ~0.05s
  // out-jerk), with the flash already rising.
  await page.evaluate((c) => {
    const b = /** @type {any} */ (window).__board
    b.entity_beat('e0', { anim: 'hit', face: c, suppress_burst: true, float: { text: '-284', kind: 'damage' } })
    b.entity_beat('e1', { anim: 'hit', face: c, suppress_burst: true, float: { text: '-197', kind: 'damage' } })
  }, ALLY)
  await page.waitForTimeout(660)
  const hit = await shot(page, 'reaction_hit.png')
  await page.waitForTimeout(700) // let the flinch fully settle back to rest

  // HEAL — both allies get a soft green pulse, NO recoil. Captured at the ~0.74s flash apex.
  await page.evaluate((c) => {
    const b = /** @type {any} */ (window).__board
    b.entity_beat('a0', { anim: 'hit', face: c, suppress_burst: true, float: { text: '+180', kind: 'heal' } })
    b.entity_beat('a1', { anim: 'hit', face: c, suppress_burst: true, float: { text: '+140', kind: 'heal' } })
  }, ENEMY)
  await page.waitForTimeout(740)
  const heal = await shot(page, 'reaction_heal.png')
  await page.waitForTimeout(700)

  // DEATH — a killing crit on e0: it red-flashes + plays its DEATH collapse but NEVER flinches (stays on its
  // ring). Captured at the ~1.05s death apex (0.5×~2.1s DEATH clip).
  await page.evaluate(
    (c) =>
      /** @type {any} */ (window).__board.entity_beat('e0', {
        anim: 'death',
        face: c,
        suppress_burst: true,
        float: { text: '-512', kind: 'crit' },
      }),
    ALLY
  )
  await page.waitForTimeout(1080)
  const death = await shot(page, 'reaction_death.png')

  // Capture-mode gate (team_outline precedent): the render is real hardware + the board booted + nothing
  // fatal logged. The stills are the reaction oracle; the luma trail is informational corroboration.
  const fatal = errors.filter((e) => /error|throw|cannot|undefined is not/i.test(e) && !/webgpu.*warn/i.test(e))
  expect(fatal, `no fatal page errors during the reaction run:\n  ${fatal.join('\n  ')}`).toHaveLength(0)

  console.log(
    `[victim_reaction] centre luma — idle=${idle.luma.toFixed(2)} hit=${hit.luma.toFixed(2)} ` +
      `heal=${heal.luma.toFixed(2)} death=${death.luma.toFixed(2)} (a flash raises luma over idle)`
  )
})
