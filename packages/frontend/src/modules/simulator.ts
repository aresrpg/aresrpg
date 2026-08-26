// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local fight birth inputs only. Once Start is pressed, @aresrpg/fight owns all combat truth.

import { type FightBoard } from '@aresrpg/fight'
import {
  character_equipment_slots,
  characteristic_value_cost,
  characteristic_values_cost,
  characteristic_names,
  is_class_name,
  max_level,
  type ClassName,
  type CharacteristicName,
  type CharacteristicValues,
} from '@aresrpg/immutable'

import fight_boards from '../../../../seed/content/fight_boards.json'
import { browser_simulator_roster_storage, install_simulator_roster_persistence } from '../simulator/persistence.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'

export type SimulatorCharacter = Readonly<{
  id: string
  name: string
  classe: string
  male: boolean
  colors: readonly [string, string, string]
  level: number
  vitality: number
  wisdom: number
  strength: number
  intelligence: number
  chance: number
  agility: number
  spell_levels: Readonly<Record<string, number>>
  loadout: Readonly<Record<string, string>>
}>
export type SimulatorMob = Readonly<{ mob_type: string; level: number }>
export type SimulatorState = Readonly<{
  seed: bigint
  characters: readonly SimulatorCharacter[]
  character_placements: Readonly<Record<number, string>>
  mob_placements: Readonly<Record<number, SimulatorMob>>
}>

export type SimulatorInput =
  | Readonly<{ type: 'simulator/board_rerolled' }>
  | Readonly<{ type: 'simulator/characters_hydrated'; characters: readonly unknown[] }>
  | Readonly<{
      type: 'simulator/character_added'
      character_id: string
      classe: string
      name: string
      male: boolean
    }>
  | Readonly<{ type: 'simulator/character_saved'; character: SimulatorCharacter }>
  | Readonly<{ type: 'simulator/character_removed'; character_id: string }>
  | Readonly<{ type: 'simulator/character_named'; character_id: string; name: string }>
  | Readonly<{ type: 'simulator/character_class_set'; character_id: string; classe: string }>
  | Readonly<{ type: 'simulator/character_sex_set'; character_id: string; male: boolean }>
  | Readonly<{ type: 'simulator/level_set'; character_id: string; level: number }>
  | Readonly<{ type: 'simulator/stat_set'; character_id: string; stat: CharacterStat; value: number }>
  | Readonly<{ type: 'simulator/stats_reset'; character_id: string }>
  | Readonly<{
      type: 'simulator/spell_level_set'
      character_id: string
      spell_name: string
      level: number
      max_level: number
    }>
  | Readonly<{ type: 'simulator/spells_reset'; character_id: string }>
  | Readonly<{
      type: 'simulator/loadout_set'
      character_id: string
      slot: string
      item_type: string | null
    }>
  | Readonly<{ type: 'simulator/character_placed'; cell: bigint; character_id: string }>
  | Readonly<{ type: 'simulator/character_unplaced'; cell: bigint }>
  | Readonly<{
      type: 'simulator/mob_placed'
      cell: bigint
      mob_type: string
      level: number
      level_min: number
      level_max: number
    }>
  | Readonly<{ type: 'simulator/mob_unplaced'; cell: bigint }>

export const initial_simulator_state = (): SimulatorState =>
  Object.freeze({
    seed: 1n,
    characters: Object.freeze([]),
    character_placements: Object.freeze({}),
    mob_placements: Object.freeze({}),
  })

/** One authored board by entropy — the exact pick rule the chain's catalog uses; the UI
 * grid and the engine setup both read THIS, never a second derivation. */
export const simulator_board = (state: Readonly<SimulatorState>): FightBoard => {
  const rows = fight_boards.boards
  const row = rows[Number(state.seed % BigInt(rows.length))]!
  return {
    width: BigInt(row.width),
    height: BigInt(row.height),
    shape_mask: row.shape_mask.map(BigInt),
    obstacles: row.obstacles.map(BigInt),
    holes: row.holes.map(BigInt),
    start_cells_a: row.start_cells_a.map(BigInt),
    start_cells_b: row.start_cells_b.map(BigInt),
  }
}

