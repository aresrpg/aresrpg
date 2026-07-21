// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { CAST_DROP_TARGET_OUT_OF_REACH, local_commit_cast_drop } from '@aresrpg/fight/turn_commit'
import { retarget_cast } from '@aresrpg/fight/txs'

import { emit_local_cast_drop_toast } from './cast_drop_toast.js'

const LOCAL = 'player:local'
const A = 168
const FAR = 378

const translate = (key, { spell } = {}) =>
  key === 'dungeons.cast_target_unreachable' ? `${spell} cancelled — target out of reach` : key

const revalidate_and_emit = ({ committed_cell, reaches }) => {
  const revalidation = retarget_cast({ target_cell: A, committed_cell, reaches })
  const drops = revalidation.dropped
    ? [
        local_commit_cast_drop({
          actor_id: LOCAL,
          spell_name: "Prowler's Eye",
          reason: CAST_DROP_TARGET_OUT_OF_REACH,
        }),
      ]
    : []
  const emitted = []
  const count = emit_local_cast_drop_toast({
    commit_succeeded: true,
    drops,
    local_actor_id: LOCAL,
    t: translate,
    emit: (toast) => emitted.push(toast),
  })
  return { revalidation, count, emitted }
}

describe('local commit cast-drop toast', () => {
  test('a re-validation pass over a stationary board emits ZERO toasts', () => {
    const result = revalidate_and_emit({ committed_cell: A, reaches: () => true })

    expect(result.revalidation).toEqual({ target: A })
    expect(result.count).toBe(0)
    expect(result.emitted).toEqual([])
  })

  test('a genuine local out-of-reach drop emits exactly one named toast', () => {
    const result = revalidate_and_emit({ committed_cell: FAR, reaches: () => false })

    expect(result.revalidation).toEqual({ dropped: true })
    expect(result.count).toBe(1)
    expect(result.emitted).toEqual([{ state: 'info', title: "Prowler's Eye cancelled — target out of reach" }])
  })

  test('stacked local drops aggregate into one toast naming every omitted cast', () => {
    const emitted = []
    const count = emit_local_cast_drop_toast({
      commit_succeeded: true,
      drops: [
        local_commit_cast_drop({
          actor_id: LOCAL,
          spell_name: "Prowler's Eye",
          reason: CAST_DROP_TARGET_OUT_OF_REACH,
        }),
        local_commit_cast_drop({
          actor_id: LOCAL,
          spell_name: 'Ghost Talon',
          reason: CAST_DROP_TARGET_OUT_OF_REACH,
        }),
      ],
      local_actor_id: LOCAL,
      t: translate,
      emit: (toast) => emitted.push(toast),
    })

    expect(count).toBe(1)
    expect(emitted).toEqual([
      { state: 'info', title: "Prowler's Eye, Ghost Talon cancelled — target out of reach" },
    ])
  })

  test('canonical ingress, prediction retirement, peers, and mob processing stay silent', () => {
    const local_drop = local_commit_cast_drop({
      actor_id: LOCAL,
      spell_name: "Prowler's Eye",
      reason: CAST_DROP_TARGET_OUT_OF_REACH,
    })
    const emitted = []

    const count = emit_local_cast_drop_toast({
      commit_succeeded: true,
      drops: [
        { ...local_drop, source: 'canonical_ingress' },
        { ...local_drop, kind: 'prediction_retired' },
        { ...local_drop, actor_id: 'player:peer' },
        { ...local_drop, source: 'mob_processing' },
      ],
      local_actor_id: LOCAL,
      t: translate,
      emit: (toast) => emitted.push(toast),
    })

    expect(count).toBe(0)
    expect(emitted).toEqual([])
  })

  test('a failed commit cannot announce a cancellation', () => {
    const emitted = []
    const count = emit_local_cast_drop_toast({
      commit_succeeded: false,
      drops: [
        local_commit_cast_drop({
          actor_id: LOCAL,
          spell_name: "Prowler's Eye",
          reason: CAST_DROP_TARGET_OUT_OF_REACH,
        }),
      ],
      local_actor_id: LOCAL,
      t: translate,
      emit: (toast) => emitted.push(toast),
    })

    expect(count).toBe(0)
    expect(emitted).toEqual([])
  })
})
