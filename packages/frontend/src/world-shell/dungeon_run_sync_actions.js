// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dungeon run CHAIN SYNC effects. This is one action fragment of dungeon_run_store's single Zustand domain:
// it reads run/fight truth, feeds the fight reducer, and owns polling, but creates no store.

import { decode_fight } from '@aresrpg/sdk/fight'
import { get_mob_template } from '@aresrpg/sdk/game'
import { fight_store } from '@aresrpg/fight/store'
import * as project from '@aresrpg/fight/project'
import { u64 } from '@aresrpg/fight/journal_u64'
import {
  STATUS_OPEN,
  STATUS_ACTIVE,
  STATUS_ROOM_CLEARED,
  STATUS_WON,
  STATUS_FAILED,
  fight_geometry_complete,
} from '@aresrpg/fight/board_state'
import { GRID_W } from '@aresrpg/fight/los'

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { paginate_fight_journal } from '../rpc/fight_journal.js'
import { display_mob_name } from '../content/mob_name_overrides'
import { note_victory } from '../fight-engine/fight_end_machine.js'
import { humanize_abort } from '../game/core/abort_copy.js'
import { mark_active_seat } from '../fight-engine/phase.js'
import { game_log } from '../core/log.js'

import { read_object, decode_pass, is_gone_error } from './run_reads.js'
import { recover_character } from './dungeon_settlement.js'
import { maybe_liquidate } from './fight-liquidation.js'
import { should_hold_receipt_fight } from './world_fight_receipt.js'
import { fight_state_trace } from './fight_state_trace.js'
import {
  init_dungeon_fight,
  sync_dungeon_fight,
  resolve_world_offset,
  hold_until_presented,
  route_settlement,
} from './dungeon_fight_shim.js'
import {
  cleared_dungeon_session,
  owned_settlement_callback,
  teardown_dungeon_fight,
} from './dungeon_run_fight_actions.js'

const POLL_MS = 4000

/** @type {Map<string, { name: string, min_level: number, element: number } | null>} */
const _mob_tmpl_cache = new Map()
/** @type {Set<string>} */
const _mob_tmpl_pending = new Set()

/**
 * Walk one M2b journal gap only while the character request and fight session that requested it still own the
 * adapter. The core's journal input is intentionally one-ingress data, but unlike snapshot it is not independently
 * session-gated; this edge therefore checks currency after the awaited walk and before every accepted batch.
 * @param {{ fight_id:string, from:string|number, is_current?:()=>boolean, current_fight_id:()=>string|null,
 *   paginate?:typeof paginate_fight_journal, input?:(message:any)=>void }} options
 * @returns {Promise<'applied'|'unavailable'|'stale'>}
 */
export async function walk_current_fight_journal({
  fight_id,
  from,
  is_current = () => true,
  current_fight_id,
  paginate = paginate_fight_journal,
  input = (message) => fight_store.getState().input(message),
}) {
  const owns_fight = () => is_current() && String(current_fight_id() ?? '') === String(fight_id)
  const walked = await paginate(fight_id, { from }).catch(() => null)
  if (!owns_fight()) return 'stale'
  if (!walked?.ok) return 'unavailable'
  for (const batch of walked.batches) {
    if (!owns_fight()) return 'stale'
    input({ type: 'journal', fight_id, batch })
  }
  return 'applied'
}

