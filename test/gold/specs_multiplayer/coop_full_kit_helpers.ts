// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FULL-KIT COOP DRIVER — test-only targeting, committed-cast accounting, and hazard→push formations.
import { expect, type Page } from '@playwright/test'

import { click_cell, human_click_locator, snapshot, type Cell } from '../specs_anchor/fight_mouse_helpers'

import { chain_truth_export, living_mob } from './coop_helpers'

export type runtime_effect = {
  kind: string
  kind_id: number
  base: number
  turns: number
  area_shape: string
  area_size: number
  stat?: number
  flags?: number
}
export type runtime_spell = {
  object_id: string
  class: string
  unlock_level: number
  name_key: string
  role: string
  levels: Array<{
    ap: number
    range: [number, number]
    free_cell: boolean
    casts_per_turn: number
    casts_per_target: number
    effects: runtime_effect[]
  }>
}
export type exported_fighter = {
  id: string
  team: number
  cell: Cell | null
  hp: number
  ap: number | null
  mp: number | null
  accepted_ap: number | null
  accepted_mp: number | null
  turn_number: number | null
  invisible: boolean
  effective_range: number
  effects: Array<{
    kind: number | null
    remaining_turns: number | null
    value: number | null
    stat: number | null
    flags: number | null
  }>
}
export type coverage_result = {
  committed: boolean
  before: exported_fighter[]
  after: exported_fighter[]
  target: Cell | null
}
export type trap_formation = { mob_id: string; stage: Cell; trap: Cell }
export type resource_probe_result = {
  committed: boolean
  spell_committed: boolean
  before: exported_fighter[]
  after: exported_fighter[]
  resource: 'ap' | 'mp'
  grant: number
  spent: number
  remaining: number | null
  grant_target: Cell | null
  committed_casts: number
}

const cell_key = (cell: Cell) => `${cell.x}:${cell.y}`
const board_export = async (page: Page) => (await chain_truth_export(page)) as exported_fighter[]

export function hazard_formation_holds(board: exported_fighter[], formation: trap_formation) {
  const mob = board.find((row) => row.id === formation.mob_id)
  const mob_cell = {
    x: (formation.stage.x + formation.trap.x) / 2,
    y: (formation.stage.y + formation.trap.y) / 2,
  }
  return mob?.cell?.x === mob_cell.x && mob.cell.y === mob_cell.y
}

export function trap_formation_holds(board: exported_fighter[], caster_id: string, formation: trap_formation) {
  const caster = board.find((row) => row.id === caster_id)
  return (
    caster?.cell?.x === formation.stage.x &&
    caster.cell.y === formation.stage.y &&
    hazard_formation_holds(board, formation)
  )
}

/** Published ids, not the stale SDK spell tables: every runtime spell unlocked through the requested level. */
export function full_kit(class_id: string, spells: runtime_spell[], level = 100) {
  return spells
    .filter((spell) => spell.class === class_id && Number(spell.unlock_level) <= level)
    .sort(
      (left, right) =>
        Number(left.unlock_level) - Number(right.unlock_level) || left.name_key.localeCompare(right.name_key)
    )
    .map((spell) => spell.name_key)
}

async function cast_queue(page: Page) {
  return page.evaluate(async () => {
    const { use_dungeon_turn } = await import('/src/game/screens/dungeon-turn.js')
    return use_dungeon_turn.getState().cast_path.map((row: any) => String(row.spell_key ?? ''))
  })
}

/** DungeonBoard's sole-writer receipt clock: only accepted committed casts advance these per-id turns. */
export async function committed_cast_clock(page: Page, entity: string) {
  return page.evaluate(async (character_id) => {
    const { character_cast_clock, use_dungeon_turn } = await import('/src/game/screens/dungeon-turn.js')
    return character_cast_clock(use_dungeon_turn.getState(), character_id).last_cast_turn as Record<string, number>
  }, entity)
}

async function drafted_move(page: Page): Promise<Cell | null> {
  return page.evaluate(async () => {
    const [{ use_dungeon_turn }, { decode }] = await Promise.all([
      import('/src/game/screens/dungeon-turn.js'),
      import('/@id/@aresrpg/fight/los'),
    ])
    const target = use_dungeon_turn.getState().move_target
    return target == null ? null : decode(target)
  })
}

async function finish_turn(page: Page) {
  const active_before = (await snapshot(page)).active
  expect(active_before, 'the full-kit driver cannot end an empty active turn').toBeTruthy()
  const end = page.locator('.hud-fightctl__end')
  await expect(end, 'END TURN was not enabled for the full-kit driver').toBeEnabled({ timeout: 12_000 })
  await human_click_locator(page, end)
  await expect
    .poll(
      async () => {
        const state = await snapshot(page)
        return state.active !== active_before || !(await living_mob(page))
      },
      { timeout: 60_000, message: 'the full-kit turn never committed or advanced' }
    )
    .toBe(true)
}

