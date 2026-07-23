// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP HELPERS — the browser drivers the two-actor coop gold row needs beyond what specs_anchor exports.
// IMPORT-ONLY BRIDGE over the anchor lane (fence: specs_anchor/** is read-only for this lane): everything the
// anchor file EXPORTS is reused verbatim (snapshot, click_cell, human_click_locator, draft-independent gestures);
// the four private idioms this file twins (drafted_cell · placement pick+ready · stacked casts · end turn) are
// deliberate thin copies — the SMALLEST HONEST BRIDGE is a one-word `export` on each in fight_mouse_helpers.ts,
// owned by the test-infra lane (named in the lane report), after which these twins collapse to imports.
import { expect, type Page } from '@playwright/test'

import { CLICK_POLICY } from '../specs_anchor/click_verify'
import {
  click_cell,
  click_damage_spell,
  gold_manifest,
  human_click_locator,
  snapshot,
  type Cell,
} from '../specs_anchor/fight_mouse_helpers'

export type GoldWallet = { address: string; privkey: string }
export type FighterRow = {
  id: string
  name: string
  team: number
  is_player: boolean
  dead: boolean
  hp: number
  ap: number
  mp: number
  cell: Cell
}

export const cell_key = (cell: Cell) => `${cell.x}:${cell.y}`

// ── boot (the light twin of boot_fixture_world: roster → world join → mount, NO fixture-mob search) ──────────

/** Roster-only boot: dev wallet + localnet ids injected, /characters?dev, chain roster resolved. */
export async function boot_roster_lite(page: Page, wallet: GoldWallet) {
  await page.addInitScript(
    (payload: { key: string; ids: any }) => {
      ;(window as any).__ARES_DEV_KEY = payload.key
      ;(window as any).__ARES_LOCALNET_IDS = payload.ids
    },
    { key: wallet.privkey, ids: gold_manifest.ids.aresrpg }
  )
  await page.goto('/characters?dev')
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__ARES_ENGINE?.get_state().sui?.loaded), {
      timeout: 45_000,
      message: 'coop roster did not resolve',
    })
    .toBe(true)
}

/** Full light boot: roster → join the world with the REQUESTED character → checkpoint settles → the world
 *  mounts at /?dev&fighttrace=1 (the probe armed). A joiner needs no discovered mob — no search leg. */
export async function boot_world_lite(page: Page, wallet: GoldWallet, world_id: string, character_id: string) {
  await boot_roster_lite(page, wallet)
  const joined = await page.evaluate(
    async ({ requested_world, requested_character }) => {
      // No load_roster re-run: boot_roster_lite's sui.loaded poll already proved the roster dispatched
      // (loaded:true rides the SAME dispatch as characters in boot_roster/load_roster — one atomic snapshot).
      const join = await import('/src/world-shell/world_join.js')
      const engine = (window as any).__ARES_ENGINE
      const character = engine.get_state().sui.characters.find((row: any) => row.id === requested_character)
      if (!character) return null
      engine.dispatch('action/select_character', character.id)
      const result = await join.join_world_action({ character_id: character.id, world_id: requested_world })
      return { digest: result?.timing?.digest ?? null }
    },
    { requested_world: world_id, requested_character: character_id }
  )
  expect(joined, `coop wallet has no character ${character_id}`).toBeTruthy()
  expect(joined!.digest, 'coop world join produced no certified digest').toBeTruthy()
  // Owned-object read lag: poll the per-world checkpoint readable before mounting (the anchor boot's same law).
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ id, world }) => {
            const { read_checkpoint } = await import('/src/chain/read_checkpoint.js')
            return !!(await read_checkpoint(id, world))
          },
          { id: character_id, world: world_id }
        ),
      { timeout: 45_000, message: 'coop checkpoint never settled after world join' }
    )
    .toBe(true)
  await page.evaluate(async (id) => {
    const { set_last_character } = await import('/src/game/core/draft.js')
    await set_last_character(id)
  }, character_id)
  await page.goto('/?dev&fighttrace=1')
  await expect
    .poll(
      () =>
        page.evaluate(
          async ({ id, world }) => {
            const { use_world_binding } = await import('/src/world-shell/session_gate.js')
            const state = (window as any).__ARES_ENGINE?.get_state()
            return (
              state?.selected_character_id === id &&
              !!(window as any).__voxel_engine?.get_scene?.() &&
              !!(window as any).__voxel_canvas &&
              use_world_binding.getState().world === world
            )
          },
          { id: character_id, world: world_id }
        ),
      { timeout: 90_000, message: 'coop world did not mount for the joiner' }
    )
    .toBe(true)
  await expect(page.locator('.gw-selfplate')).toBeVisible()
}

// ── discovery + the product join door ────────────────────────────────────────────────────────────────────────

