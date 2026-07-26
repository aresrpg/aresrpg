// PR #966 — BAR 3 (expired placement heals on COLD BOOT) + BAR 6 TEARDOWN (forfeit via the product door).
// The fight sat in PLACEMENT with NO client watching while its window expired. A cold boot must heal it:
// ensure_resumable_fight → resume_decision 'force_start' → the door fires → board mounts, fight ACTIVE.
// BAR 4 still binds here: while the seat is live on chain the client may never announce it cleared.
// usage: FIGHT=0x… node pr966_bar3.mjs
import fs from 'node:fs'
import {
  launch, seat, sleep, until, log, ts, BASE, SHOTS,
  fights_of_character, chain_read, dev_state, toasts_of,
  RELEASE_SIGNALS, REFUSAL_SIGNAL, hits,
} from './pr966_harness.mjs'

const FIGHT = process.env.FIGHT
const CHAR = '0xe3d99d594f2acab553445e83ad122482ae242fa42df0771a4f5c4e98b33fce7b'
const ALICE = '0xb4951afe3682d3e9425671f1772e3676bc6ff361ac00896ea131cf52765cd177'
if (!FIGHT) { console.error('FIGHT env required'); process.exit(2) }
const OUT = { fight_id: FIGHT }

const v1 = async () => {
  const f = (await fights_of_character(CHAR)).find(x => x.fight_id === FIGHT)
  return f ? f.status : 'gone'
}

log('PRE-BOOT /v1 status:', await v1(), 'at', ts())

const browser = await launch()
const A = await seat(browser, { name: 'BAR3', key: 'alice' })

const T0 = Date.now()
await A.page.goto(`${BASE}/?dev`, { waitUntil: 'domcontentloaded' })
log('COLD BOOT started (no prior session — the janitor leg)')
const up = await until(async () => (await dev_state(A.page))?.status != null, {
  timeout: 150000, interval: 1000, label: 'board mounts after the janitor heal',
})
const st = await dev_state(A.page)
const cr = await chain_read(A.page, FIGHT)
const tst = await toasts_of(A.page)
OUT.board_up = up
OUT.ms = Date.now() - T0
OUT.dev_state = st
OUT.chain = cr
OUT.v1 = await v1()
OUT.toasts = tst
OUT.refusal_lines = hits(A.console_all, REFUSAL_SIGNAL)
OUT.release_lines = hits(A.console_all, RELEASE_SIGNALS)
OUT.release_toasts = tst.filter(x => RELEASE_SIGNALS.some(r => r.test(x)))
OUT.alice_seat_live = (cr.seat_owners || []).includes(ALICE) && (cr.status === 0 || cr.status === 1)

log(`BAR3 board_up=${up} after ${OUT.ms}ms`)
log('BAR3 DEV_STATE:', JSON.stringify(st))
log('BAR3 CHAIN (0=placement 1=active):', JSON.stringify(cr))
log('BAR3 /v1 status:', OUT.v1)
log('BAR3 shot:', await A.shot('20_after_expiry_boot'))
log('BAR3 TX_TIMINGS:', JSON.stringify(await A.page.evaluate(() => window.__TX_TIMINGS ?? null)))
log('BAR3 REFUSAL lines:', JSON.stringify(OUT.refusal_lines))
log('BAR3 RELEASE lines (bar4):', JSON.stringify(OUT.release_lines))
log('BAR3 RELEASE toasts (bar4):', JSON.stringify(OUT.release_toasts))
log('BAR3 relevant console:')
for (const l of A.console_all) if (/world-fight|resume|liquidat|force_start|placement|dungeon fight/i.test(l)) log('   ', l)
log('BAR3 console errors:')
for (const l of A.console_errors) log('   ', l)

// ── BAR 6 · TEARDOWN — forfeit through the product's own door ────────────────
log('=== TEARDOWN — FORFEIT (product flow) ===')
const btn = A.page.locator('.hud-fightctl__abandon').first()
if (await btn.count()) {
  await btn.click()
  await sleep(1500)
  await A.shot('21_forfeit_confirm')
  const confirm = A.page.locator('.confirm-dialog__btn--danger, .confirm-dialog__btn--confirm').first()
  if (await confirm.count()) {
    await confirm.click()
    log('forfeit confirmed — waiting for the tx')
    await sleep(22000)
    OUT.forfeit = 'confirmed'
  } else { log('NO CONFIRM BUTTON'); OUT.forfeit = 'no_confirm' }
} else {
  log('NO FORFEIT BUTTON — visible buttons:', JSON.stringify(
    await A.page.evaluate(() => [...document.querySelectorAll('button')]
      .filter(b => b.getBoundingClientRect().width > 0)
      .map(b => `${(b.innerText || '').trim().slice(0, 24)}|${b.className}`).slice(0, 30))))
  OUT.forfeit = 'no_button'
}
await A.shot('22_after_forfeit')
await until(async () => (await v1()) === 'gone', { timeout: 150000, interval: 5000, label: 'fight settles' })
OUT.v1_final = await v1()
OUT.chain_final = await chain_read(A.page, FIGHT)
OUT.digests = await A.digests()
log('FINAL /v1 status:', OUT.v1_final)
log('FINAL chain:', JSON.stringify(OUT.chain_final))
log('digests:', JSON.stringify(OUT.digests))
log('page errors:', A.errors.join(' | ') || '(none)')
log('console.errors:', A.console_errors.join(' | ') || '(none)')
OUT.all_page_errors = A.errors
OUT.all_console_errors = A.console_errors
fs.writeFileSync(`${SHOTS}/../pr966_bar3.json`, JSON.stringify(OUT, null, 2))
await browser.close()
log('done')