async function queue_spell_at(page: Page, spell_id: string, targets: Cell[]) {
  const spell = page.locator(`button.hud-socket[data-spell-id="${spell_id}"]`)
  await expect(spell, `runtime spell ${spell_id} did not render in the L100 hand`).toHaveCount(1)
  if ((await spell.getAttribute('aria-disabled')) === 'true') return null
  await human_click_locator(page, spell)
  await expect.poll(() => snapshot(page).then((state) => state.armed)).toBe(spell_id)
  for (const candidate of targets.slice(0, 8)) {
    const queue_before = await cast_queue(page)
    if ((await click_cell(page, candidate)) !== 'pressed') continue
    const grew = await expect
      .poll(() => cast_queue(page), { timeout: 4_000 })
      .toHaveLength(queue_before.length + 1)
      .then(() => true)
      .catch(() => false)
    if (!grew) continue
    expect((await cast_queue(page)).at(-1), `cast registered on the wrong spell while ${spell_id} was armed`).toBe(
      spell_id
    )
    return candidate
  }
  if ((await snapshot(page)).armed === spell_id) await human_click_locator(page, spell)
  return null
}

/** Advance an otherwise complete seat without drafting movement that could disturb the reserved trap line. */
export async function pass_coverage_turn(page: Page) {
  await finish_turn(page)
}

/** Product range math plus recipient-aware ordering. Occupied cells remain legal cast endpoints unless the
 *  runtime row itself says free_cell; the obstacle list is LOS input, not an occupied-target filter. */
async function legal_cast_targets(page: Page, spell_id: string): Promise<Cell[]> {
  return page.evaluate(async (requested_spell_id) => {
    const [{ fight_view }, { encode, decode }, dungeon_module, grid_module, intents, spells_module] = await Promise.all(
      [
        import('/@id/@aresrpg/fight/project'),
        import('/@id/@aresrpg/fight/los'),
        import('/src/world-shell/dungeon_store.js'),
        import('/src/game/screens/dungeon-grid.js'),
        import('/src/fight-engine/overlay_intents.js'),
        import('/src/game/screens/hud/fight-spells.js'),
      ]
    )
    const fight = fight_view()
    const { dungeon } = dungeon_module.use_dungeon.getState()
    const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
    const spell = spells_module.fight_spell(requested_spell_id)
    const [level] = spell?.levels ?? []
    if (!fight || !dungeon || !me || !level) return []

    const occupied = new Set<number>()
    const mobs = new Set<number>()
    const players = new Set<number>()
    const allies = new Set<number>()
    const player_deficit = new Map<number, number>()
    for (const fighter of fight.fighters.values()) {
      if (fighter.dead) continue
      const cell = encode(fighter.cell.x, fighter.cell.y)
      if (fighter.id !== me.id) occupied.add(cell)
      ;(fighter.is_player ? players : mobs).add(cell)
      if (fighter.is_player && fighter.id !== me.id) allies.add(cell)
      if (fighter.is_player)
        player_deficit.set(cell, Math.max(0, Number(fighter.health_max ?? 0) - Number(fighter.health ?? 0)))
    }
    const obstacles = [...(dungeon.obstacles ?? []), ...occupied]
    const places_trap = (level.effects ?? []).some((effect: any) => effect.kind === 'PLACE_TRAP')
    const footprint = intents.cast_range_set_dungeon(
      level.range,
      { cell: me.cell },
      grid_module.dungeon_grid_of(dungeon),
      obstacles,
      {
        los: level.line_of_sight !== false,
        linear: level.linear === true,
        free_cell: level.free_cell === true,
        trap_cells: places_trap ? fight.my_traps : null,
      }
    )
    const support_kinds = new Set([
      'HEAL',
      'GIVE_POINTS',
      'ALTER_STAT',
      'ALTER_RESIST',
      'REDUCE_DAMAGE',
      'INVISIBILITY',
      'REVEAL',
      'RETURN_SPELL',
    ])
    const support = (level.effects ?? []).every((effect: any) => support_kinds.has(String(effect.kind)))
    const returns_spell = (level.effects ?? []).some((effect: any) => effect.kind === 'RETURN_SPELL')
    const range_buff = (level.effects ?? []).some(
      (effect: any) => effect.kind === 'ALTER_STAT' && Number(effect.stat) === 6
    )
    const heals = (level.effects ?? []).some((effect: any) => effect.kind === 'HEAL')
    const self_anchor = Number(level.range?.[1] ?? 0) === 0
    const preferred = [...footprint].filter((cell) =>
      level.free_cell || self_anchor
        ? true
        : support
          ? returns_spell
            ? allies.has(cell)
            : players.has(cell)
          : mobs.has(cell)
    )
    if (!preferred.length) return []
    return preferred
      .sort((left, right) => {
        if (range_buff) {
          const own = encode(me.cell.x, me.cell.y)
          if (left === own) return -1
          if (right === own) return 1
        }
        if (heals) {
          const deficit = Number(player_deficit.get(right) ?? 0) - Number(player_deficit.get(left) ?? 0)
          if (deficit) return deficit
        }
        const nearest_mob = (cell: number) => {
          const decoded = decode(cell)
          return Math.min(
            ...[...mobs].map((mob) => {
              const target = decode(mob)
              return Math.abs(decoded.x - target.x) + Math.abs(decoded.y - target.y)
            })
          )
        }
        const left_distance = level.free_cell ? nearest_mob(left) : 0
        const right_distance = level.free_cell ? nearest_mob(right) : 0
        return left_distance - right_distance || left - right
      })
      .map((cell) => decode(cell))
  }, spell_id)
}

