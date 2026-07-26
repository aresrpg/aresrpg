// PR #966 — settle a leftover fight through the PRODUCT's own FORFEIT door (never a raw chain tx).
// usage: FIGHT=0x… [NAME=SETTLE] node pr966_settle.mjs
import {
  launch, seat, sleep, until, log, ts, BASE,
  fights_of_character, chain_read, dev_state, toasts_of,
} from './pr966_harness.mjs'

const FIGHT = process.env.FIGHT
const NAME = process.env.NAME || 'SETTLE'
const CHAR = '0xe3d99d594f2acab553445e83ad122482ae242fa42df0771a4f5c4e98b33fce7b'
if (!FIGHT) { console.error('FIGHT env required'); process.exit(2) }

const v1 = async () => {
  const f = (await fights_of_character(CHAR)).find(x => x.fight_id === FIGHT)
  return f ? f.status : 'gone'
}
log('PRE /v1:', await v1())

const browser = await launch()
const A = await seat(browser, { name: NAME, key: 'alice' })
await A.page.goto(`${BASE}/?dev`, { waitUntil: 'domcontentloaded' })
log('booting…')
const up = await until(async () => (await dev_state(A.page))?.status != null, {
  timeout: 150000, interval: 1000, label: 'board mounts',
})
log(`board_up=${up}`)
log('DEV_STATE:', JSON.stringify(await dev_state(A.page)))
log('CHAIN:', JSON.stringify(await chain_read(A.page, FIGHT)))
log('shot:', await A.shot('30_boot'))
log('toasts:', JSON.stringify(await toasts_of(A.page)))

const btn = A.page.locator('.hud-fightctl__abandon').first()
if (await btn.count()) {
  await btn.click()
  await sleep(1500)
  await A.shot('31_confirm')
  const confirm = A.page.locator('.confirm-dialog__btn--danger, .confirm-dialog__btn--confirm').first()
  if (await confirm.count()) {
    await confirm.click()
    log('FORFEIT confirmed — waiting for the tx')
    await sleep(25000)
  } else log('NO CONFIRM BUTTON')
} else {
  log('NO FORFEIT BUTTON — visible:', JSON.stringify(
    await A.page.evaluate(() => [...document.querySelectorAll('button')]
      .filter(b => b.getBoundingClientRect().width > 0)
      .map(b => `${(b.innerText || '').trim().slice(0, 24)}|${b.className}`).slice(0, 30))))
}
await A.shot('32_after_forfeit')
await until(async () => (await v1()) === 'gone', { timeout: 150000, interval: 5000, label: 'fight settles' })
log('FINAL /v1:', await v1())
log('FINAL chain:', JSON.stringify(await chain_read(A.page, FIGHT)))
log('digests:', JSON.stringify(await A.digests()))
log('console.errors:', A.console_errors.join(' | ') || '(none)')
log('page errors:', A.errors.join(' | ') || '(none)')
await A.shot('33_final')
await browser.close()
log('done')
