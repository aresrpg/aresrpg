// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE mount prompt state. PromptStack owns desktop world keys; this module tells the player seam whether X
// mounts a resolved ride, dismounts the current ride, or must not be offered. Keeping that decision here makes
// one physical key press one toggle and keeps the rendered action honest through mount → ride → dismount.

export const MOUNT_PROMPT = Object.freeze({ id: 'mount', key: 'X', priority: 50 })

/**
 * @param {{
 *   riding: boolean,
 *   in_fight: boolean,
 *   blocked?: boolean,
 *   target: { available?: boolean, glb_url?: string | null, source?: 'dev'|'equip'|'pet'|null } | null,
 * }} state
 * @returns {'mount_pet'|'mount'|'dismount'|null}
 */
export function mount_prompt_kind({ riding, in_fight, blocked = false, target }) {
  if (in_fight || blocked) return null
  if (riding) return 'dismount'
  if (!target?.available || !target.glb_url) return null
  return target.source === 'pet' ? 'mount_pet' : 'mount'
}

/** The translated action label for each prompt state. @param {'mount_pet'|'mount'|'dismount'} kind */
export function mount_prompt_label_key(kind) {
  if (kind === 'mount_pet') return 'world.mount_hint'
  return kind === 'dismount' ? 'touch.dismount' : 'touch.mount'
}