/** A ranged recipient can be absent even while empty geometry exists. Find a reachable anchor from which the
 *  same recipient-aware footprint is non-empty; movement consumes this turn and the spell remains uncredited. */
async function target_enabling_move(page: Page, spell_id: string): Promise<Cell | null> {
  return page.evaluate(async (requested_spell_id) => {
    const [
      { fight_view },
      { encode, decode, bfsReachable },
      dungeon_module,
      grid_module,
      intents,
      spells_module,
      blockers,
    ] = await Promise.all([
      import('/@id/@aresrpg/fight/project'),
      import('/@id/@aresrpg/fight/los'),
      import('/src/world-shell/dungeon_store.js'),
      import('/src/game/screens/dungeon-grid.js'),
      import('/src/fight-engine/overlay_intents.js'),
      import('/src/game/screens/hud/fight-spells.js'),
      import('/src/world-shell/fight_board_blockers.js'),
    ])
    const fight = fight_view()
    const { dungeon } = dungeon_module.use_dungeon.getState()
    const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
    const spell = spells_module.fight_spell(requested_spell_id)
    const [level] = spell?.levels ?? []
    if (!fight || !dungeon || !me || !level || Number(me.mp) <= 0) return null

    const occupied: number[] = []
    const mobs = new Set<number>()
    const players = new Set<number>()
    const allies = new Set<number>()
    for (const fighter of fight.fighters.values()) {
      if (fighter.dead) continue
      const cell = encode(fighter.cell.x, fighter.cell.y)
      if (fighter.id !== me.id) occupied.push(cell)
      ;(fighter.is_player ? players : mobs).add(cell)
      if (fighter.is_player && fighter.id !== me.id) allies.add(cell)
    }
    const obstacles = [...(dungeon.obstacles ?? []), ...occupied]
    const grid = grid_module.dungeon_grid_of(dungeon)
    const blocked = blockers.presentation_blocked_cells(dungeon, fight.fighters, me.id)
    const candidates = [...bfsReachable(encode(me.cell.x, me.cell.y), Number(me.mp), blocked)]
    const support_kinds = new Set([
      'HEAL',
      'GIVE_POINTS',
      'ALTER_STAT',
      'ALTER_RESIST',
      'REDUCE_DAMAGE',
      'INVISIBILITY',
      'REVEAL',
      'RETURN_SPELL',
    ])
    const support = (level.effects ?? []).every((effect: any) => support_kinds.has(String(effect.kind)))
    const returns_spell = (level.effects ?? []).some((effect: any) => effect.kind === 'RETURN_SPELL')
    const self_anchor = Number(level.range?.[1] ?? 0) === 0
    for (const candidate of candidates) {
      const footprint = intents.cast_range_set_dungeon(level.range, { cell: decode(candidate) }, grid, obstacles, {
        los: level.line_of_sight !== false,
        linear: level.linear === true,
        free_cell: level.free_cell === true,
      })
      if (
        [...footprint].some((cell) =>
          level.free_cell || self_anchor
            ? true
            : support
              ? returns_spell
                ? allies.has(cell)
                : players.has(cell)
              : mobs.has(cell)
        )
      )
        return decode(candidate)
    }
    return null
  }, spell_id)
}