/** The EXACT discovery read FightsModal renders from: /v1 fights → to_fight_marker → is_join_legal. */
export async function discover_fights(page: Page, world_id: string) {
  return page.evaluate(async (world) => {
    const [{ get_fights }, nearby] = await Promise.all([
      import('/src/rpc/client'),
      import('/@id/@aresrpg/world'), // to_fight_marker — packages/world/src/nearby_fights.js since D770a
    ])
    const fights = await get_fights({ world }).catch(() => [])
    return (fights ?? [])
      .map((row: any) => nearby.to_fight_marker(row))
      .filter(Boolean)
      .map((marker: any) => ({
        id: marker.id,
        public: !!marker.public,
        status: String(marker.status),
        participant_count: Number(marker.participant_count ?? 0),
        join_legal: nearby.is_join_legal(marker, false),
      }))
  }, world_id)
}

/** The product join door — the EXACT composition FightsModal's JOIN runs: join_world_fight (fight::join PTB,
 *  signed) then enter_world_fight from the receipt boundary. Resolves when B's own board adopts the fight. */
export async function join_fight_by_door(page: Page, fight_id: string, character_id: string) {
  await page.evaluate(
    async ({ fight, character }) => {
      const [{ join_world_fight }, { enter_world_fight }, { enter_after_world_join_receipt }] = await Promise.all([
        import('/src/world-shell/dungeon_actions.js'),
        import('/src/world-shell/world_fight.js'),
        import('/src/world-shell/world_fight_receipt.js'),
      ])
      await enter_after_world_join_receipt({
        execute: () => join_world_fight({ fight_id: fight, character_id: character, party_id: null }),
        enter: enter_world_fight,
        fight_id: fight,
        character_id: character,
      })
    },
    { fight: fight_id, character: character_id }
  )
  await expect
    .poll(() => snapshot(page).then((state) => state.fight_id), {
      timeout: 60_000,
      message: 'the joined fight never mounted on the joiner board',
    })
    .toBe(fight_id)
  await expect
    .poll(() => snapshot(page).then((state) => state.me?.id ?? null), {
      timeout: 60_000,
      message: 'the joiner never received its own seat entity',
    })
    .not.toBeNull()
}

/** The product WATCH door — the exact call FightsModal makes for a public ACTIVE fight. The return only
 *  acknowledges the binding; hydration is async, so prove the seatless core view before returning. */
export async function watch_fight_by_door(page: Page, fight_id: string, world_id: string | null = null) {
  const entered = await page.evaluate(
    async ({ requested_fight_id, requested_world_id }) => {
      const { spectate_world_fight } = await import('/src/world-shell/world_fight.js')
      return spectate_world_fight({
        fight_id: requested_fight_id,
        world_id: requested_world_id,
        public_fight: true,
        status: 'active',
      })
    },
    { requested_fight_id: fight_id, requested_world_id: world_id }
  )
  expect(entered, `WATCH refused the public active fight ${fight_id}`).toBe(true)
  await expect
    .poll(
      () =>
        page.evaluate(async (expected_fight_id) => {
          const [{ use_dungeon }, { fight_view }] = await Promise.all([
            import('/src/world-shell/dungeon_store.js'),
            import('/@id/@aresrpg/fight/project'),
          ])
          const dungeon = use_dungeon.getState()
          const fight = fight_view()
          return {
            fight_id: dungeon.fight_id,
            spectating: dungeon.spectating,
            spectator: fight?.spectator === true,
            view_fight_id: fight?.fight_id ?? null,
          }
        }, fight_id),
      { timeout: 60_000, message: `WATCH never hydrated the spectator board for ${fight_id}` }
    )
    .toEqual({ fight_id, spectating: true, spectator: true, view_fight_id: fight_id })
}

/** A join attempt expected to be REFUSED: returns the surfaced (humanized) error message, or null when the
 *  join wrongly succeeded. The caller owns the assert. */
export async function join_refusal_message(page: Page, fight_id: string, character_id: string) {
  return page.evaluate(
    async ({ fight, character }) => {
      const { join_world_fight } = await import('/src/world-shell/dungeon_actions.js')
      try {
        await join_world_fight({ fight_id: fight, character_id: character, party_id: null })
        return null
      } catch (error: any) {
        return String(error?.message ?? error)
      }
    },
    { fight: fight_id, character: character_id }
  )
}

// ── board reads (all fighters + the rendered probe) ─────────────────────────────────────────────────────────

/** EVERY fighter on this page's board (players included — the anchor snapshot exposes only me+mobs). */
export async function fighters_snapshot(page: Page): Promise<FighterRow[]> {
  return page.evaluate(() => {
    const fight = (window as any).__ARES_ENGINE?.get_state().fight
    if (!fight) return []
    return [...fight.fighters.values()].map((row: any) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      team: Number(row.team),
      is_player: !!row.is_player,
      dead: !!row.dead,
      hp: Number(row.health ?? 0),
      ap: Number(row.ap ?? 0),
      mp: Number(row.mp ?? 0),
      cell: { x: Number(row.cell.x), y: Number(row.cell.y) },
    }))
  })
}