const is_start_cell = (cells: readonly bigint[], cell: bigint): boolean => cells.includes(cell)

const without_value = (rows: Readonly<Record<number, string>>, value: string): Readonly<Record<number, string>> =>
  Object.freeze(Object.fromEntries(Object.entries(rows).filter(([, candidate]) => candidate !== value)))

const without_cell = <T>(rows: Readonly<Record<number, T>>, cell: bigint): Readonly<Record<number, T>> =>
  Object.freeze(Object.fromEntries(Object.entries(rows).filter(([candidate]) => candidate !== String(cell))))

export const CHARACTER_STATS = characteristic_names
export type CharacterStat = CharacteristicName
export const MAX_SIMULATOR_NAME_LENGTH = 24
export const stat_budget = (level: number): number => (level - 1) * 5

const is_hex_color = (color: string): boolean => /^#[0-9a-f]{6}$/i.test(color)
const DEFAULT_COLORS = Object.freeze(['#ffffff', '#d9af57', '#8b6539'] as const)
export const spell_point_cost = (level: number): number => (level * (level - 1)) / 2
export const spell_budget = (level: number): number => level - 1
const equipment_slots = new Set<string>(character_equipment_slots)

export const valid_simulator_character = (character: Readonly<SimulatorCharacter>): boolean => {
  const stats = CHARACTER_STATS.map((stat) => character[stat])
  const spell_levels = Object.values(character.spell_levels)
  const classe = is_class_name(character.classe) ? character.classe : null
  const spent = classe ? characteristic_values_cost(classe, character_stat_values(character)) : null
  return (
    character.id.trim().length > 0 &&
    character.name.trim().length > 0 &&
    classe !== null &&
    typeof character.male === 'boolean' &&
    character.colors.length === 3 &&
    character.colors.every(is_hex_color) &&
    Number.isInteger(character.level) &&
    character.level >= 1 &&
    character.level <= max_level &&
    stats.every((value) => Number.isInteger(value) && value >= 0) &&
    spent !== null &&
    spent <= stat_budget(character.level) &&
    spell_levels.every((level) => Number.isInteger(level) && level >= 1) &&
    spell_levels.reduce((total, level) => total + spell_point_cost(level), 0) <= spell_budget(character.level) &&
    Object.entries(character.loadout).every(
      ([slot, item_type]) => equipment_slots.has(slot) && item_type.trim().length > 0
    )
  )
}

const record_value = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null

const number_record = (value: unknown): Readonly<Record<string, number>> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(record_value(value) ?? {}).filter((entry): entry is [string, number] => Number.isFinite(entry[1]))
    )
  )

const string_record = (value: unknown): Readonly<Record<string, string>> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(record_value(value) ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  )

export const decode_simulator_character = (value: unknown): SimulatorCharacter | null => {
  const row = record_value(value)
  if (!row) return null
  const stats = record_value(row.stat_alloc) ?? row
  const stored_colors = Array.isArray(row.colors) ? row.colors : null
  const colors =
    stored_colors?.length === 3 && stored_colors.every((color) => typeof color === 'string')
      ? (Object.freeze([...stored_colors]) as readonly [string, string, string])
      : DEFAULT_COLORS
  const character: SimulatorCharacter = Object.freeze({
    id: typeof row.id === 'string' ? row.id : '',
    name: typeof row.name === 'string' ? row.name : '',
    classe: typeof row.classe === 'string' ? row.classe : typeof row.class_id === 'string' ? row.class_id : '',
    male: row.male !== false,
    colors,
    level: Number(row.level),
    vitality: Number(stats.vitality),
    wisdom: Number(stats.wisdom),
    strength: Number(stats.strength),
    intelligence: Number(stats.intelligence),
    chance: Number(stats.chance),
    agility: Number(stats.agility),
    spell_levels: number_record(row.spell_levels),
    loadout: string_record(row.loadout),
  })
  const fitted = refit_character(character)
  return valid_simulator_character(fitted) ? fitted : null
}

