// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { OBSERVER_ACTION_KINDS, OBSERVER_AUDIENCES, OBSERVER_EMIT_MATRIX } from './fixtures/observer_emit_matrix.js'

const designed_expectation = (action_kind, audience) => {
  if (action_kind === 'damage_heal')
    return { presentation: 'beat', visibility: 'public', matrix_red: false, issues: [] }

  if (action_kind === 'status_only_cast') {
    const common = {
      presentation: ['cast_animation', 'badge'],
      visibility: 'public_unless_invisibility_class',
    }
    if (audience === 'self')
      return {
        ...common,
        status_decode: 'shared_home',
        badge_turns: 'committed_status_projection',
        matrix_red: true,
        issues: [2166, 2176],
      }
    if (audience === 'ally')
      return {
        ...common,
        presentation_door: 'admit_events',
        presentation_count: 1,
        matrix_red: true,
        issues: [2162, 2163],
      }
    return { ...common, status_decode: 'shared_home', matrix_red: true, issues: [2166] }
  }

  if (action_kind === 'trap_place') {
    if (audience === 'self')
      return { presentation: 'full_sprite', visibility: 'visible', matrix_red: false, issues: [] }
    if (audience === 'ally')
      return { presentation: 'full_sprite', visibility: 'visible', matrix_red: true, issues: [2164] }
    return { presentation: 'none', visibility: 'hidden', matrix_red: true, issues: [2164] }
  }

  if (action_kind === 'trap_trigger')
    return { presentation: 'resolution_sequence', visibility: 'public', matrix_red: false, issues: [] }

  if (action_kind === 'movement')
    return {
      presentation: 'path_walk',
      visibility: audience === 'enemy' ? 'unless_mover_invisible' : 'visible_baseline',
      matrix_red: false,
      issues: [],
    }

  if (audience === 'self')
    return { presentation: 'own_ranges_overlays', visibility: 'always', matrix_red: true, issues: [2161] }
  if (audience === 'ally')
    return { presentation: 'visible_baseline', visibility: 'visible_baseline', matrix_red: false, issues: [] }
  return { presentation: 'silhouette_less', visibility: 'hidden', matrix_red: false, issues: [] }
}

describe('observer emit matrix — shared action-kind × audience contract', () => {
  test('the fixture is the complete, duplicate-free 6 × 3 matrix', () => {
    const coordinates = OBSERVER_EMIT_MATRIX.map(({ action_kind, audience }) => `${action_kind}:${audience}`)
    const required = OBSERVER_ACTION_KINDS.flatMap((action_kind) =>
      OBSERVER_AUDIENCES.map((audience) => `${action_kind}:${audience}`)
    )

    expect(OBSERVER_EMIT_MATRIX).toHaveLength(18)
    expect(new Set(coordinates).size).toBe(18)
    expect([...coordinates].sort()).toEqual([...required].sort())
  })

  test('exactly six designed-red cells carry every observer-wave issue tag', () => {
    const red = OBSERVER_EMIT_MATRIX.filter(({ expectation }) => expectation.matrix_red)
    const issues = new Set(red.flatMap(({ expectation }) => expectation.issues))

    expect(red).toHaveLength(6)
    expect([...issues].sort((a, b) => a - b)).toEqual([2161, 2162, 2163, 2164, 2166, 2176])
  })

  for (const row of OBSERVER_EMIT_MATRIX) {
    const title = `${row.action_kind} × ${row.audience}`
    const assert_cell = () => {
      expect(Object.keys(row).sort()).toEqual(['action_kind', 'audience', 'expectation'])
      expect(row.expectation).toEqual(designed_expectation(row.action_kind, row.audience))
    }

    if (row.expectation.matrix_red) test.skip(`MATRIX_RED: ${title}`, assert_cell)
    else test(title, assert_cell)
  }
})
