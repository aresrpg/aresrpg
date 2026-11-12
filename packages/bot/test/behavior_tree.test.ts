// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { evaluate_behavior, empty_behavior_memory, type BehaviorNode } from '../src/behavior_tree.ts'

type Node = BehaviorNode<string, string>
const action = (name: string): Node => ({ type: 'action', action: name })
const condition = (name: string): Node => ({ type: 'condition', condition: name })
const branch: Node = {
  type: 'selector',
  children: [
    { type: 'sequence', children: [condition('urgent'), action('handle'), action('finish')] },
    { type: 'sequence', children: [action('gather'), action('craft')] },
  ],
}
test('reactive selector preempts and clears the abandoned subtree in either direction', () => {
  const first = evaluate_behavior(branch, empty_behavior_memory(), () => false)
  expect(first).toMatchObject({ status: 'action', node: 'root/1/0', action: 'gather' })
  const after_gather = { ...first.memory, completed: ['root/1/0'] }
  const next = evaluate_behavior(branch, after_gather, () => false)
  expect(next.action).toBe('craft')
  const urgent = evaluate_behavior(branch, next.memory, () => true)
  expect(urgent.action).toBe('handle')
  expect(urgent.memory.completed).toEqual([])
  const after_handle = { ...urgent.memory, completed: ['root/0/1'] }
  const lower = evaluate_behavior(branch, after_handle, () => false)
  expect(lower.action).toBe('gather')
  expect(lower.memory.completed).toEqual([])
})
test('unknown higher-priority facts block fallback actions and do not mean false', () => {
  const next = evaluate_behavior(branch, empty_behavior_memory(), () => null)
  expect(next.status).toBe('waiting')
  expect(next.action).toBeUndefined()
})
test('nested sequence retains action successes but reevaluates conditions', () => {
  const tree: Node = { type: 'sequence', children: [condition('ready'), action('buy'), action('craft')] }
  const memory = { ...empty_behavior_memory(), completed: ['root/1'] }
  expect(evaluate_behavior(tree, memory, () => true).action).toBe('craft')
  const invalidated = evaluate_behavior(tree, memory, () => false)
  expect(invalidated).toMatchObject({ status: 'failure', memory: { completed: [] } })
})
test('explicit loop yields after one traversal and never spins synchronously', () => {
  const tree: Node = { type: 'loop', child: condition('true') }
  let visits = 0
  const next = evaluate_behavior(tree, empty_behavior_memory(), () => {
    visits += 1
    return true
  })
  expect(next.status).toBe('waiting')
  expect(visits).toBe(1)
  expect(next.memory).toEqual(empty_behavior_memory())
})
test('unavailable selection falls through but waiting and replanning do not', () => {
  const tree: Node = { type: 'selector', children: [action('gather'), action('buy')] }
  expect(
    evaluate_behavior(
      tree,
      empty_behavior_memory(),
      () => true,
      (value) => (value === 'gather' ? 'failure' : 'action')
    ).action
  ).toBe('buy')
  for (const status of ['waiting', 'replan'] as const)
    expect(
      evaluate_behavior(
        tree,
        empty_behavior_memory(),
        () => true,
        () => status
      )
    ).toMatchObject({ status, action: 'gather' })
})
test('explicit completion propagates out of nested loops', () => {
  expect(
    evaluate_behavior(
      { type: 'loop', child: { type: 'sequence', children: [condition('goal'), { type: 'complete' }] } },
      empty_behavior_memory(),
      () => true
    ).status
  ).toBe('complete')
})

test('unknown priority preserves completed effects in the selected branch', () => {
  const memory = { completed: ['root/1/0'], selected: { root: 1 } }
  const blocked = evaluate_behavior(branch, memory, () => null)
  expect(blocked.memory).toEqual(memory)
  expect(blocked.blocked).toBe(true)
  expect(evaluate_behavior(branch, blocked.memory, () => false).action).toBe('craft')
})
