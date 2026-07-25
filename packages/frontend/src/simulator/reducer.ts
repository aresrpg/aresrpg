// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/reducer.ts — THE simulator page's ONE reducer (docs/design/simulator_rebuild_spec.md §6).
//
// Pure `reduce_simulator(state, input) → state` over the local-only setup domain: the determinism seed and
// the roster of up to 6 locally-authored characters (level / stat allocation / spell levels). No chain read,
// no chain write, no async — IndexedDB is a PERSISTENCE EDGE (simulator/persistence.ts) whose boot read
// re-enters here as the `hydrated` input, never as a store write.
//
// The point budgets are the CHAIN's, mirrored: a character earns 5 stat points and 1 spell point per level
// from 2 (`progression_math.move points_for_level_range`, read by `character_link.move
// unspent_stat_points`/`unspent_spell_points`), stat allocation costs 1 point per point
// (`stat_allocation.move raise_stat`), and raising a spell TO level `t` costs `t − 1` points — the S8
// escalating cost of `spell_level.move raise_spell_level`, so a spell sitting at level `l` has cost
// `l·(l−1)/2` in total. Spell level 1 is the FREE baseline (an absent row reads 1 on chain), so only raised
// spells are stored. A level DROP re-fits both allocations to the smaller budget rather than leaving an
// invalid build: stats scale down proportionally, spells fall to the highest level the budget still affords.

import { STATISTICS_PRIMARY } from '@aresrpg/sdk/stats'

/** The six allocatable primary stats — the SDK's vocabulary, pinned by a drift test in reducer.test.ts. */
export type SimStat = 'vitality' | 'wisdom' | 'strength' | 'intelligence' | 'chance' | 'agility'

export const SIM_STATS = STATISTICS_PRIMARY as readonly SimStat[]

export const MAX_ROSTER = 6
export const MAX_LEVEL = 200
export const MAX_NAME_LENGTH = 24
const STAT_POINTS_PER_LEVEL = 5
const SPELL_POINTS_PER_LEVEL = 1

export type SimCharacter = {
  id: string
  name: string
  class_id: string
  male: boolean
  level: number
  stat_alloc: Record<SimStat, number>
  /** spell id → invested level (> 1 only; the free baseline 1 is implicit, exactly like the chain's DF) */
  spell_levels: Record<string, number>
  /** slot → item template id (the max-roll loadout the L1 content lane fills) */
  loadout: Record<string, string>
}

export type SimulatorState = {
  seed: number
  roster: readonly SimCharacter[]
  focus_id: string | null
}

export type SimulatorInput =
  | { type: 'hydrated'; seed: number; roster: readonly SimCharacter[]; focus_id: string | null }
  | { type: 'seed_set'; seed: number }
  | { type: 'character_added'; class_id: string; name: string; male: boolean }
  | { type: 'character_removed'; id: string }
  | { type: 'character_named'; id: string; name: string }
  | { type: 'character_class_set'; id: string; class_id: string }
  | { type: 'character_sex_set'; id: string; male: boolean }
  | { type: 'level_set'; id: string; level: number }
  | { type: 'stat_set'; id: string; stat: SimStat; value: number }
  | { type: 'stats_reset'; id: string }
  | { type: 'spell_level_set'; id: string; spell_id: string; level: number; max_level: number }
  | { type: 'spells_reset'; id: string }
  | { type: 'focus_set'; id: string | null }

export const EMPTY_STAT_ALLOC: Record<SimStat, number> = {
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
}

export const INITIAL_SIMULATOR_STATE: SimulatorState = { seed: 0, roster: [], focus_id: null }

