// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type BehaviorNode<Action, Condition> =
  | Readonly<{ type: 'sequence' | 'selector'; children: readonly BehaviorNode<Action, Condition>[] }>
  | Readonly<{ type: 'loop'; child: BehaviorNode<Action, Condition> }>
  | Readonly<{ type: 'condition'; condition: Condition }>
  | Readonly<{ type: 'action'; action: Action }>
  | Readonly<{ type: 'wait' | 'complete' }>
  | Readonly<{ type: 'replan'; reason: string }>
export type BehaviorMemory = Readonly<{
  completed: readonly string[]
  selected: Readonly<Record<string, number>>
}>
export type BehaviorResult<Action> = Readonly<{
  status: 'success' | 'failure' | 'waiting' | 'complete' | 'replan' | 'action'
  memory: BehaviorMemory
  node?: string
  action?: Action
  reason?: string
  blocked?: boolean
}>
const below = (root: string, path: string) => path === root || path.startsWith(`${root}/`)
const clear_subtree = (root: string, memory: BehaviorMemory): BehaviorMemory => ({
  completed: memory.completed.filter((path) => !below(root, path)),
  selected: Object.fromEntries(Object.entries(memory.selected).filter(([path]) => !below(root, path))),
})
export const empty_behavior_memory = (): BehaviorMemory => ({ completed: [], selected: {} })
/** Pure reactive tree evaluation. Execution and receipt recovery remain outside this evaluator.
 * Unknown conditions block selectors too: absence of an observation is never a negative fact. */
export const evaluate_behavior = <Action, Condition>(
  tree: BehaviorNode<Action, Condition>,
  memory: BehaviorMemory,
  condition: (value: Condition) => boolean | null,
  action_status: (value: Action, path: string) => BehaviorResult<Action>['status'] = () => 'action'
): BehaviorResult<Action> => {
  type Node = BehaviorNode<Action, Condition>
  type Visit = (node: Node, path: string, retained: BehaviorMemory) => BehaviorResult<Action>
  const handlers = {
    condition: (node, _path, retained) => {
      const value = condition(node.condition)
      const statuses = new Map<boolean | null, BehaviorResult<Action>['status']>([
        [null, 'waiting'],
        [true, 'success'],
        [false, 'failure'],
      ])
      return { status: statuses.get(value)!, blocked: value === null, memory: retained }
    },
    action: (node, path, retained) => {
      if (retained.completed.includes(path)) return { status: 'success', memory: retained }
      const status = action_status(node.action, path)
      return {
        status,
        node: path,
        action: node.action,
        memory: status === 'success' ? { ...retained, completed: [...retained.completed, path] } : retained,
      }
    },
    wait: (_node, _path, retained) => ({ status: 'waiting', memory: retained }),
    complete: (_node, _path, retained) => ({ status: 'complete', memory: retained }),
    replan: (node, _path, retained) => ({ status: 'replan', reason: node.reason, memory: retained }),
    loop: (node, path, retained) => {
      const result = visit(node.child, `${path}/0`, retained)
      return result.status === 'success' ? { status: 'waiting', memory: clear_subtree(path, result.memory) } : result
    },
    sequence: (node, path, retained) => sequence(node.children, path, retained),
    selector: (node, path, retained) => selector(node.children, path, retained),
  } satisfies {
    [Kind in Node['type']]: (
      node: Node & { type: Kind },
      path: string,
      retained: BehaviorMemory
    ) => BehaviorResult<Action>
  }
  // The mapped handlers preserve the discriminant/argument correlation at dispatch.
  const visit: Visit = (node, path, retained) => (handlers[node.type] as Visit)(node, path, retained)
  const sequence = (
    children: readonly BehaviorNode<Action, Condition>[],
    path: string,
    retained: BehaviorMemory
  ): BehaviorResult<Action> => {
    let current = retained
    for (const [index, child] of children.entries()) {
      const result = visit(child, `${path}/${index}`, current)
      current = result.memory
      if (result.status === 'failure') return { ...result, memory: clear_subtree(path, current) }
      if (result.status !== 'success') return result
    }
    return { status: 'success', memory: current }
  }
  const selector = (
    children: readonly BehaviorNode<Action, Condition>[],
    path: string,
    retained: BehaviorMemory
  ): BehaviorResult<Action> => {
    let current = retained
    for (const [index, child] of children.entries()) {
      const child_path = `${path}/${index}`
      let result = visit(child, child_path, current)
      if (result.status === 'failure') {
        current = clear_subtree(child_path, result.memory)
        continue
      }
      if (result.blocked) return { ...result, memory: retained }
      const previous = retained.selected[path]
      if (previous !== undefined && previous !== index) {
        current = clear_subtree(`${path}/${previous}`, current)
        // Reentering a different branch starts a new traversal of that branch.
        result = visit(child, child_path, clear_subtree(child_path, current))
      }
      return { ...result, memory: { ...result.memory, selected: { ...result.memory.selected, [path]: index } } }
    }
    return { status: 'failure', memory: clear_subtree(path, current) }
  }
  return visit(tree, 'root', memory)
}
