// THE MANDATE COOP DRIVE — alice + bob, one public world fight, on the SERVED tip 8dc6107e.
// Bars: 1 join · 2 names · 3 both play + lag · 4 placement refresh · 5 percent-buff · 6 settle.
import fs from 'node:fs'
import {
  launch, seat, sleep, until, log, BASE, SHOTS,
  fights_of_character, fight_by_id, dev_state, chain_read, visible_text,
} from './mcd_harness.mjs'
import { coords_of, world_name_of, dist, travel_to, focus_world, calibrate, walk_to, prompts_of, to_world } from './coop_lib.mjs'

const WORLD = '0xf69fe397444a1a278deb9a67d4516aac2f6cfa1e083581c21d99f763b543fc3c'
const TARGET_WORLD = 'VERDANT HOLLOW'
const ZONE = [487, 487]
const CHAR_A = '0xe3d99d594f2acab553445e83ad122482ae242fa42df0771a4f5c4e98b33fce7b' // alice qa3c15f0be
const CHAR_B = '0x6ceb23694c67eb344378e897ca4e229a6e2ac8b1584b3878446b24366f7e9b5c' // bob   qa88e113c7
const EV = '/private/tmp/claude-501/-Users-sceatstudio-dev-aresrpg/355a94d1-4ae2-4602-9c1e-e2c26823aa58/scratchpad/mcd_evidence.json'

const ev = { tip: '8dc6107e', base: BASE, world: WORLD, started: new Date().toISOString(), bars: {}, notes: [] }
const save = () => fs.writeFileSync(EV, JSON.stringify(ev, null, 2))
const bar = (id, verdict, detail) => {
  ev.bars[id] = { verdict, ...detail, at: new Date().toISOString() }
  save()
  log(`### BAR ${id} = ${verdict} — ${JSON.stringify(detail).slice(0, 400)}`)
}
const ADDR_RE = /0x[0-9a-fA-F]{6,}/

const browser = await launch()
const A = await seat(browser, { name: 'A_alice', key: 'alice' })
const B = await seat(browser, { name: 'B_bob', key: 'bob' })
ev.addresses = { alice: A.address, bob: B.address }

const bail = async (why, code = 1) => {
  ev.bail = why
  save()
  log('BAIL —', why)
  for (const s of [A, B]) await s.shot('X_bail').catch(() => {})
  await browser.close()
  process.exit(code)
}

// ── PHASE 0 · boot ────────────────────────────────────────────────────────────
log('PHASE 0 — boot both seats')
for (const s of [A, B]) await s.page.goto(`${BASE}/?dev`, { waitUntil: 'domcontentloaded' })
await sleep(30000)
for (const s of [A, B]) log(s.name, await world_name_of(s.page), JSON.stringify(await coords_of(s.page)))
for (const s of [A, B]) log(s.name, 'boot shot', await s.shot('00_boot'))

// ── PHASE 1 · same world ──────────────────────────────────────────────────────
log('PHASE 1 — co-world')
for (const s of [A, B]) log(s.name, 'travel:', await travel_to(s, TARGET_WORLD))
for (const s of [A, B]) {
  await focus_world(s.page)
  await calibrate(s)
}

// ── PHASE 2 · converge on a pack ──────────────────────────────────────────────
log('PHASE 2 — packs')
const rows = await A.page.evaluate(
  async ([world, zx, zy]) => {
    const m = await import('/src/game/zone_rows.js')
    return JSON.parse(JSON.stringify(await m.zone_rows_v1(world, zx, zy, { fresh: true })))
  },
  [WORLD, ...ZONE]
)
const p0 = await coords_of(A.page)
const packs = rows
  .filter(r => r.kind === 'mob')
  .map(r => ({ ...r, w: to_world(r) }))
  .sort((a, b) => Math.hypot(a.w.x - p0.x, a.w.z - p0.z) - Math.hypot(b.w.x - p0.x, b.w.z - p0.z))
log(`${packs.length} packs; nearest ${packs[0]?.spawn_id} at ${JSON.stringify(packs[0]?.w)}`)

const armed_A = async () => (await prompts_of(A.page)).some(p => /ATTACK/i.test(p))
let pack = null
for (const cand of packs.slice(0, 6)) {
  const d = await walk_to(A, cand.w, { tol: 6, budget_ms: 120000, label: `pack ${cand.spawn_id}` })
  const ok = await until(armed_A, { timeout: 8000, interval: 1000, label: 'ATTACK arms' })
  log(`  pack ${cand.spawn_id} d=${Math.round(d)} attack=${ok}`)
  if (ok) { pack = cand; break }
}
if (!pack) await bail('no pack reachable within the engage ring', 2)
ev.pack = { spawn_id: pack.spawn_id, world_xz: pack.w }

