// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// simulator/use_sim_fight.js — the page's fight SESSION: one shim per page visit, and the two verbs the
// START/STOP controls call (spec §4.7).
//
// THE ONE DOOR. Everything it touches already exists and is owned elsewhere: the fold is fight_start.js, the
// local chain + store seeding is fight_shim.js, and the phase is the page reducer's (`fight_started` /
// `fight_stopped`). This hook only ORDERS them — mint the fight id in the reducer, hand that id to the shim,
// and roll the phase back if the shim refuses. A refusal is surfaced as a reason string the page prints; a
// silent no-op on a pressed button is the failure this page shipped with.

import { useCallback, useMemo, useRef, useState } from 'react'

import { mob_corpus_of } from '../pages/encyclopedia/world_corpus'
import * as item_corpus from '../pages/encyclopedia/item_corpus'
import { report_chunk_load_failure } from '../core/stale_deploy_recovery'

import { board_of } from './board'
import { build_start_args } from './fight_start.js'
import { use_mob_index } from './MobPicker'
import { use_simulator } from './store'

/**
 * The shim is imported LAZILY, on the first START. It is the head of the whole fight chain — the local sim
 * chain, the fight core, the production dungeon store — none of which a setup session ever touches, and none
 * of which loads under a plain page render (the module tree reaches the wallet SDK, which needs a `window`).
 * One dynamic import keeps the page's own shell cheap and rendered.
 */
const load_shim = () => import('./fight_shim.js')

/**
 * A shim that will not load is a STALE PAGE, never a build without a local chain — the only way that import
 * fails in production is a deploy retiring the chunk hash this tab still points at, and the host answers the
 * retired path with the SPA shell, so the browser refuses it as a module. The page said "the local chain is
 * not available in this build", which blames the build the player cannot see for the state of the tab they
 * are holding; the truth is one reload away and the app already owns that reload
 * (`stale_deploy_recovery`). Report it there — Vite's preload helper cancels its own report the moment the
 * recovery listener handles it, so a caught rejection is otherwise lost — and name the reason honestly.
 * @returns {string} the blocked reason the page prints
 */
export const on_shim_load_failure = () => {
  report_chunk_load_failure()
  return 'stale_build'
}

/**
 * @returns {{ phase: string, can_start: boolean, blocked: string | null,
 *   start: () => Promise<void>, stop: () => void }}
 */
export function use_sim_fight() {
  const shim = useRef(/** @type {ReturnType<typeof create_fight_shim> | null} */ (null))
  const [blocked, set_blocked] = useState(/** @type {string | null} */ (null))
  const phase = use_simulator((state) => state.phase)
  const placements = use_simulator((state) => state.placements)
  const { by_id } = item_corpus.use_item_corpus()
  const mob_by_id = use_mob_index()

  /** THE ONE way a simulator fight session ends — the STOP control's, and (#1632) the shim's own terminal
   *  exit's. Stable identity, so the shim below can be handed it once at construction. */
  const stop = useCallback(() => {
    shim.current?.stop()
    shim.current?.dispose()
    use_simulator.getState().input({ type: 'fight_stopped' })
    set_blocked(null)
  }, [])

  const start = useCallback(async () => {
    const state = use_simulator.getState()
    const built = build_start_args({
      state,
      board: board_of(state.seed, state.anchor_nonce),
      item_by_id: by_id,
      mob_by_id,
      mob_spells_of: (id) => mob_corpus_of(id)?.spells ?? [],
    })
    if (!built.ok) return set_blocked(built.reason)
    // A chunk that will not load is a REASON, not a dead button (`simulator.fight_blocked_stale_build`).
    const loaded = await load_shim().catch(() => null)
    if (!loaded) return set_blocked(on_shim_load_failure())
    const { create_fight_shim } = loaded

    // The reducer mints the fight id (`sim:<seed>:<n>`, fresh on every START — spec §4.7), so the phase flips
    // FIRST and the shim is handed the id the page now holds. One home for the id, one for the phase.
    state.input({ type: 'fight_started' })
    const { fight } = use_simulator.getState()
    // `on_finish` is the fight-over door (#1632): the shim decides WHEN a decided fight collapses, this hook
    // owns WHERE it collapses to. Without it the terminal effect fired into a no-op and the board never left.
    shim.current = shim.current ?? create_fight_shim({ on_finish: stop })
    const opened = shim.current.start({ ...built.args, fight_id: fight.fight_id })
    if (!opened.ok) {
      state.input({ type: 'fight_stopped' })
      return set_blocked(opened.reason)
    }
    return set_blocked(null)
  }, [by_id, mob_by_id, stop])

  // ≥1 PLACED CHARACTER arms the control (#883 ⑤). The mob half is not a disabled button but a REASON: an
  // empty enemy band is a thing you fix in one click, and a dead grey button never says which click.
  const can_start = useMemo(() => Object.keys(placements).length > 0, [placements])

  return { phase, can_start, blocked, start, stop }
}