/** The page's rendered beat probe — the cross-visibility and trap-trigger evidence source. */
export async function probe_beats(
  page: Page
): Promise<Array<{ t: number; kind: string; id: string | null; spell_id: string | null }>> {
  return page.evaluate(() => {
    const probe = (window as any).__ARES_FIGHT_PROBE
    return (probe?.beats ?? []).map((row: any) => ({
      t: Number(row.t ?? 0),
      kind: String(row.kind),
      id: row.id == null ? null : String(row.id),
      spell_id: row.spell_id == null ? null : String(row.spell_id),
    }))
  })
}

/** The living mob's board row on this page (coop rows fight exactly one group). */
export async function living_mob(page: Page): Promise<FighterRow | null> {
  const rows = await fighters_snapshot(page)
  return rows.find((row) => !row.is_player && !row.dead) ?? null
}

// ── local draft oracles (thin twins of the anchor privates — see the bridge note in the header) ─────────────

async function drafted_cell(page: Page, key: 'move_target' | 'cast_target' | 'placement_pick'): Promise<Cell | null> {
  return page.evaluate(async (field) => {
    const [{ use_dungeon_turn }, { decode }] = await Promise.all([
      import('/src/game/screens/dungeon-turn.js'),
      import('/@id/@aresrpg/fight/los'),
    ])
    const value = (use_dungeon_turn.getState() as Record<string, any>)[field]
    return value == null ? null : decode(value)
  }, key)
}

async function cast_queue_length(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const { use_dungeon_turn } = await import('/src/game/screens/dungeon-turn.js')
    return use_dungeon_turn.getState().cast_path.length
  })
}

// ── placement (hardened pick + READY + the per-seat commit fold) ────────────────────────────────────────────

/** Pick a free near-mob placement cell with the verified gesture, READY, and prove the on-chain fold
 *  (me.cell == pick) — legal while the fight STAYS in placement (other seats still pending). */
export async function place_and_ready(page: Page): Promise<Cell> {
  await expect.poll(() => snapshot(page).then((state) => state.placement), { timeout: 45_000 }).toBe(true)
  const state = await snapshot(page)
  const fighters = await fighters_snapshot(page)
  const occupied = new Set(fighters.filter((row) => !row.dead).map((row) => cell_key(row.cell)))
  const mob = fighters.find((row) => !row.is_player && !row.dead)
  expect(mob, 'coop placement found no living mob on the board').toBeTruthy()
  const free = state.placement_cells
    .filter((cell) => !occupied.has(cell_key(cell)))
    .sort(
      (a, b) =>
        Math.abs(a.x - mob!.cell.x) +
        Math.abs(a.y - mob!.cell.y) -
        (Math.abs(b.x - mob!.cell.x) + Math.abs(b.y - mob!.cell.y))
    )
  const pick = free.find((cell) => cell_key(cell) !== cell_key(state.me!.cell)) ?? free[0]
  expect(pick, 'coop seat has no free placement cell').toBeTruthy()
  // The pick is an idempotent LOCAL choice (D66) — wrong-cell may re-click bounded, dead clicks fail loud.
  const policy = { ...CLICK_POLICY, wrong_cell_retriable: true, max_attempts: 4 }
  let registered: Cell | null = null
  for (let attempts = 1; attempts <= policy.max_attempts && !registered; attempts += 1) {
    if ((await click_cell(page, pick!, policy)) !== 'pressed') continue
    const deadline = Date.now() + 6_000
    while (Date.now() < deadline && !registered) {
      const draft = await drafted_cell(page, 'placement_pick')
      if (draft && cell_key(draft) === cell_key(pick!)) registered = draft
      else await page.waitForTimeout(150)
    }
  }
  expect(registered ? cell_key(registered) : null, `coop placement pick never registered on ${cell_key(pick!)}`).toBe(
    cell_key(pick!)
  )
  await human_click_locator(page, page.locator('.hud-fightctl__ready'))
  // The commit fold: place_at landed, so the projected seat reflects the picked cell even mid-placement.
  await expect
    .poll(() => snapshot(page).then((s) => cell_key(s.me!.cell)), {
      timeout: 30_000,
      message: 'the placement commit never folded onto the seat cell',
    })
    .toBe(cell_key(pick!))
  return pick!
}

// ── one driven turn (playable-gate → optional body-aware move → arm → bounded casts → END TURN) ─────────────

async function wait_playable(page: Page) {
  await expect
    .poll(
      async () => {
        const state = await snapshot(page)
        const mob_alive = (await fighters_snapshot(page)).some((row) => !row.is_player && !row.dead)
        return !mob_alive || (!!state.me && state.active === state.me.id && !state.presenting)
      },
      { timeout: 30_000, message: 'board never became playable (active===me && !presenting)' }
    )
    .toBe(true)
}

/** Body-aware BFS toward the mob: OTHER LIVING PLAYERS block cells too (the anchor path_to_mob ignores them —
 *  fine solo, wrong in coop; noted as the bridge's second parameter). Returns the path of steps to adjacency. */
