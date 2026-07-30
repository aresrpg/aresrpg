// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD SWITCH action. Creation performs its first join atomically in the mint PTB (#1714); every later change
// is manual through the world switcher and self-pays through the normal transaction choke.
// Kiosk resolution: THE one derive-from-character home (kiosk_resolve.js) — never a first-cap pick.

import { join_world_ptb } from '@aresrpg/sdk/game'

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK, T62_WORLDS } from '../chain/deployment'
import i18n from '../i18n'
import { context } from '../game/core/game.js'

import { run_tx } from './tx.js'
import { character_join_handle, join_kiosk_for_character } from './kiosk_resolve.js'
import { publish_world_binding } from './session_gate.js'
import { seed_world_join_receipt } from './world_join_receipt.js'

/** Build the `zones::join_world` PTB for `character_id` with the create-effects-first kiosk pair. */
async function build_join(character_id, world_id) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not signed in')
  const sdk = await get_sdk()
  // Create-effects FIRST (a just-minted character's kiosk pair is known EXACTLY — zero reads, zero race), else the
  // derive-from-character resolver with a bounded READ-ONLY retry (never the join tx). See kiosk_resolve.js.
  const known_handle = character_join_handle(context.get_state().sui.characters, character_id)
  const handle = await join_kiosk_for_character(sdk, address, character_id, { known_handle })
  if (!handle) throw new Error(i18n.t('characters.delete.not_in_kiosk'))
  return join_world_ptb({ network: DEMO_NETWORK })({
    world_id,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
  })
}

/**
 * MANUAL world join — the switcher's tx (S-67 mounts the UI; this is the callable). Self-pay through the ONE
 * run_tx choke (simulate-first; an executed failure is the caller's to surface, never re-fired).
 * @param {{ character_id: string, world_id?: string, queued?: boolean }} args
 * @returns {Promise<{ result:any, timing:any }>}
 */
export async function join_world_action({ character_id, world_id = T62_WORLDS[0].id, queued = false }) {
  const tx = await build_join(character_id, world_id)
  const out = await run_tx('join_world', tx, undefined, undefined, { queued })
  // PIPELINE LAW fast path: the tx's OWN receipt already proves the position (first-join roll, or the
  // untouched rejoin checkpoint — zones.move emits WorldJoined either way) — seed it before publishing so a
  // travel/rejoin never races the separate chain-direct DF read (world_checkpoint.js).
  await seed_world_join_receipt(character_id, world_id, out.result)
  // The bind is chain-truth NOW — publish it so the session gate swaps spectate → resident without waiting
  // on the next doc poll (session_gate.js is the one binding home; the indexer catches up behind it). Source
  // 'manual' arms the stale-poll guard: a doc poll returning the pre-travel world during indexer catch-up gets
  // discarded instead of clobbering this write (session_gate.js's _pending_manual_target).
  publish_world_binding(character_id, world_id, 'manual')
  return out
}
