// PR #966 — BARS 1 · 2 · 4 · 5, attempt 3. The point-to-point walker stalls in a terrain pocket (south is
// water), so this ROAMS in short steps and polls the real [R] ATTACK prompt EVERY step — any pack we pass
// within the engage ring arms, instead of only the one we aimed at.
import fs from 'node:fs'
import {
  launch, seat, sleep, until, log, iso, BASE, SHOTS,
  fights_of_character, chain_read, dev_state, board_up, toasts_of,
  RELEASE_SIGNALS, REFUSAL_SIGNAL, hits,
} from './pr966_harness.mjs'
import { coords_of, world_name_of, focus_world, calibrate, prompts_of, to_world } from './coop_lib.mjs'

const WORLD = '0xf69fe397444a1a278deb9a67d4516aac2f6cfa1e083581c21d99f763b543fc3c'
const ZONE = [487, 487]
const CHAR = '0xe3d99d594f2acab553445e83ad122482ae242fa42df0771a4f5c4e98b33fce7b'
const ALICE = '0xb4951afe3682d3e9425671f1772e3676bc6ff361ac00896ea131cf52765cd177'
const OUT = {}

const browser = await launch()
const A = await seat(browser, { name: 'BAR124', key: 'alice' })
await A.page.goto(`${BASE}/?dev`, { waitUntil: 'domcontentloaded' })
log('booting…')
await sleep(28000)
log('world:', await world_name_of(A.page), 'coords', JSON.stringify(await coords_of(A.page)))
await focus_world(A.page)
await calibrate(A)

const armed = async () => (await prompts_of(A.page)).some(p => /ATTACK/i.test(p))
const hold = async (keys, ms) => {
  for (const k of keys) await A.page.keyboard.down(k)
  await sleep(ms)
  for (const k of keys) await A.page.keyboard.up(k)
}

const rows = await A.page.evaluate(
  async ([world, zx, zy]) => {
    const m = await import('/src/game/zone_rows.js')
    return JSON.parse(JSON.stringify(await m.zone_rows_v1(world, zx, zy, { fresh: true })))
  },
  [WORLD, ...ZONE]
)
const p0 = await coords_of(A.page)
const packs = rows.filter(r => r.kind === 'mob').map(r => ({ ...r, w: to_world(r) }))
  .sort((a, b) => Math.hypot(a.w.x - p0.x, a.w.z - p0.z) - Math.hypot(b.w.x - p0.x, b.w.z - p0.z))
log(`${packs.length} packs; from ${JSON.stringify(p0)} nearest d=${Math.round(Math.hypot(packs[0].w.x - p0.x, packs[0].w.z - p0.z))}`)

/** ROAM toward `target` in short steps, checking the ATTACK prompt EVERY step. Returns true the moment a
 *  pack (any pack) arms the prompt. Unsticks sideways when the position stops changing. */
async function roam_toward(target, budget_ms, label) {
  const t0 = Date.now()
  let last = null
  let stalls = 0
  while (Date.now() - t0 < budget_ms) {
    if (await armed()) { log(`  ARMED while roaming ${label}`); return true }
    const p = await coords_of(A.page)
    if (!p) return false
    const dx = target.x - p.x
    const dz = target.z - p.z
    const d = Math.hypot(dx, dz)
    if (d <= 6) return await armed()
    if (last && Math.hypot(p.x - last.x, p.z - last.z) < 2.5) {
      stalls++
      // barrier — jump and strafe HARD, alternating sides, escalating with each stall
      await A.page.keyboard.down('Space')
      await hold([stalls % 2 ? 'KeyA' : 'KeyD'], 500 + stalls * 350)
      await A.page.keyboard.up('Space')
      if (stalls > 3) { // back off then commit to a perpendicular run — a real detour, not a nudge
        await hold(['KeyS'], 900)
        await hold([stalls % 2 ? 'KeyA' : 'KeyD'], 2200)
      }
      if (stalls > 8) { log(`  giving up on ${label} at d=${Math.round(d)}`); return false }
    } else stalls = 0
    last = p
    const { w, d: dd } = A.cal
    const wz = Math.sign(w.dz) || -1
    const dxs = Math.sign(dd.dx) || 1
    const keys = []
    if (Math.abs(dz) > 4) keys.push(Math.sign(dz) === wz ? 'KeyW' : 'KeyS')
    if (Math.abs(dx) > 4) keys.push(Math.sign(dx) === dxs ? 'KeyD' : 'KeyA')
    if (!keys.length) return await armed()
    await hold(keys, 800) // SHORT steps so the prompt check is frequent
  }
  return await armed()
}