function path_to_mob_coop(
  me: FighterRow,
  rows: FighterRow[],
  arena: { width: number; height: number; cells: number[] }
) {
  const mob = rows.find((row) => !row.is_player && !row.dead)
  if (!mob) return []
  const occupied = new Set(rows.filter((row) => !row.dead && row.id !== me.id).map((row) => cell_key(row.cell)))
  const queue: Array<{ cell: Cell; path: Cell[] }> = [{ cell: me.cell, path: [] }]
  const seen = new Set([cell_key(me.cell)])
  while (queue.length) {
    const current = queue.shift()!
    if (Math.abs(current.cell.x - mob.cell.x) + Math.abs(current.cell.y - mob.cell.y) <= 1) return current.path
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cell = { x: current.cell.x + dx, y: current.cell.y + dy }
      const key = cell_key(cell)
      const index = cell.y * arena.width + cell.x
      if (
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= arena.width ||
        cell.y >= arena.height ||
        arena.cells[index] !== 0 ||
        occupied.has(key) ||
        seen.has(key)
      )
        continue
      seen.add(key)
      queue.push({ cell, path: [...current.path, cell] })
    }
  }
  return []
}

/** Play ONE whole turn on this page: move toward the mob when out of reach (verified draft), arm a guaranteed
 *  damage spell, cast up to `max_casts` at the mob when adjacent, END TURN. Returns what actually happened. */
export async function play_turn(page: Page, { max_casts = 1 }: { max_casts?: number } = {}) {
  await wait_playable(page)
  const before = await snapshot(page)
  const rows = await fighters_snapshot(page)
  const me = rows.find((row) => row.id === before.me?.id)
  const mob = rows.find((row) => !row.is_player && !row.dead)
  if (!me || !mob) return { moved: null as Cell | null, casts: 0, mob_alive: !!mob }
  let moved: Cell | null = null
  const distance = Math.abs(me.cell.x - mob.cell.x) + Math.abs(me.cell.y - mob.cell.y)
  if (distance > 1) {
    const path = path_to_mob_coop(me, rows, before.arena!)
    const target = path[Math.min(path.length, Math.max(1, me.mp)) - 1]
    if (target) {
      const baseline = await drafted_cell(page, 'move_target')
      let registered: Cell | null = null
      for (let attempts = 1; attempts <= CLICK_POLICY.max_attempts && !registered; attempts += 1) {
        await wait_playable(page)
        if ((await click_cell(page, target)) !== 'pressed') continue
        const deadline = Date.now() + 4_000
        while (Date.now() < deadline && !registered) {
          const draft = await drafted_cell(page, 'move_target')
          if (draft && (!baseline || cell_key(draft) !== cell_key(baseline))) registered = draft
          else await page.waitForTimeout(150)
        }
        // A registered WRONG cell is FINAL (a committed move draft is never blind-retried — D254).
        if (registered) expect(cell_key(registered), 'coop move draft registered the wrong cell').toBe(cell_key(target))
      }
      expect(registered, `coop move draft never registered on ${cell_key(target)}`).toBeTruthy()
      moved = target
    }
  }
  // Arm a guaranteed point-damage spell through the REAL socket (the exported anchor gesture asserts arming).
  const spell = await click_damage_spell(page)
  const aim_from = (await drafted_cell(page, 'move_target')) ?? me.cell
  let casts = 0
  if (Math.abs(aim_from.x - mob.cell.x) + Math.abs(aim_from.y - mob.cell.y) <= 1) {
    for (let cast = 0; cast < max_casts; cast += 1) {
      const affordable = await expect
        .poll(() => spell.getAttribute('aria-disabled'), { timeout: 2_000 })
        .not.toBe('true')
        .then(() => true)
        .catch(() => false)
      if (!affordable) break
      if (!(await living_mob(page))) break
      const queued_before = await cast_queue_length(page)
      expect(await click_cell(page, mob.cell), 'coop cast click never aligned a verified press').toBe('pressed')
      let grew = false
      for (let wait = 0; wait < 27 && !grew; wait += 1) {
        if ((await cast_queue_length(page)) > queued_before) grew = true
        else await page.waitForTimeout(150)
      }
      if (!grew) break
      casts += 1
    }
  }
  const end = page.locator('.hud-fightctl__end')
  if (await living_mob(page)) {
    await expect(end, 'END TURN not clickable on a living-mob coop turn').toBeEnabled({ timeout: 12_000 })
    await human_click_locator(page, end)
  }
  return { moved, casts, mob_alive: !!(await living_mob(page)) }
}

// ── fight end ────────────────────────────────────────────────────────────────────────────────────────────────

/** The seat's own Victory dialog: asserts it, parses the rendered "+N XP", presses Continue (the product open),
 *  dismisses a Later prompt, and proves a clean world return (fight chrome gone, selfplate back). */
