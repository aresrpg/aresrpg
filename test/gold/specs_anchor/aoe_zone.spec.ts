// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { find_aoe_stage, zone_verdicts, type Cell, type HpRow } from './aoe_zone'
import {
  boot_fixture_world,
  cell_key,
  click_cell,
  engage_by_mouse,
  gold_manifest,
  human_click_locator,
  snapshot,
  wait_player_turn,
  type FightFixture,
  type GoldWallet,
} from './fight_mouse_helpers'

// AOE ZONE PROOF — validate through playwright that the AoE fully works
// (BACKLOG 🎯 row, UNBLOCKED 07-17 by the kit sweep landing zones for 4,257 atoms). The scenario,
// end to end via the REAL UI:
//   · the zone spell is the SEEDED corpus one — senshi_oathblade (unlock 1, range 0-0 self-cast, CROSS size 1,
//     damage on enemies only): wallet 0's default gold character IS the senshi (up_gold CLASSES), so the live
//     deck carries it at level 1 with zero test scaffolding;
//   · the fixture is the dedicated `aoe` world (fight_fixtures.mjs): a TWO-mob inert durable Bonelet group —
//     "every entity in the zone takes the effect" is a real plural, nothing dies, adjacency never drifts;
//   · the MULTI-CELL TARGETING PREVIEW must paint the zone (the `highlight_aoe` engine channel) while the armed
//     hover sits on the castable cell;
//   · the committed cast must hit EVERY living in-zone entity and NOTHING else — judged by the ONE pure law
//     (aoe_zone.ts zone_verdicts) over BOTH oracles: the display store and an independent chain read
//     (@aresrpg/sdk get_fight), plus exact display==chain HP parity per fighter.
// The expected zone set derives in-page from the sim's get_aoe_cells — the chain resolver's byte-twin — fed the
// RAW corpus effect row (read node-side below), never a re-implementation of shape math in this spec.

const gold = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const corpus_path = path.resolve(gold, '..', '..', 'seed', 'mainnet', 'spells', 'senshi.json')
type CorpusEffect = { kind: number; area_shape: number; area_size: number; target_filter: number }
type CorpusSpell = {
  id: string
  name: string
  unlock: number
  levels: Array<{ ap_cost: number; range_min: number; range_max: number; effects: CorpusEffect[] }>
}
const senshi_corpus = JSON.parse(fs.readFileSync(corpus_path, 'utf8')) as CorpusSpell[]
const oathblade = senshi_corpus.find((spell) => spell.id === 'senshi_oathblade')

const sorted_keys = (cells: readonly Cell[]) => cells.map(cell_key).sort()

/** The cells currently painted on the engine's `highlight_aoe` channel, decoded off the live board descriptor
 *  (tile world position → cell — the exact inverse of board_highlights' cell_center_world placement). */
async function painted_aoe_cells(page: Page): Promise<Cell[]> {
  return page.evaluate(() => {
    const w = window as any
    const descriptor = w.__voxel_board?._descriptor?.()
    const group = w.__voxel_engine?.get_scene?.()?.getObjectByName?.('highlight_aoe')
    if (!descriptor || !group) return []
    return group.children.map((tile: any) => ({
      x: Math.round((tile.position.x - descriptor.origin.x) / descriptor.cell_size - 0.5),
      y: Math.round((tile.position.z - descriptor.origin.z) / descriptor.cell_size - 0.5),
    }))
  })
}

/** The drafted cast queue (use_dungeon_turn.cast_path) — the registration oracle of the armed board click
 *  (same read the hardened helpers oracle stacked casts on; the store is the ONE local draft truth, S2). */