const clamp_int = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min

const character_stat_values = (character: Readonly<SimulatorCharacter>): Readonly<Record<CharacterStat, number>> =>
  Object.freeze(
    Object.fromEntries(CHARACTER_STATS.map((stat) => [stat, character[stat]])) as Record<CharacterStat, number>
  )

const empty_character_stats = (): Readonly<Record<CharacterStat, number>> =>
  Object.freeze(Object.fromEntries(CHARACTER_STATS.map((stat) => [stat, 0])) as Record<CharacterStat, number>)

const affordable_stat_value = (classe: ClassName, stat: CharacterStat, wanted: number, budget: number): number => {
  let value = clamp_int(wanted, 0, stat === 'vitality' && classe === 'ikari' ? budget * 2 : budget)
  while (value > 0) {
    const cost = characteristic_value_cost(classe, stat, value)
    if (cost !== null && cost <= budget) return value
    value -= 1
  }
  return 0
}

const fit_stats = (
  classe: ClassName,
  stats: CharacteristicValues,
  budget: number
): Readonly<Record<CharacterStat, number>> => {
  let left = budget
  return Object.freeze(
    Object.fromEntries(
      CHARACTER_STATS.map((stat) => {
        const value = affordable_stat_value(classe, stat, stats[stat], left)
        left -= characteristic_value_cost(classe, stat, value) ?? 0
        return [stat, value]
      })
    ) as Record<CharacterStat, number>
  )
}

const affordable_spell_level = (wanted: number, budget: number): number => {
  for (let level = wanted; level > 1; level -= 1) if (spell_point_cost(level) <= budget) return level
  return 1
}

const fit_spells = (
  spell_levels: Readonly<Record<string, number>>,
  budget: number
): Readonly<Record<string, number>> => {
  const fitted = Object.entries(spell_levels)
    .sort(([left], [right]) => left.localeCompare(right))
    .reduce<Readonly<{ left: number; levels: Readonly<Record<string, number>> }>>(
      ({ left, levels }, [spell_name, wanted]) => {
        const level = affordable_spell_level(wanted, left)
        return Object.freeze({
          left: left - spell_point_cost(level),
          levels: level > 1 ? Object.freeze({ ...levels, [spell_name]: level }) : levels,
        })
      },
      Object.freeze({ left: budget, levels: Object.freeze({}) })
    )
  return fitted.levels
}

const refit_character = (character: Readonly<SimulatorCharacter>): SimulatorCharacter => {
  if (!is_class_name(character.classe)) return character
  const stats = fit_stats(character.classe, character_stat_values(character), stat_budget(character.level))
  return Object.freeze({
    ...character,
    ...stats,
    spell_levels: fit_spells(character.spell_levels, spell_budget(character.level)),
  })
}

const map_character = (
  state: Readonly<SimulatorState>,
  character_id: string,
  change: (character: Readonly<SimulatorCharacter>) => SimulatorCharacter
): SimulatorState =>
  Object.freeze({
    ...state,
    characters: Object.freeze(
      state.characters.map((character) => (character.id === character_id ? change(character) : character))
    ),
  })

// The lab has no roster cap: the smallest unused index always exists within length + 1 candidates.
export const next_simulator_character_id = (characters: readonly SimulatorCharacter[]): string => {
  const used = new Set(characters.map(({ id }) => id))
  return (
    Array.from({ length: characters.length + 1 }, (_, index) => `sim_c${index + 1}`).find((id) => !used.has(id)) ??
    `sim_c${characters.length + 1}`
  )
}

const clean_name = (name: string, fallback: string): string => {
  const trimmed = name.trim().slice(0, MAX_SIMULATOR_NAME_LENGTH)
  return trimmed || fallback
}

