// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { BehaviorAction, BehaviorScript } from './behavior_script.ts'

const action_characters = (action: BehaviorAction): readonly string[] => {
  if ('character_id' in action) return [action.character_id]
  if (action.type === 'combat') return action.profiles.map(({ character_id }) => character_id)
  if (action.type !== 'call') return []
  return typeof action.payload.character_id === 'string' ? [action.payload.character_id] : []
}
const nodes = (script: BehaviorScript) => {
  const pending = [script.tree]
  const visited: BehaviorScript['tree'][] = []
  while (pending.length) {
    const node = pending.pop()!
    visited.push(node)
    if ('children' in node) pending.push(...node.children)
    if ('child' in node) pending.push(node.child)
  }
  return visited
}
const acting_ids = (script: BehaviorScript) =>
  nodes(script).flatMap((node) => (node.type === 'action' ? action_characters(node.action) : []))
/** A tree acts for exactly one hero, the key of its run. Conditions may still read teammates. */
export const behavior_actor = (script: BehaviorScript): string => {
  const ids = new Set(acting_ids(script))
  if (ids.size !== 1) throw new Error('behavior_needs_one_character')
  return [...ids][0]!
}