/** Attempt one still-uncredited id. Refusals remain false and are retried by the caller on a later turn. */
export async function play_coverage_turn(
  page: Page,
  entity: string,
  spell_id: string,
  preferred_target: Cell | null = null
): Promise<coverage_result> {
  const state_before = await snapshot(page)
  const before = await board_export(page)
  const clock_before = await committed_cast_clock(page, entity)
  expect(state_before.me?.id).toBe(entity)
  expect(state_before.active, 'coverage driver called outside its own active turn').toBe(entity)
  expect(state_before.presenting, 'coverage driver called through a presentation wave').toBe(false)

  const spell = page.locator(`button.hud-socket[data-spell-id="${spell_id}"]`)
  await expect(spell, `runtime spell ${spell_id} did not render in the L100 hand`).toHaveCount(1)
  const enabled = await expect
    .poll(() => spell.getAttribute('aria-disabled'), { timeout: 2_000 })
    .not.toBe('true')
    .then(() => true)
    .catch(() => false)
  if (!enabled) {
    await finish_turn(page)
    return { committed: false, before, after: await board_export(page), target: null }
  }

  await human_click_locator(page, spell)
  await expect.poll(() => snapshot(page).then((state) => state.armed)).toBe(spell_id)
  const targets = preferred_target ? [preferred_target] : await legal_cast_targets(page, spell_id)
  if (!targets.length) {
    await human_click_locator(page, spell)
    await expect.poll(() => snapshot(page).then((state) => state.armed)).toBeNull()
    const move = await target_enabling_move(page, spell_id)
    if (move) {
      expect(await click_cell(page, move), `target-enabling move never aligned on ${cell_key(move)}`).toBe('pressed')
      await expect
        .poll(() => drafted_move(page).then((cell) => (cell ? cell_key(cell) : null)), {
          timeout: 6_000,
          message: `target-enabling move never registered on ${cell_key(move)}`,
        })
        .toBe(cell_key(move))
    }
    await finish_turn(page)
    return { committed: false, before, after: await board_export(page), target: null }
  }

  let target: Cell | null = null
  for (const candidate of targets.slice(0, 8)) {
    const queue_before = await cast_queue(page)
    if ((await click_cell(page, candidate)) !== 'pressed') continue
    const grew = await expect
      .poll(() => cast_queue(page), { timeout: 4_000 })
      .toHaveLength(queue_before.length + 1)
      .then(() => true)
      .catch(() => false)
    if (!grew) continue
    expect((await cast_queue(page)).at(-1), `cast registered on the wrong spell while ${spell_id} was armed`).toBe(
      spell_id
    )
    target = candidate
    break
  }
  await finish_turn(page)
  const committed = target ? await cast_advanced(page, entity, spell_id, clock_before) : false
  return { committed, before, after: await board_export(page), target }
}

const effect_reaches = (anchor: Cell, cell: Cell, shape: string, size: number) => {
  const dx = Math.abs(anchor.x - cell.x)
  const dy = Math.abs(anchor.y - cell.y)
  if (shape === 'POINT') return dx === 0 && dy === 0
  if (shape === 'CROSS') return (dx === 0 || dy === 0) && dx + dy <= size
  return dx + dy <= size
}

async function self_grant_targets(page: Page, spell: runtime_spell, entity: string, stat: number) {
  const caster = (await board_export(page)).find((row) => row.id === entity)
  const effect = spell.levels[0]?.effects.find((row) => row.kind === 'GIVE_POINTS' && Number(row.stat) === stat)
  if (!caster?.cell || !effect) return []
  return (await legal_cast_targets(page, spell.name_key)).filter((target) =>
    effect_reaches(target, caster.cell!, effect.area_shape, effect.area_size)
  )
}

async function move_next_to_ally(page: Page): Promise<Cell | null> {
  return page.evaluate(async () => {
    const [{ fight_view }, { encode, decode, bfsPath, GRID_CELLS }, dungeon_module, blockers] = await Promise.all([
      import('/@id/@aresrpg/fight/project'),
      import('/@id/@aresrpg/fight/los'),
      import('/src/world-shell/dungeon_store.js'),
      import('/src/world-shell/fight_board_blockers.js'),
    ])
    const fight = fight_view()
    const { dungeon } = dungeon_module.use_dungeon.getState()
    const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
    if (!fight || !dungeon || !me || Number(me.mp) <= 0) return null
    const occupied = new Set(
      [...fight.fighters.values()]
        .filter((fighter: any) => !fighter.dead)
        .map((fighter: any) => encode(fighter.cell.x, fighter.cell.y))
    )
    const blocked = blockers.presentation_blocked_cells(dungeon, fight.fighters, me.id)
    const candidates: Array<{ cell: number; path: number[] }> = []
    for (const ally of [...fight.fighters.values()].filter(
      (fighter: any) => fighter.is_player && !fighter.dead && fighter.id !== me.id
    ))
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const cell = encode(ally.cell.x + dx, ally.cell.y + dy)
        if (occupied.has(cell)) continue
        const path = bfsPath(encode(me.cell.x, me.cell.y), cell, blocked, GRID_CELLS)
        if (path.length) candidates.push({ cell, path })
      }
    candidates.sort((left, right) => left.path.length - right.path.length || left.cell - right.cell)
    const [best] = candidates
    const step = best?.path[Math.min(best.path.length, Number(me.mp)) - 1]
    return step == null ? null : decode(step)
  })
}