async function cast_queue(page: Page): Promise<{ length: number; last: Cell | null }> {
  return page.evaluate(async () => {
    const [{ use_dungeon_turn }, { decode }] = await Promise.all([
      import('/src/game/screens/dungeon-turn.js'),
      import('/@id/@aresrpg/fight'), // los decode — packages/fight/src/los.js since M1a
    ])
    const { cast_path } = use_dungeon_turn.getState()
    const tail = cast_path.length ? cast_path[cast_path.length - 1].cell : null
    return { length: cast_path.length, last: tail == null ? null : decode(tail) }
  })
}

/** INDEPENDENT chain oracle: the shared Fight object via @aresrpg/sdk get_fight (gRPC), decoded to the same
 *  HpRow shape the display rows use — mob ids are the display's own `mob-${index}` (project.js maps chain mob
 *  index 1:1), cells decode off the fight's own board stride. */
async function chain_rows(
  page: Page,
  fight_id: string,
  caster_id: string
): Promise<{ mobs: HpRow[]; caster: HpRow | null }> {
  return page.evaluate(
    async ({ id, me }) => {
      const [{ get_fight }, sdk_module] = await Promise.all([
        // bare specifiers can't resolve in a browser-native import (page.evaluate) — Vite's /@id/ escape can.
        import('/@id/@aresrpg/sdk/fight'),
        import('/src/chain/sdk'),
      ])
      const sdk = await sdk_module.get_sdk()
      const fight = await get_fight({ grpc_client: sdk.grpc_client })(id)
      if (!fight) return { mobs: [], caster: null }
      const stride = Number(fight.width ?? 20)
      const decode = (cell: unknown) => ({ x: Number(cell) % stride, y: Math.floor(Number(cell) / stride) })
      const hp_row = (row_id: string, row: any) => ({
        id: row_id,
        cell: decode(row.cell),
        dead: Number(row.hp ?? 0) === 0,
        health: Number(row.hp ?? 0),
      })
      const participant = (fight.participants ?? []).find((row: any) => String(row.character) === String(me))
      return {
        mobs: (fight.mobs ?? []).map((row: any, index: number) => hp_row(`mob-${index}`, row)),
        caster: participant ? hp_row(String(me), participant) : null,
      }
    },
    { id: fight_id, me: caster_id }
  )
}

const display_rows = (state: Awaited<ReturnType<typeof snapshot>>): HpRow[] => [
  { id: state.me!.id, cell: state.me!.cell, dead: state.me!.dead, health: state.me!.health },
  ...state.mobs.map((mob) => ({ id: mob.id, cell: mob.cell, dead: mob.dead, health: mob.health })),
]