let engaged_pack = null
for (const pack of packs.slice(0, 14)) {
  const p = await coords_of(A.page)
  const d = Math.hypot(pack.w.x - p.x, pack.w.z - p.z)
  log(`roaming to pack ${pack.spawn_id} d=${Math.round(d)}`)
  if (await roam_toward(pack.w, 75000, `pack ${pack.spawn_id}`)) { engaged_pack = pack; break }
}
if (!engaged_pack) {
  log('BLOCKED — no pack reachable')
  await A.shot('X_unreachable')
  await browser.close()
  process.exit(2)
}

await focus_world(A.page)
const T_ENGAGE = Date.now()
await A.page.keyboard.press('KeyR')
log(`[R] pressed — engaging pack ${engaged_pack.spawn_id}`)

const seen = await until(async () => {
  const f = (await fights_of_character(CHAR))[0]
  if (!f) return false
  globalThis.__f = f
  return true
}, { timeout: 120000, interval: 1200, label: 'fight appears for alice on /v1' })
if (!seen) {
  log('FAIL — no fight appeared')
  await A.shot('X_no_fight')
  await browser.close()
  process.exit(1)
}
const FIGHT = globalThis.__f.fight_id
OUT.fight_id = FIGHT
log(`FIGHT ${FIGHT} /v1 status=${globalThis.__f.status} +${Date.now() - T_ENGAGE}ms after [R]`)

const cr0 = await chain_read(A.page, FIGHT)
OUT.chain_pre = cr0
log('CHAIN PRE-REFRESH:', JSON.stringify(cr0))
log('  window_left_ms =', cr0.placement_deadline_ms - cr0.now, `deadline ${iso(cr0.placement_deadline_ms)}`)
log('  alice seat present:', (cr0.seat_owners || []).includes(ALICE))
log('shot:', await A.shot('10_placement_before_refresh'))
log('DEV_STATE pre-refresh:', JSON.stringify(await dev_state(A.page)))

async function refresh_leg(tag, shot_label) {
  A.console_all.length = 0
  const t = Date.now()
  log(`=== ${tag} — RELOAD ===`)
  await A.page.reload({ waitUntil: 'domcontentloaded' })
  const up = await until(() => board_up(A.page), { timeout: 90000, interval: 800, label: `board re-mounts (${tag})` })
  const st = await dev_state(A.page)
  const cr = await chain_read(A.page, FIGHT)
  const tst = await toasts_of(A.page)
  const shot = await A.shot(shot_label)
  const lines = [...A.console_all]
  const rec = {
    tag, board_up: up, ms: Date.now() - t, dev_state: st, chain: cr,
    window_open_at_mount: cr.placement_deadline_ms > cr.now,
    alice_seat_live: (cr.seat_owners || []).includes(ALICE) && (cr.status === 0 || cr.status === 1),
    toasts: tst,
    refusal_lines: hits(lines, REFUSAL_SIGNAL),
    release_lines: hits(lines, RELEASE_SIGNALS),
    release_toasts: tst.filter(x => RELEASE_SIGNALS.some(r => r.test(x))),
    console_errors: lines.filter(l => / error: | \[pageerror\] /.test(l)),
    relevant: lines.filter(l => /world-fight|resume|liquidat|force_start|placement|dungeon fight/i.test(l)),
  }
  log(`${tag} board_up=${up} in ${rec.ms}ms · chain status=${cr.status} · window_open=${rec.window_open_at_mount} · seat_live=${rec.alice_seat_live}`)
  log(`${tag} DEV_STATE:`, JSON.stringify(st))
  log(`${tag} shot:`, shot)
  log(`${tag} REFUSAL lines:`, JSON.stringify(rec.refusal_lines))
  log(`${tag} RELEASE lines (bar4):`, JSON.stringify(rec.release_lines))
  log(`${tag} RELEASE toasts (bar4):`, JSON.stringify(rec.release_toasts))
  log(`${tag} toasts:`, JSON.stringify(tst))
  for (const l of rec.relevant) log('    rel:', l)
  for (const l of rec.console_errors) log('    err:', l)
  return rec
}

OUT.bar1 = await refresh_leg('BAR1', '11_after_refresh_1')
OUT.bar2 = await refresh_leg('BAR2', '12_after_refresh_2')

OUT.chain_final = await chain_read(A.page, FIGHT)
OUT.v1_final = await fights_of_character(CHAR)
log('CHAIN FINAL:', JSON.stringify(OUT.chain_final))
log('ALL page errors:', A.errors.join(' | ') || '(none)')
log('ALL console.error:', A.console_errors.join(' | ') || '(none)')
OUT.all_page_errors = A.errors
OUT.all_console_errors = A.console_errors
fs.writeFileSync(`${SHOTS}/../pr966_bar124.json`, JSON.stringify(OUT, null, 2))
log('FIGHT_ID', FIGHT)
await browser.close()
log('done')
