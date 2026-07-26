// PLAYED ARMING CAPTURE — PR #926 head 2c7ba64a, the #931 id-space fix under proof.
// The one question: does a committed cast's damage SURVIVE END TURN?
import { writeFileSync, mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

const SHOTS = '/tmp/aresrpg-lanes/played-931-drive/shots'
mkdirSync(SHOTS, { recursive: true })

const log: string[] = []
const L = (s: string) => {
  log.push(`[${new Date().toISOString().slice(11, 23)}] ${s}`)
  console.log('[played931]', s)
}
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png` }).catch((e) => L(`shot ${name} FAILED: ${e}`))

/** The DOM the player actually sees — the only oracle that is not a re-implementation. */
const hud = (page: Page) =>
  page.evaluate(() => {
    const q = (s: string) => document.querySelector(s)
    const all = (s: string) => [...document.querySelectorAll(s)]
    const turns = all('.hud-turn').map((el) => ({
      name: el.querySelector('.hud-turn__name')?.textContent ?? '',
      hp: el.querySelector('.hud-turn__hp-num')?.textContent ?? '',
      active: el.classList.contains('active'),
      dead: el.classList.contains('dead'),
      team: el.className.match(/hud-turn (\w+)/)?.[1] ?? '',
    }))
    const sockets = all('.hud-socket').map((el) => ({
      key: el.querySelector('.hud-socket__key')?.textContent ?? '',
      label: el.getAttribute('aria-label') ?? '',
      empty: el.classList.contains('empty'),
      armed: el.classList.contains('armed'),
    }))
    const probe = (window as any).__ARES_FIGHT_PROBE ?? null
    return {
      spellbar: !!q('.hud-spellbar'),
      vitals_hp: q('.hud-vbox__hp')?.textContent ?? null,
      sockets,
      armed_index: sockets.findIndex((s) => s.armed),
      turns,
      active: turns.find((t) => t.active)?.name ?? null,
      beats: probe?.beats?.length ?? 0,
      last_beats: (probe?.beats ?? []).slice(-8),
      dialogs: all('[role=dialog]').map((d) => d.getAttribute('aria-label') ?? '?'),
      picker: !!q('.z-\\[9999\\]'),
    }
  })

/** The FULL trace ring — the console preview truncates objects at five props, this does not. */
const trace = (page: Page) =>
  page.evaluate(() => {
    const rows = (window as any).__ARES_FIGHT_TRACE ?? []
    try {
      return JSON.parse(
        JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? String(v) : typeof v === 'function' ? '[fn]' : v))
      )
    } catch (e) {
      return rows.map((r: any) => String(r))
    }
  })

const mob_count = (page: Page) =>
  page.evaluate(() => Number(document.body.innerText.match(/MOB TEAM\s+(\d+)\s*\/\s*\d+/)?.[1] ?? 0))
const roster_count = (page: Page) =>
  page.evaluate(() => Number(document.body.innerText.match(/ROSTER\s+(\d+)\s*\/\s*\d+/)?.[1] ?? 0))

/** The SIMULATOR BOARD canvas — never the persistent world canvas mounted behind the router. */
async function canvas_box(page: Page) {
  const box = await page.evaluate(() => {
    const cs = [...document.querySelectorAll('canvas')]
    const board = cs.find((c) => {
      const p = c.parentElement
      return !!p && getComputedStyle(p).backgroundColor === 'rgb(12, 12, 20)'
    })
    const el = board ?? cs.sort((a, b) => a.clientWidth * a.clientHeight - b.clientWidth * b.clientHeight)[0]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height, board: !!board, count: cs.length }
  })
  if (!box) throw new Error('no canvas')
  return box
}

async function press(page: Page, x: number, y: number, settle = 350) {
  await page.mouse.move(x, y, { steps: 5 })
  await page.waitForTimeout(60)
  await page.mouse.down()
  await page.waitForTimeout(50)
  await page.mouse.up()
  await page.waitForTimeout(settle)
}

test('PLAYED — a committed cast folds damage that survives END TURN', async ({ page }) => {
  test.setTimeout(1_400_000)
  const console_errors: string[] = []
  const page_errors: string[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error') console_errors.push(t)
    if (/\[simulator\]|\[fight-state\]|uncastable|SpellTemplate|refus|drop/i.test(t)) L(`console: ${t.slice(0, 300)}`)
  })
  page.on('pageerror', (e) => page_errors.push(String(e)))

  const DEV_KEY = process.env.ARES_DEV_KEY
  if (!DEV_KEY) throw new Error('ARES_DEV_KEY missing')
  await page.addInitScript((k) => {
    ;(window as any).__ARES_DEV_KEY = k
  }, DEV_KEY)

  await page.goto('/simulator?dev&fighttrace=1')
  await page.waitForSelector('.template-input, canvas', { timeout: 120_000 })
  await page.waitForTimeout(4_000)
  await expect(page.getByText('SIMULATOR', { exact: false }).first()).toBeVisible({ timeout: 60_000 })
  await page.waitForSelector('canvas', { timeout: 120_000 })
  await page.waitForTimeout(8_000)
  L('signed in as the QA key · simulator board mounted')
  await shot(page, '00_setup_boot')

  // ── 1. CREATE A CHARACTER ────────────────────────────────────────────────────────────────────────────
  await page.getByText('NEW CHARACTER').first().click()
  await page.waitForSelector('[role=dialog]', { timeout: 30_000 })
  await page.getByLabel('NAME').first().fill('QAKNIGHT')
  await page.getByRole('button', { name: 'CREATE', exact: true }).click()
  await page.waitForTimeout(1_500)
  L('character created')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  // ── 2. SWEEP THE BOARD: one ally cell, then two mob cells ────────────────────────────────────────────
  const box = await canvas_box(page)
  const points: { x: number; y: number }[] = []
  const STEP = 26
  for (let y = box.y + 14; y < box.y + box.height - 10; y += STEP)
    for (let x = box.x + 14; x < box.x + box.width - 10; x += STEP) points.push({ x, y })
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  points.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))

  let placed = false
  let swept = 0
  const WANT_MOBS = 2
  for (const p of points) {
    if (placed && (await mob_count(page)) >= WANT_MOBS) break
    swept += 1
    await press(page, p.x, p.y, 220)
    const state = await hud(page)
    if (state.dialogs.includes('PLACE A CHARACTER')) {
      if (placed) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
        continue
      }
      L(`ally start cell at (${Math.round(p.x)},${Math.round(p.y)}) after ${swept} probes`)
      await page.getByRole('dialog', { name: 'PLACE A CHARACTER' }).getByText('QAKNIGHT').click()
      await page.waitForTimeout(900)
      placed = true
      await shot(page, '02_character_placed')
      continue
    }
    if (state.picker) {
      if ((await mob_count(page)) >= WANT_MOBS) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        continue
      }
      L(`mob start cell at (${Math.round(p.x)},${Math.round(p.y)}) after ${swept} probes`)
      await page.waitForTimeout(2_000)
      const rows = page.locator('.z-\\[9999\\] div[class*="border-l-2"]')
      await expect(rows.first()).toBeVisible({ timeout: 60_000 })
      const before_pick = await mob_count(page)
      const n = await rows.count()
      for (let i = 0; i < Math.min(n, 5); i += 1) {
        const name = (await rows.nth(i).textContent())?.trim().replace(/\s+/g, ' ').slice(0, 50)
        await rows.nth(i).click()
        await page.waitForTimeout(1_500)
        const picked = await mob_count(page)
        L(`mob row "${name}" → MOB TEAM ${picked}/6`)
        if (picked > before_pick) break
      }
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      continue
    }
    if (state.dialogs.length) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
  }
  L(`setup done — placed=${placed} roster=${await roster_count(page)} mobs=${await mob_count(page)} (${swept} probes)`)
  await shot(page, '04_setup_ready')
  expect(placed, 'a character stands on the board').toBe(true)
  expect(await mob_count(page), 'mobs stand on the board').toBeGreaterThan(0)

  // ── 3. START ─────────────────────────────────────────────────────────────────────────────────────────
  const start = page.getByRole('button', { name: /START FIGHT/i })
  await expect(start).toBeEnabled({ timeout: 20_000 })
  await start.click()
  await page.waitForSelector('.hud-spellbar', { timeout: 120_000 })
  await page.waitForTimeout(8_000)
  let s = await hud(page)
  L(`fight up — sockets filled=${s.sockets.filter((x) => !x.empty).length} turns=${s.turns.length} active=${s.active}`)
  await shot(page, '05_fight_spellbar')
  for (let i = 0; i < 60 && !s.active; i += 1) {
    await page.waitForTimeout(2_000)
    s = await hud(page)
  }
  L(`active seat: ${s.active} · turns: ${JSON.stringify(s.turns)}`)

  const evidence: any = { head: '2c7ba64a', url: 'http://localhost:5280/simulator?dev&fighttrace=1', rounds: [] }

  // ── 4. PLAY ──────────────────────────────────────────────────────────────────────────────────────────
  const hover_card = () =>
    page.evaluate(() => {
      const el = document.querySelector('.ent-tt')
      if (!el || el.classList.contains('ent-tt--out')) return null
      return {
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        enemy: el.classList.contains('enemy'),
        dmg: (el.querySelector('.ent-tt__delta--dmg')?.textContent ?? '').trim(),
      }
    })

  /** Hover the cell and read the HP the card prints — `Name (7)` or `Name (10 −5)` while armed. */
  const card_hp = async (x: number, y: number) => {
    await page.mouse.move(x + 3, y + 3, { steps: 2 })
    await page.waitForTimeout(120)
    await page.mouse.move(x, y, { steps: 2 })
    await page.waitForTimeout(320)
    const tip = await hover_card()
    if (!tip) return { hp: null as number | null, tip: null }
    const m = tip.text.match(/\((\d+)/)
    return { hp: m ? Number(m[1]) : null, tip }
  }

  async function find_enemy(me: string | null, want_dmg: boolean) {
    const b = await canvas_box(page)
    for (let r = 20; r <= Math.min(b.width, b.height) / 2; r += 16)
      for (let a = 0; a < 360; a += 14) {
        const x = b.x + b.width / 2 + Math.cos((a * Math.PI) / 180) * r
        const y = b.y + b.height / 2 + Math.sin((a * Math.PI) / 180) * r * 0.62
        if (x < b.x + 4 || x > b.x + b.width - 4 || y < b.y + 4 || y > b.y + b.height - 4) continue
        await page.mouse.move(x, y, { steps: 2 })
        await page.waitForTimeout(80)
        const tip = await hover_card()
        if (!tip?.enemy) continue
        if (me && tip.text.includes(me)) continue
        if (want_dmg && !tip.dmg) continue
        return { x, y, tip: tip.text, dmg: tip.dmg }
      }
    return null
  }

  /** The turn card row for a named entity — `presented_health`, the chain-anchored number. */
  const card_of = async (name: string) => (await hud(page)).turns.find((t) => t.name === name) ?? null
  const first_mob = async () => (await hud(page)).turns.find((t) => t.team !== 'ally' && !t.dead) ?? null

  async function arm(round: number) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.press('1')
    await page.waitForTimeout(600)
    let a = await hud(page)
    if (a.armed_index < 0) {
      L(`round ${round}: numkey 1 did not arm — falling back to socket clicks`)
      const filled = page.locator('.hud-socket:not(.empty)')
      const n = await filled.count()
      for (let i = 0; i < n; i += 1) {
        await filled.nth(i).click({ force: true })
        await page.waitForTimeout(400)
        a = await hud(page)
        if (a.armed_index >= 0) break
      }
    }
    return a
  }

  let casts_landed = 0
  let persisted = 0
  for (let round = 1; round <= 8; round += 1) {
    s = await hud(page)
    if (s.active !== 'QAKNIGHT') {
      for (let i = 0; i < 40 && s.active !== 'QAKNIGHT'; i += 1) {
        await page.waitForTimeout(2_000)
        s = await hud(page)
      }
      L(`round ${round}: seat returned to ${s.active}`)
    }

    let armed = await arm(round)
    L(`round ${round}: armed_index=${armed.armed_index} socket=${JSON.stringify(armed.sockets[armed.armed_index] ?? null)}`)
    if (casts_landed === 0 && armed.armed_index >= 0) await shot(page, '07_armed')

    let target = await find_enemy('QAKNIGHT', true)
    if (!target) {
      const body = await find_enemy('QAKNIGHT', false)
      L(`round ${round}: no castable cell — walking toward ${body ? `${Math.round(body.x)},${Math.round(body.y)}` : 'nothing'}`)
      if (body) {
        await press(page, body.x, body.y, 2_400)
        armed = await arm(round)
        target = await find_enemy('QAKNIGHT', true)
      }
    }
    if (!target) {
      L(`round ${round}: NO CASTABLE TARGET — ending turn`)
      const e = page.getByRole('button', { name: /END TURN/i })
      if (await e.count()) await e.first().click()
      await page.waitForTimeout(6_000)
      continue
    }

    // ── PRE-CAST SAMPLE: hover card (with the armed prediction) + the target's turn card ──
    const pre = await card_hp(target.x, target.y)
    const mob_name = (pre.tip?.text ?? '').split('(')[0].trim()
    const pre_card = mob_name ? await card_of(mob_name) : await first_mob()
    L(`round ${round}: PRE-CAST target="${mob_name}" hover=${JSON.stringify(pre.tip)} card_hp=${pre_card?.hp}`)
    if (casts_landed === 0) await shot(page, '08_precast_hover_prediction')

    const trace_before = (await trace(page)).length

    // ── THE CAST ──
    await page.mouse.move(target.x, target.y, { steps: 4 })
    await page.waitForTimeout(200)
    await page.mouse.down()
    await page.waitForTimeout(60)
    await page.mouse.up()
    await page.waitForTimeout(3_200)
    casts_landed += 1

    const post = await card_hp(target.x, target.y)
    const post_card = mob_name ? await card_of(mob_name) : await first_mob()
    L(`round ${round}: POST-CAST hover=${JSON.stringify(post.tip)} card_hp=${post_card?.hp}`)
    if (casts_landed === 1) await shot(page, '09_postcast_hp')
    if (casts_landed === 2) await shot(page, '09b_postcast_hp_round2')

    // ── END TURN — the commit door ──
    const active_before = (await hud(page)).active
    const end = page.getByRole('button', { name: /END TURN/i })
    const has_end = (await end.count()) > 0
    if (has_end) await end.first().click()
    L(`round ${round}: END TURN pressed (active was ${active_before}) present=${has_end}`)

    let moved = false
    let moved_ms = -1
    const t0 = Date.now()
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(500)
      const now = await hud(page)
      if (now.active !== active_before) {
        moved = true
        moved_ms = Date.now() - t0
        L(`round ${round}: TURN POINTER MOVED ${active_before} → ${now.active} after ${moved_ms}ms`)
        break
      }
    }
    if (moved && casts_landed === 1) await shot(page, '11_turn_pointer_on_mob')

    // the commit has flushed by now — SAMPLE THE SAME CELL AGAIN. This is the money shot.
    await page.waitForTimeout(2_000)
    const committed = await card_hp(target.x, target.y)
    const committed_card = mob_name ? await card_of(mob_name) : await first_mob()
    L(`round ${round}: POST-END-TURN hover=${JSON.stringify(committed.tip)} card_hp=${committed_card?.hp}`)
    if (casts_landed === 1) await shot(page, '10_post_endturn_hp_MONEYSHOT')

    const held =
      pre_card?.hp != null &&
      committed_card?.hp != null &&
      Number(committed_card.hp) < Number(pre_card.hp)
    if (held) persisted += 1
    L(`round ${round}: DAMAGE HELD THROUGH COMMIT = ${held} (card ${pre_card?.hp} → ${post_card?.hp} → ${committed_card?.hp})`)

    const rows = await trace(page)
    evidence.rounds.push({
      round,
      target: mob_name,
      predicted: target.dmg,
      armed_index: armed.armed_index,
      armed_label: armed.sockets[armed.armed_index]?.label ?? null,
      hover: { pre: pre.tip?.text ?? null, post: post.tip?.text ?? null, committed: committed.tip?.text ?? null },
      card_hp: { pre: pre_card?.hp ?? null, post: post_card?.hp ?? null, committed: committed_card?.hp ?? null },
      damage_held: held,
      pointer_moved: moved,
      pointer_moved_ms: moved_ms,
      active_before,
      active_after: (await hud(page)).active,
      turns: (await hud(page)).turns,
      trace_slice: rows.slice(trace_before),
    })

    await page.waitForTimeout(2_500)
    const over = await page.evaluate(() => !document.querySelector('.hud-spellbar'))
    if (over) {
      L(`round ${round}: the fight ended (the HUD is gone)`)
      break
    }
    if (casts_landed >= 3 && persisted >= 2) break
  }

  const final = await hud(page)
  await shot(page, '12_final')
  evidence.final = final
  evidence.casts_landed = casts_landed
  evidence.casts_persisted = persisted
  evidence.fight_trace = await trace(page)
  evidence.probe = await page.evaluate(() => {
    const p = (window as any).__ARES_FIGHT_PROBE
    return p ? { beats: p.beats.slice(-60), vfx: p.vfx.slice(-20) } : null
  })
  evidence.console_errors = console_errors
  evidence.page_errors = page_errors
  evidence.log = log
  writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify(evidence, null, 2))
  L(`casts=${casts_landed} persisted=${persisted} console_errors=${console_errors.length} page_errors=${page_errors.length}`)
  expect(casts_landed, 'at least two casts were played').toBeGreaterThanOrEqual(2)
})
