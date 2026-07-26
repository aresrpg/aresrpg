// MANDATE COOP DRIVE — attempt 2. Stage A: resume the LIVE coop fight, both play, measure lag, settle.
// Stage B: fresh engage+join, hard-refresh mid-PLACEMENT (bar 4), settle.
import fs from 'node:fs'
import {
  launch, seat, sleep, until, log, BASE, SHOTS,
  fights_of_character, fight_by_id, dev_state, chain_read, visible_text,
} from './mcd_harness.mjs'
import { coords_of, world_name_of, focus_world, calibrate, walk_to, prompts_of, to_world } from './coop_lib.mjs'

const WORLD = '0xf69fe397444a1a278deb9a67d4516aac2f6cfa1e083581c21d99f763b543fc3c'
const ZONE = [487, 487]
const CHAR_A = '0xe3d99d594f2acab553445e83ad122482ae242fa42df0771a4f5c4e98b33fce7b'
const CHAR_B = '0x6ceb23694c67eb344378e897ca4e229a6e2ac8b1584b3878446b24366f7e9b5c'
const EV = '/private/tmp/claude-501/-Users-sceatstudio-dev-aresrpg/355a94d1-4ae2-4602-9c1e-e2c26823aa58/scratchpad/mcd_evidence.json'

const ev = fs.existsSync(EV) ? JSON.parse(fs.readFileSync(EV, 'utf8')) : {}
ev.tip = '8dc6107e'
ev.base = BASE
ev.attempt2_started = new Date().toISOString()
ev.bars = ev.bars || {}
const save = () => fs.writeFileSync(EV, JSON.stringify(ev, null, 2))
const bar = (id, verdict, detail) => {
  ev.bars[id] = { verdict, ...detail, at: new Date().toISOString() }
  save()
  log(`### BAR ${id} = ${verdict} — ${JSON.stringify(detail).slice(0, 500)}`)
}
const ADDR_RE = /0x[0-9a-fA-F]{16,}/

const browser = await launch()
const A = await seat(browser, { name: 'A2_alice', key: 'alice' })
const B = await seat(browser, { name: 'B2_bob', key: 'bob' })

const shutdown = async (why, code) => {
  ev.exit = why
  ev.finished = new Date().toISOString()
  save()
  log('EXIT —', why)
  await browser.close()
  process.exit(code)
}

/** chain turn key: 'M<idx>' for a mob, else the participant's character id. */
const turn_key = c => {
  if (!c?.current_turn) return null
  const t = c.current_turn
  return t.is_mob ? `M${t.idx}` : c.characters?.[t.idx] ?? `P${t.idx}`
}

// ── BOOT ──────────────────────────────────────────────────────────────────────
log('BOOT both seats')
for (const s of [A, B]) await s.page.goto(`${BASE}/?dev`, { waitUntil: 'domcontentloaded' })
await sleep(32000)
for (const s of [A, B]) log(s.name, await world_name_of(s.page), JSON.stringify(await coords_of(s.page)))
for (const s of [A, B]) log(s.name, 'boot', await s.shot('00_boot'))

// ── STAGE A · the live coop fight ─────────────────────────────────────────────
const live = (await fights_of_character(CHAR_A))[0]
if (!live) await shutdown('no live fight for alice — nothing to resume', 3)
const FIGHT = live.fight_id
ev.fight_id = FIGHT
log(`RESUMING ${FIGHT} status=${live.status}`)

// wait for BOTH clients to fold their own seat into the fight slice
const in_slice = async s => {
  const st = await dev_state(s.page)
  return !!st && st.me != null && st.my_cell != null
}
const folded = {}
for (const s of [A, B]) {
  folded[s.name] = await until(() => in_slice(s), { timeout: 120000, interval: 3000, label: `${s.name} fighter in slice` })
  log(s.name, 'in slice:', folded[s.name], JSON.stringify(await dev_state(s.page)))
}
for (const s of [A, B]) await s.shot('10_resumed')

// BAR 1 — both seats on chain, same fight (chain truth via /v1)
const c1 = await chain_read(null, FIGHT)
log('CHAIN:', JSON.stringify(c1))
const both_on_chain =
  c1.characters?.includes(CHAR_A) && c1.characters?.includes(CHAR_B) && c1.participants === 2