async function stage_self_grant(page: Page, spell: runtime_spell, entity: string, stat: number) {
  const targets = await self_grant_targets(page, spell, entity, stat)
  if (targets.length) return targets
  const move = await move_next_to_ally(page)
  if (move) {
    expect(await click_cell(page, move), `self-grant staging move never aligned on ${cell_key(move)}`).toBe('pressed')
    await expect.poll(() => drafted_move(page).then((cell) => (cell ? cell_key(cell) : null))).toBe(cell_key(move))
  }
  await finish_turn(page)
  return null
}

async function live_resource(page: Page, entity: string, resource: 'ap' | 'mp') {
  return page.evaluate(
    async ({ fighter_id, pool }) => {
      const { fight_view } = await import('/@id/@aresrpg/fight/project')
      const fighter = fight_view()?.fighters.get(fighter_id)
      return fighter?.[pool] == null ? null : Number(fighter[pool])
    },
    { fighter_id: entity, pool: resource }
  )
}

async function granted_move(page: Page, baseline_mp: number) {
  return page.evaluate(async (baseline) => {
    const [{ fight_view }, { encode, decode, bfsPath, bfsReachable, GRID_CELLS }, dungeon_module, blockers] =
      await Promise.all([
        import('/@id/@aresrpg/fight/project'),
        import('/@id/@aresrpg/fight/los'),
        import('/src/world-shell/dungeon_store.js'),
        import('/src/world-shell/fight_board_blockers.js'),
      ])
    const fight = fight_view()
    const { dungeon } = dungeon_module.use_dungeon.getState()
    const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
    if (!fight || !dungeon || !me || Number(me.mp) <= baseline) return null
    const start = encode(me.cell.x, me.cell.y)
    const blocked = blockers.presentation_blocked_cells(dungeon, fight.fighters, me.id)
    const candidates = [...bfsReachable(start, Number(me.mp), blocked)].flatMap((cell) => {
      const path = bfsPath(start, cell, blocked, GRID_CELLS)
      return path.length > baseline ? [{ cell, path }] : []
    })
    candidates.sort((left, right) => left.path.length - right.path.length || left.cell - right.cell)
    const [found] = candidates
    return found ? { target: decode(found.cell), spent: found.path.length } : null
  }, baseline_mp)
}

async function cast_advanced(page: Page, entity: string, spell_id: string, before: Record<string, number>) {
  return expect
    .poll(() => committed_cast_clock(page, entity).then((clock) => Number(clock[spell_id] ?? -1)), {
      timeout: 20_000,
      message: `${spell_id} did not advance its committed cast clock`,
    })
    .not.toBe(Number(before[spell_id] ?? -1))
    .then(() => true)
    .catch(() => false)
}

/** After full spell coverage, prove an MP grant by drafting it before a path longer than the starting MP pool. */
export async function play_mp_grant_turn(
  page: Page,
  entity: string,
  grant_spell: runtime_spell
): Promise<resource_probe_result> {
  const before = await board_export(page)
  const fighter = before.find((row) => row.id === entity)
  const clock = await committed_cast_clock(page, entity)
  const targets = await stage_self_grant(page, grant_spell, entity, 1)
  if (!targets || fighter?.mp == null)
    return {
      committed: false,
      spell_committed: false,
      before,
      after: await board_export(page),
      resource: 'mp',
      grant: 0,
      spent: 0,
      remaining: null,
      grant_target: null,
      committed_casts: 0,
    }
  const target = await queue_spell_at(page, grant_spell.name_key, targets)
  if (!target) {
    await finish_turn(page)
    return {
      committed: false,
      spell_committed: false,
      before,
      after: await board_export(page),
      resource: 'mp',
      grant: 0,
      spent: 0,
      remaining: null,
      grant_target: null,
      committed_casts: 0,
    }
  }
  const declared_grant = grant_spell.levels[0]?.effects
    .filter((effect) => effect.kind === 'GIVE_POINTS' && Number(effect.stat) === 1)
    .reduce((sum, effect) => sum + Number(effect.base ?? 0), 0)
  expect(declared_grant, `${grant_spell.name_key} has no positive catalog MP grant`).toBeGreaterThan(0)
  // Critical GIVE_POINTS rows may exceed the learned-rank normal floor; the observed excess is carried as `grant`.
  const available = await expect
    .poll(() => live_resource(page, entity, 'mp'), { timeout: 6_000 })
    .toBeGreaterThanOrEqual(fighter.mp + declared_grant)
    .then(() => live_resource(page, entity, 'mp'))
  const move = await granted_move(page, fighter.mp)
  if (!move || available == null) {
    await finish_turn(page)
    const spell_committed = await cast_advanced(page, entity, grant_spell.name_key, clock)
    return {
      committed: false,
      spell_committed,
      before,
      after: await board_export(page),
      resource: 'mp',
      grant: available == null ? 0 : available - fighter.mp,
      spent: 0,
      remaining: null,
      grant_target: target,
      committed_casts: 1,
    }
  }
  expect(await click_cell(page, move.target), `granted-MP move never aligned on ${cell_key(move.target)}`).toBe(
    'pressed'
  )
  await expect.poll(() => drafted_move(page).then((cell) => (cell ? cell_key(cell) : null))).toBe(cell_key(move.target))
  const grant = available - fighter.mp
  const remaining = await expect
    .poll(() => live_resource(page, entity, 'mp'), { timeout: 6_000 })
    .toBe(fighter.mp + grant - move.spent)
    .then(() => live_resource(page, entity, 'mp'))
  await finish_turn(page)
  const after = await board_export(page)
  const moved = after.find((row) => row.id === entity)
  const spell_committed = await cast_advanced(page, entity, grant_spell.name_key, clock)
  const committed = spell_committed && moved?.cell != null && cell_key(moved.cell) === cell_key(move.target)
  return {
    committed,
    spell_committed,
    before,
    after,
    resource: 'mp',
    grant,
    spent: move.spent,
    remaining,
    grant_target: target,
    committed_casts: 1,
  }
}

