// Driven capture for the fight-HUD seats lane (#948 / #929 / #951 / #950).
// Seeds the simulator's own IndexedDB (two seated characters + one mob), presses the real START button,
// and plays BOTH seats through the production HUD.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:5320'
const OUT =
  process.env.SHOT_DIR ?? '/tmp/claude-501/-Users-sceatstudio-dev-aresrpg/355a94d1-4ae2-4602-9c1e-e2c26823aa58/scratchpad/seatshots'
mkdirSync(OUT, { recursive: true })
const HEADED = process.env.HEADED === '1'

const character = (id, name, male) => ({
  id,
  name,
  class_id: 'senshi',
  male,
  level: 20,
  stat_alloc: { vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 },
  spell_levels: {},
  loadout: {},
})

const ROSTER = [character('sim_c1', 'Kaelen', true), character('sim_c2', 'Mireth', false)]
const SETUP = {
  seed: 0,
  focus_id: 'sim_c1',
  anchor_nonce: 0,
  placements: { 2: 'sim_c1', 4: 'sim_c2' },
  mob_picks: { 204: { template_id: 'wooling', level: 8 } },
}

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 15000, animations: 'disabled', caret: 'hide' }).catch((e) => console.log('SHOT FAILED', name, e.message))
  console.log('SHOT', name)
}

const hud_state = (page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll('.hud-turn')].map((el) => ({
      name: el.querySelector('.hud-turn__name')?.textContent ?? '',
      lvl: el.querySelector('.hud-turn__lvl')?.textContent ?? '',
      active: el.classList.contains('active'),
    }))
    return { cards }
  })

const run = async () => {
  const browser = await chromium.launch({ headless: !HEADED })
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
  const logs = []
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))

  await page.goto(`${BASE}/simulator`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ roster, setup }) => {
      await new Promise((resolve, reject) => {
        const open = indexedDB.open('aresrpg_simulator', 1)
        open.onupgradeneeded = () => {
          const db = open.result
          for (const s of ['roster', 'setup', 'traces']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s)
        }
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(['roster', 'setup'], 'readwrite')
          const store = tx.objectStore('roster')
          store.clear()
          for (const c of roster) store.put(c, c.id)
          tx.objectStore('setup').put(setup, 'current')
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    { roster: ROSTER, setup: SETUP }
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(7000)
  await shot(page, '01-setup-two-seats')

  const start = page.getByRole('button', { name: /start/i }).first()
  await start.waitFor({ timeout: 30_000 })
  console.log('START enabled:', await start.isEnabled())
  await start.click()
  await page.waitForTimeout(9000)
  await shot(page, '02-fight-open')
  console.log('HUD', JSON.stringify(await hud_state(page)))

  const seen = new Set()
  for (let round = 0; round < 8; round++) {
    const state = await hud_state(page)
    const active = state.cards.find((c) => c.active)
    console.log(`round ${round} active=${active?.name ?? 'none'} cards=${state.cards.map((c) => c.name).join('|')}`)
    if (active?.name) seen.add(active.name)
    await shot(page, `03-round-${round}-${(active?.name ?? 'none').replace(/\W+/g, '')}`)
    const end = page.getByRole('button', { name: /end turn|end/i }).first()
    if (await end.count()) await end.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(7000)
    if (seen.size >= 2 && round >= 2) break
  }
  console.log('SEATS SEEN:', [...seen].join(', '))

  const socket = page.locator('.hud-deck__slot, [class*="socket"]').first()
  if (await socket.count()) {
    await socket.hover().catch(() => {})
    await page.waitForTimeout(1500)
    await shot(page, '04-spell-tooltip')
    const tip = await page.evaluate(() =>
      [...document.querySelectorAll('[class*="tooltip"], [role="tooltip"], [class*="hover-tip"]')]
        .map((el) => el.textContent)
        .join(' || ')
    )
    console.log('TOOLTIP:', tip.slice(0, 600))
  }

  const canvas = page.locator('canvas').first()
  const box = await canvas.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.55)
    await page.waitForTimeout(1000)
    await shot(page, '05-paint-hover-path')
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.62)
    await page.waitForTimeout(1000)
    await shot(page, '06-paint-hover-path-b')
  }

  console.log('--- console tail ---')
  console.log(logs.slice(-45).join('\n'))
  await browser.close()
}

run().catch((error) => {
  console.error('DRIVE FAILED', error)
  process.exit(1)
})
