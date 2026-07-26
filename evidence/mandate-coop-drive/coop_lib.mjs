// Shared drive verbs for the coop pass.
import { sleep, until } from './harness.mjs'

export const coords_of = async page => {
  const t = await page.locator('body').innerText().catch(() => '')
  const m = t.match(/(-?\d+)\s*\n\s*(-?\d+)\s*\n\s*(-?\d+)\s*\n\s*ZONE\s*(-?\d+)·(-?\d+)/)
  return m ? { x: +m[1], y: +m[2], z: +m[3], zx: +m[4], zy: +m[5] } : null
}

export const world_name_of = async page =>
  (await page.locator('.gw-worlds__now').innerText().catch(() => '')).trim()

export const dist = (p, q) => (p && q ? Math.hypot(p.x - q.x, p.z - q.z) : Infinity)

/** Travel a seat to `world` via the real modal. Returns 'already' | 'travelled' | 'unavailable'. */
export async function travel_to(s, world) {
  const now = await world_name_of(s.page)
  if (now.toUpperCase() === world.toUpperCase()) return 'already'
  await s.page.locator('.gw-worlds__travel').click()
  await sleep(2500)
  const card = s.page.locator('.gw-travel__card').filter({ hasText: new RegExp(world, 'i') }).first()
  const btn = card.locator('.gw-travel__go').first()
  const label = (await btn.innerText().catch(() => '')).trim()
  console.log(`  ${s.name} travel card "${world}" button="${label}"`)
  if (/HERE/i.test(label)) {
    await s.page.keyboard.press('Escape')
    return 'already'
  }
  if (!/TRAVEL/i.test(label)) {
    await s.page.keyboard.press('Escape')
    return 'unavailable'
  }
  await btn.click()
  await sleep(1500)
  // Confirm dialog: "Travel to X? Joining commits on chain." → the CONFIRM button
  const confirm = s.page.getByRole('button', { name: /^TRAVEL$/i })
  const n = await confirm.count()
  for (let i = 0; i < n; i++) {
    const c = confirm.nth(i)
    const cls = ((await c.getAttribute('class')) || '').toString()
    if (/gw-worlds__travel|gw-travel__go/.test(cls)) continue
    console.log(`  ${s.name} confirming travel (btn .${cls.slice(0, 40)})`)
    await c.click()
    break
  }
  const ok = await until(async () => (await world_name_of(s.page)).toUpperCase() === world.toUpperCase(), {
    timeout: 120000,
    interval: 3000,
    label: `${s.name} arrive ${world}`,
  })
  return ok ? 'travelled' : 'unavailable'
}

/** Focus the 3D canvas so keyboard verbs reach the game (not the HUD). */
export async function focus_world(page) {
  const box = await page.locator('canvas').first().boundingBox()
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.75)
  await sleep(500)
}

export const hud_text = async page => (await page.locator('body').innerText().catch(() => '')).replace(/\n+/g, ' | ')

export const OFFSET = 250000
export const to_world = c => ({ x: c.x - OFFSET, z: c.z - OFFSET })

const hold = async (page, keys, ms) => {
  for (const k of keys) await page.keyboard.down(k)
  await sleep(ms)
  for (const k of keys) await page.keyboard.up(k)
}

/** Learn which key moves which world axis (camera is fixed-north, but never assume). */
export async function calibrate(s) {
  const probe = async key => {
    const p0 = await coords_of(s.page)
    await hold(s.page, [key], 1200)
    await sleep(900)
    const p1 = await coords_of(s.page)
    return { dx: p1.x - p0.x, dz: p1.z - p0.z }
  }
  const w = await probe('KeyW')
  const d = await probe('KeyD')
  s.cal = { w, d }
  console.log(`  ${s.name} calibrate: W→(${w.dx},${w.dz})  D→(${d.dx},${d.dz})`)
  return s.cal
}

/**
 * Walk a seat to a world-space target with closed-loop feedback. Real held keys, no teleport.
 * Returns the final distance.
 */
export async function walk_to(s, target, { tol = 20, budget_ms = 240000, label = '' } = {}) {
  const t0 = Date.now()
  let last = null
  let stalls = 0
  while (Date.now() - t0 < budget_ms) {
    const p = await coords_of(s.page)
    if (!p) return Infinity
    const dx = target.x - p.x
    const dz = target.z - p.z
    const d = Math.hypot(dx, dz)
    if (d <= tol) {
      console.log(`  ${s.name} arrived ${label} d=${Math.round(d)}`)
      return d
    }
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 3) {
      stalls++
      // blocked — hop and strafe out of the wall
      await s.page.keyboard.down('Space')
      await hold(s.page, [stalls % 2 ? 'KeyA' : 'KeyD'], 900)
      await s.page.keyboard.up('Space')
    } else stalls = 0
    if (stalls > 6) {
      console.log(`  ${s.name} STALLED ${label} at d=${Math.round(d)}`)
      return d
    }
    last = p
    // world axes are (approximately) key-aligned — pick the keys whose vectors reduce |d|
    const keys = []
    const { w, d: dd } = s.cal
    const wz = Math.sign(w.dz) || -1
    const dxs = Math.sign(dd.dx) || 1
    if (Math.abs(dz) > tol / 2) keys.push(Math.sign(dz) === wz ? 'KeyW' : 'KeyS')
    if (Math.abs(dx) > tol / 2) keys.push(Math.sign(dx) === dxs ? 'KeyD' : 'KeyA')
    if (!keys.length) return d
    const ms = Math.max(400, Math.min(3000, (d / 10.3) * 1000 * 0.7))
    await hold(s.page, keys, ms)
    await sleep(400)
  }
  const p = await coords_of(s.page)
  return Math.hypot(target.x - p.x, target.z - p.z)
}

/** Live prompt labels visible on the HUD (the [F]/[R]/[V] affordances). */
export const prompts_of = async page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.gw-npc-prompt')].map(e => (e.innerText || '').replace(/\n/g, ' ').trim())
  )
