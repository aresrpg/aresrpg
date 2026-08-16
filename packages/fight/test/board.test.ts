// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_mob_snapshot, generate_board, mob_scalar_for_level, project_board_cells } from '../src/index.ts'
import type { MobTemplateSource } from '../src/types.ts'

describe('fight board projection', () => {
  test('projects one canonical render classification for every shaped cell', () => {
    const board = generate_board(1n)
    const first = project_board_cells(board)
    const second = project_board_cells(generate_board(1n))

    expect(second).toEqual(first)
    expect(first.filter(({ kind }) => kind === 'start_a')).toHaveLength(6)
    expect(first.filter(({ kind }) => kind === 'start_b')).toHaveLength(6)
    expect(first.filter(({ kind }) => kind === 'obstacle')).toHaveLength(board.obstacles.length)
    expect(first.filter(({ kind }) => kind === 'hole')).toHaveLength(board.holes.length)
  })
})

test('the canonical mob scalar reaches every requested authored level', () => {
  const template = {
    mob_type: 'test',
    level_min: 11n,
    level_max: 19n,
    hp: 10n,
    ap: 1n,
    mp: 1n,
    agility: 0n,
    wisdom: 0n,
    earth_res: 32_768n,
    fire_res: 32_768n,
    water_res: 32_768n,
    air_res: 32_768n,
    spells: [],
    loot: [],
    xp: 1n,
  } satisfies MobTemplateSource

  for (let level = template.level_min; level <= template.level_max; level += 1n)
    expect(create_mob_snapshot(template, mob_scalar_for_level(template, level)).level).toBe(level)
})
