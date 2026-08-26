// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_fight } from '@aresrpg/fight'
import { describe, expect, test } from 'bun:test'

import authored_boards from '../../../../seed/content/fight_boards.json'
import { filter_picker_items } from '../../src/components/SearchPickerModal.tsx'
import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import {
  can_start_simulator_fight,
  initial_simulator_state,
  reduce_simulator_state,
  simulator_board,
} from '../../src/modules/simulator.ts'
import fight_module from '../../src/modules/fight.ts'
import { simulator_fight_setup } from '../../src/simulator/fight_setup.ts'
import { simulator_cell_intent } from '../../src/simulator/board_intent.ts'
import { simulator_debug_blob } from '../../src/simulator/debug_blob.ts'
import { initial_app_state, reduce_app_state, type AppInput, type AppState } from '../../src/store.ts'

const settings = Object.freeze({
  quality: 'medium',
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
} as const)

const local_character = () => ({
  id: 'local_senshi',
  name: 'Local Senshi',
  classe: 'senshi',
  male: true,
  colors: ['#ffffff', '#d9af57', '#8b6539'] as const,
  level: 1,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  spell_levels: {},
  loadout: {},
})

const with_local_character = () =>
  reduce_simulator_state(initial_simulator_state(), {
    type: 'simulator/character_saved',
    character: local_character(),
  })