export const create_dungeon_sync_actions = ({ set, get, get_store }) => ({
  _collapse_terminal_ghost(fight_id = get().fight_id) {
    if (!fight_id || get().fight_id !== fight_id) return
    if (get().spectating) {
      get()._stop_polling()
      hold_until_presented(() => {
        const state = get()
        if (state.spectating && state.fight_id === fight_id) state.reset_local()
      })
      return
    }
    if (get()._claiming || get()._settling || get().phase === 'done') {
      set({ fight_id: null })
      return
    }
    game_log('dungeon', 'live Fight GONE — terminal resolution settled elsewhere; collapsing the ghost board')
    const { character_id } = get()
    set({ fight_id: null, _claiming: true })
    get()._stop_polling()
    hold_until_presented(() => {
      if (get().phase === 'done') return
      teardown_dungeon_fight()
      set(cleared_dungeon_session('done'))
      if (character_id) void recover_character(get_store(), character_id).catch(() => 'failed')
    })
  },

  _resolve_mob_identities(sdk, fight, { is_current = () => true } = {}) {
    const id = fight?.group_template
    if (!id || !fight?.mobs?.length) return
    const known = get().mob_names
    if (id in known || _mob_tmpl_cache.has(id) || _mob_tmpl_pending.has(id)) return
    _mob_tmpl_pending.add(id)
    return get_mob_template({ grpc_client: sdk.grpc_client })(id)
      .then((tpl) =>
        _mob_tmpl_cache.set(
          id,
          tpl ? { name: tpl.name || 'Mob', min_level: tpl.min_level || 1, element: tpl.element ?? 255 } : null
        )
      )
      .catch(() => _mob_tmpl_cache.set(id, null))
      .finally(() => {
        _mob_tmpl_pending.delete(id)
        if (!is_current()) return
        const resolved = _mob_tmpl_cache.get(id)
        if (resolved) {
          set({
            mob_names: { ...get().mob_names, [id]: display_mob_name(resolved.name) },
            mob_levels: { ...get().mob_levels, [id]: resolved.min_level },
            mob_elements: { ...get().mob_elements, [id]: resolved.element },
          })
          fight_store.getState().input({
            type: 'ctx',
            ctx: { mob_names: get().mob_names, mob_levels: get().mob_levels, mob_elements: get().mob_elements },
          })
        }
      })
  },

  note_group_identity(template_id, name, level, element) {
    if (!template_id || !name || template_id in get().mob_names) return
    set({
      mob_names: { ...get().mob_names, [template_id]: display_mob_name(name) },
      mob_levels: { ...get().mob_levels, [template_id]: Number(level) || 1 },
      mob_elements: { ...get().mob_elements, [template_id]: Number(element ?? 255) },
    })
    fight_store.getState().input({
      type: 'ctx',
      ctx: { mob_names: get().mob_names, mob_levels: get().mob_levels, mob_elements: get().mob_elements },
    })
  },

  async refresh({ is_current = () => true } = {}) {
    if (!is_current()) return
    const { fight_id, run_pass_id } = get()
    if (!fight_id && !run_pass_id) return
    try {
      const sdk = await get_sdk()
      if (!is_current()) return
      const me = use_auth.getState().address
      let { run } = get()
      if (run_pass_id) {
        try {
          run = decode_pass(await read_object(sdk, run_pass_id))
        } catch (error) {
          if (!is_current()) return
          if (!is_gone_error(error)) throw error
          run = null
        }
        if (!is_current()) return
        if (!run) {
          if (!get().fight_id && !get()._settling) {
            get()._stop_polling()
            set({ run: null, phase: 'done' })
            return
          }
        } else {
          set({ run })
          if (!get().fight_id && run.fight && !get()._claiming && !get()._settling) {
            set({
              fight_id: run.fight,
              fight_fresh: false,
              fight_started_at_ms: Date.now(),
              fight_start_partial: true,
            })
            init_dungeon_fight({
              fight_id: run.fight,
              character_id: get().character_id,
              address: me,
              run,
              rooms_total: get().rooms.length,
              mob_names: get().mob_names,
              mob_levels: get().mob_levels,
              mob_elements: get().mob_elements,
            })
          }
        }
      }
      const live_fight_id = get().fight_id
      if (live_fight_id) {
        let read = null
        let definitively_gone = false
        try {
          read = await read_object(sdk, live_fight_id)
        } catch (error) {
          if (!is_current()) return
          if (!is_gone_error(error)) throw error
          definitively_gone = true
        }
        if (!is_current()) return
        if (!read) {
          const receipt_owned = should_hold_receipt_fight(get(), live_fight_id)
          const fresh_receipt = receipt_owned && get().fight_fresh
          const retry_receipt_read = receipt_owned && (!definitively_gone || fresh_receipt)
          fight_state_trace('fight_adoption_exact_read_missing', {
            fight_id: live_fight_id,
            definitively_gone,
            receipt_owned,
            fresh_receipt,
            decision: retry_receipt_read ? 'retry' : 'drop',
          })
          if (retry_receipt_read) return
          get()._collapse_terminal_ghost(live_fight_id)
          return
        }
        if (get().fight_id !== live_fight_id) return
        const fight = decode_fight(read.json)
        if (!fight_geometry_complete(fight)) {
          fight_state_trace('fight_adoption_degraded_read_held', {
            fight_id: live_fight_id,
            version: Number(read.version) || 0,
            width: fight?.width ?? null,
            height: fight?.height ?? null,
          })
          return
        }
        await get()._resolve_mob_identities(sdk, fight, { is_current })
        if (!is_current() || get().fight_id !== live_fight_id) return
        const offset = await resolve_world_offset(sdk, get().world_id ?? fight.world)
        if (!is_current() || get().fight_id !== live_fight_id) return
        sync_dungeon_fight({
          read,
          run,
          rooms_total: get().rooms.length,
          ctx: {
            address: get().spectating ? null : me,
            creator: get().spectating ? null : me,
            my_entity_id: get().spectating ? null : get().character_id,
            spectator: get().spectating,
            run,
            rooms_total: get().rooms.length,
            mob_names: get().mob_names,
            mob_levels: get().mob_levels,
            mob_elements: get().mob_elements,
            offset,
            beat_ctx: { grid_width: GRID_W },
          },
        })
        const { accept_state, journal_gap } = fight_store.getState()
        const accepted = u64(accept_state?.head)
        const frontier = accepted == null ? 0n : accepted + 1n
        const gap_from =
          journal_gap && String(journal_gap.fight_id ?? live_fight_id) === String(live_fight_id)
            ? u64(journal_gap.from)
            : null
        const from = gap_from != null && gap_from < frontier ? gap_from : frontier
        const result = await walk_current_fight_journal({
          fight_id: live_fight_id,
          from: from.toString(),
          is_current,
          current_fight_id: () => get().fight_id,
        })
        if (result === 'stale') return
      } else if (run) {
        const offset = await resolve_world_offset(sdk, get().world_id ?? run.world)
        if (!is_current()) return
        sync_dungeon_fight({
          read: null,
          run,
          rooms_total: get().rooms.length,
          open_version: Number(run.version) || 0,
          ctx: {
            address: get().spectating ? null : me,
            creator: get().spectating ? null : me,
            my_entity_id: get().spectating ? null : get().character_id,
            spectator: get().spectating,
            run,
            rooms_total: get().rooms.length,
            mob_names: get().mob_names,
            mob_levels: get().mob_levels,
            mob_elements: get().mob_elements,
            offset,
            beat_ctx: { grid_width: GRID_W },
          },
        })
      }
      if (!is_current()) return
      const view = project.board_view(fight_store.getState())
      if (!view) return
      if (live_fight_id && get().fight_id !== live_fight_id) return
      set({ error: null, fight_syncing: false })
      const { spectating } = get()
      if (view.status === STATUS_ACTIVE && !spectating) {
        mark_active_seat(view.id)
      }
      if (view.status === STATUS_OPEN) {
        const { phase } = get()
        if (phase === 'waiting_for_party' || phase === 'entering') return
        set({ phase: 'waiting_for_party' })
        return
      }
      if (get().phase === 'waiting_for_party') set({ phase: 'playing' })
      if (view.chain_terminal === STATUS_ROOM_CLEARED) {
        if (spectating) {
          get().reset_local()
          return
        }
        note_victory(view.id, view.room_index, 'non_terminal')
        teardown_dungeon_fight()
        void route_settlement(
          get_store(),
          STATUS_ROOM_CLEARED,
          {},
          {
            on_settled: owned_settlement_callback(get_store, {
              world_id: get().world_id,
              leader_character_id: get().character_id,
              run_pass_ids_by_character: { ...get().owned_run_pass_ids },
            }),
          }
        )
        return
      }
      if (view.status === STATUS_WON || view.status === STATUS_FAILED) {
        if (spectating) {
          const terminal_fight_id = live_fight_id
          get()._stop_polling()
          hold_until_presented(() => {
            const state = get()
            if (state.spectating && state.fight_id === terminal_fight_id) state.reset_local()
          })
        }
        return
      }
      if (!spectating) maybe_liquidate(view, get)
    } catch (error) {
      if (!is_current()) return
      if (is_gone_error(error)) return get()._recover_stale_membership({})
      game_log('dungeon', 'refresh failed', error)
      set({ error: humanize_abort(error?.message ?? String(error)) })
    }
  },

  _start_polling() {
    get()._stop_polling()
    const timer = setInterval(() => get().refresh(), POLL_MS)
    set({ _poll_timer: timer })
  },

  _stop_polling() {
    const timer = get()._poll_timer
    if (timer) clearInterval(timer)
    set({ _poll_timer: null })
  },

  dismiss_recap() {
    if (get().room_recap) set({ room_recap: null })
  },
})
