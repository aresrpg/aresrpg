// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export const OBSERVER_ACTION_KINDS = [
  'damage_heal',
  'status_only_cast',
  'trap_place',
  'trap_trigger',
  'movement',
  'invisible_self',
]

export const OBSERVER_AUDIENCES = ['self', 'ally', 'enemy']

/**
 * The shared action-kind × audience contract. `matrix_red` marks a designed cell whose production proof is
 * intentionally skipped until the observer-wave fix lane lands; issue tags keep every reported symptom attached
 * to the cell that exercises it. Roles are semantic only — no player or QA identity belongs in this fixture.
 */
export const OBSERVER_EMIT_MATRIX = [
  {
    action_kind: 'damage_heal',
    audience: 'self',
    expectation: { presentation: 'beat', visibility: 'public', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'damage_heal',
    audience: 'ally',
    expectation: { presentation: 'beat', visibility: 'public', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'damage_heal',
    audience: 'enemy',
    expectation: { presentation: 'beat', visibility: 'public', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'status_only_cast',
    audience: 'self',
    expectation: {
      presentation: ['cast_animation', 'badge'],
      visibility: 'public_unless_invisibility_class',
      status_decode: 'shared_home',
      badge_turns: 'committed_status_projection',
      matrix_red: true,
      issues: [2166, 2176],
    },
  },
  {
    action_kind: 'status_only_cast',
    audience: 'ally',
    expectation: {
      presentation: ['cast_animation', 'badge'],
      visibility: 'public_unless_invisibility_class',
      presentation_door: 'admit_events',
      presentation_count: 1,
      matrix_red: true,
      issues: [2162, 2163],
    },
  },
  {
    action_kind: 'status_only_cast',
    audience: 'enemy',
    expectation: {
      presentation: ['cast_animation', 'badge'],
      visibility: 'public_unless_invisibility_class',
      status_decode: 'shared_home',
      matrix_red: true,
      issues: [2166],
    },
  },
  {
    action_kind: 'trap_place',
    audience: 'self',
    expectation: { presentation: 'full_sprite', visibility: 'visible', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'trap_place',
    audience: 'ally',
    expectation: { presentation: 'full_sprite', visibility: 'visible', matrix_red: true, issues: [2164] },
  },
  {
    action_kind: 'trap_place',
    audience: 'enemy',
    expectation: { presentation: 'none', visibility: 'hidden', matrix_red: true, issues: [2164] },
  },
  {
    action_kind: 'trap_trigger',
    audience: 'self',
    expectation: { presentation: 'resolution_sequence', visibility: 'public', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'trap_trigger',
    audience: 'ally',
    expectation: { presentation: 'resolution_sequence', visibility: 'public', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'trap_trigger',
    audience: 'enemy',
    expectation: { presentation: 'resolution_sequence', visibility: 'public', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'movement',
    audience: 'self',
    expectation: { presentation: 'path_walk', visibility: 'visible_baseline', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'movement',
    audience: 'ally',
    expectation: { presentation: 'path_walk', visibility: 'visible_baseline', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'movement',
    audience: 'enemy',
    expectation: {
      presentation: 'path_walk',
      visibility: 'unless_mover_invisible',
      matrix_red: false,
      issues: [],
    },
  },
  {
    action_kind: 'invisible_self',
    audience: 'self',
    expectation: { presentation: 'own_ranges_overlays', visibility: 'always', matrix_red: true, issues: [2161] },
  },
  {
    action_kind: 'invisible_self',
    audience: 'ally',
    expectation: { presentation: 'visible_baseline', visibility: 'visible_baseline', matrix_red: false, issues: [] },
  },
  {
    action_kind: 'invisible_self',
    audience: 'enemy',
    expectation: { presentation: 'silhouette_less', visibility: 'hidden', matrix_red: false, issues: [] },
  },
]
