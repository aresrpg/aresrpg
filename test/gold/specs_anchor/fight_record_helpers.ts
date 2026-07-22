// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, type Page } from '@playwright/test'

import {
  cell_key,
  click_cell,
  click_damage_spell,
  clean_return,
  draft_move,
  engage_by_mouse,
  human_click_locator,
  snapshot,
  wait_player_turn,
  type FightFixture,
} from './fight_mouse_helpers'

// The present.js pacing law, mirrored here so the (rig-gated, node-heavy) spec keeps the exact minimal import
// graph the other proven anchor specs use — present.js is the source of truth (packages/fight/src/present.js
// `export const MOB_TURN_MS = 3000`); Pillar 2b asserts the live value; this is the oracle ceiling for wave pacing.
const MOB_TURN_MS = 3000

// ╔══════════════════════════════════════════════════════════════════════════════════════════════════╗
// ║ PILLAR 1 — THE ADAPTIVE FIGHT ROW, RECORDED & VERIFIED: join a world, search the zone, teleport to ║
// ║ the nearest fight, wait the required time, adapt to the layout of mob positions, play turns with   ║
// ║ mouse and record exactly what is happening to verify it — spell effects, fight timers.             ║
// ║                                                                                                    ║
// ║ boot_fixture_world (join → search → travel-wait) + the adaptive mouse-only multi-turn drive already ║
// ║ exist (fight_mouse_helpers). THIS layer adds the RECORDER — a structured log of everything the      ║
// ║ render path emitted (cast→VFX trace beats, damage floats, HP repaints, presenting windows,          ║
// ║ per-turn/per-wave timers) — and the ORACLE VERIFY: the recording is cross-checked against the       ║
// ║ present.js pacing law (≈3s/mob) and the receipt-derived HP truth. The full recording is written to  ║
// ║ test/gold/out/fight_record.json so a human can read exactly what happened.                          ║
// ╚══════════════════════════════════════════════════════════════════════════════════════════════════╝

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out')

type Recording = {
  trace: Array<Record<string, any>>
  hp: Array<{ t: number; from: number; to: number; presenting: boolean }>
  floats: Array<{ t: number; text: string }>
  combat: Array<{ t: number; message: string; presenting: boolean }>
  presenting: Array<{ t: number; presenting: boolean }>
}