export async function assert_victory_and_continue(page: Page): Promise<bigint> {
  const dialog = page.locator('[role="dialog"][aria-label^="Victory:"]')
  await expect(dialog).toBeVisible({ timeout: 150_000 })
  await expect(dialog.locator('.fe-gain')).toContainText(/\+\d+ XP/, { timeout: 45_000 })
  const gain_text = (await dialog.locator('.fe-gain').first().textContent()) ?? ''
  const parsed = /\+(\d+) XP/.exec(gain_text)
  expect(parsed, `victory gain text unparseable: "${gain_text}"`).toBeTruthy()
  await human_click_locator(page, dialog.getByRole('button', { name: 'Continue', exact: true }))
  const later = page.getByRole('button', { name: 'Later', exact: true })
  await later.waitFor({ state: 'visible', timeout: 1_500 }).catch(() => {})
  if (await later.isVisible()) await human_click_locator(page, later)
  await expect(page.locator('.hud-fightctl')).toHaveCount(0, { timeout: 45_000 })
  await expect(page.locator('.gw-selfplate')).toBeVisible()
  return BigInt(parsed![1])
}

/** CHAIN-TRUTH EXPORT (the coop desync oracle, ruled 2026-07-22): one client's settled COMMITTED board,
 *  serialized comparable. Two clients that folded the same journal MUST export deep-equal values here.
 *  Per-client channels stay out by design: my_entity_id, presented paces, and trap/glyph overlays. Accepted
 *  budget is exported separately because chain-silent GIVE_POINTS claims are authoritative draft legality. */
export async function chain_truth_export(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const [{ decode }, { engine_view_of }, { fight_store, claimed_budget_state, committed_state }, { range_bonus_of }] =
      await Promise.all([
        import('/@id/@aresrpg/fight/los'),
        import('/@id/@aresrpg/fight/project'),
        import('/@id/@aresrpg/fight/store'),
        import('/@id/@aresrpg/fight/statuses'),
      ])
    const state = fight_store.getState()
    const view = engine_view_of(state)
    if (!view?.fighters) return null
    const committed = committed_state(state)
    const budget = claimed_budget_state(state)
    let player_index = 0
    let mob_index = 0
    return [...view.fighters.values()]
      .map((row: any) => {
        const key = row.is_player ? `p${player_index++}` : `m${mob_index++}`
        const fighter = committed.fighters?.[key]
        const accepted = budget.fighters?.[key]
        const cell = fighter?.cell == null ? row.cell : decode(fighter.cell)
        const effects = (fighter?.statuses ?? []).map((effect: any) => ({
          kind: effect.kind == null ? null : Number(effect.kind),
          remaining_turns: effect.remaining_turns == null ? null : Number(effect.remaining_turns),
          element: effect.element == null ? null : Number(effect.element),
          value: effect.value == null ? null : Number(effect.value),
          stat: effect.stat == null ? null : Number(effect.stat),
          chance: effect.chance == null ? null : Number(effect.chance),
          flags: effect.flags == null ? null : Number(effect.flags),
        }))
        return {
          id: String(row.id),
          owner: row.owner == null ? null : String(row.owner),
          variant: row.variant == null ? null : String(row.variant),
          team: Number(row.team),
          cell: cell == null ? null : { x: Number(cell.x), y: Number(cell.y) },
          hp: Number(fighter?.hp ?? row.committed_health),
          alive: !!(fighter?.alive ?? row.committed_alive),
          hp_max: Number(row.health_max),
          ap: fighter?.ap == null ? null : Number(fighter.ap),
          mp: fighter?.mp == null ? null : Number(fighter.mp),
          accepted_ap: accepted?.ap == null ? null : Number(accepted.ap),
          accepted_mp: accepted?.mp == null ? null : Number(accepted.mp),
          turn_number: fighter?.turn_number == null ? null : Number(fighter.turn_number),
          invisible: !!fighter?.invisible,
          effective_range: Number(
            range_bonus_of({
              id: String(row.id),
              base_range: Number(row.base_range ?? 0),
              effects,
            })
          ),
          effects,
        }
      })
      .sort((left: any, right: any) => left.id.localeCompare(right.id))
  })
}

export type committed_visibility = {
  target: string
  status_kind: number | null
  invisible: boolean
  remaining_turns: number
}

/**
 * Five-way visibility oracle over a fresh authoritative Fight-object read. Kind-27 ActionEffect is receipt-only
 * and the flat journal has no kind-27 event twin, so a spectator's settled store cannot honestly reconstruct it.
 * Every browser instead reads the committed Fight.fx status row and maps its fighter seat back to the target id.
 */
