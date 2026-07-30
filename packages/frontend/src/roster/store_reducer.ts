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
 * Adopt a settled first-character receipt as the active identity. World membership is already part of that
 * receipt's creation PTB (#1714), so this effect deliberately owns selection only.
 */
export function adopt_predicted_character(
  predicted_id: string,
  deps: { select_character: (id: string) => void }
): void {
  deps.select_character(predicted_id)
}

/** A wallet's paid mint is also its onboarding mint only when no settled roster row or active identity preceded
 * the receipt. Ignore the creator's click-instant `ghost:*` row. Keep this decision on the pre-receipt state:
 * the receipt reducer itself inserts the real row, so reading afterward would misclassify every first paid mint
 * as an additional character. */
export function should_adopt_paid_mint(
  prior: Readonly<{
    characters: ReadonlyArray<Readonly<{ id?: unknown; ghost?: boolean }> | null | undefined>
    selected_character_id: string | null
  }>
): boolean {
  const has_settled_character = prior.characters.some(
    (character) => !!character?.id && character.ghost !== true && !String(character.id).startsWith('ghost:')
  )
  return !has_settled_character && prior.selected_character_id === null
}

/** Paid first-mint adoption shares the free path's selection rule. Additional paid mints are roster deltas
 * only and must leave the active character untouched. Returns whether the receipt became active. */
export function adopt_paid_mint_if_first(
  predicted_id: string,
  prior: Readonly<{
    characters: ReadonlyArray<Readonly<{ id?: unknown; ghost?: boolean }> | null | undefined>
    selected_character_id: string | null
  }>,
  deps: { select_character: (id: string) => void }
): boolean {
  if (!should_adopt_paid_mint(prior)) return false
  adopt_predicted_character(predicted_id, deps)
  return true
}