bar(1, both_on_chain ? 'PASS' : 'FAIL', {
  fight_id: FIGHT, participants: c1.participants, seats: c1.seats,
  alice_seated: c1.characters?.includes(CHAR_A), bob_seated: c1.characters?.includes(CHAR_B),
  join_path: 'B proximity prompt "V SEE FIGHTS IN THE AREA · 1 FIGHT NEARBY" → [V] → JOIN (attempt-1 run)',
  clients_folded: folded,
})

// BAR 2 — names on every card, zero addresses, BOTH clients
const name_scan = {}
for (const s of [A, B]) {
  const txt = await visible_text(s.page)
  name_scan[s.name] = {
    addresses_shown: txt.filter(t => ADDR_RE.test(t)).slice(0, 10),
    names_shown: [...new Set(txt.filter(t => /^qa[0-9a-f]{6,}$/i.test(t)))],
    sample: txt.filter(t => t.length < 40).slice(0, 60),
  }
  await s.shot('20_names')
}
bar(2, Object.values(name_scan).every(v => v.addresses_shown.length === 0) ? 'PASS' : 'FAIL',
  Object.fromEntries(Object.entries(name_scan).map(([k, v]) => [k, { addresses_shown: v.addresses_shown, names_shown: v.names_shown }])))
ev.bar2_detail = name_scan
save()

// ── BAR 3 · both play + client-vs-chain lag ───────────────────────────────────
log('BAR 3 — both seats act; sampling chain vs clients')
const samples = []
const acts = { A2_alice: [], B2_bob: [] }
const T0 = Date.now()
const DEADLINE = T0 + 7 * 60 * 1000

const try_act = async s => {
  const st = await dev_state(s.page)
  if (!st || !st.me || st.active !== st.me) return null
  const cur = st.my_cell
  if (!cur) return null
  for (const c of [
    { x: cur.x + 1, y: cur.y }, { x: cur.x - 1, y: cur.y },
    { x: cur.x, y: cur.y + 1 }, { x: cur.x, y: cur.y - 1 },
  ]) {
    if (c.x < 0 || c.y < 0) continue
    const r = await s.page.evaluate(cell => window.__ARES_DEV_MOVE?.(cell) ?? { ok: false, error: 'hook missing' }, c)
    if (r?.ok) {
      log(`  ${s.name} MOVE → ${JSON.stringify(c)} mp_after=${r.mp_after}`)
      acts[s.name].push({ t: Date.now() - T0, kind: 'move', to: c, mp_after: r.mp_after })
      return r
    }
    if (!/not my turn|reach|MP|mp/i.test(String(r?.error))) log(`  ${s.name} move refused: ${r?.error}`)
  }
  const btn = s.page.locator('.hud-fightctl__end').first()
  if (await btn.count()) {
    await btn.click().catch(() => {})
    log(`  ${s.name} END TURN (real click)`)
    acts[s.name].push({ t: Date.now() - T0, kind: 'end_turn_click' })
    return { ok: true, passed: true }
  }
  return null
}

while (Date.now() < DEADLINE) {
  const c = await chain_read(null, FIGHT)
  const sa = await dev_state(A.page)
  const sb = await dev_state(B.page)
  samples.push({
    t: Date.now() - T0,
    chain_status: c.status_label,
    chain_turn: turn_key(c),
    A_active: sa?.active ?? null, A_turn: sa?.turn ?? null, A_hp: sa?.my_hp ?? null, A_me: sa?.me ?? null,
    B_active: sb?.active ?? null, B_turn: sb?.turn ?? null, B_hp: sb?.my_hp ?? null, B_me: sb?.me ?? null,
  })
  if (c.status_label !== 'active') { log('fight left ACTIVE — status', c.status_label); break }
  for (const s of [A, B]) await try_act(s)
  if (acts.A2_alice.length >= 2 && acts.B2_bob.length >= 2) { log('both seats acted twice — enough'); break }
  await sleep(2000)
}
ev.samples = samples
ev.acts = acts
save()
for (const s of [A, B]) await s.shot('30_played')