export async function committed_visibility_export(
  page: Page,
  args: { fight_id: string; target: string }
): Promise<committed_visibility | null> {
  return page.evaluate(
    async ({ requested_fight, target_id }) => {
      const [{ get_sdk }, { read_object }, { decode_fight }, statuses, controls] = await Promise.all([
        import('/src/chain/sdk'),
        import('/src/world-shell/run_reads.js'),
        import('/@id/@aresrpg/sdk/fight'),
        import('/@id/@aresrpg/fight/fight_status_snapshot'),
        import('/@id/@aresrpg/fight/fight_control'),
      ])
      const read = await read_object(await get_sdk(), requested_fight).catch(() => null)
      const fight = read ? decode_fight(read.json) : null
      if (!fight) return null
      const seat = (fight.participants ?? []).findIndex((participant: any) => {
        const row = participant?.fields ?? participant
        const entity = controls.participant_entity_id({
          character: row?.character ?? row?.character_id,
          addr: row?.addr ?? row?.owner,
        })
        return String(entity ?? '') === target_id
      })
      if (seat < 0) return null
      const active = statuses
        .read_fighter_statuses(read.json)
        .filter((row: any) => Number(row.fighter) === seat && Number(row.kind) === statuses.INVISIBILITY_STATUS_KIND)
      const remaining_turns = active.reduce(
        (longest: number, row: any) => Math.max(longest, Number(row.remaining_turns) || 0),
        0
      )
      return {
        target: target_id,
        status_kind: remaining_turns > 0 ? statuses.INVISIBILITY_STATUS_KIND : null,
        invisible: remaining_turns > 0,
        remaining_turns,
      }
    },
    { requested_fight: args.fight_id, target_id: args.target }
  )
}

export type committed_resource_turn = {
  entity: string
  seat: number
  turn: number
  resource: 'ap' | 'mp'
  start: number
  minimum_grant: number
  spent: number
  minimum_remaining: number
  action_count: number
  grant_target: Cell
  destination: Cell | null
}

/**
 * Five-way grant oracle. `claimed_budget_state` is a local current-turn legality overlay and expires at TurnEnded,
 * so every observer instead projects the flat canonical Cast/Moved journal. The actor-side committed spell clocks
 * bind those actions to the catalog ids; this export proves all five observers accepted the same excess-budget use.
 */
export async function committed_resource_turn_export(
  page: Page,
  args: {
    entity: string
    resource: 'ap' | 'mp'
    expected_actions: number
    minimum_grant: number
    action_costs: number[]
    grant_target: Cell
    before: Array<{ id: string; cell: Cell | null; ap: number | null; mp: number | null; alive?: boolean }>
  }
): Promise<committed_resource_turn | null> {
  return page.evaluate(
    async ({ fighter_id, pool, action_count, grant_floor, costs, aimed, before_board }) => {
      const [{ fight_store }, { engine_view_of }, { bfsPath, decode, encode, GRID_CELLS }] = await Promise.all([
        import('/@id/@aresrpg/fight/store'),
        import('/@id/@aresrpg/fight/project'),
        import('/@id/@aresrpg/fight/los'),
      ])
      const state = fight_store.getState()
      const view = engine_view_of(state)
      if (!view?.fighters) return null

      let player_seat = -1
      let cursor = 0
      for (const fighter of view.fighters.values()) {
        if (!fighter.is_player) continue
        if (String(fighter.id) === fighter_id) player_seat = cursor
        cursor += 1
      }
      if (player_seat < 0) return null

      const rows = Object.values(state.entries ?? {})
        .filter((entry: any) => entry.source === 'canonical')
        .sort(
          (left: any, right: any) =>
            Number(left.version) - Number(right.version) || Number(left.event_idx) - Number(right.event_idx)
        )
      const turn_end = rows.findLastIndex(
        (row: any) => row.kind === 'TurnEnded' && !row.is_mob && Number(row.idx) === player_seat
      )
      const turn_start = rows.findLastIndex(
        (row: any, index: number) =>
          index < turn_end && row.kind === 'TurnStarted' && !row.is_mob && Number(row.idx) === player_seat
      )
      if (turn_start < 0 || turn_end < 0) return null
      const turn_rows = rows.slice(turn_start, turn_end + 1)
      const casts = turn_rows.filter(
        (row: any) => row.kind === 'Cast' && !row.caster_is_mob && Number(row.caster_idx) === player_seat
      )
      if (
        casts.length !== action_count ||
        !casts[0] ||
        Number(casts[0].target_cell) !== encode(aimed.x, aimed.y) ||
        !(grant_floor > 0)
      )
        return null

      const baseline = before_board.find((fighter: any) => String(fighter.id) === fighter_id)
      const start = Number(baseline?.[pool])
      if (!baseline?.cell || !Number.isFinite(start)) return null
      const grant = grant_floor
      const grant_target = decode(Number(casts[0].target_cell))

      if (pool === 'ap') {
        if (costs.length !== casts.length || costs.some((cost: number) => !(cost > 0))) return null
        const spent = costs.reduce((sum: number, cost: number) => sum + cost, 0)
        if (!(spent > start && spent <= start + grant)) return null
        return {
          entity: fighter_id,
          seat: player_seat,
          turn: Number(rows[turn_end].version),
          resource: pool,
          start,
          minimum_grant: grant,
          spent,
          minimum_remaining: start + grant - spent,
          action_count: casts.length,
          grant_target,
          destination: null,
        }
      }

      const cast_index = turn_rows.indexOf(casts[0])
      const move_index = turn_rows.findIndex((row: any) => row.kind === 'Moved' && String(row.character) === fighter_id)
      const moved = turn_rows[move_index]
      if (!moved || move_index <= cast_index) return null
      const blocked = new Set<number>()
      for (const [cell, value] of (view.arena?.cells ?? []).entries()) if (value) blocked.add(cell)
      for (const fighter of before_board)
        if (fighter.id !== fighter_id && fighter.alive !== false && fighter.cell)
          blocked.add(encode(fighter.cell.x, fighter.cell.y))
      const route = bfsPath(encode(baseline.cell.x, baseline.cell.y), Number(moved.to_cell), blocked, GRID_CELLS)
      const spent = route.length
      if (!(spent > start && spent <= start + grant)) return null
      return {
        entity: fighter_id,
        seat: player_seat,
        turn: Number(rows[turn_end].version),
        resource: pool,
        start,
        minimum_grant: grant,
        spent,
        minimum_remaining: start + grant - spent,
        action_count: casts.length,
        grant_target,
        destination: decode(Number(moved.to_cell)),
      }
    },
    {
      fighter_id: args.entity,
      pool: args.resource,
      action_count: args.expected_actions,
      grant_floor: args.minimum_grant,
      costs: args.action_costs,
      aimed: args.grant_target,
      before_board: args.before,
    }
  )
}

