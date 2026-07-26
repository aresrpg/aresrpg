// BAR 4 (roles inverted) + the alice-immobility pin.
// 1) DIAGNOSE: screenshot alice + probe her movement at the old fight site (the stall's ground truth).
// 2) BOB engages a pack near alice; ALICE joins via [V]; ALICE hard-refreshes mid-PLACEMENT.
// 3) Settle both through the product.
import fs from 'node:fs'
import {
  launch, seat, sleep, until, log, BASE,
  fights_of_character, fight_by_id, dev_state, chain_read, visible_text,
} from './mcd_harness.mjs'
import { coords_of, world_name_of, focus_world, calibrate, walk_to, prompts_of, to_world, dist } from './coop_lib.mjs'

const WORLD = '0xf69fe397444a1a278deb9a67d4516aac2f6cfa1e083581c21d99f763b543fc3c'
const ZONE = [487, 487]
const CHAR_A = '0xe3d99d594f2acab553445e83ad122482ae242fa42df0771a4f5c4e98b33fce7b'
const CHAR_B = '0x6ceb23694c67eb344378e897ca4e229a6e2ac8b1584b3878446b24366f7e9b5c'
const EV = '/private/tmp/claude-501/-Users-sceatstudio-dev-aresrpg/355a94d1-4ae2-4602-9c1e-e2c26823aa58/scratchpad/mcd_evidence.json'

const ev = fs.existsSync(EV) ? JSON.parse(fs.readFileSync(EV, 'utf8')) : { bars: {} }
const save = () => fs.writeFileSync(EV, JSON.stringify(ev, null, 2))
const bar = (id, verdict, detail) => {
  ev.bars[id] = { verdict, ...detail, at: new Date().toISOString() }
  save()
  log(`### BAR ${id} = ${verdict} — ${JSON.stringify(detail).slice(0, 500)}`)
}

const browser = await launch()
const A = await seat(browser, { name: 'A4_alice', key: 'alice' })
const B = await seat(browser, { name: 'B4_bob', key: 'bob' })
const done = async (why, code) => {
  ev.bar4b_exit = why
  ev.finished = new Date().toISOString()
  save()
  log('EXIT —', why)
  await browser.close()
  process.exit(code)
}
const dismiss_report = async s => {
  const btn = s.page.getByRole('button', { name: /^CONTINUE$/i }).first()
  if (await btn.count().catch(() => 0)) { await btn.click().catch(() => {}); log(s.name, 'dismissed report'); await sleep(2500); return true }
  return false
}
const hold = async (page, keys, ms) => {
  for (const k of keys) await page.keyboard.down(k)
  await sleep(ms)
  for (const k of keys) await page.keyboard.up(k)
}

log('BOOT')
for (const s of [A, B]) await s.page.goto(`${BASE}/?dev`, { waitUntil: 'domcontentloaded' })
await sleep(32000)
for (const s of [A, B]) { await dismiss_report(s); await focus_world(s.page) }

// ── 1 · PIN alice's immobility ────────────────────────────────────────────────
const a0 = await coords_of(A.page)
log('ALICE at', JSON.stringify(a0), 'world', await world_name_of(A.page))
log('alice diag shot', await A.shot('diag_00_stuck'))
const probes = {}
for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD']) {
  const p0 = await coords_of(A.page)
  await hold(A.page, [k], 1500)
  await sleep(900)
  const p1 = await coords_of(A.page)
  probes[k] = { dx: p1.x - p0.x, dz: p1.z - p0.z, dy: p1.y - p0.y }
}
// jump + strafe recovery (the product's own unstick affordance)
const before_jump = await coords_of(A.page)
await A.page.keyboard.down('Space')
await hold(A.page, ['KeyW'], 1400)
await A.page.keyboard.up('Space')
await sleep(1200)
const after_jump = await coords_of(A.page)
const freed = Math.hypot(after_jump.x - before_jump.x, after_jump.z - before_jump.z) > 3
log('alice key probes:', JSON.stringify(probes))
log('alice jump recovery:', JSON.stringify({ before_jump, after_jump, freed }))
log('alice diag shot 2', await A.shot('diag_01_after_jump'))
ev.alice_immobility = {
  position: a0,
  key_probes: probes,
  jump_recovery: { before: before_jump, after: after_jump, freed },
  hud_readable: !!a0,
  page_errors: A.errors.concat(A.console_errors).slice(0, 8),
  note: 'alice sat at the settled fight site (-440,-439); bob at his own spot calibrated and walked normally in the same session',
}
save()

