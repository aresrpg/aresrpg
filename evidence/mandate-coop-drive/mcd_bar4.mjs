// BAR 4 — coop placement refresh: A engages, B joins, ONE client hard-refreshes mid-PLACEMENT
// and must re-enter the placement board with no manual action. Then both settle.
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
const A = await seat(browser, { name: 'A3_alice', key: 'alice' })
const B = await seat(browser, { name: 'B3_bob', key: 'bob' })
const done = async (why, code) => {
  ev.bar4_exit = why
  ev.finished = new Date().toISOString()
  save()
  log('EXIT —', why)
  await browser.close()
  process.exit(code)
}

/** Dismiss any post-fight report modal so world input is live again (CONTINUE is the product's own door). */
const dismiss_report = async s => {
  const btn = s.page.getByRole('button', { name: /^CONTINUE$/i }).first()
  if (await btn.count().catch(() => 0)) {
    await btn.click().catch(() => {})
    log(s.name, 'dismissed fight report (CONTINUE)')
    await sleep(2500)
    return true
  }
  return false
}

log('BOOT')
for (const s of [A, B]) await s.page.goto(`${BASE}/?dev`, { waitUntil: 'domcontentloaded' })
await sleep(32000)
for (const s of [A, B]) {
  await dismiss_report(s)
  log(s.name, await world_name_of(s.page), JSON.stringify(await coords_of(s.page)))
  await focus_world(s.page)
  await calibrate(s)
}

// converge on a pack
const rows = await A.page.evaluate(
  async ([world, zx, zy]) => {
    const m = await import('/src/game/zone_rows.js')
    return JSON.parse(JSON.stringify(await m.zone_rows_v1(world, zx, zy, { fresh: true })))
  }, [WORLD, ...ZONE])
const pa = await coords_of(A.page)
const packs = rows.filter(r => r.kind === 'mob').map(r => ({ ...r, w: to_world(r) }))
  .sort((x, y) => Math.hypot(x.w.x - pa.x, x.w.z - pa.z) - Math.hypot(y.w.x - pa.x, y.w.z - pa.z))
log(`${packs.length} packs; A at ${JSON.stringify(pa)}`)
let pack = null
for (const cand of packs.slice(0, 6)) {
  const d = await walk_to(A, cand.w, { tol: 6, budget_ms: 100000, label: `pack ${cand.spawn_id}` })
  const ok = await until(async () => (await prompts_of(A.page)).some(p => /ATTACK/i.test(p)), { timeout: 8000, interval: 1000, label: 'ATTACK arms' })
  log(`  pack ${cand.spawn_id} d=${Math.round(d)} attack=${ok}`)
  if (ok) { pack = cand; break }
}
if (!pack) { bar(4, 'BLOCKED', { why: 'no pack reachable' }); await done('no pack', 2) }
await walk_to(B, { x: pack.w.x + 16, z: pack.w.z + 16 }, { tol: 14, budget_ms: 140000, label: 'pack(B)' })
log('separation', Math.round(dist(await coords_of(A.page), await coords_of(B.page))))

// A engages
await focus_world(A.page)
await A.page.keyboard.press('KeyR')
const seen = await until(async () => {
  const f = (await fights_of_character(CHAR_A))[0]
  if (!f) return false
  globalThis.__f = f
  return true
}, { timeout: 150000, interval: 1500, label: 'fight on /v1' })
if (!seen) { bar(4, 'BLOCKED', { why: 'no fight after [R]' }); await done('no fight', 2) }
const FIGHT = globalThis.__f.fight_id
ev.fight_id_bar4 = FIGHT
log('FIGHT', FIGHT, globalThis.__f.status)

// B joins FAST — placement is a short window
let joined = false
if (await until(async () => (await prompts_of(B.page)).some(p => /FIGHT/i.test(p)), { timeout: 45000, interval: 2000, label: 'B fights prompt' })) {
  await focus_world(B.page)
  await B.page.keyboard.press('KeyV')
  await sleep(3000)
  const join = B.page.locator('.gw-ft__act--join').first()
  if (await join.count()) { await join.click(); joined = true; log('B clicked JOIN') }
}
const c_pre = await chain_read(null, FIGHT)
log('CHAIN pre-refresh:', JSON.stringify(c_pre))
await A.shot('b4_10_placement_A')
await B.shot('b4_10_placement_B')

// THE REFRESH — B, mid-placement
if (c_pre.status_label !== 'placement') {
  bar(4, 'BLOCKED', { why: `fight was '${c_pre.status_label}' not placement at the refresh beat`, chain: c_pre })
  await done('not in placement', 0)
}
B.console_all.length = 0
const T_R = Date.now()
log('=== HARD REFRESH B mid-placement ===')
await B.page.reload({ waitUntil: 'domcontentloaded' })
const reentered = await until(async () => {
  const st = await dev_state(B.page)
  return !!st && st.me != null && st.my_cell != null
}, { timeout: 90000, interval: 1500, label: 'B re-enters the placement board' })
const ms = Date.now() - T_R
const st_after = await dev_state(B.page)
const c_post = await chain_read(null, FIGHT)
await B.shot('b4_20_after_refresh')
await A.shot('b4_20_peer')
const b_txt = await visible_text(B.page)
bar(4, reentered ? 'PASS' : 'FAIL', {
  fight_id: FIGHT,
  bob_joined_before_refresh: joined,
  participants_on_chain: c_pre.participants,
  status_at_refresh: c_pre.status_label,
  reentered_with_no_manual_action: reentered,
  ms_to_reenter: ms,
  status_after: c_post.status_label,
  dev_state_after: st_after,
  refused_line_present: B.console_all.some(l => /placement resume refused/.test(l)),
  names_visible_after: [...new Set(b_txt.filter(t => /^qa[0-9a-f]{6,}$/i.test(t)))],
  addresses_visible_after: b_txt.filter(t => /0x[0-9a-fA-F]{16,}/.test(t)).slice(0, 5),
})

// settle both
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
for (const s of [A, B]) await s.shot('b4_30_settled')
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