export type committed_drain = {
  caster: string
  caster_seat: number
  target: string
  target_is_mob: boolean
  target_index: number
  resource: 'ap' | 'mp'
  removed: number
  requested: number
  cast_target: Cell
  cast_count: number
}

/** Five-way point-removal oracle over the canonical Cast + Drain rows that the indexer preserves. */
export async function committed_drain_export(
  page: Page,
  args: { caster: string; target: string; resource: 'ap' | 'mp'; cast_target: Cell }
): Promise<committed_drain | null> {
  return page.evaluate(
    async ({ caster_id, target_id, pool, aimed }) => {
      const [{ fight_store }, { engine_view_of }, { decode, encode }] = await Promise.all([
        import('/@id/@aresrpg/fight/store'),
        import('/@id/@aresrpg/fight/project'),
        import('/@id/@aresrpg/fight/los'),
      ])
      const state = fight_store.getState()
      const view = engine_view_of(state)
      if (!view?.fighters) return null

      let caster_seat = -1
      let target_index = -1
      let target_is_mob = false
      let player_index = 0
      let mob_index = 0
      for (const fighter of view.fighters.values()) {
        if (fighter.is_player) {
          if (String(fighter.id) === caster_id) caster_seat = player_index
          if (String(fighter.id) === target_id) {
            target_index = player_index
            target_is_mob = false
          }
          player_index += 1
        } else {
          if (String(fighter.id) === target_id) {
            target_index = mob_index
            target_is_mob = true
          }
          mob_index += 1
        }
      }
      if (caster_seat < 0 || target_index < 0) return null

      const rows = Object.values(state.entries ?? {})
        .filter((entry: any) => entry.source === 'canonical')
        .sort(
          (left: any, right: any) =>
            Number(left.version) - Number(right.version) || Number(left.event_idx) - Number(right.event_idx)
        )
      const turn_end = rows.findLastIndex(
        (row: any) => row.kind === 'TurnEnded' && !row.is_mob && Number(row.idx) === caster_seat
      )
      const turn_start = rows.findLastIndex(
        (row: any, index: number) =>
          index < turn_end && row.kind === 'TurnStarted' && !row.is_mob && Number(row.idx) === caster_seat
      )
      if (turn_start < 0 || turn_end < 0) return null
      const turn_rows = rows.slice(turn_start, turn_end + 1)
      const casts = turn_rows.filter(
        (row: any) => row.kind === 'Cast' && !row.caster_is_mob && Number(row.caster_idx) === caster_seat
      )
      const fumbled = turn_rows.some(
        (row: any) => row.kind === 'CriticalFailure' && !row.caster_is_mob && Number(row.caster_idx) === caster_seat
      )
      if (fumbled || casts.length !== 1 || Number(casts[0].target_cell) !== encode(aimed.x, aimed.y)) return null

      const point_kind = pool === 'ap' ? 0 : 1
      const drains = turn_rows.filter(
        (row: any) =>
          row.kind === 'Drain' &&
          !!row.target_is_mob === target_is_mob &&
          Number(row.target_idx) === target_index &&
          Number(row.point_kind) === point_kind &&
          Number(row.removed) > 0
      )
      if (drains.length !== 1) return null
      const [drain] = drains
      return {
        caster: caster_id,
        caster_seat,
        target: target_id,
        target_is_mob,
        target_index,
        resource: pool,
        removed: Number(drain.removed),
        requested: Number(drain.requested),
        cast_target: decode(Number(casts[0].target_cell)),
        cast_count: casts.length,
      }
    },
    {
      caster_id: args.caster,
      target_id: args.target,
      pool: args.resource,
      aimed: args.cast_target,
    }
  )
}