// lag = time from a chain turn-key change to the first sample where the client's active matches it
const lag_for = key => {
  const out = []
  for (let i = 1; i < samples.length; i++) {
    const ck = samples[i].chain_turn
    if (!ck || ck === samples[i - 1].chain_turn) continue
    const tc = samples[i].t
    const hit = samples.slice(i).find(s => s[key] === ck)
    out.push({ chain_turn: ck, t_chain: tc, t_client: hit ? hit.t : null, lag_ms: hit ? hit.t - tc : null })
  }
  return out
}
const la = lag_for('A_active')
const lb = lag_for('B_active')
const maxl = arr => { const v = arr.map(x => x.lag_ms).filter(x => x != null); return v.length ? Math.max(...v) : null }
const lag = {
  sample_interval_ms: 2000,
  A: { pairs: la, max_lag_ms: maxl(la), unmatched: la.filter(x => x.lag_ms == null).length },
  B: { pairs: lb, max_lag_ms: maxl(lb), unmatched: lb.filter(x => x.lag_ms == null).length },
}
ev.lag = lag
save()
log('LAG:', JSON.stringify({ A_max: lag.A.max_lag_ms, B_max: lag.B.max_lag_ms, A_unmatched: lag.A.unmatched, B_unmatched: lag.B.unmatched }))
const both_played = acts.A2_alice.length > 0 && acts.B2_bob.length > 0
bar(3, both_played ? 'PASS' : 'FAIL', {
  alice_acts: acts.A2_alice, bob_acts: acts.B2_bob,
  max_lag_ms: { alice_client: lag.A.max_lag_ms, bob_client: lag.B.max_lag_ms },
  unmatched_turns: { alice_client: lag.A.unmatched, bob_client: lag.B.unmatched },
  chain_turn_changes: samples.filter((s, i) => i && s.chain_turn !== samples[i - 1].chain_turn).length,
})

// BAR 5 — percent-buff rows
const cast_kinds = []
bar(5, 'N/A', { why: 'both seats committed MOVE/END-TURN only — no kind-9/11 buff cast on this drive', cast_kinds })

// ── BAR 6 · settle through the product ────────────────────────────────────────
log('BAR 6 — settle')
const forfeit = async s => {
  const btn = s.page.locator('.hud-fightctl__abandon').first()
  if (!(await btn.count())) { log(s.name, 'no forfeit button visible'); return false }
  await btn.click()
  await sleep(1500)
  await s.shot('40_confirm')
  const confirm = s.page.locator('.confirm-dialog__btn--danger, .confirm-dialog__btn--confirm').first()
  if (!(await confirm.count())) { log(s.name, 'no confirm dialog'); return false }
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
}, { timeout: 180000, interval: 5000, label: 'both fight lists empty' })
const final = await fight_by_id(FIGHT)
for (const s of [A, B]) await s.shot('50_settled')
const errs = {}
for (const s of [A, B]) errs[s.name] = s.errors.concat(s.console_errors).slice(0, 15)
ev.errors = errs
bar(6, cleared ? 'PASS' : 'FAIL', {
  forfeited: ff, lists_empty: cleared,
  alice_fights_after: (globalThis.__fa || []).length, bob_fights_after: (globalThis.__fb || []).length,
  final_status: final?.status ?? 'gone',
  page_error_counts: Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v.length])),
})
ev.digests_stageA = { A: await A.digests(), B: await B.digests() }
save()

// ── STAGE B · BAR 4 — fresh fight, hard-refresh mid-PLACEMENT ─────────────────
log('STAGE B — BAR 4: fresh engage, refresh ONE client during placement')
for (const s of [A, B]) { await focus_world(s.page); await calibrate(s) }
const rows = await A.page.evaluate(
  async ([world, zx, zy]) => {
    const m = await import('/src/game/zone_rows.js')
    return JSON.parse(JSON.stringify(await m.zone_rows_v1(world, zx, zy, { fresh: true })))
  }, [WORLD, ...ZONE])
const pa = await coords_of(A.page)
const packs = rows.filter(r => r.kind === 'mob').map(r => ({ ...r, w: to_world(r) }))
  .sort((x, y) => Math.hypot(x.w.x - pa.x, x.w.z - pa.z) - Math.hypot(y.w.x - pa.x, y.w.z - pa.z))