/* eslint-disable complexity -- one exhaustive pure reducer owns every simulator input. */
export const reduce_simulator_state = (
  state: Readonly<SimulatorState>,
  input: Readonly<SimulatorInput>
): SimulatorState => {
  if (input.type === 'simulator/board_rerolled')
    return Object.freeze({
      ...state,
      seed: state.seed + 1n,
      character_placements: Object.freeze({}),
      mob_placements: Object.freeze({}),
    })
  if (input.type === 'simulator/characters_hydrated') {
    const stored = input.characters
      .map(decode_simulator_character)
      .filter((character): character is SimulatorCharacter => character !== null)
    const by_id = new Map(stored.map((character) => [character.id, character]))
    state.characters.forEach((character) => by_id.set(character.id, character))
    return Object.freeze({
      ...state,
      characters: Object.freeze([...by_id.values()]),
    })
  }
  if (input.type === 'simulator/character_added') {
    const id = next_simulator_character_id(state.characters)
    if (input.character_id !== id || !is_class_name(input.classe)) return state
    const character: SimulatorCharacter = Object.freeze({
      id,
      name: clean_name(input.name, id),
      classe: input.classe,
      male: input.male,
      colors: Object.freeze(['#ffffff', '#d9af57', '#8b6539'] as const),
      level: 1,
      vitality: 0,
      wisdom: 0,
      strength: 0,
      intelligence: 0,
      chance: 0,
      agility: 0,
      spell_levels: Object.freeze({}),
      loadout: Object.freeze({}),
    })
    return Object.freeze({ ...state, characters: Object.freeze([...state.characters, character]) })
  }
  if (input.type === 'simulator/character_saved') {
    if (!valid_simulator_character(input.character)) return state
    const character = Object.freeze({
      ...input.character,
      name: input.character.name.trim(),
      colors: Object.freeze([...input.character.colors]) as readonly [string, string, string],
      spell_levels: Object.freeze({ ...input.character.spell_levels }),
      loadout: Object.freeze({ ...input.character.loadout }),
    })
    const existing = state.characters.some(({ id }) => id === character.id)
    return Object.freeze({
      ...state,
      characters: Object.freeze(
        existing
          ? state.characters.map((candidate) => (candidate.id === character.id ? character : candidate))
          : [...state.characters, character]
      ),
    })
  }
  if (input.type === 'simulator/character_removed')
    return Object.freeze({
      ...state,
      characters: Object.freeze(state.characters.filter(({ id }) => id !== input.character_id)),
      character_placements: without_value(state.character_placements, input.character_id),
    })
  if (input.type === 'simulator/character_named')
    return map_character(state, input.character_id, (character) =>
      Object.freeze({ ...character, name: clean_name(input.name, character.id) })
    )
  if (input.type === 'simulator/character_class_set') {
    if (!is_class_name(input.classe)) return state
    return map_character(state, input.character_id, (character) =>
      character.classe === input.classe
        ? character
        : Object.freeze({
            ...character,
            ...empty_character_stats(),
            classe: input.classe,
            spell_levels: Object.freeze({}),
          })
    )
  }
  if (input.type === 'simulator/character_sex_set')
    return map_character(state, input.character_id, (character) => Object.freeze({ ...character, male: input.male }))
  if (input.type === 'simulator/level_set')
    return map_character(state, input.character_id, (character) =>
      refit_character(Object.freeze({ ...character, level: clamp_int(input.level, 1, max_level) }))
    )
  if (input.type === 'simulator/stat_set')
    return map_character(state, input.character_id, (character) => {
      if (!is_class_name(character.classe)) return character
      const { classe } = character
      const stats = character_stat_values(character)
      const others = CHARACTER_STATS.reduce(
        (total, stat) =>
          total + (stat === input.stat ? 0 : (characteristic_value_cost(classe, stat, stats[stat]) ?? 0)),
        0
      )
      return Object.freeze({
        ...character,
        [input.stat]: affordable_stat_value(
          classe,
          input.stat,
          input.value,
          Math.max(0, stat_budget(character.level) - others)
        ),
      })
    })
  if (input.type === 'simulator/stats_reset')
    return map_character(state, input.character_id, (character) =>
      Object.freeze({ ...character, ...empty_character_stats() })
    )
  if (input.type === 'simulator/spell_level_set')
    return map_character(state, input.character_id, (character) => {
      const current = character.spell_levels[input.spell_name] ?? 1
      const other_cost = Object.values(character.spell_levels).reduce(
        (total, level) => total + spell_point_cost(level),
        -spell_point_cost(current)
      )
      const level = affordable_spell_level(
        clamp_int(input.level, 1, Math.max(1, input.max_level)),
        Math.max(0, spell_budget(character.level) - other_cost)
      )
      const { [input.spell_name]: _removed, ...rest } = character.spell_levels
      return Object.freeze({
        ...character,
        spell_levels: Object.freeze(level > 1 ? { ...rest, [input.spell_name]: level } : rest),
      })
    })
  if (input.type === 'simulator/spells_reset')
    return map_character(state, input.character_id, (character) =>
      Object.freeze({ ...character, spell_levels: Object.freeze({}) })
    )
  if (input.type === 'simulator/loadout_set')
    return map_character(state, input.character_id, (character) => {
      if (!equipment_slots.has(input.slot)) return character
      const { [input.slot]: _removed, ...rest } = character.loadout
      return Object.freeze({
        ...character,
        loadout: Object.freeze(input.item_type ? { ...rest, [input.slot]: input.item_type } : rest),
      })
    })
  const board = simulator_board(state)
  if (input.type === 'simulator/character_placed') {
    if (
      !is_start_cell(board.start_cells_a, input.cell) ||
      !state.characters.some(({ id }) => id === input.character_id)
    )
      return state
    return Object.freeze({
      ...state,
      character_placements: Object.freeze({
        ...without_value(state.character_placements, input.character_id),
        [Number(input.cell)]: input.character_id,
      }),
    })
  }
  if (input.type === 'simulator/character_unplaced') {
    if (!is_start_cell(board.start_cells_a, input.cell)) return state
    return Object.freeze({ ...state, character_placements: without_cell(state.character_placements, input.cell) })
  }
  if (input.type === 'simulator/mob_placed') {
    if (
      !is_start_cell(board.start_cells_b, input.cell) ||
      !Number.isInteger(input.level) ||
      input.level < input.level_min ||
      input.level > input.level_max
    )
      return state
    return Object.freeze({
      ...state,
      mob_placements: Object.freeze({
        ...state.mob_placements,
        [Number(input.cell)]: Object.freeze({ mob_type: input.mob_type, level: Math.trunc(input.level) }),
      }),
    })
  }
  if (input.type === 'simulator/mob_unplaced') {
    if (!is_start_cell(board.start_cells_b, input.cell)) return state
    return Object.freeze({ ...state, mob_placements: without_cell(state.mob_placements, input.cell) })
  }
  return state
}
/* eslint-enable complexity */

export const can_start_simulator_fight = (state: Readonly<SimulatorState>): boolean =>
  Object.keys(state.character_placements).length > 0 && Object.keys(state.mob_placements).length > 0

const reduce = (state: AppState, input: AppInput): AppState => {
  if (!input.type.startsWith('simulator/')) return state
  const simulator = reduce_simulator_state(state.simulator, input as SimulatorInput)
  return simulator === state.simulator ? state : Object.freeze({ ...state, simulator })
}

const observe = ({ events, dispatch, get_state, signal }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  const storage = browser_simulator_roster_storage()
  if (!storage) return
  install_simulator_roster_persistence({
    storage,
    signal,
    hydrate: (characters) => dispatch({ type: 'simulator/characters_hydrated', characters }),
    read_characters: () => get_state().simulator.characters,
    on_characters_changed: (listener) => {
      events.on('STATE_UPDATED', (state, previous) => {
        if (state.simulator.characters !== previous.simulator.characters) listener()
      })
    },
  })
}

export default Object.freeze({ name: 'simulator', reduce, observe }) satisfies AppModule