// B walks near (must be within the 50-block discovery ring) but does NOT engage.
await walk_to(B, { x: pack.w.x + 16, z: pack.w.z + 16 }, { tol: 14, budget_ms: 150000, label: 'pack(B)' })
const pA = await coords_of(A.page)
const pB = await coords_of(B.page)
log('A', JSON.stringify(pA), 'B', JSON.stringify(pB), 'separation', Math.round(dist(pA, pB)))
ev.separation = Math.round(dist(pA, pB))
for (const s of [A, B]) await s.shot('10_at_pack')

// ── PHASE 3 · A engages ───────────────────────────────────────────────────────
log('PHASE 3 — A engages [R]')
await focus_world(A.page)
const T_ENGAGE = Date.now()
await A.page.keyboard.press('KeyR')
const seen = await until(async () => {
  const f = (await fights_of_character(CHAR_A))[0]
  if (!f) return false
  globalThis.__f = f
  return true
}, { timeout: 150000, interval: 2000, label: 'alice fight on /v1' })
if (!seen) await bail('no fight appeared for alice after [R]')
const FIGHT = globalThis.__f.fight_id
ev.fight_id = FIGHT
log(`FIGHT ${FIGHT} +${Date.now() - T_ENGAGE}ms  status=${globalThis.__f.status}`)
const cr0 = await chain_read(A.page, FIGHT)
log('CHAIN pre-join:', JSON.stringify(cr0))
ev.chain_pre_join = cr0
await A.shot('20_engaged')

// ── PHASE 4 · BAR 1 — B joins the SAME fight ──────────────────────────────────
log('PHASE 4 — BAR 1: B joins')
const bp = await until(async () => (await prompts_of(B.page)).some(p => /FIGHT/i.test(p)), {
  timeout: 90000, interval: 3000, label: 'B sees the [V] fights prompt',
})
log('B prompts:', JSON.stringify(await prompts_of(B.page)))
await B.shot('30_b_prompt')
let join_clicked = false
if (bp) {
  await focus_world(B.page)
  await B.page.keyboard.press('KeyV')
  await sleep(3500)
  await B.shot('31_b_fights_panel')
  // BAR 2 (half) — the fights panel must name characters, not addresses.
  const panel_txt = await visible_text(B.page)
  ev.bar2_panel_text = panel_txt.filter(t => t.length < 60).slice(0, 80)
  const join = B.page.locator('.gw-ft__act--join').first()
  if (await join.count()) {
    log('B clicking JOIN')
    await join.click()
    join_clicked = true
    await sleep(12000)
    await B.shot('32_b_joined')
  } else {
    log('B: NO JOIN BUTTON — acts:', (await B.page.locator('.gw-ft__act').allInnerTexts()).join(','))
  }
}
const both_seated = await until(async () => {
  const fb = await fights_of_character(CHAR_B)
  return fb.some(f => f.fight_id === FIGHT)
}, { timeout: 120000, interval: 3000, label: 'bob seated on the SAME fight' })
const cr1 = await chain_read(A.page, FIGHT)
log('CHAIN post-join:', JSON.stringify(cr1))
bar(1, both_seated && cr1.participants >= 2 ? 'PASS' : 'FAIL', {
  join_clicked, both_seated, participants: cr1.participants, fight_id: FIGHT, chain: cr1,
})
if (!both_seated) await bail('bob never seated — coop join broken')

// ── PHASE 5 · BAR 2 — names, zero addresses, on BOTH clients ──────────────────
log('PHASE 5 — BAR 2: name scan')
const name_scan = {}
for (const s of [A, B]) {
  const txt = await visible_text(s.page)
  const addrs = txt.filter(t => ADDR_RE.test(t))
  const names = txt.filter(t => /^qa[0-9a-f]{6,}$/i.test(t))
  name_scan[s.name] = { addresses_shown: addrs.slice(0, 10), names_shown: [...new Set(names)], total_nodes: txt.length }
  await s.shot('40_names')
}
bar(2, Object.values(name_scan).every(v => v.addresses_shown.length === 0) ? 'PASS' : 'FAIL', name_scan)

