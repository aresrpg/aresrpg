// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type inventory_context_action =
  | 'equip'
  | 'use'
  | 'clear'
  | 'feed'
  | 'open'
  | 'crush'
  | 'split'
  | 'merge'
  | 'send'
  | 'explorer'

export type inventory_context_stack = {
  readonly id: string
  readonly template_id: string | null
  readonly amount: number
  readonly stackable: boolean
}

export type inventory_stack_context = {
  readonly stack: inventory_context_stack
  readonly stacks: readonly inventory_context_stack[]
}

const is_mergeable_stack = (stack: inventory_context_stack, candidate: inventory_context_stack): boolean =>
  stack.stackable &&
  candidate.stackable &&
  candidate.id !== stack.id &&
  Boolean(stack.template_id) &&
  candidate.template_id === stack.template_id

const is_stack_action_visible = (
  action: inventory_context_action,
  stack_context: inventory_stack_context | undefined
): boolean => {
  if (action !== 'split' && action !== 'merge') return true
  if (!stack_context || stack_context.stack.amount <= 1) return false
  if (action === 'split') return stack_context.stack.stackable
  return stack_context.stacks.some((candidate) => is_mergeable_stack(stack_context.stack, candidate))
}

/**
 * Add the common SEND action to an inventory menu without disturbing that surface's existing actions. SEND is
 * projected immediately before Explorer so the on-chain navigation escape hatch remains the final row.
 */
export function project_inventory_context_actions(
  existing_actions: readonly inventory_context_action[],
  stack_context?: inventory_stack_context
): inventory_context_action[] {
  const unique_actions = [
    ...new Set(
      existing_actions.filter(
        (action) => action !== 'send' && is_stack_action_visible(action, stack_context)
      )
    ),
  ]
  const explorer_index = unique_actions.indexOf('explorer')
  if (explorer_index < 0) return [...unique_actions, 'send']
  return [...unique_actions.slice(0, explorer_index), 'send', ...unique_actions.slice(explorer_index)]
}
