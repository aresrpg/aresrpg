// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type inventory_context_action = 'equip' | 'use' | 'feed' | 'open' | 'crush' | 'send' | 'explorer'

/**
 * Add the common SEND action to an inventory menu without disturbing that surface's existing actions. SEND is
 * projected immediately before Explorer so the on-chain navigation escape hatch remains the final row.
 */
export function project_inventory_context_actions(
  existing_actions: readonly inventory_context_action[]
): inventory_context_action[] {
  const unique_actions = [...new Set(existing_actions.filter((action) => action !== 'send'))]
  const explorer_index = unique_actions.indexOf('explorer')
  if (explorer_index < 0) return [...unique_actions, 'send']
  return [...unique_actions.slice(0, explorer_index), 'send', ...unique_actions.slice(explorer_index)]
}
