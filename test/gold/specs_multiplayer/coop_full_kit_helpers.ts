// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FULL-KIT COOP DRIVER — test-only targeting, committed-cast accounting, and the one trap→push formation.
import { expect, type Page } from '@playwright/test'

import { click_cell, human_click_locator, snapshot, type Cell } from '../specs_anchor/fight_mouse_helpers'

import { chain_truth_export, living_mob } from './coop_helpers'

export type runtime_effect = { kind: string; stat?: number }
export type runtime_spell = {
  class: string
  unlock_level: number
  name_key: string
  role: string
  levels: Array<{
    range: [number, number]
    free_cell: boolean
    effects: runtime_effect[]
  }>
}
export type exported_fighter = {
  id: string
  team: number
  cell: Cell | null
  hp: number
  effects: Array<{ kind: number | null; value: number | null; stat: number | null }>
}
export type coverage_result = {
  committed: boolean
  before: exported_fighter[]
  after: exported_fighter[]
  target: Cell | null
}
export type trap_formation = { mob_id: string; stage: Cell; trap: Cell }

const cell_key = (cell: Cell) => `${cell.x}:${cell.y}`
const board_export = async (page: Page) => (await chain_truth_export(page)) as exported_fighter[]

export function trap_formation_holds(board: exported_fighter[], caster_id: string, formation: trap_formation) {
  const caster = board.find((row) => row.id === caster_id)
  const mob = board.find((row) => row.id === formation.mob_id)
  const mob_cell = {
    x: (formation.stage.x + formation.trap.x) / 2,
    y: (formation.stage.y + formation.trap.y) / 2,
  }
  return (
    caster?.cell?.x === formation.stage.x &&
    caster.cell.y === formation.stage.y &&
    mob?.cell?.x === mob_cell.x &&
    mob.cell.y === mob_cell.y
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

/** DungeonBoard's sole-writer receipt clock: only an accepted committed cast appears here. */
export async function committed_casts(page: Page, entity: string) {
  return page.evaluate(async (character_id) => {
    const { character_cast_clock, use_dungeon_turn } = await import('/src/game/screens/dungeon-turn.js')
    return Object.keys(character_cast_clock(use_dungeon_turn.getState(), character_id).last_cast_turn).sort()
  }, entity)
}

async function drafted_move(page: Page): Promise<Cell | null> {
  return page.evaluate(async () => {
    const [{ use_dungeon_turn }, { decode }] = await Promise.all([
      import('/src/game/screens/dungeon-turn.js'),
      import('/@id/@aresrpg/fight'),
    ])
    const target = use_dungeon_turn.getState().move_target
    return target == null ? null : decode(target)
  })
}

async function finish_turn(page: Page, turn_before: number) {
  const end = page.locator('.hud-fightctl__end')
  await expect(end, 'END TURN was not enabled for the full-kit driver').toBeEnabled({ timeout: 12_000 })
  await human_click_locator(page, end)
  await expect
    .poll(
      async () => {
        const state = await snapshot(page)
        return state.turn !== turn_before || !(await living_mob(page))
      },
      { timeout: 60_000, message: 'the full-kit turn never committed or advanced' }
    )
    .toBe(true)
}

/** Advance an otherwise complete seat without drafting movement that could disturb the reserved trap line. */
export async function pass_coverage_turn(page: Page) {
  await finish_turn(page, (await snapshot(page)).turn)
}

/** Product range math plus recipient-aware ordering. Occupied cells remain legal cast endpoints unless the
 *  runtime row itself says free_cell; the obstacle list is LOS input, not an occupied-target filter. */
async function legal_cast_targets(page: Page, spell_id: string): Promise<Cell[]> {
  return page.evaluate(async (requested_spell_id) => {
    const [{ fight_view, encode, decode }, dungeon_module, grid_module, intents, spells_module] = await Promise.all([
      import('/@id/@aresrpg/fight'),
      import('/src/world-shell/dungeon_store.js'),
      import('/src/game/screens/dungeon-grid.js'),
      import('/src/fight-engine/overlay_intents.js'),
      import('/src/game/screens/hud/fight-spells.js'),
    ])
    const fight = fight_view()
    const { dungeon } = dungeon_module.use_dungeon.getState()
    const me = fight?.my_entity_id ? fight.fighters.get(fight.my_entity_id) : null
    const spell = spells_module.fight_spell(requested_spell_id)
    const [level] = spell?.levels ?? []
    if (!fight || !dungeon || !me || !level) return []

    const occupied = new Set<number>()
    const mobs = new Set<number>()
    const players = new Set<number>()
    for (const fighter of fight.fighters.values()) {
      if (fighter.dead) continue
      const cell = encode(fighter.cell.x, fighter.cell.y)
      if (fighter.id !== me.id) occupied.add(cell)
      ;(fighter.is_player ? players : mobs).add(cell)
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
    const support_kinds = new Set(['HEAL', 'GIVE_POINTS', 'ALTER_STAT', 'ALTER_RESIST', 'REDUCE_DAMAGE'])
    const support = (level.effects ?? []).every((effect: any) => support_kinds.has(String(effect.kind)))
    const self_anchor = Number(level.range?.[1] ?? 0) === 0
    const preferred = [...footprint].filter((cell) =>
      level.free_cell || self_anchor ? true : support ? players.has(cell) : mobs.has(cell)
    )
    if (!preferred.length) return []
    return preferred
      .sort((left, right) => {
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
      { fight_view, encode, decode, bfsReachable },
      dungeon_module,
      grid_module,
      intents,
      spells_module,
      blockers,
    ] = await Promise.all([
      import('/@id/@aresrpg/fight'),
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
    for (const fighter of fight.fighters.values()) {
      if (fighter.dead) continue
      const cell = encode(fighter.cell.x, fighter.cell.y)
      if (fighter.id !== me.id) occupied.push(cell)
      ;(fighter.is_player ? players : mobs).add(cell)
    }
    const obstacles = [...(dungeon.obstacles ?? []), ...occupied]
    const grid = grid_module.dungeon_grid_of(dungeon)
    const blocked = blockers.presentation_blocked_cells(dungeon, fight.fighters, me.id)
    const candidates = [...bfsReachable(encode(me.cell.x, me.cell.y), Number(me.mp), blocked)]
    const support_kinds = new Set(['HEAL', 'GIVE_POINTS', 'ALTER_STAT', 'ALTER_RESIST', 'REDUCE_DAMAGE'])
    const support = (level.effects ?? []).every((effect: any) => support_kinds.has(String(effect.kind)))
    const self_anchor = Number(level.range?.[1] ?? 0) === 0
    for (const candidate of candidates) {
      const footprint = intents.cast_range_set_dungeon(level.range, { cell: decode(candidate) }, grid, obstacles, {
        los: level.line_of_sight !== false,
        linear: level.linear === true,
        free_cell: level.free_cell === true,
      })
      if (
        [...footprint].some((cell) =>
          level.free_cell || self_anchor ? true : support ? players.has(cell) : mobs.has(cell)
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
    await finish_turn(page, state_before.turn)
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
    await finish_turn(page, state_before.turn)
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
  await finish_turn(page, state_before.turn)
  const committed = target
    ? await expect
        .poll(() => committed_casts(page, entity).then((ids) => ids.includes(spell_id)), {
          timeout: 20_000,
          message: `${spell_id} was drafted but not accepted; it remains eligible for a later retry`,
        })
        .toBe(true)
        .then(() => true)
        .catch(() => false)
    : false
  return { committed, before, after: await board_export(page), target }
}

/** Find a reachable player→mob→empty-cell line for Fanged Snare then Gutterknife. */
export async function find_trap_formation(page: Page): Promise<trap_formation | null> {
  return page.evaluate(async () => {
    const [{ fight_view, encode, decode, bfsPath, GRID_CELLS }, dungeon_module, grid_module, blockers] =
      await Promise.all([
        import('/@id/@aresrpg/fight'),
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
        if (!grid.shape_mask.has(stage) || !grid.shape_mask.has(trap) || occupied.has(trap)) continue
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
    const [{ fight_view, encode, decode, bfsPath, GRID_CELLS }, dungeon_module, blockers] = await Promise.all([
      import('/@id/@aresrpg/fight'),
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
  await finish_turn(page, state.turn)
  return true
}

export function changed_target_ids(before: exported_fighter[], after: exported_fighter[], family: string) {
  const prior = new Map(before.map((row) => [row.id, row]))
  return after.flatMap((row) => {
    const old = prior.get(row.id)
    if (!old) return []
    if (family === 'damage') return row.team === 1 && row.hp < old.hp ? [row.id] : []
    if (family === 'displacement')
      return row.cell && old.cell && cell_key(row.cell) !== cell_key(old.cell) ? [row.id] : []
    if (family === 'buff' || family === 'shield')
      return JSON.stringify(row.effects) !== JSON.stringify(old.effects) ? [row.id] : []
    return []
  })
}