/** After full spell coverage, prove an AP grant by drafting enough follow-up casts to exceed the starting pool. */
export async function play_ap_grant_turn(
  page: Page,
  entity: string,
  grant_spell: runtime_spell,
  spend_spell: runtime_spell
): Promise<resource_probe_result> {
  const before = await board_export(page)
  const fighter = before.find((row) => row.id === entity)
  const clock = await committed_cast_clock(page, entity)
  const targets = await stage_self_grant(page, grant_spell, entity, 0)
  if (!targets || fighter?.ap == null)
    return {
      committed: false,
      spell_committed: false,
      before,
      after: await board_export(page),
      resource: 'ap',
      grant: 0,
      spent: 0,
      remaining: null,
      grant_target: null,
      committed_casts: 0,
    }
  const target = await queue_spell_at(page, grant_spell.name_key, targets)
  if (!target) {
    await finish_turn(page)
    return {
      committed: false,
      spell_committed: false,
      before,
      after: await board_export(page),
      resource: 'ap',
      grant: 0,
      spent: 0,
      remaining: null,
      grant_target: null,
      committed_casts: 0,
    }
  }
  const declared_grant = grant_spell.levels[0]?.effects
    .filter((effect) => effect.kind === 'GIVE_POINTS' && Number(effect.stat) === 0)
    .reduce((sum, effect) => sum + Number(effect.base ?? 0), 0)
  expect(declared_grant, `${grant_spell.name_key} has no positive catalog AP grant`).toBeGreaterThan(0)
  const expected_available = fighter.ap - Number(grant_spell.levels[0]?.ap ?? 0) + declared_grant
  // Critical GIVE_POINTS rows may exceed the learned-rank normal floor; final budget math uses the observed grant.
  const available = await expect
    .poll(() => live_resource(page, entity, 'ap'), { timeout: 6_000 })
    .toBeGreaterThanOrEqual(expected_available)
    .then(() => live_resource(page, entity, 'ap'))
  const grant_cost = Number(grant_spell.levels[0]?.ap ?? 0)
  const spend_cost = Number(spend_spell.levels[0]?.ap ?? 0)
  const spend_count = spend_cost > 0 ? Math.floor((fighter.ap - grant_cost) / spend_cost) + 1 : 0
  const spent = grant_cost + spend_count * spend_cost
  const grant = available == null ? 0 : available - fighter.ap + grant_cost
  let followups_queued =
    available != null &&
    spend_count > 0 &&
    spent > fighter.ap &&
    spent <= fighter.ap + grant &&
    Number(spend_spell.levels[0]?.casts_per_turn ?? 0) >= spend_count &&
    Number(spend_spell.levels[0]?.casts_per_target ?? 0) >= spend_count
  for (let index = 0; followups_queued && index < spend_count; index += 1) {
    const spend_targets = await legal_cast_targets(page, spend_spell.name_key)
    followups_queued = !!spend_targets.length && !!(await queue_spell_at(page, spend_spell.name_key, spend_targets))
  }
  if (!followups_queued || available == null) {
    await finish_turn(page)
    const spell_committed = await cast_advanced(page, entity, grant_spell.name_key, clock)
    return {
      committed: false,
      spell_committed,
      before,
      after: await board_export(page),
      resource: 'ap',
      grant,
      spent: 0,
      remaining: null,
      grant_target: target,
      committed_casts: 1,
    }
  }
  const remaining = await expect
    .poll(() => live_resource(page, entity, 'ap'), { timeout: 6_000 })
    .toBe(fighter.ap + grant - spent)
    .then(() => live_resource(page, entity, 'ap'))
  await finish_turn(page)
  const after = await board_export(page)
  const spell_committed = await cast_advanced(page, entity, grant_spell.name_key, clock)
  const spend_committed = await cast_advanced(page, entity, spend_spell.name_key, clock)
  const committed = spent > fighter.ap && spell_committed && spend_committed
  return {
    committed,
    spell_committed,
    before,
    after,
    resource: 'ap',
    grant,
    spent,
    remaining,
    grant_target: target,
    committed_casts: 1 + spend_count,
  }
}