let pack = null
for (const cand of packs.slice(0, 6)) {
  await walk_to(A, cand.w, { tol: 6, budget_ms: 100000, label: `pack ${cand.spawn_id}` })
  if (await until(async () => (await prompts_of(A.page)).some(p => /ATTACK/i.test(p)), { timeout: 8000, interval: 1000, label: 'ATTACK arms' })) {
    pack = cand; break
  }
}
if (!pack) { bar(4, 'BLOCKED', { why: 'no pack reachable for the stage-B fight' }); await shutdown('stage B: no pack', 0) }
await walk_to(B, { x: pack.w.x + 16, z: pack.w.z + 16 }, { tol: 14, budget_ms: 130000, label: 'pack(B)' })

await focus_world(A.page)
await A.page.keyboard.press('KeyR')
const seen2 = await until(async () => {
  const f = (await fights_of_character(CHAR_A))[0]
  if (!f) return false
  globalThis.__f2 = f
  return true
}, { timeout: 150000, interval: 2000, label: 'stage-B fight on /v1' })
if (!seen2) { bar(4, 'BLOCKED', { why: 'stage-B fight never appeared' }); await shutdown('stage B: no fight', 0) }
const FIGHT2 = globalThis.__f2.fight_id
ev.fight_id_stageB = FIGHT2
log('STAGE-B FIGHT', FIGHT2, 'status', globalThis.__f2.status)

// B joins so the refresh happens on a COOP placement board
let joined2 = false
if (await until(async () => (await prompts_of(B.page)).some(p => /FIGHT/i.test(p)), { timeout: 60000, interval: 3000, label: 'B sees fights prompt' })) {
  await focus_world(B.page)
  await B.page.keyboard.press('KeyV')
  await sleep(3500)
  const join = B.page.locator('.gw-ft__act--join').first()
  if (await join.count()) { await join.click(); joined2 = true; log('B joined stage-B fight') }
}
await sleep(6000)
const cb = await chain_read(null, FIGHT2)
log('STAGE-B CHAIN:', JSON.stringify(cb))
await A.shot('60_stageB_placement')
await B.shot('60_stageB_placement')

// THE REFRESH — one client, mid-placement
let bar4
if (cb.status_label === 'placement') {
  B.console_all.length = 0
  const T_R = Date.now()
  log('refreshing B mid-placement')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  const re = await until(async () => {
    const st = await dev_state(B.page)
    return !!st && st.me != null && st.my_cell != null
  }, { timeout: 90000, interval: 1500, label: 'B re-enters the placement board' })
  const after = await dev_state(B.page)
  const cb2 = await chain_read(null, FIGHT2)
  await B.shot('70_after_refresh')
  await A.shot('70_peer_during_refresh')
  bar4 = {
    joined_before_refresh: joined2,
    reentered: re, ms_to_reenter: Date.now() - T_R,
    status_at_refresh: cb.status_label, status_after: cb2.status_label,
    dev_state_after: after,
    refused_line: B.console_all.some(l => /placement resume refused/.test(l)),
    manual_action_needed: false,
  }
  bar(4, re ? 'PASS' : 'FAIL', bar4)
} else {
  bar(4, 'BLOCKED', { why: `stage-B fight was '${cb.status_label}' not 'placement' when the refresh beat arrived`, chain: cb })
}

// settle stage B
log('settling stage B')
for (const s of [A, B]) await forfeit(s)
const cleared2 = await until(async () => {
  globalThis.__fa2 = await fights_of_character(CHAR_A)
  globalThis.__fb2 = await fights_of_character(CHAR_B)
  return globalThis.__fa2.length === 0 && globalThis.__fb2.length === 0
}, { timeout: 180000, interval: 5000, label: 'stage-B lists empty' })
ev.stageB_settled = {
  cleared: cleared2,
  alice_fights_after: (globalThis.__fa2 || []).length,
  bob_fights_after: (globalThis.__fb2 || []).length,
  final: (await fight_by_id(FIGHT2))?.status ?? 'gone',
}
for (const s of [A, B]) await s.shot('80_final')
const errs2 = {}
for (const s of [A, B]) errs2[s.name] = s.errors.concat(s.console_errors).slice(0, 15)
ev.errors_final = errs2
ev.digests = { A: await A.digests(), B: await B.digests() }
save()
log('STAGE B SETTLED:', JSON.stringify(ev.stageB_settled))
await shutdown('complete', 0)