const clamp_int = (value: number, min: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min

/** Stat points earned by reaching `level` — 5 per level from 2 (progression_math.move). */
export const stat_budget = (level: number): number => Math.max(0, level - 1) * STAT_POINTS_PER_LEVEL

/** Spell points earned by reaching `level` — 1 per level from 2 (progression_math.move). */
export const spell_budget = (level: number): number => Math.max(0, level - 1) * SPELL_POINTS_PER_LEVEL

/** Total spell points sunk into ONE spell sitting at `level` — Σ(t−1) for t in 2..level (S8 escalating). */
export const spell_cost = (level: number): number => (level * (level - 1)) / 2

export const stats_spent = (character: Readonly<SimCharacter>): number =>
  SIM_STATS.reduce((sum, stat) => sum + (character.stat_alloc[stat] ?? 0), 0)

export const spells_spent = (character: Readonly<SimCharacter>): number =>
  Object.values(character.spell_levels).reduce((sum, level) => sum + spell_cost(level), 0)

/** The highest level ≤ `wanted` whose total cost fits `budget` (1 = the free baseline, always affordable). */
const affordable_level = (wanted: number, budget: number): number => {
  const fits = Array.from({ length: Math.max(0, wanted - 1) }, (_, index) => wanted - index).find(
    (level) => spell_cost(level) <= budget
  )
  return fits ?? 1
}

/** Scale an over-budget allocation down proportionally — a level drop keeps the build's SHAPE, not its size. */
const fit_stats = (stat_alloc: Readonly<Record<SimStat, number>>, budget: number): Record<SimStat, number> => {
  const spent = SIM_STATS.reduce((sum, stat) => sum + (stat_alloc[stat] ?? 0), 0)
  if (spent <= budget) return stat_alloc
  return Object.fromEntries(
    SIM_STATS.map((stat) => [stat, spent === 0 ? 0 : Math.floor(((stat_alloc[stat] ?? 0) * budget) / spent)])
  ) as Record<SimStat, number>
}

/** Fold the spell map into the budget, richest-first, dropping every row back to its free baseline. */
const fit_spells = (spell_levels: Readonly<Record<string, number>>, budget: number): Record<string, number> => {
  const entries = Object.entries(spell_levels).sort(([a], [b]) => (a < b ? -1 : 1))
  const { rows } = entries.reduce<{ left: number; rows: [string, number][] }>(
    ({ left, rows: kept }, [spell_id, level]) => {
      const fitted = affordable_level(level, left)
      return { left: left - spell_cost(fitted), rows: fitted > 1 ? [...kept, [spell_id, fitted]] : kept }
    },
    { left: budget, rows: [] }
  )
  return Object.fromEntries(rows)
}

/** Re-fit a character's allocations to its own level's budgets — the ONE invariant every arm restores. */
const refit = (character: Readonly<SimCharacter>): SimCharacter => ({
  ...character,
  stat_alloc: fit_stats(character.stat_alloc, stat_budget(character.level)),
  spell_levels: fit_spells(character.spell_levels, spell_budget(character.level)),
})

const clean_name = (name: string, fallback: string): string => {
  const trimmed = String(name ?? '')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
  return trimmed.length > 0 ? trimmed : fallback
}

/** The first free `sim_c1…sim_c6` slot, or null when the roster is full — ids are slot-derived, so pure. */
const next_character_id = (roster: readonly SimCharacter[]): string | null => {
  const used = new Set(roster.map(({ id }) => id))
  return Array.from({ length: MAX_ROSTER }, (_, index) => `sim_c${index + 1}`).find((id) => !used.has(id)) ?? null
}

const map_character = (
  state: Readonly<SimulatorState>,
  id: string,
  change: (character: Readonly<SimCharacter>) => SimCharacter
): SimulatorState => ({
  ...state,
  roster: state.roster.map((character) => (character.id === id ? change(character) : character)),
})

/** Sanitize any character-shaped value (a hydrated IDB row included) into a valid, in-budget character. */
export const normalize_character = (raw: Readonly<Partial<SimCharacter> & { id: string }>): SimCharacter =>
  refit({
    id: raw.id,
    name: clean_name(String(raw.name ?? ''), raw.id),
    class_id: String(raw.class_id ?? ''),
    male: raw.male !== false,
    level: clamp_int(Number(raw.level ?? 1), 1, MAX_LEVEL),
    stat_alloc: Object.fromEntries(
      SIM_STATS.map((stat) => [stat, clamp_int(Number(raw.stat_alloc?.[stat] ?? 0), 0, Number.MAX_SAFE_INTEGER)])
    ) as Record<SimStat, number>,
    spell_levels: Object.fromEntries(
      Object.entries(raw.spell_levels ?? {})
        .map(([spell_id, level]) => [spell_id, clamp_int(Number(level), 1, Number.MAX_SAFE_INTEGER)] as const)
        .filter(([, level]) => level > 1)
    ),
    loadout: Object.fromEntries(
      Object.entries(raw.loadout ?? {}).filter(([, template_id]) => typeof template_id === 'string')
    ),
  })

export function reduce_simulator(state: Readonly<SimulatorState>, input: Readonly<SimulatorInput>): SimulatorState {
  switch (input.type) {
    case 'hydrated': {
      const roster = input.roster.slice(0, MAX_ROSTER).map(normalize_character)
      const focus_id = roster.some(({ id }) => id === input.focus_id) ? input.focus_id : (roster[0]?.id ?? null)
      return { seed: clamp_int(input.seed, 0, 0xffffffff), roster, focus_id }
    }

    case 'seed_set':
      return { ...state, seed: clamp_int(input.seed, 0, 0xffffffff) }

    case 'character_added': {
      const id = next_character_id(state.roster)
      if (!id) return state
      const character = normalize_character({
        id,
        name: input.name,
        class_id: input.class_id,
        male: input.male,
        level: 1,
        stat_alloc: EMPTY_STAT_ALLOC,
        spell_levels: {},
        loadout: {},
      })
      return { ...state, roster: [...state.roster, character], focus_id: id }
    }

    case 'character_removed': {
      const roster = state.roster.filter(({ id }) => id !== input.id)
      if (roster.length === state.roster.length) return state
      return { ...state, roster, focus_id: state.focus_id === input.id ? (roster[0]?.id ?? null) : state.focus_id }
    }

    case 'character_named':
      return map_character(state, input.id, (character) => ({
        ...character,
        name: clean_name(input.name, character.id),
      }))

    // A spell belongs to ONE class on chain (`raise_spell_level` aborts ENotClassSpell otherwise), so a class
    // switch drops the invested levels with it — keeping them would bank points on unreachable spells.
    case 'character_class_set':
      return map_character(state, input.id, (character) =>
        character.class_id === input.class_id
          ? character
          : { ...character, class_id: String(input.class_id), spell_levels: {} }
      )

    case 'character_sex_set':
      return map_character(state, input.id, (character) => ({ ...character, male: input.male }))

    case 'level_set':
      return map_character(state, input.id, (character) =>
        refit({ ...character, level: clamp_int(input.level, 1, MAX_LEVEL) })
      )

    case 'stat_set':
      return map_character(state, input.id, (character) => {
        const others = stats_spent(character) - (character.stat_alloc[input.stat] ?? 0)
        const ceiling = Math.max(0, stat_budget(character.level) - others)
        return {
          ...character,
          stat_alloc: { ...character.stat_alloc, [input.stat]: clamp_int(input.value, 0, ceiling) },
        }
      })

    case 'stats_reset':
      return map_character(state, input.id, (character) => ({ ...character, stat_alloc: EMPTY_STAT_ALLOC }))

    case 'spell_level_set':
      return map_character(state, input.id, (character) => {
        const others = spells_spent(character) - spell_cost(character.spell_levels[input.spell_id] ?? 1)
        const left = Math.max(0, spell_budget(character.level) - others)
        const wanted = clamp_int(input.level, 1, Math.max(1, Math.trunc(input.max_level)))
        const level = affordable_level(wanted, left)
        const { [input.spell_id]: _dropped, ...rest } = character.spell_levels
        return { ...character, spell_levels: level > 1 ? { ...rest, [input.spell_id]: level } : rest }
      })

    case 'spells_reset':
      return map_character(state, input.id, (character) => ({ ...character, spell_levels: {} }))

    case 'focus_set':
      return state.roster.some(({ id }) => id === input.id) || input.id === null
        ? { ...state, focus_id: input.id }
        : state
  }
}