describe('local fight simulator setup', () => {
  test('the frontend has one canonical fight construction door', async () => {
    const source_root = `${import.meta.dir}/../../src`
    const files = [...new Bun.Glob('**/*.{ts,tsx}').scanSync(source_root)]
    const owners = (
      await Promise.all(files.map(async (file) => ({ file, source: await Bun.file(`${source_root}/${file}`).text() })))
    )
      .filter(({ source }) => source.includes('create_fight({'))
      .map(({ file }) => file)

    expect(owners).toEqual(['modules/fight_session.ts'])
  })

  test('the shared picker composes category, text, and pill filters', () => {
    const items = [
      {
        id: 'bunny',
        label: 'Alley Bunny',
        category: 'normal',
        tags: ['earth'],
        facets: ['world:nauvis', 'biome:nauvis:forest', 'family:fuwa', 'element:earth'],
      },
      { id: 'abbot', label: 'The Abbot', category: 'boss', tags: ['fire'], facets: ['family:abbot'] },
    ]

    expect(filter_picker_items({ items, search: 'bunn', category: 'normal', pills: new Set(['earth']) })).toEqual([
      items[0],
    ])
    expect(filter_picker_items({ items, search: '', category: 'normal', pills: new Set(['fire']) })).toEqual([])
    expect(filter_picker_items({ items, search: '', category: 'family:fuwa', pills: new Set() })).toEqual([items[0]])
    expect(filter_picker_items({ items, search: '', category: 'biome:nauvis:forest', pills: new Set() })).toEqual([
      items[0],
    ])
  })

  test('starts with an empty authored roster rather than an invented fighter', () => {
    expect(initial_simulator_state().characters).toEqual([])
  })

  test('hydrates valid current and retired IndexedDB character rows through the reducer', () => {
    const state = reduce_simulator_state(initial_simulator_state(), {
      type: 'simulator/characters_hydrated',
      characters: [
        local_character(),
        {
          id: 'sim_c2',
          name: 'Retired shape',
          class_id: 'shugo',
          male: false,
          level: 2,
          stat_alloc: { vitality: 5, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 },
          spell_levels: {},
          loadout: {},
        },
        { id: 'junk' },
      ],
    })

    expect(state.characters.map(({ id }) => id)).toEqual(['local_senshi', 'sim_c2'])
    expect(state.characters[1]).toMatchObject({ classe: 'shugo', vitality: 5, colors: local_character().colors })
  })

  test('uses the simulator character creation flow and keeps edits in the simulator reducer', async () => {
    const modal_source = await Bun.file(`${import.meta.dir}/../../src/simulator/CharacterModal.tsx`).text()

    expect(modal_source).toContain('function CreateForm')
    expect(modal_source).not.toContain('CharacterIdentityFields')

    const created = reduce_simulator_state(initial_simulator_state(), {
      type: 'simulator/character_added',
      character_id: 'sim_c1',
      classe: 'senshi',
      name: 'Local Senshi',
      male: true,
    })
    const character = created.characters[0]!
    const leveled = reduce_simulator_state(created, {
      type: 'simulator/level_set',
      character_id: character.id,
      level: 2,
    })
    const allocated = reduce_simulator_state(leveled, {
      type: 'simulator/stat_set',
      character_id: character.id,
      stat: 'vitality',
      value: 99,
    })
    const changed_class = reduce_simulator_state(
      {
        ...allocated,
        characters: [{ ...allocated.characters[0]!, spell_levels: { tackle: 2 } }],
      },
      {
        type: 'simulator/character_class_set',
        character_id: character.id,
        classe: 'shugo',
      }
    )

    expect(character.id).toBe('sim_c1')
    expect(allocated.characters[0]?.vitality).toBe(5)
    expect(changed_class.characters[0]?.classe).toBe('shugo')
    expect(changed_class.characters[0]?.vitality).toBe(0)
    expect(changed_class.characters[0]?.spell_levels).toEqual({})
  })

  test('the simulator enforces class costs and Ikari double-vitality reachability', () => {
    const base = reduce_simulator_state(initial_simulator_state(), {
      type: 'simulator/character_saved',
      character: { ...local_character(), classe: 'ikari', level: 2 },
    })
    const vitality = reduce_simulator_state(base, {
      type: 'simulator/stat_set',
      character_id: 'local_senshi',
      stat: 'vitality',
      value: 99,
    })
    const strength = reduce_simulator_state(vitality, {
      type: 'simulator/stat_set',
      character_id: 'local_senshi',
      stat: 'strength',
      value: 1,
    })

    expect(vitality.characters[0]?.vitality).toBe(10)
    expect(strength.characters[0]?.strength).toBe(0)
  })

  test('saves roster characters independently and removes their board placement with them', () => {
    const initial = initial_simulator_state()
    const character = {
      ...local_character(),
      level: 2,
      vitality: 5,
    }
    const saved = reduce_simulator_state(initial, { type: 'simulator/character_saved', character })
    const [cell] = simulator_board(saved).start_cells_a
    const placed = reduce_simulator_state(saved, {
      type: 'simulator/character_placed',
      cell: cell!,
      character_id: character.id,
    })
    const removed = reduce_simulator_state(placed, {
      type: 'simulator/character_removed',
      character_id: character.id,
    })

    expect(saved.characters).toEqual([character])
    expect(placed.character_placements[Number(cell)]).toBe(character.id)
    expect(removed.characters).toEqual([])
    expect(removed.character_placements).toEqual({})
  })

  test('keeps the authored max-roll loadout on the local character', () => {
    const character = { ...local_character(), loadout: { tool: 'arcanite_hoe', title: 'title_veteran' } }
    const saved = reduce_simulator_state(initial_simulator_state(), {
      type: 'simulator/character_saved',
      character,
    })

    expect(saved.characters[0]?.loadout).toEqual(character.loadout)
  })

  test('derives the exact same 6v6 board from the same local seed', () => {
    const first = simulator_board(initial_simulator_state())
    const second = simulator_board(initial_simulator_state())

    expect(second).toEqual(first)
    expect(first.start_cells_a).toHaveLength(6)
    expect(first.start_cells_b).toHaveLength(6)
  })

  test('plays the authored catalog row the chain would pick — seed % len, byte-equal', () => {
    const rows = authored_boards.boards
    expect(rows.length).toBeGreaterThan(0)
    const seeds = [0n, 1n, 7n, BigInt(rows.length), BigInt(rows.length) + 3n]
    seeds.forEach((seed) => {
      const row = rows[Number(seed % BigInt(rows.length))]!
      expect(simulator_board({ ...initial_simulator_state(), seed })).toEqual({
        width: BigInt(row.width),
        height: BigInt(row.height),
        shape_mask: row.shape_mask.map(BigInt),
        obstacles: row.obstacles.map(BigInt),
        holes: row.holes.map(BigInt),
        start_cells_a: row.start_cells_a.map(BigInt),
        start_cells_b: row.start_cells_b.map(BigInt),
      })
    })
  })

  test('builds the simulator probe through the shared five-second blob contract', () => {
    const board = simulator_board(initial_simulator_state())
    const clicked_cell = board.start_cells_b[2]!
    const blob = simulator_debug_blob(board, clicked_cell, 3, 'per_cell', 0x35b34a)

    expect(blob).toMatchObject({
      shape: 'per_cell',
      color: 0x35b34a,
      origin_cell: Number(clicked_cell),
      reveal_step_ms: 32,
      duration_ms: 5_000,
    })
    expect(blob?.cells.length).toBeGreaterThan(1)
    expect(
      blob?.cells.some((cell) => board.obstacles.includes(BigInt(cell)) || board.holes.includes(BigInt(cell)))
    ).toBe(false)
    expect(simulator_debug_blob(board, board.obstacles[0]!, 3, 'per_cell', 0x35b34a)).toBeNull()
  })

  test('accepts fighters only on their own starting band and requires both teams', () => {
    const initial = with_local_character()
    const board = simulator_board(initial)
    const [ally_cell] = board.start_cells_a
    const [enemy_cell] = board.start_cells_b
    const ally = reduce_simulator_state(initial, {
      type: 'simulator/character_placed',
      cell: ally_cell!,
      character_id: initial.characters[0]!.id,
    })
    const enemy = reduce_simulator_state(ally, {
      type: 'simulator/mob_placed',
      cell: enemy_cell!,
      mob_type: 'alley_bunny',
      level: 10,
      level_min: 10,
      level_max: 20,
    })

    expect(can_start_simulator_fight(ally)).toBeFalse()
    expect(can_start_simulator_fight(enemy)).toBeTrue()
    expect(
      reduce_simulator_state(enemy, {
        type: 'simulator/mob_placed',
        cell: ally_cell!,
        mob_type: 'alley_bunny',
        level: 4,
        level_min: 1,
        level_max: 6,
      })
    ).toBe(enemy)
  })

  test('keeps placement verbs on the board cells', () => {
    const state = with_local_character()
    const board = simulator_board(state)
    const ally_cell = board.start_cells_a[0]!
    const enemy_cell = board.start_cells_b[0]!

    expect(simulator_cell_intent(board, state, ally_cell)).toEqual({ type: 'pick_character', cell: ally_cell })
    expect(simulator_cell_intent(board, state, enemy_cell)).toEqual({ type: 'edit_mob', cell: enemy_cell })

    const placed = reduce_simulator_state(state, {
      type: 'simulator/character_placed',
      cell: ally_cell,
      character_id: state.characters[0]!.id,
    })
    expect(simulator_cell_intent(board, placed, ally_cell)).toEqual({ type: 'unplace_character', cell: ally_cell })
  })

  test('reroll advances the seed and clears placements tied to the old board', () => {
    const initial = with_local_character()
    const [ally_cell] = simulator_board(initial).start_cells_a
    const placed = reduce_simulator_state(initial, {
      type: 'simulator/character_placed',
      cell: ally_cell!,
      character_id: initial.characters[0]!.id,
    })
    const rerolled = reduce_simulator_state(placed, { type: 'simulator/board_rerolled' })

    expect(rerolled.seed).toBe(initial.seed + 1n)
    expect(rerolled.character_placements).toEqual({})
    expect(simulator_board(rerolled)).not.toEqual(simulator_board(initial))
  })

  test('hands local birth inputs to the canonical fight factory', () => {
    const initial = reduce_simulator_state(initial_simulator_state(), {
      type: 'simulator/character_saved',
      character: local_character(),
    })
    const board = simulator_board(initial)
    const with_ally = reduce_simulator_state(initial, {
      type: 'simulator/character_placed',
      cell: board.start_cells_a[0]!,
      character_id: initial.characters[0]!.id,
    })
    const protector = encyclopedia_catalog.mobs.find(({ mob_type }) => mob_type === 'protector_wheat_bricheton')!
    const ready = reduce_simulator_state(with_ally, {
      type: 'simulator/mob_placed',
      cell: board.start_cells_b[0]!,
      mob_type: protector.mob_type,
      level: protector.level_min,
      level_min: protector.level_min,
      level_max: protector.level_max,
    })
    const fight = create_fight({ setup: simulator_fight_setup(ready), mode: 'local', seed: ready.seed })

    expect(fight.state().contract.board).toEqual(board)
    expect(fight.state().contract.fighters).toHaveLength(2)
    expect(fight.state().contract.fighters[1]?.kind.type).toBe('mob')
    expect(fight.state().sources.players.local_senshi?.folded_stats.chance).toBe(32_768n)
    expect(fight.state().sources.players.local_senshi?.weapon).toBeNull()
    expect(fight.apply({ type: 'start', observed_ms: 60_000n }).error).toBeNull()

    const listeners = new Map<string, ((input: AppInput) => void)[]>()
    let app_state: AppState = Object.freeze({ ...initial_app_state(settings), simulator: ready })
    const emit = (input: AppInput): void => {
      app_state = reduce_app_state(app_state, input)
      for (const listener of listeners.get(input.type) ?? []) listener(input)
    }
    fight_module.observe?.({
      events: {
        on: (name, listener) => {
          listeners.set(name, [...(listeners.get(name) ?? []), listener as unknown as (input: AppInput) => void])
        },
      },
      signal: new AbortController().signal,
      get_state: () => app_state,
      dispatch: emit,
    })
    emit({ type: 'fight/opened', mode: 'local', setup: simulator_fight_setup(ready), seed: ready.seed })
    emit({ type: 'fight/input', fight: null, input: { type: 'start' }, origin: 'local' })

    expect(app_state.fight.mounted).toBeTrue()
    expect(app_state.fight.checkpoint?.contract.round).toBeGreaterThanOrEqual(1n)
  })
})