// Install a page-side recorder over the LIVE render path: the product's own `__ARES_FIGHT_TRACE` (cast/flush/
// displacement VFX beats, gated on ?fighttrace=1 — boot_fixture_world already sets it), the fight CORE
// subscription (my HP repaints, presenting transitions — mirror kill 07-17: fight truth no longer rides the
// engine pump), the engine STATE_UPDATED stream (the combat feed), and the `.damage-float` DOM numbers.
async function install_render_recorder(page: Page) {
  await page.evaluate(async () => {
    const target = window as any
    const engine = target.__ARES_ENGINE
    // MIRROR KILL (07-17): `state.fight` is deleted, so HP/presenting reads go to the fight core's memoized
    // engine_view projection and their rows subscribe to fight_store (the store fight truth actually changes
    // in); the engine listener keeps ONLY the combat-log rows (message_history is engine state), stamping
    // `presenting` from the live view at message time.
    const { fight_store, engine_view_of } = await import('/@id/@aresrpg/fight')
    target.__GOLD_REC_OFF?.()
    target.__ARES_FIGHT_TRACE = [] // fresh render-trace capture for this fight
    target.__GOLD_REC = { hp: [], floats: [], combat: [], presenting: [] }
    const view = () => engine_view_of(fight_store.getState())
    const hp_of = () => {
      const v = view()
      if (!v?.my_entity_id) return null
      const me = v.fighters?.get(v.my_entity_id)
      return me ? Number(me.health) : null
    }
    let prev_hp = hp_of()
    let prev_presenting = !!view()?.presenting
    let message_count = engine.get_state().message_history?.length ?? 0
    const on_fight = () => {
      const t = Date.now()
      const presenting = !!view()?.presenting
      const hp = hp_of()
      if (hp !== null && prev_hp !== null && hp !== prev_hp)
        target.__GOLD_REC.hp.push({ t, from: prev_hp, to: hp, presenting })
      prev_hp = hp ?? prev_hp
      if (presenting !== prev_presenting) target.__GOLD_REC.presenting.push({ t, presenting })
      prev_presenting = presenting
    }
    const unsubscribe = fight_store.subscribe(on_fight)
    const listener = (state: any) => {
      const t = Date.now()
      const presenting = !!view()?.presenting
      const messages = state.message_history ?? []
      for (const m of messages.slice(message_count))
        if (m.channel === 'CLIENT_COMBAT') target.__GOLD_REC.combat.push({ t, message: m.message, presenting })
      message_count = messages.length
    }
    engine.events.on('STATE_UPDATED', listener)
    const observer = new MutationObserver(() => {
      for (const el of Array.from(document.querySelectorAll('.damage-float')) as any[]) {
        const text = (el.textContent || '').trim()
        if (text && !el.__gold_seen) {
          el.__gold_seen = true
          target.__GOLD_REC.floats.push({ t: Date.now(), text })
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    target.__GOLD_REC_OFF = () => {
      engine.events.off('STATE_UPDATED', listener)
      unsubscribe()
      observer.disconnect()
    }
  })
}

async function collect_recording(page: Page): Promise<Recording> {
  return page.evaluate(() => {
    const target = window as any
    return {
      trace: target.__ARES_FIGHT_TRACE ?? [],
      hp: target.__GOLD_REC?.hp ?? [],
      floats: target.__GOLD_REC?.floats ?? [],
      combat: target.__GOLD_REC?.combat ?? [],
      presenting: target.__GOLD_REC?.presenting ?? [],
    }
  })
}

/**
 * The recorded, oracle-verified adaptive fight. Boots the fixture world elsewhere (boot_fixture_world), then here:
 * engage by mouse → adapt placement → play ≥3 mouse-only turns → RECORD every rendered beat → VERIFY the
 * recording against present.js's ~3s/mob pacing law and the receipt-derived HP truth → win → clean return.
 * Writes the structured recording to test/gold/out/fight_record.json.
 */
export async function play_recorded_multi_turn_fight(page: Page, fixture: FightFixture) {
  const spawn_id = await engage_by_mouse(page, fixture)
  await install_render_recorder(page)

  // ADAPT PLACEMENT to whatever mob layout rolled — nearest free placement cell to the first living mob.
  await expect.poll(() => snapshot(page).then((s) => s.placement)).toBe(true)
  const placement = await snapshot(page)
  const occupied = new Set(placement.mobs.filter((m) => !m.dead).map((m) => cell_key(m.cell)))
  const first_mob = placement.mobs.find((m) => !m.dead)!
  const free = placement.placement_cells
    .filter((c) => !occupied.has(cell_key(c)))
    .sort(
      (a, b) =>
        Math.abs(a.x - first_mob.cell.x) +
        Math.abs(a.y - first_mob.cell.y) -
        (Math.abs(b.x - first_mob.cell.x) + Math.abs(b.y - first_mob.cell.y))
    )
  const place = free.find((c) => cell_key(c) !== cell_key(placement.me!.cell)) ?? free[0]
  expect(place, 'recorded fixture has no free placement cell').toBeTruthy()
  await click_cell(page, place!)
  await expect.poll(() => snapshot(page).then((s) => cell_key(s.me!.cell))).toBe(cell_key(place!))
  await human_click_locator(page, page.locator('.hud-fightctl__ready'))
  await expect.poll(() => snapshot(page).then((s) => !s.placement), { timeout: 45_000 }).toBe(true)

  // THE ADAPTIVE TURN LOOP — derive the reachable target from live state, never hardcoded coords.
  const turns: Array<{ turn: number; armed_at: number; casts: number; wave_ms: number | null; mobs_acting: number }> =
    []
  for (let turn = 0; turn < 12; turn += 1) {
    await wait_player_turn(page)
    const armed_at = Date.now()
    const state = await snapshot(page)
    const mob = state.mobs.find((m) => !m.dead)
    if (!mob) break
    let casts = 0
    const distance = Math.abs(state.me!.cell.x - mob.cell.x) + Math.abs(state.me!.cell.y - mob.cell.y)
    if (distance > 1) await draft_move(page, false)
    await click_damage_spell(page)
    casts += 1
    const aimed = await snapshot(page)
    const target = aimed.mobs.find((m) => !m.dead)
    if (target && Math.abs(aimed.me!.cell.x - target.cell.x) + Math.abs(aimed.me!.cell.y - target.cell.y) <= 1)
      await click_cell(page, target.cell)

    // TIMER LAW — one per-turn floor: END TURN enables within 1.5s once ≥3.2s elapsed, regardless of casts.
    const since_armed = Date.now() - armed_at
    if (since_armed < 3_200) await page.waitForTimeout(3_200 - since_armed)
    const end = page.locator('.hud-fightctl__end')
    await expect(end, 'END TURN stayed disabled after the one per-turn floor — the per-cast gate is back').toBeEnabled({
      timeout: 1_500,
    })
    const mobs_acting = (await snapshot(page)).mobs.filter((m) => !m.dead).length
    await human_click_locator(page, end)

    // RECORD THE WAVE — presenting must be observed, then measured until it drains (the ~3s/mob window).
    const wave_seen = await expect
      .poll(() => snapshot(page).then((s) => s.presenting || !s.mobs.some((m) => !m.dead)), { timeout: 30_000 })
      .toBe(true)
      .then(() => true)
      .catch(() => false)
    const after = await snapshot(page)
    let wave_ms: number | null = null
    if (wave_seen && after.mobs.some((m) => !m.dead) && after.presenting) {
      const wave_start = Date.now()
      await expect
        .poll(() => snapshot(page).then((s) => !s.presenting), {
          timeout: 60_000,
          message: 'mob wave never finished presenting',
        })
        .toBe(true)
      wave_ms = Date.now() - wave_start
    }
    turns.push({ turn: turn + 1, armed_at, casts, wave_ms, mobs_acting })
    if (await page.locator('[role="dialog"][aria-label^="Victory:"]').isVisible()) break
  }

  const recording = await collect_recording(page)
  await page.evaluate(() => (window as any).__GOLD_REC_OFF?.())

  // ── WRITE THE ARTIFACT — "record exactly what's happening" ────────────────────────────────────────
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const artifact = path.join(OUT_DIR, 'fight_record.json')
  const player_turns = turns.length
  const waves = turns.map((t) => t.wave_ms).filter((v): v is number => v !== null)
  fs.writeFileSync(
    artifact,
    JSON.stringify({ fixture: fixture.mob_name, player_turns, turns, recording, MOB_TURN_MS }, null, 2)
  )

  // ── ORACLE VERIFY: the recording vs the stated laws + present.js pacing ──────────────────────────
  // (1) ADAPTIVE MULTI-TURN — the fixture reached the handoff cycle ≥3 times (single-turn rows lied by omission).
  expect(player_turns, `fixture ended before the 3rd player turn (played ${player_turns})`).toBeGreaterThanOrEqual(3)

  // (2) SPELL CASTS → THEIR VFX FIRED — every mouse cast produced a render/commit trace beat; the fight committed.
  const flush_started = recording.trace.filter((r) => r.event === 'flush_started')
  const flush_finished = recording.trace.filter((r) => r.event === 'flush_finished' && r.ok)
  const total_casts = turns.reduce((n, t) => n + t.casts, 0)
  expect(
    flush_started.length,
    'no cast/flush render beat was recorded — casts fired no VFX pipeline'
  ).toBeGreaterThanOrEqual(Math.min(player_turns, total_casts))
  expect(flush_finished.length, 'no cast commit ever finished — turns could not commit').toBeGreaterThanOrEqual(1)

  // (3) MOBS VISIBLY ACT + ~3s/mob PACING (present.js oracle) — every recorded wave spans a readable window bounded
  //     by the pacing law: ≥2s (drain slack under the 3s floor) and ≤ MOB_TURN_MS × mobs_acting + generous slack.
  expect(waves.length, 'no mob wave presentation was ever recorded — mobs did not visibly act').toBeGreaterThanOrEqual(
    2
  )
  for (const t of turns) {
    if (t.wave_ms === null) continue
    expect(t.wave_ms, `turn ${t.turn} wave presented ${t.wave_ms}ms — under the ~3s/mob floor`).toBeGreaterThanOrEqual(
      2_000
    )
    const ceiling = MOB_TURN_MS * Math.max(1, t.mobs_acting) + 8_000
    expect(
      t.wave_ms,
      `turn ${t.turn} wave ${t.wave_ms}ms exceeds the present.js ${MOB_TURN_MS}ms×${t.mobs_acting} pacing ceiling`
    ).toBeLessThanOrEqual(ceiling)
  }

  // (4) HP IS NOT A STALE INTEGER IN A DIV — a mob hit landed (HP dropped) and it was VISIBLY signalled (a float
  //     number and/or a combat-feed line), never a silent state change. This is the exact regression this fences.
  const hp_drops = recording.hp.filter((h) => h.to < h.from)
  expect(hp_drops.length, 'no mob damage ever repainted my HP — the HP integer never updated').toBeGreaterThanOrEqual(1)
  const visible_signals = recording.floats.length + recording.combat.length
  expect(
    visible_signals,
    'my HP dropped but NO float number or combat line was rendered — a silent HP change'
  ).toBeGreaterThanOrEqual(1)

  // ── WIN + CLEAN RETURN ────────────────────────────────────────────────────────────────────────────
  const dialog = page.locator('[role="dialog"][aria-label^="Victory:"]')
  await expect(dialog).toBeVisible({ timeout: 150_000 })
  await expect(dialog.locator('.fe-gain')).toContainText(/\+\d+ XP/, { timeout: 45_000 })
  await human_click_locator(page, dialog.getByRole('button', { name: 'Continue', exact: true }))
  const later = page.getByRole('button', { name: 'Later', exact: true })
  await later.waitFor({ state: 'visible', timeout: 1_500 }).catch(() => {})
  if (await later.isVisible()) await human_click_locator(page, later)
  await clean_return(page, spawn_id)
  return { spawn_id, player_turns, waves, artifact, recording }
}