// ── 2 · BOB engages a pack near ALICE, alice joins ────────────────────────────
await calibrate(B)
const rows = await B.page.evaluate(
  async ([world, zx, zy]) => {
    const m = await import('/src/game/zone_rows.js')
    return JSON.parse(JSON.stringify(await m.zone_rows_v1(world, zx, zy, { fresh: true })))
  }, [WORLD, ...ZONE])
const ap = await coords_of(A.page)
// pick the pack CLOSEST TO ALICE so her [V] proximity prompt (50 blocks) arms without walking
const packs = rows.filter(r => r.kind === 'mob').map(r => ({ ...r, w: to_world(r) }))
  .sort((x, y) => Math.hypot(x.w.x - ap.x, x.w.z - ap.z) - Math.hypot(y.w.x - ap.x, y.w.z - ap.z))
log(`${packs.length} packs; nearest-to-alice ${packs[0]?.spawn_id} at ${JSON.stringify(packs[0]?.w)} d_alice=${Math.round(Math.hypot(packs[0].w.x - ap.x, packs[0].w.z - ap.z))}`)

let pack = null
for (const cand of packs.slice(0, 4)) {
  const d_alice = Math.hypot(cand.w.x - ap.x, cand.w.z - ap.z)
  if (d_alice > 45) { log(`  skip ${cand.spawn_id}: ${Math.round(d_alice)} from alice (outside her prompt ring)`); continue }
  await walk_to(B, cand.w, { tol: 6, budget_ms: 140000, label: `pack ${cand.spawn_id}` })
  const ok = await until(async () => (await prompts_of(B.page)).some(p => /ATTACK/i.test(p)), { timeout: 8000, interval: 1000, label: 'ATTACK arms (bob)' })
  log(`  pack ${cand.spawn_id} attack=${ok} d_alice=${Math.round(d_alice)}`)
  if (ok) { pack = cand; break }
}
if (!pack) { bar(4, 'BLOCKED', { why: 'no pack both reachable by bob and inside alice\'s 50-block prompt ring', alice_immobile: !freed }); await done('no pack', 2) }
log('separation A↔B', Math.round(dist(await coords_of(A.page), await coords_of(B.page))))

await focus_world(B.page)
await B.page.keyboard.press('KeyR')
const seen = await until(async () => {
  const f = (await fights_of_character(CHAR_B))[0]
  if (!f) return false
  globalThis.__f = f
  return true
}, { timeout: 150000, interval: 1500, label: 'bob fight on /v1' })
if (!seen) { bar(4, 'BLOCKED', { why: 'no fight after bob [R]' }); await done('no fight', 2) }
const FIGHT = globalThis.__f.fight_id
ev.fight_id_bar4 = FIGHT
log('FIGHT', FIGHT, globalThis.__f.status, '(engager = BOB)')

// ALICE joins
let joined = false
const ap2 = await prompts_of(A.page)
log('alice prompts:', JSON.stringify(ap2))
if (await until(async () => (await prompts_of(A.page)).some(p => /FIGHT/i.test(p)), { timeout: 45000, interval: 2000, label: 'alice fights prompt' })) {
  await focus_world(A.page)
  await A.page.keyboard.press('KeyV')
  await sleep(3000)
  await A.shot('b4b_05_alice_panel')
  const join = A.page.locator('.gw-ft__act--join').first()
  if (await join.count()) { await join.click(); joined = true; log('ALICE clicked JOIN') }
  else log('alice: no JOIN button —', (await A.page.locator('.gw-ft__act').allInnerTexts()).join(','))
}
const c_pre = await chain_read(null, FIGHT)
log('CHAIN pre-refresh:', JSON.stringify(c_pre))
await A.shot('b4b_10_placement_A')
await B.shot('b4b_10_placement_B')