export type committed_dot_tick = {
  caster: string
  caster_seat: number
  target: string
  target_index: number
  cast_target: Cell
  amount: number
  remaining_hp: number
  cast_count: number
}

/**
 * Five-way DoT oracle over the flat canonical journal. Rich ActionEffect envelopes are deliberately not
 * journalled, so this isolates the caster's one accepted Cast and the target mob's next start-of-turn Hit.
 * The caller additionally binds that Cast to Patient Venom through DungeonBoard's exact per-spell clock.
 */
export async function committed_dot_tick_export(
  page: Page,
  args: { caster: string; target: string; target_cell: Cell }
): Promise<committed_dot_tick | null> {
  return page.evaluate(
    async ({ caster_id, target_id, aimed }) => {
      const [{ fight_store }, { engine_view_of }, { decode, encode }] = await Promise.all([
        import('/@id/@aresrpg/fight/store'),
        import('/@id/@aresrpg/fight/project'),
        import('/@id/@aresrpg/fight/los'),
      ])
      const state = fight_store.getState()
      const view = engine_view_of(state)
      if (!view?.fighters) return null

      let caster_seat = -1
      let target_index = -1
      let player_index = 0
      let mob_index = 0
      for (const fighter of view.fighters.values()) {
        if (fighter.is_player) {
          if (String(fighter.id) === caster_id) caster_seat = player_index
          player_index += 1
        } else {
          if (String(fighter.id) === target_id) target_index = mob_index
          mob_index += 1
        }
      }
      if (caster_seat < 0 || target_index < 0) return null

      const rows = Object.values(state.entries ?? {})
        .filter((entry: any) => entry.source === 'canonical')
        .sort(
          (left: any, right: any) =>
            Number(left.version) - Number(right.version) || Number(left.event_idx) - Number(right.event_idx)
        )
      const turn_end = rows.findLastIndex(
        (row: any) => row.kind === 'TurnEnded' && !row.is_mob && Number(row.idx) === caster_seat
      )
      const turn_start = rows.findLastIndex(
        (row: any, index: number) =>
          index < turn_end && row.kind === 'TurnStarted' && !row.is_mob && Number(row.idx) === caster_seat
      )
      if (turn_start < 0 || turn_end < 0) return null

      const casts = rows
        .slice(turn_start, turn_end + 1)
        .filter((row: any) => row.kind === 'Cast' && !row.caster_is_mob && Number(row.caster_idx) === caster_seat)
      const fumbled = rows
        .slice(turn_start, turn_end + 1)
        .some(
          (row: any) => row.kind === 'CriticalFailure' && !row.caster_is_mob && Number(row.caster_idx) === caster_seat
        )
      if (fumbled || casts.length !== 1 || Number(casts[0].target_cell) !== encode(aimed.x, aimed.y)) return null

      const next_player = rows.findIndex(
        (row: any, index: number) => index > turn_end && row.kind === 'TurnStarted' && !row.is_mob
      )
      if (next_player < 0) return null
      // Production emits no mob TurnStarted/TurnEnded anchors. In this fixed 4v1 queue, Yajin p1 is followed by
      // m0, so its complete mob phase is exactly the open interval from p1 TurnEnded to the next player start.
      const mob_rows = rows.slice(turn_end + 1, next_player)
      const hit_index = mob_rows.findIndex(
        (row: any) =>
          row.kind === 'Hit' && row.victim_is_mob && Number(row.victim_idx) === target_index && Number(row.amount) > 0
      )
      const moved = mob_rows.some(
        (row: any) =>
          (row.kind === 'MobMoved' && Number(row.idx) === target_index) ||
          (row.kind === 'Displaced' && row.target_is_mob && Number(row.target_idx) === target_index)
      )
      const mob_cast_index = mob_rows.findIndex(
        (row: any) => row.kind === 'Cast' && row.caster_is_mob && Number(row.caster_idx) === target_index
      )
      const hits = mob_rows.filter(
        (row: any) =>
          row.kind === 'Hit' && row.victim_is_mob && Number(row.victim_idx) === target_index && Number(row.amount) > 0
      )
      if (moved || hit_index < 0 || (mob_cast_index >= 0 && hit_index > mob_cast_index) || hits.length !== 1)
        return null
      const [hit] = hits
      return {
        caster: caster_id,
        caster_seat,
        target: target_id,
        target_index,
        cast_target: decode(Number(casts[0].target_cell)),
        amount: Number(hit.amount),
        remaining_hp: Number(hit.remaining_hp),
        cast_count: casts.length,
      }
    },
    { caster_id: args.caster, target_id: args.target, aimed: args.target_cell }
  )
}
