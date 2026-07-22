// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Read-only projection of the dungeon run's session identity. dungeon_run_store remains the one authority;
// this leaf lets roster enrichment and party presence observe the four identity fields they need without
// importing the 1,500-line run/settlement composition graph back into themselves.

import { createStore } from 'zustand/vanilla'

const dungeon_session_store = createStore(() => ({
  in_session: false,
  character_id: null,
  session_address: null,
  dungeon_id: null,
}))

/** @returns {{ in_session:boolean, character_id:string|null, session_address:string|null, dungeon_id:string|null }} */
export const read_dungeon_session = () => dungeon_session_store.getState()

/** @param {(state:ReturnType<typeof read_dungeon_session>)=>void} listener */
export const subscribe_dungeon_session = (listener) => dungeon_session_store.subscribe(listener)

/**
 * Project one authoritative dungeon-run state into the dependency-light identity leaf.
 * @param {{ in_session?:boolean, character_id?:string|null, session_address?:string|null, dungeon_id?:string|null }} state
 */
export function publish_dungeon_session(state) {
  const current = dungeon_session_store.getState()
  const next = {
    in_session: state.in_session === true,
    character_id: state.character_id ?? null,
    session_address: state.session_address ?? null,
    dungeon_id: state.dungeon_id ?? null,
  }
  if (
    current.in_session === next.in_session &&
    current.character_id === next.character_id &&
    current.session_address === next.session_address &&
    current.dungeon_id === next.dungeon_id
  )
    return
  dungeon_session_store.setState(next, true)
}