/** Spend at most one movement turn until a fixed free-cell hazard target enters this spell's real footprint. */
export async function move_to_cast_target(page: Page, spell_id: string, target: Cell, avoid: Cell[] = []) {
  const route = await page.evaluate(
    async ({ requested_spell_id, target_cell, avoided_cells }) => {
      const [
        { fight_view },
        { encode, decode, bfsPath, bfsReachable, GRID_CELLS },
        dungeon_module,
        grid_module,
        intents,
        spells_module,
        blockers,
      ] = await Promise.all([
        import('/@id/@aresrpg/fight/project'),
        import('/@id/@aresrpg/fight/los'),
        import('/src/world-shell/dungeon_store.js'),
        import('/src/game/screens/dungeon-grid.js'),
        import('/src/fight-engine/overlay_intents.js'),
        import('/src/game/screens/hud/fight-spells.js'),
        import('/src/world-shell/fight_board_blockers.js'),
      ])
      const fight = fight_view()
      const { dungeon } = dungeon_module.use_dungeon.getState()
      const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
      const spell = spells_module.fight_spell(requested_spell_id)
      const [level] = spell?.levels ?? []
      if (!fight || !dungeon || !me || !level) return null
      const start = encode(me.cell.x, me.cell.y)
      const target_id = encode(target_cell.x, target_cell.y)
      const avoided = new Set(avoided_cells.map((cell) => encode(cell.x, cell.y)))
      const occupied = [...fight.fighters.values()]
        .filter((fighter: any) => !fighter.dead && fighter.id !== me.id)
        .map((fighter: any) => encode(fighter.cell.x, fighter.cell.y))
      const obstacles = [...(dungeon.obstacles ?? []), ...occupied]
      const grid = grid_module.dungeon_grid_of(dungeon)
      const blocked = blockers.presentation_blocked_cells(dungeon, fight.fighters, me.id)
      const candidates = [start, ...bfsReachable(start, Number(me.mp), blocked)]
        .filter((cell, index, rows) => rows.indexOf(cell) === index && !avoided.has(cell))
        .flatMap((cell) => {
          const footprint = intents.cast_range_set_dungeon(level.range, { cell: decode(cell) }, grid, obstacles, {
            los: level.line_of_sight !== false,
            linear: level.linear === true,
            free_cell: level.free_cell === true,
          })
          if (!footprint.has(target_id)) return []
          const path = cell === start ? [] : bfsPath(start, cell, blocked, GRID_CELLS)
          return cell === start || path.length ? [{ cell, path }] : []
        })
      candidates.sort((left, right) => left.path.length - right.path.length || left.cell - right.cell)
      const [found] = candidates
      if (!found) return null
      return found.path.length ? { ready: false, destination: decode(found.cell) } : { ready: true, destination: null }
    },
    { requested_spell_id: spell_id, target_cell: target, avoided_cells: avoid }
  )
  expect(route, `${spell_id} cannot reach fixed hazard cell ${cell_key(target)}`).toBeTruthy()
  if (route!.ready) return false
  const { destination } = route!
  expect(destination, `${spell_id} staging move produced no destination`).toBeTruthy()
  expect(await click_cell(page, destination!), `${spell_id} staging move never aligned`).toBe('pressed')
  await expect
    .poll(() => drafted_move(page).then((cell) => (cell ? cell_key(cell) : null)))
    .toBe(cell_key(destination!))
  await finish_turn(page)
  return true
}