// ── 3 · THE REFRESH — ALICE, mid-placement ────────────────────────────────────
if (c_pre.status_label !== 'placement') {
  bar(4, 'BLOCKED', { why: `fight was '${c_pre.status_label}' at the refresh beat`, chain: c_pre, alice_joined: joined })
  await done('not placement', 0)
}
A.console_all.length = 0
const T_R = Date.now()
log('=== HARD REFRESH ALICE mid-placement ===')
await A.page.reload({ waitUntil: 'domcontentloaded' })
const reentered = await until(async () => {
  const st = await dev_state(A.page)
  return !!st && st.me != null && st.my_cell != null
}, { timeout: 90000, interval: 1500, label: 'alice re-enters the placement board' })
const ms = Date.now() - T_R
const st_after = await dev_state(A.page)
const c_post = await chain_read(null, FIGHT)
await A.shot('b4b_20_after_refresh')
await B.shot('b4b_20_peer')
const a_txt = await visible_text(A.page)
bar(4, reentered ? 'PASS' : 'FAIL', {
  fight_id: FIGHT,
  engager: 'bob', refreshed_client: 'alice',
  alice_joined_before_refresh: joined,
  participants_on_chain: c_pre.participants,
  seats: c_pre.seats,
  status_at_refresh: c_pre.status_label,
  reentered_with_no_manual_action: reentered,
  ms_to_reenter: ms,
  status_after: c_post.status_label,
  dev_state_after: st_after,
  refused_line_present: A.console_all.some(l => /placement resume refused/.test(l)),
  names_visible_after: [...new Set(a_txt.filter(t => /^qa[0-9a-f]{6,}$/i.test(t)))],
  addresses_visible_after: a_txt.filter(t => /0x[0-9a-fA-F]{16,}/.test(t)).slice(0, 5),
})

// ── settle ────────────────────────────────────────────────────────────────────
log('settling')
const forfeit = async s => {
  const btn = s.page.locator('.hud-fightctl__abandon').first()
  if (!(await btn.count())) { log(s.name, 'no forfeit button'); return false }
  await btn.click()
  await sleep(1500)
  const confirm = s.page.locator('.confirm-dialog__btn--danger, .confirm-dialog__btn--confirm').first()
  if (!(await confirm.count())) { log(s.name, 'no confirm'); return false }
  await confirm.click()
  log(s.name, 'forfeit confirmed')
  await sleep(22000)
  return true
}
const ff = {}
for (const s of [A, B]) ff[s.name] = await forfeit(s)
const cleared = await until(async () => {
  globalThis.__fa = await fights_of_character(CHAR_A)
  globalThis.__fb = await fights_of_character(CHAR_B)
  return globalThis.__fa.length === 0 && globalThis.__fb.length === 0
}, { timeout: 180000, interval: 5000, label: 'lists empty' })
for (const s of [A, B]) await s.shot('b4b_30_settled')
ev.bar4_settle = {
  forfeited: ff, cleared,
  alice_after: (globalThis.__fa || []).length, bob_after: (globalThis.__fb || []).length,
  final: (await fight_by_id(FIGHT))?.status ?? 'gone',
}
ev.errors_bar4 = Object.fromEntries([A, B].map(s => [s.name, s.errors.concat(s.console_errors).slice(0, 15)]))
ev.digests_bar4 = { A: await A.digests(), B: await B.digests() }
save()
log('SETTLE:', JSON.stringify(ev.bar4_settle))
await done('complete', 0)