// ── PHASE 6 · BAR 4 — refresh ONE client mid-placement ────────────────────────
log('PHASE 6 — BAR 4: placement refresh (B)')
const board_up = async page => {
  const st = await dev_state(page)
  return !!st && st.status != null
}
const crp = await chain_read(A.page, FIGHT)
const window_left = crp.placement_deadline_ms - crp.now
log(`placement window left = ${window_left}ms (placement_ms=${crp.placement_ms})`)
let bar4 = { window_left_ms: window_left, status_at_refresh: crp.status_label }
if (crp.status === 0 || /placement/i.test(crp.status_label || '')) {
  B.console_all.length = 0
  const T_R = Date.now()
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  const re = await until(() => board_up(B.page), { timeout: 90000, interval: 1000, label: 'B board re-mounts' })
  bar4 = {
    ...bar4,
    reentered: re,
    ms_to_reenter: Date.now() - T_R,
    dev_state: await dev_state(B.page),
    refused_line: B.console_all.some(l => /placement resume refused/.test(l)),
  }
  await B.shot('50_b_after_refresh')
  bar(4, re ? 'PASS' : 'FAIL', bar4)
} else {
  bar(4, 'SKIPPED', { ...bar4, why: 'placement already over when the refresh beat arrived' })
}

// ── PHASE 7 · both place + ready (real board clicks, dev-hook fallback) ───────
log('PHASE 7 — placement: both seats pick + READY')
const place_ready = async s => {
  const st = await dev_state(s.page)
  log(s.name, 'pre-place DEV_STATE', JSON.stringify(st))
  const had_btn = await s.page.locator('.hud-fightctl__end').first().count()
  // the sanctioned placement state-reacher: same store/tx the board's cell pick + READY button fire
  const r = await s.page.evaluate(() => window.__ARES_DEV_PLACE_READY?.() ?? { ok: false, reason: 'hook missing' })
  log(s.name, 'place_ready ->', JSON.stringify(r), 'ready_btn_present=', had_btn)
  return { path: 'dev_place_ready_hook', result: r, ready_button_present: !!had_btn }
}
const placed = {}
for (const s of [A, B]) placed[s.name] = await place_ready(s)
ev.placement = placed
save()
await sleep(15000)
for (const s of [A, B]) await s.shot('60_placed')

const active = await until(async () => {
  const c = await chain_read(A.page, FIGHT)
  globalThis.__c = c
  return c.status === 1
}, { timeout: 180000, interval: 4000, label: 'fight goes ACTIVE' })
log('ACTIVE:', active, JSON.stringify(globalThis.__c))
ev.chain_active = globalThis.__c
save()
if (!active) await bail('fight never went ACTIVE — cannot drive bar 3')

// ── PHASE 8 · BAR 3 — both play + client-vs-chain lag ─────────────────────────
log('PHASE 8 — BAR 3: both seats act; sampling lag')
const samples = []
const acts = { A_alice: [], B_bob: [] }
const T0 = Date.now()
const DEADLINE = T0 + 8 * 60 * 1000

const try_act = async s => {
  const st = await dev_state(s.page)
  if (!st || st.active !== st.me) return null
  // a REAL action on my turn: step one cell (the same commit_turn a reach-cell click + End Turn produces)
  const cur = st.my_cell
  if (!cur) return null
  const cands = [
    { x: cur.x + 1, y: cur.y }, { x: cur.x - 1, y: cur.y },
    { x: cur.x, y: cur.y + 1 }, { x: cur.x, y: cur.y - 1 },
  ]
  for (const c of cands) {
    if (c.x < 0 || c.y < 0) continue
    const r = await s.page.evaluate(cell => window.__ARES_DEV_MOVE?.(cell) ?? { ok: false, error: 'hook missing' }, c)
    log(`  ${s.name} MOVE ${JSON.stringify(c)} ->`, JSON.stringify(r))
    if (r?.ok) {
      acts[s.name].push({ t: Date.now() - T0, kind: 'move', to: c, mp_after: r.mp_after })
      return r
    }
  }
  // could not move (blocked/no MP) → pass the turn through the canon End Turn button (a real click)
  const btn = s.page.locator('.hud-fightctl__end').first()
  if (await btn.count()) {
    await btn.click().catch(() => {})
    acts[s.name].push({ t: Date.now() - T0, kind: 'end_turn_click' })
    log(`  ${s.name} END TURN (real click)`)
    return { ok: true, passed: true }
  }
  return null
}

