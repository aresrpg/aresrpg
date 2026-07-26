// PLAYED CAPTURE — PR #926 arm blocker (#916 / #922).
// Drives the REAL simulator on the PR head build: place → START → arm → cast → END TURN → mob turn → cast again.
import { writeFileSync, mkdirSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

const SHOTS = '/tmp/aresrpg-lanes/played-926-drive/shots'
mkdirSync(SHOTS, { recursive: true })

const log: string[] = []
const L = (s: string) => {
  log.push(`[${new Date().toISOString().slice(11, 23)}] ${s}`)
  console.log('[played]', s)
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
      cls: el.className,
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
      turn_banner: q('.hud-turnbanner')?.textContent ?? null,
      tooltip: q('.ent-tt')?.textContent ?? null,
      beats: probe?.beats?.length ?? 0,
      vfx: probe?.vfx?.length ?? 0,
      upserts: probe?.upserts?.length ?? 0,
      last_beats: (probe?.beats ?? []).slice(-6).map((b: any) => b.kind ?? b.type ?? JSON.stringify(b).slice(0, 90)),
      dialogs: all('[role=dialog]').map((d) => d.getAttribute('aria-label') ?? '?'),
      picker: !!q('.z-\\[9999\\]'),
    }
  })

/** The top bar's own counters — the page's published truth about what is seated. */
const mob_count = (page: Page) =>
  page.evaluate(() => Number(document.body.innerText.match(/MOB TEAM\s+(\d+)\s*\/\s*\d+/)?.[1] ?? 0))
const roster_count = (page: Page) =>
  page.evaluate(() => Number(document.body.innerText.match(/ROSTER\s+(\d+)\s*\/\s*\d+/)?.[1] ?? 0))

/** The SIMULATOR BOARD canvas — never the persistent world canvas mounted behind the router.
 *  BoardPaneView wraps it in a div with the board's own `background:#0c0c14`. */
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

/** A real mouse press at absolute page coords. */
async function press(page: Page, x: number, y: number, settle = 350) {
  await page.mouse.move(x, y, { steps: 5 })
  await page.waitForTimeout(60)
  await page.mouse.down()
  await page.waitForTimeout(50)
  await page.mouse.up()
  await page.waitForTimeout(settle)
}