/** Find a reachable pusher→mob→empty hazard-cell line for a later occupied-target push. */
export async function find_trap_formation(page: Page): Promise<trap_formation | null> {
  return page.evaluate(async () => {
    const [{ fight_view }, { encode, decode, bfsPath, GRID_CELLS }, dungeon_module, grid_module, blockers] =
      await Promise.all([
        import('/@id/@aresrpg/fight/project'),
        import('/@id/@aresrpg/fight/los'),
        import('/src/world-shell/dungeon_store.js'),
        import('/src/game/screens/dungeon-grid.js'),
        import('/src/world-shell/fight_board_blockers.js'),
      ])
    const fight = fight_view()
    const { dungeon } = dungeon_module.use_dungeon.getState()
    const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
    if (!fight || !dungeon || !me) return null
    const grid = grid_module.dungeon_grid_of(dungeon)
    const blocked = blockers.presentation_blocked_cells(dungeon, fight.fighters, me.id)
    const occupied = new Set(
      [...fight.fighters.values()]
        .filter((fighter: any) => !fighter.dead)
        .map((fighter: any) => encode(fighter.cell.x, fighter.cell.y))
    )
    const existing_traps = new Set((fight.my_traps ?? []).map((cell: any) => Number(cell)))
    const candidates: Array<{ mob_id: string; stage: number; trap: number; path: number[] }> = []
    for (const mob of [...fight.fighters.values()].filter((fighter: any) => !fighter.dead && !fighter.is_player)) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const stage = encode(mob.cell.x - dx, mob.cell.y - dy)
        const trap = encode(mob.cell.x + dx, mob.cell.y + dy)
        if (
          !grid.shape_mask.has(stage) ||
          !grid.shape_mask.has(trap) ||
          blocked.has(stage) ||
          blocked.has(trap) ||
          occupied.has(trap) ||
          existing_traps.has(trap)
        )
          continue
        if (occupied.has(stage) && stage !== encode(me.cell.x, me.cell.y)) continue
        const path = bfsPath(encode(me.cell.x, me.cell.y), stage, blocked, GRID_CELLS)
        if (path.length || stage === encode(me.cell.x, me.cell.y))
          candidates.push({ mob_id: mob.id, stage, trap, path })
      }
    }
    candidates.sort((left, right) => left.path.length - right.path.length || left.stage - right.stage)
    const [found] = candidates
    return found ? { mob_id: found.mob_id, stage: decode(found.stage), trap: decode(found.trap) } : null
  })
}

/** Spend one movement-only turn toward an already validated formation; false means the stage is reached. */
export async function move_toward_formation(page: Page, formation: trap_formation) {
  const state = await snapshot(page)
  if (state.me && cell_key(state.me.cell) === cell_key(formation.stage)) return false
  const destination = await page.evaluate(async (target) => {
    const [{ fight_view }, { encode, decode, bfsPath, GRID_CELLS }, dungeon_module, blockers] = await Promise.all([
      import('/@id/@aresrpg/fight/project'),
      import('/@id/@aresrpg/fight/los'),
      import('/src/world-shell/dungeon_store.js'),
      import('/src/world-shell/fight_board_blockers.js'),
    ])
    const fight = fight_view()
    const { dungeon } = dungeon_module.use_dungeon.getState()
    const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
    if (!fight || !dungeon || !me) return null
    const path = bfsPath(
      encode(me.cell.x, me.cell.y),
      encode(target.x, target.y),
      blockers.presentation_blocked_cells(dungeon, fight.fighters, me.id),
      GRID_CELLS
    )
    const step = path[Math.min(path.length, Number(me.mp)) - 1]
    return step == null ? null : decode(step)
  }, formation.stage)
  expect(destination, `no path remains to trap stage ${cell_key(formation.stage)}`).toBeTruthy()
  expect(await click_cell(page, destination!), `trap-stage move never aligned on ${cell_key(destination!)}`).toBe(
    'pressed'
  )
  await expect
    .poll(() => drafted_move(page).then((cell) => (cell ? cell_key(cell) : null)))
    .toBe(cell_key(destination!))
  await finish_turn(page)
  return true
}

export function changed_target_ids(
  before: exported_fighter[],
  after: exported_fighter[],
  kind: string,
  caster_id: string,
  resource: 'ap' | 'mp' | null = null,
  stat: number | null = null
) {
  const prior = new Map(before.map((row) => [row.id, row]))
  return after.flatMap((row) => {
    const old = prior.get(row.id)
    if (!old) return []
    if (kind === 'DAMAGE' || kind === 'LIFE_STEAL') return row.team === 1 && row.hp < old.hp ? [row.id] : []
    if (kind === 'CASTER_DAMAGE') return row.id === caster_id && row.hp < old.hp ? [row.id] : []
    if (kind === 'HEAL') return row.team === 0 && row.hp > old.hp ? [row.id] : []
    if (kind === 'PUSH')
      return row.team === 1 && row.cell && old.cell && cell_key(row.cell) !== cell_key(old.cell) ? [row.id] : []
    if (kind === 'TELEPORT')
      return row.team === 0 && row.cell && old.cell && cell_key(row.cell) !== cell_key(old.cell) ? [row.id] : []
    if (kind === 'ALTER_STAT' && Number(stat) === 6) return row.effective_range !== old.effective_range ? [row.id] : []
    if (kind === 'REMOVE_POINTS' && row.id !== caster_id)
      return JSON.stringify(row.effects) !== JSON.stringify(old.effects) ||
        (resource != null && row[resource] != null && old[resource] != null && row[resource]! < old[resource]!)
        ? [row.id]
        : []
    if (['APPLY_DOT', 'INVISIBILITY', 'RETURN_SPELL'].includes(kind))
      return JSON.stringify(row.effects) !== JSON.stringify(old.effects) ? [row.id] : []
    return []
  })
}
