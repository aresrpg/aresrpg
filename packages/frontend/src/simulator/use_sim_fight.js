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
    // A chunk that will not load is a REASON, not a dead button (`simulator.fight_blocked_sim_chain_missing`).
    const loaded = await load_shim().catch(() => null)
    if (!loaded) return set_blocked('sim_chain_missing')
    const { create_fight_shim } = loaded

    // The reducer mints the fight id (`sim:<seed>:<n>`, fresh on every START — spec §4.7), so the phase flips
    // FIRST and the shim is handed the id the page now holds. One home for the id, one for the phase.
    state.input({ type: 'fight_started' })
    const { fight } = use_simulator.getState()
    shim.current = shim.current ?? create_fight_shim()
    const opened = shim.current.start({ ...built.args, fight_id: fight.fight_id })
    if (!opened.ok) {
      state.input({ type: 'fight_stopped' })
      return set_blocked(opened.reason)
    }
    return set_blocked(null)
  }, [by_id, mob_by_id])

  const stop = useCallback(() => {
    shim.current?.stop()
    shim.current?.dispose()
    use_simulator.getState().input({ type: 'fight_stopped' })
    set_blocked(null)
  }, [])

  // ≥1 PLACED CHARACTER arms the control (#883 ⑤). The mob half is not a disabled button but a REASON: an
  // empty enemy band is a thing you fix in one click, and a dead grey button never says which click.
  const can_start = useMemo(() => Object.keys(placements).length > 0, [placements])

  return { phase, can_start, blocked, start, stop }
}
