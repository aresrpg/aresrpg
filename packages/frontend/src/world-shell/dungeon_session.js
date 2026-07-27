// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Read-only projection of the dungeon run's session identity. dungeon_run_store remains the one authority;
// this leaf lets persistence, roster enrichment, and party presence observe the six phase/identity fields
// they need without importing the 1,500-line run/settlement composition graph back into themselves.

import { createStore } from 'zustand/vanilla'

const dungeon_session_store = createStore((set, get) => ({
  in_session: false,
  character_id: null,
  session_address: null,
  dungeon_id: null,
  run_pass_id: null,
  fight_id: null,
  // L-P4 — the store's OWN action door: the write lives here, inside the creator, never in a bare helper an
  // async `.subscribe()` callback calls directly (the v1.12.28 crash class, cross-function form). A no-op
  // publish is dropped before it wakes any subscriber.
  publish(state) {
    const current = get()
    const next = {
      in_session: state.in_session === true,
      character_id: state.character_id ?? null,
      session_address: state.session_address ?? null,
      dungeon_id: state.dungeon_id ?? null,
      run_pass_id: state.run_pass_id ?? null,
      fight_id: state.fight_id ?? null,
    }
    if (
      current.in_session === next.in_session &&
      current.character_id === next.character_id &&
      current.session_address === next.session_address &&
      current.dungeon_id === next.dungeon_id &&
      current.run_pass_id === next.run_pass_id &&
      current.fight_id === next.fight_id
    )
      return
    set(next)
  },
}))

/** @returns {{ in_session:boolean, character_id:string|null, session_address:string|null, dungeon_id:string|null,
 *   run_pass_id:string|null, fight_id:string|null }} */
export const read_dungeon_session = () => dungeon_session_store.getState()

/** @param {(state:ReturnType<typeof read_dungeon_session>)=>void} listener */
export const subscribe_dungeon_session = (listener) => dungeon_session_store.subscribe(listener)

/**
 * Project one authoritative dungeon-run state into the dependency-light identity leaf. A thin call into the
 * store's own action door — never a direct write — so an async subscriber driving this stays L-P4-clean.
 * @param {{ in_session?:boolean, character_id?:string|null, session_address?:string|null, dungeon_id?:string|null,
 *   run_pass_id?:string|null, fight_id?:string|null }} state
 */
export function publish_dungeon_session(state) {
  dungeon_session_store.getState().publish(state)
}