test('PLAYED — the simulator fight casts, folds damage, and cycles turns', async ({ page }) => {
  test.setTimeout(900_000)
  const console_errors: string[] = []
  const page_errors: string[] = []
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error') console_errors.push(t)
    if (/\[simulator\]|\[fight-state\]|commit|END TURN|refus|drop/i.test(t)) L(`console: ${t.slice(0, 220)}`)
  })
  page.on('pageerror', (e) => page_errors.push(String(e)))

  // The app shell gates every route on a connected address — the DEV native-wallet login (auth/dev_wallet.ts)
  // signs in with the project's QA key `alice`. Never the owner's, never a fresh key. Nothing here spends: the
  // simulator's chain is `@aresrpg/fight/sim_chain` (local, mocked receipts).
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

  // ── 1. CREATE A CHARACTER (real clicks through the roster seat → editor modal) ────────────────────────
  await page.getByText('NEW CHARACTER').first().click()
  await page.waitForSelector('[role=dialog]', { timeout: 30_000 })
  await page.getByLabel('NAME').first().fill('QAKNIGHT')
  await page.getByRole('button', { name: 'CREATE', exact: true }).click()
  await page.waitForTimeout(1_500)
  L('character created')
  await shot(page, '01_character_editor')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)

  // ── 2. SWEEP THE BOARD for a blue (ally) start cell, then a red (mob) one ─────────────────────────────
  const box = await canvas_box(page)
  const points: { x: number; y: number }[] = []
  const STEP = 26
  for (let y = box.y + 14; y < box.y + box.height - 10; y += STEP)
    for (let x = box.x + 14; x < box.x + box.width - 10; x += STEP) points.push({ x, y })
  // centre-out: the bands sit near the board's two ends, but the board is centred in the pane
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  points.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))
  L(
    `sweep grid: ${points.length} points over board canvas ${Math.round(box.width)}x${Math.round(box.height)} (board_canvas=${(box as any).board}, canvases=${(box as any).count})`
  )

  let placed = false
  let mobbed = false
  let swept = 0
  for (const p of points) {
    if (placed && (await mob_count(page)) >= 2) break
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
      if ((await mob_count(page)) >= 2) {
        await page.keyboard.press('Escape')
        await page.waitForTimeout(250)
        continue
      }
      // the mob seat's own search picker (an empty red cell opens it directly)
      L(`mob start cell at (${Math.round(p.x)},${Math.round(p.y)}) after ${swept} probes`)
      await page.waitForTimeout(2_000)
      // RESULT ROWS ONLY — the category sidebar's buttons carry the same border-l-2 class, and clicking one
      // silently filters instead of picking (measured: "All (341)").
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
        if (picked > before_pick) {
          mobbed = true
          break
        }
      }
      // the modal flips to the mob editor — close it
      await page.keyboard.press('Escape')
      await page.waitForTimeout(700)
      if (mobbed) await shot(page, '03_mob_picked')
      continue
    }
    if (state.dialogs.length) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }
  }
  L(
    `setup done — placed=${placed} mobbed=${mobbed} · roster=${await roster_count(page)} mobs=${await mob_count(page)} after ${swept} probes`
  )
  await shot(page, '04_setup_ready')
  expect(placed, 'a character stands on the board').toBe(true)
  expect(await mob_count(page), 'a mob stands on the board').toBeGreaterThan(0)

  // ── 3. START ─────────────────────────────────────────────────────────────────────────────────────────
  const start = page.getByRole('button', { name: /START FIGHT/i })
  await expect(start).toBeEnabled({ timeout: 20_000 })
  await start.click()
  await page.waitForTimeout(2_000)
  const blocked = await page.evaluate(
    () => document.body.innerText.match(/Place at least one character.*|.*before starting.*/)?.[0] ?? null
  )
  L(`START FIGHT pressed — blocked banner: ${blocked ?? 'none'}`)
  await page.waitForSelector('.hud-spellbar', { timeout: 120_000 })
  await page.waitForTimeout(8_000)
  let s = await hud(page)
  L(`fight up — sockets=${s.sockets.length} filled=${s.sockets.filter((x) => !x.empty).length} turns=${s.turns.length} active=${s.active}`)
  await shot(page, '05_fight_spellbar')

  // wait for the placement phase to hand over to a live turn
  for (let i = 0; i < 60 && !s.active; i += 1) {
    await page.waitForTimeout(2_000)
    s = await hud(page)
  }
  L(`active seat: ${s.active} · turns: ${JSON.stringify(s.turns)}`)
  await shot(page, '06_fight_live')

  const evidence: any = { setup_probes: swept, rounds: [] }

  // ── 4. PLAY ──────────────────────────────────────────────────────────────────────────────────────────
  /** The board-hover card (tooltip_card.jsx). With a spell armed it prints the PREDICTED damage on a LEGAL
   *  cast target (`.ent-tt__delta--dmg`) — the player's own "this cell is castable" affordance, and the only
   *  honest way to tell a targetable cell from one that would just disarm + walk. */
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

  /** Sweep the board with the mouse. `want_dmg` demands the cast affordance; otherwise any enemy body. */
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

  const mob_row = () => hud(page).then((h) => h.turns.find((t) => t.team !== 'ally' && !t.dead) ?? null)

  /** Arm hand slot 1 with the real keybind; fall back to a socket click if the key is inert. */
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
  for (let round = 1; round <= 8; round += 1) {
    s = await hud(page)
    if (!s.active) {
      L(`round ${round}: no active seat — waiting`)
      await page.waitForTimeout(4_000)
      s = await hud(page)
    }
    const my_turn = s.active === 'QAKNIGHT'
    L(`round ${round}: active=${s.active} mine=${my_turn}`)
    if (!my_turn) {
      // let the mob turn resolve
      for (let i = 0; i < 30 && s.active !== 'QAKNIGHT'; i += 1) {
        await page.waitForTimeout(2_000)
        s = await hud(page)
      }
      L(`round ${round}: seat returned to ${s.active}`)
    }

    // ARM via the number key — the real keybind, not a socket click
    let armed = await arm(round)
    L(`round ${round}: armed_index=${armed.armed_index} socket=${JSON.stringify(armed.sockets[armed.armed_index] ?? null)}`)
    if (casts_landed === 0) await shot(page, '07_armed')

    const hp_before = await mob_row()
    const beats_before = (await hud(page)).beats

    // ① a cell the armed spell can actually reach (tooltip prints the predicted damage)
    let target = await find_enemy('QAKNIGHT', true)
    if (!target) {
      // ② out of range — WALK toward the mob first (a click off the targetable set disarms and drafts a move,
      //    DungeonBoard.jsx:983-1009), then re-arm and re-check from the drafted position. Real play.
      const body = await find_enemy('QAKNIGHT', false)
      L(`round ${round}: no castable cell — walking toward ${body ? `${Math.round(body.x)},${Math.round(body.y)}` : 'nothing'}`)
      if (body) {
        await press(page, body.x, body.y, 2_200)
        armed = await arm(round)
        target = await find_enemy('QAKNIGHT', true)
      }
    }
    L(
      `round ${round}: cast target ${target ? `${Math.round(target.x)},${Math.round(target.y)} · ${target.tip.slice(0, 60)} · predicted ${target.dmg}` : 'NONE'}`
    )

    let cast_this_round = false
    if (target) {
      await page.mouse.move(target.x, target.y, { steps: 4 })
      await page.waitForTimeout(200)
      await page.mouse.down()
      await page.waitForTimeout(60)
      await page.mouse.up()
      // capture the beat WHILE it plays
      await page.waitForTimeout(420)
      if (casts_landed === 0) await shot(page, '08_cast_inflight')
      await page.waitForTimeout(2_600)
      cast_this_round = true
      casts_landed += 1
      // THE COMMIT QUESTION: the tooltip is the OPTIMISTIC fold, the turn card is `presented_health`
      // (chain-anchored). Sample the SAME target through the commit so a rolled-back cast is visible.
      await page.mouse.move(target.x, target.y, { steps: 2 })
      await page.waitForTimeout(250)
      const optimistic = await hover_card()
      L(`round ${round}: post-cast tooltip = ${JSON.stringify(optimistic)} · turn cards = ${JSON.stringify((await hud(page)).turns)}`)
      evidence.samples = evidence.samples ?? []
      evidence.samples.push({ round, when: 'post_cast', tooltip: optimistic, turns: (await hud(page)).turns })
    }
    const hp_after = await mob_row()
    const after = await hud(page)
    L(
      `round ${round}: mob hp ${hp_before?.hp} → ${hp_after?.hp} · beats ${beats_before} → ${after.beats} · last=${JSON.stringify(after.last_beats)}`
    )
    if (cast_this_round && casts_landed === 1) await shot(page, '09_after_cast')

    // ── END TURN — the #922 fix under proof ──
    const active_before = (await hud(page)).active
    const end = page.getByRole('button', { name: /END TURN/i })
    const has_end = (await end.count()) > 0
    if (has_end) {
      await end.first().click()
      L(`round ${round}: END TURN pressed (active was ${active_before})`)
    } else {
      L(`round ${round}: no END TURN button found — DOM: ${JSON.stringify((await hud(page)).turns)}`)
    }
    let moved = false
    for (let i = 0; i < 25; i += 1) {
      await page.waitForTimeout(1_000)
      const now = await hud(page)
      if (now.active !== active_before) {
        moved = true
        L(`round ${round}: TURN POINTER MOVED ${active_before} → ${now.active} after ${i + 1}s`)
        break
      }
    }
    if (moved && casts_landed >= 1) await shot(page, '10_turn_moved')
    if (cast_this_round && target) {
      await page.mouse.move(target.x, target.y, { steps: 2 })
      await page.waitForTimeout(300)
      const committed = await hover_card()
      L(`round ${round}: POST-COMMIT tooltip on the same cell = ${JSON.stringify(committed)}`)
      evidence.samples.push({ round, when: 'post_commit', tooltip: committed, turns: (await hud(page)).turns })
    }
    const post = await hud(page)
    evidence.rounds.push({
      round,
      active_before,
      active_after: post.active,
      pointer_moved: moved,
      cast: cast_this_round,
      predicted: target?.dmg ?? null,
      armed_index: armed.armed_index,
      mob_hp_before: hp_before?.hp ?? null,
      mob_hp_after: hp_after?.hp ?? null,
      beats_before,
      beats_after: post.beats,
      turns: post.turns,
    })
    if (!moved) L(`round ${round}: POINTER DID NOT MOVE — active still ${post.active}`)
    await page.waitForTimeout(3_000)
    // enough played evidence, or the fight is over
    const over = await page.evaluate(() => !document.querySelector('.hud-spellbar'))
    if (over) {
      L(`round ${round}: the fight ended (the HUD is gone)`)
      break
    }
    if (casts_landed >= 2 && evidence.rounds.filter((r: any) => r.pointer_moved).length >= 2) break
  }

  const final = await hud(page)
  await shot(page, '11_final')
  evidence.final = final
  evidence.casts_landed = casts_landed
  L(`casts landed: ${casts_landed} · rounds with a pointer move: ${evidence.rounds.filter((r: any) => r.pointer_moved).length}`)
  expect(casts_landed, 'at least one spell was cast on a mob').toBeGreaterThan(0)
  // The FULL trace rows — the console preview truncates objects at five properties, so `cast_count` and
  // `dropped` are only readable here. This is what says whether a drafted cast reached the commit batch.
  evidence.fight_trace = await page.evaluate(() => (window as any).__ARES_FIGHT_TRACE ?? null)
  evidence.probe = await page.evaluate(() => {
    const p = (window as any).__ARES_FIGHT_PROBE
    return p ? { beats: p.beats.slice(-40), vfx: p.vfx.slice(-20) } : null
  })
  evidence.console_errors = console_errors
  evidence.page_errors = page_errors
  evidence.log = log
  writeFileSync(`${SHOTS}/evidence.json`, JSON.stringify(evidence, null, 2))
  L(`console errors: ${console_errors.length} · page errors: ${page_errors.length}`)
  for (const e of console_errors.slice(0, 20)) L(`  ERR ${e.slice(0, 200)}`)
})
