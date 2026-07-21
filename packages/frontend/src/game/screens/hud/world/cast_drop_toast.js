// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { CAST_DROP_TARGET_OUT_OF_REACH } from '@aresrpg/fight/turn_commit'

/**
 * Surface one aggregate cancellation toast from genuine cast-drop records produced by the controlled player's
 * successful commit. Validation results, canonical ingress, prediction retirement, foreign fighters, and mob
 * simulation records are deliberately inert.
 * @param {{
 *   commit_succeeded:boolean,
 *   drops:Array<{kind?:string,source?:string,actor_id?:string,spell_name?:string,reason?:string}>,
 *   local_actor_id:string,
 *   t:(key:string, values?:object)=>string,
 *   emit:(toast:{state:string,title:string})=>void,
 * }} params
 * @returns {0|1} number of emitted toasts
 */
export function emit_local_cast_drop_toast({ commit_succeeded, drops, local_actor_id, t, emit }) {
  if (!commit_succeeded || !local_actor_id) return 0
  const spell_names = (drops ?? [])
    .filter(
      (drop) =>
        drop?.kind === 'cast_drop' &&
        drop.source === 'local_commit' &&
        drop.actor_id === local_actor_id &&
        drop.reason === CAST_DROP_TARGET_OUT_OF_REACH &&
        typeof drop.spell_name === 'string' &&
        drop.spell_name.trim().length > 0
    )
    .map((drop) => drop.spell_name.trim())
  if (spell_names.length === 0) return 0
  emit({
    state: 'info',
    title: t('dungeons.cast_target_unreachable', { spell: spell_names.join(', ') }),
  })
  return 1
}