test.describe('gold localnet — the AoE zone proof', () => {
  test.skip(!gold_manifest, 'no .gold-deployment.json — run `node test/gold/up_gold.mjs` first')

  test('@headed AOE ZONE · armed hover paints the multi-cell zone and the cast hits every entity in it (chain + display parity)', async ({
    page,
  }) => {
    test.slow()
    // ── the corpus contract this proof stands on (also pinned red/green in aoe_zone_test.ts) ──
    expect(oathblade, 'senshi corpus lost senshi_oathblade — the level-1 zone spell this proof casts').toBeTruthy()
    const [level_one] = oathblade!.levels
    const [zone_effect] = level_one.effects
    expect(oathblade!.unlock, 'Oathblade must stay level-1 unlocked for the fresh gold senshi').toBe(1)
    expect(
      [level_one.range_min, level_one.range_max],
      'Oathblade must stay self-cast (the zone centers on me)'
    ).toEqual([0, 0])
    expect(zone_effect.area_shape, 'Oathblade effect 0 must stay a real multi-cell zone shape').not.toBe(0)

    const fixture = gold_manifest.fight_fixtures?.aoe as (FightFixture & { group?: [number, number] }) | undefined
    expect(fixture, 'gold boot must provide the dedicated aoe fixture world (fight_fixtures.aoe)').toBeTruthy()
    const [wallet] = gold_manifest.wallets as GoldWallet[]
    // wallet 0's DEFAULT roster row is the senshi (up_gold CLASSES[(0+0)%4]) — same seat fight_lifecycle drives.
    await boot_fixture_world(page, wallet, fixture!)
    await engage_by_mouse(page, fixture!)
    await expect.poll(() => snapshot(page).then((state) => state.placement)).toBe(true)

    // FIXTURE CONTRACT: the aoe world spawns a TWO-mob group — the plural "every entity in the zone".
    await expect
      .poll(() => snapshot(page).then((state) => state.mobs.filter((mob) => !mob.dead).length), {
        message: 'the aoe fixture fight must field its 2-mob Bonelet group',
      })
      .toBe(2)

    // Placement + walking are SETUP, driven by the same dev hooks in_turn_beats aligns with; every assertion
    // below stays on the real mouse/UI surfaces.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              !!(window as any).__ARES_DEV_PLACE_READY &&
              !!(window as any).__ARES_DEV_MOVE &&
              !!(window as any).__ARES_DEV_CELL_SCREEN
          ),
        { timeout: 30_000, message: 'dev fight hooks never booted for the aoe proof' }
      )
      .toBe(true)
    const placed = await page.evaluate(() => (window as any).__ARES_DEV_PLACE_READY())
    expect(placed.ok, `placement failed: ${placed.reason}`).toBe(true)
    await expect.poll(() => snapshot(page).then((state) => !state.placement), { timeout: 45_000 }).toBe(true)

    // ── ALIGN: walk to a cross-zone stage — ≥1 living mob orthogonally adjacent AND all 4 neighbors real
    //    on-board terrain, so the expected zone is EXACTLY the 5-cell cross. Inert mobs never move: it holds. ──
    let stage: Cell | null = null
    for (let attempt = 0; attempt < 20 && !stage; attempt += 1) {
      await wait_player_turn(page)
      const state = await snapshot(page)
      const found = find_aoe_stage({ me: state.me!, mobs: state.mobs, arena: state.arena! })
      expect(found, 'fight board offers no reachable cross-zone stage next to a living mob').toBeTruthy()
      if (cell_key(state.me!.cell) === cell_key(found!.stage)) {
        ;({ stage } = found!)
        break
      }
      const step_count = Math.max(1, Math.min(state.me!.mp, found!.path.length))
      const destination = found!.path[step_count - 1]
      const moved = await page.evaluate((cell) => (window as any).__ARES_DEV_MOVE(cell), destination)
      expect(moved.ok, `alignment move failed: ${moved.error}`).toBe(true)
    }
    expect(stage, 'could not reach a cross-zone stage within 20 turns').toBeTruthy()

    await wait_player_turn(page)
    // The align moves above committed through the SAME traced flush path — reset the trace so the flush polls
    // below read THIS turn's commit, never an alignment one (the in_turn_beats recorder resets it the same way).
    await page.evaluate(() => {
      ;(window as any).__ARES_FIGHT_TRACE = []
    })
    const before = await snapshot(page)
    // D75 stride pin: the sim's 20×19 grid, the chain cell encode, and this board are the same geometry.
    expect([before.arena!.width, before.arena!.height], 'fight board must be the D75 20×19 grid').toEqual([20, 19])
    expect(cell_key(before.me!.cell), 'the aligned stage must hold at the assert turn').toBe(cell_key(stage!))

    // ── THE EXPECTED ZONE — the sim's own zone-set derivation (the chain resolver's byte-twin) over the RAW
    //    corpus effect row, centered on my cell (range 0 self-cast). 5 cells by stage construction. ──
    const zone = await page.evaluate(
      async ({ center, effect }) => {
        const { get_aoe_cells } = await import('/@id/@aresrpg/sim')
        return get_aoe_cells(effect, center, center) as Cell[]
      },
      { center: stage!, effect: zone_effect }
    )
    expect(sorted_keys(zone), 'a clean stage derives the exact 5-cell cross zone').toHaveLength(5)
    const zone_keys = new Set(zone.map(cell_key))
    const in_zone_mobs = before.mobs.filter((mob) => !mob.dead && zone_keys.has(cell_key(mob.cell)))
    expect(in_zone_mobs.length, 'the stage guarantees at least one living mob inside the zone').toBeGreaterThanOrEqual(
      1
    )

    const chain_before = await chain_rows(page, before.fight_id!, before.me!.id)
    expect(chain_before.caster, 'chain read must resolve my Participant row').toBeTruthy()
    expect(chain_before.mobs, 'chain read must resolve both FightMob rows').toHaveLength(2)
    // PRE-CAST PARITY GATE (rig integrity): the display board IS the chain board before anything is cast.
    expect(chain_before.mobs.map((row) => `${row.id}@${cell_key(row.cell)}:${row.health}`).sort()).toEqual(
      before.mobs.map((row) => `${row.id}@${cell_key(row.cell)}:${row.health}`).sort()
    )
    expect(chain_before.caster!.health, 'pre-cast caster HP must agree chain↔display').toBe(before.me!.health)

    // ── ARM the zone spell on the real deck ──
    const spell_button = page.getByRole('button', { name: oathblade!.name, exact: true })
    await expect(spell_button, 'full-corpus senshi must carry Oathblade at level 1').toBeEnabled()
    await human_click_locator(page, spell_button)
    await expect.poll(() => snapshot(page).then((state) => state.armed)).toBe('oathblade')

    // ── THE MULTI-CELL TARGETING PREVIEW: hover the castable (own) cell, capture the aoe channel paint. The
    //    hard verdict lands at the end of the spec so the effect legs below always report their own truth. ──
    const point = await page.evaluate((cell) => {
      const projected = (window as any).__ARES_DEV_CELL_SCREEN?.(cell.x, cell.y)
      const rect = (window as any).__voxel_canvas?.getBoundingClientRect()
      return projected && rect ? { x: rect.left + projected.x, y: rect.top + projected.y } : null
    }, stage!)
    expect(point, 'the stage cell must project to a canvas pixel for the armed hover').toBeTruthy()
    await page.mouse.move(point!.x, point!.y, { steps: 8 })
    await page.waitForTimeout(120)
    let painted: Cell[] = []
    await expect
      .poll(
        async () => {
          painted = await painted_aoe_cells(page)
          return painted.length
        },
        { timeout: 10_000, message: 'the armed castable hover never painted the aoe channel at all' }
      )
      .toBeGreaterThanOrEqual(1)
    const zone_paint_settled = await expect
      .poll(
        async () => {
          painted = await painted_aoe_cells(page)
          return sorted_keys(painted).join(' ')
        },
        { timeout: 5_000 }
      )
      .toBe(sorted_keys(zone).join(' '))
      .then(() => true)
      .catch(() => false) // evidence captured in `painted`; the final verdict assertion is below

    // ── CAST via the hardened verified press (click_verify law: only a pixel that DECODES to my cell) ──
    expect(
      await click_cell(page, stage!),
      `zone cast never aligned a verified press pixel on cell ${cell_key(stage!)}`
    ).toBe('pressed')
    await expect
      .poll(() => cast_queue(page).then((queue) => queue.length), {
        timeout: 10_000,
        message: 'the zone cast never registered on the draft queue — dead click?',
      })
      .toBe(1)
    const queued = await cast_queue(page)
    expect(
      queued.last ? cell_key(queued.last) : null,
      'the zone cast registered on the WRONG cell — a registered effect is never blind-retried'
    ).toBe(cell_key(stage!))
    await expect
      .poll(() => snapshot(page).then((state) => state.me!.ap), {
        message: 'the drafted zone cast must charge its seeded AP cost',
      })
      .toBe(before.me!.ap - level_one.ap_cost)

    // ── COMMIT the turn (real END TURN button) and wait for the receipt to land ──
    const end_turn = page.locator('.hud-fightctl__end')
    await expect(end_turn).toBeVisible()
    await expect(end_turn).toBeEnabled({ timeout: 12_000 })
    await human_click_locator(page, end_turn)
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              ((window as any).__ARES_FIGHT_TRACE ?? []).find((row: any) => row.event === 'flush_finished')?.ok ?? null
          ),
        { timeout: 90_000, message: 'the zone-cast turn never committed successfully' }
      )
      .toBe(true)
    const flush = await page.evaluate(
      () => ((window as any).__ARES_FIGHT_TRACE ?? []).find((row: any) => row.event === 'flush_started')?.cast_count
    )
    expect(flush, 'exactly one drafted cast must have committed').toBe(1)

    // ── EVERY ENTITY IN THE ZONE TAKES THE EFFECT — display first (presentation-paced, one HP beat per hit:
    //    wait until EVERY living in-zone mob shows its drop, then let the render queue drain), then the chain ──
    await expect
      .poll(
        async () => {
          const state = await snapshot(page)
          return in_zone_mobs.every((prior) => {
            const now = state.mobs.find((row) => row.id === prior.id)
            return !!now && now.health < prior.health
          })
        },
        { timeout: 60_000, message: 'not every in-zone mob showed an HP drop after the zone cast committed' }
      )
      .toBe(true)
    await expect
      .poll(() => snapshot(page).then((state) => !state.presenting), {
        timeout: 30_000,
        message: 'the zone-cast presentation never drained',
      })
      .toBe(true)
    const after = await snapshot(page)
    const display_verdicts = zone_verdicts({
      zone,
      caster_id: before.me!.id,
      before: display_rows(before),
      after: display_rows(after),
    })
    expect(display_verdicts.hits, 'the zone law must have demanded at least one hit').toBeGreaterThanOrEqual(1)
    expect(
      display_verdicts.ok,
      `DISPLAY zone law broken: ${JSON.stringify(display_verdicts.rows)} (zone ${sorted_keys(zone).join(' ')})`
    ).toBe(true)

    const chain_after = await chain_rows(page, before.fight_id!, before.me!.id)
    const chain_verdicts = zone_verdicts({
      zone,
      caster_id: before.me!.id,
      before: [chain_before.caster!, ...chain_before.mobs],
      after: [chain_after.caster!, ...chain_after.mobs],
    })
    expect(
      chain_verdicts.ok,
      `CHAIN zone law broken: ${JSON.stringify(chain_verdicts.rows)} (zone ${sorted_keys(zone).join(' ')})`
    ).toBe(true)

    // ── DISPLAY == CHAIN parity, exact, per fighter (the "chain state + display parity" clause of the order) ──
    await expect
      .poll(
        async () => {
          const settled = await snapshot(page)
          return settled.mobs
            .map((mob) => `${mob.id}:${mob.health}`)
            .sort()
            .join(' ')
        },
        { timeout: 30_000, message: 'display mob HP never converged onto the chain truth' }
      )
      .toBe(
        chain_after.mobs
          .map((mob) => `${mob.id}:${mob.health}`)
          .sort()
          .join(' ')
      )
    expect(chain_after.caster!.health, 'the caster stands in its own zone UNHARMED (enemies-only filter)').toBe(
      chain_before.caster!.health
    )
    expect(after.me!.health, 'display caster HP must agree with the chain').toBe(chain_after.caster!.health)

    // ── THE TARGETING PREVIEW VERDICT (asserted last so the effect legs above always reported): the armed
    //    hover must have painted the FULL multi-cell zone, not just the cursor cell. ──
    expect(
      zone_paint_settled,
      `the multi-cell targeting preview never painted the zone: expected aoe channel ${sorted_keys(zone).join(' ')}, ` +
        `last observed ${sorted_keys(painted).join(' ') || '(nothing)'} — the zone paint is missing or partial`
    ).toBe(true)
  })
})