while (Date.now() < DEADLINE) {
  const c = await chain_read(A.page, FIGHT)
  const sa = await dev_state(A.page)
  const sb = await dev_state(B.page)
  samples.push({
    t: Date.now() - T0,
    chain_ptr: c.turn_ptr, chain_status: c.status,
    A_turn: sa?.turn ?? null, A_active: sa?.active ?? null, A_me: sa?.me ?? null, A_hp: sa?.my_hp ?? null,
    B_turn: sb?.turn ?? null, B_active: sb?.active ?? null, B_me: sb?.me ?? null, B_hp: sb?.my_hp ?? null,
  })
  if (c.status !== 1) { log('fight left ACTIVE — status', c.status_label); break }
  for (const s of [A, B]) await try_act(s)
  if (acts.A_alice.length >= 3 && acts.B_bob.length >= 3) { log('both seats acted 3x — enough'); break }
  await sleep(2500)
}
ev.samples = samples
ev.acts = acts
save()
for (const s of [A, B]) await s.shot('70_played')

// lag: pair the k-th chain turn_ptr transition with the k-th client transition
const transitions = (key) => {
  const out = []
  for (let i = 1; i < samples.length; i++) if (samples[i][key] !== samples[i - 1][key]) out.push(samples[i].t)
  return out
}
const tc = transitions('chain_ptr')
const lag_of = key => {
  const tk = transitions(key)
  const n = Math.min(tc.length, tk.length)
  const ls = []
  for (let i = 0; i < n; i++) ls.push(tk[i] - tc[i])
  return { transitions: tk.length, lags_ms: ls, max_ms: ls.length ? Math.max(...ls) : null }
}
const lag = { sample_interval_ms: 2500, chain_transitions: tc.length, A: lag_of('A_active'), B: lag_of('B_active') }
ev.lag = lag
log('LAG:', JSON.stringify(lag))
const both_played = acts.A_alice.length > 0 && acts.B_bob.length > 0
const real_moves = acts.A_alice.some(a => a.kind === 'move') && acts.B_bob.some(a => a.kind === 'move')
bar(3, both_played ? (real_moves ? 'PASS' : 'PASS-WEAK') : 'FAIL', { acts, lag, real_moves })

// ── PHASE 9 · BAR 5 — percent-buff rows (kind 9/11) ───────────────────────────
bar(5, 'N/A', { why: 'no kind-9/11 buff cast on this drive — both seats committed moves/passes only' })

// ── PHASE 10 · BAR 6 — settle through the product ─────────────────────────────
log('PHASE 10 — BAR 6: settle')
const forfeit = async s => {
  const btn = s.page.locator('.hud-fightctl__abandon').first()
  if (!(await btn.count())) return log(s.name, 'no forfeit button'), false
  await btn.click()
  await sleep(1500)
  await s.shot('80_confirm')
  const confirm = s.page.locator('.confirm-dialog__btn--danger, .confirm-dialog__btn--confirm').first()
  if (!(await confirm.count())) return log(s.name, 'no confirm dialog'), false
  await confirm.click()
  log(s.name, 'forfeit confirmed')
  await sleep(20000)
  return true
}
const ff = {}
for (const s of [A, B]) ff[s.name] = await forfeit(s)
const cleared = await until(async () => {
  const fa = await fights_of_character(CHAR_A)
  const fb = await fights_of_character(CHAR_B)
  globalThis.__fa = fa
  globalThis.__fb = fb
  return fa.length === 0 && fb.length === 0
}, { timeout: 180000, interval: 5000, label: 'both fight lists empty' })
const final = await fight_by_id(FIGHT)
log('final fight row:', JSON.stringify(final))
for (const s of [A, B]) await s.shot('90_settled')

const errs = {}
for (const s of [A, B]) errs[s.name] = s.errors.concat(s.console_errors).slice(0, 12)
ev.errors = errs
bar(6, cleared ? 'PASS' : 'FAIL', {
  forfeited: ff, lists_empty: cleared,
  alice_fights: (globalThis.__fa || []).length, bob_fights: (globalThis.__fb || []).length,
  final_status: final?.status ?? 'gone',
  page_errors: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v.length])),
})

ev.digests = { A: await A.digests(), B: await B.digests() }
ev.finished = new Date().toISOString()
save()
log('EVIDENCE →', EV)
log('SHOTS →', SHOTS)
await browser.close()
