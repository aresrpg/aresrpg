// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type ExpeditionInput =
  | Readonly<{ type: 'wallet_session/reset' }>
  | Readonly<{ type: 'character_load/started' }>
  | Readonly<{ type: 'character_load/failed' }>
  | Readonly<{
      type: 'character_load/settled'
      kiosk_id: string | null
      personal_kiosk_cap_id: string | null
      character: unknown
      no_character: boolean
      expedition_id: string | null
    }>
  | Readonly<{ type: 'character_mint/started' }>
  | Readonly<{ type: 'character_mint/finished' }>
  | Readonly<{
      type: 'character_mint/settled'
      character: unknown
      kiosk_id: string | null
      personal_kiosk_cap_id: string | null
    }>
  | Readonly<{ type: 'expedition/refreshed'; expedition: unknown }>

export type ResettableExpeditionState = Readonly<{
  loading: boolean
  no_character: boolean
  character: unknown
  kiosk_id: string | null
  personal_kiosk_cap_id: string | null
  busy: boolean
  expedition_id: string | null
  expedition: unknown
}>

export const EXPEDITION_INITIAL_STATE = {
  loading: false,
  no_character: false,
  character: null,
  kiosk_id: null,
  personal_kiosk_cap_id: null,
  busy: false,
  expedition_id: null,
  expedition: null,
} as const satisfies ResettableExpeditionState

export function reduce_expedition<State extends ResettableExpeditionState>(
  state: State,
  message: ExpeditionInput
): State | typeof EXPEDITION_INITIAL_STATE {
  switch (message.type) {
    case 'character_load/started':
      return state.loading ? state : { ...state, loading: true }
    case 'character_load/failed':
      return state.loading ? { ...state, loading: false } : state
    case 'character_load/settled':
      return {
        ...state,
        loading: false,
        kiosk_id: message.kiosk_id,
        personal_kiosk_cap_id: message.personal_kiosk_cap_id,
        character: message.character,
        no_character: message.no_character,
        expedition_id: message.expedition_id,
      }
    case 'character_mint/started':
      return state.busy ? state : { ...state, busy: true }
    case 'character_mint/finished':
      return state.busy ? { ...state, busy: false } : state
    case 'character_mint/settled':
      return {
        ...state,
        busy: false,
        character: message.character,
        kiosk_id: message.kiosk_id ?? state.kiosk_id,
        personal_kiosk_cap_id: message.personal_kiosk_cap_id ?? state.personal_kiosk_cap_id,
      }
    case 'expedition/refreshed':
      return state.expedition === message.expedition ? state : { ...state, expedition: message.expedition }
    case 'wallet_session/reset':
      if (
        !state.loading &&
        !state.no_character &&
        state.character === null &&
        state.kiosk_id === null &&
        state.personal_kiosk_cap_id === null &&
        !state.busy &&
        state.expedition_id === null &&
        state.expedition === null
      )
        return state
      return EXPEDITION_INITIAL_STATE
  }
}

/**
 * SWITCH-PARITY LEG ② — the create receipt's adoption effect (roster/store.ts's create_character, the FREE
 * first-character path). A just-minted character's receipt IS the intent to play it now (ONE-PIPELINE LAW:
 * derive from the input, never gate on ambient prior state) — so selection and the join gate BOTH target the
 * SAME id, unconditionally, and can never diverge. Before this fix, selection ran only
 * `if (!cur.selected_character_id)` while the join gate (begin_join) always fired for the new character — a
 * stale/prior selection silently outlived the receipt (DiscoveryPrompts kept polling the OLD character while
 * the join resolved the NEW one). Effects injected so this two-line invariant is behavior-tested directly.
 */
export function adopt_predicted_character(
  predicted_id: string,
  deps: { select_character: (id: string) => void; begin_join: (id: string) => void }
): void {
  deps.select_character(predicted_id)
  deps.begin_join(predicted_id)
}
