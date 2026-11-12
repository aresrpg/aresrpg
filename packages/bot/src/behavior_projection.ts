// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { BehaviorScript } from './behavior_script.ts'

const action_characters = (action: import('./behavior_script.ts').BehaviorAction): readonly string[] => {
  if ('character_id' in action) return [action.character_id]
  if (action.type === 'combat') return action.profiles.map(({ character_id }) => character_id)
  if (action.type !== 'call') return []
  return typeof action.payload.character_id === 'string' ? [action.payload.character_id] : []
}
/** Descriptive projection of the accepted tree, never another authority or progress store. */
export const behavior_character_ids = (script: BehaviorScript): readonly string[] => {
  const pending = [script.tree]
  const ids = new Set<string>()
  while (pending.length) {
    const node = pending.pop()!
    if ('children' in node) pending.push(...node.children)
    if ('child' in node) pending.push(node.child)
    if (node.type === 'condition' && 'fact' in node.condition) ids.add(node.condition.fact.character_id)
    if (node.type === 'action') action_characters(node.action).forEach((id) => ids.add(id))
  }
  return [...ids]
}
