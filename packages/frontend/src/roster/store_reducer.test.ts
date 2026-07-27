// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SWITCH-PARITY LEG ② — proves adopt_predicted_character (the create-receipt adoption effect
// roster/store.ts's create_character calls) targets selection AND the join gate with the SAME id,
// unconditionally, using the REAL stores (context, session_gate.js) so "the gate agrees" is an actual
// cross-store assertion, not a tautology about the function's own two-line body.
//
// Before this leg: roster/store.ts guarded selection on `if (!cur.selected_character_id)` while begin_join
// always fired for the new character — a character created while some OTHER id was already selected (e.g. a
// stale cross-session selection surviving into a fresh first-mint) left selected_character_id on the stale
// id while the join gate moved to the new character (DiscoveryPrompts then polls the OLD char). RED evidence
// for that exact divergence was captured against a verbatim pre-fix reconstruction and is not re-shipped
// here — this suite exercises only the real, current adopt_predicted_character.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const { context } = await import('../game/core/game.js')
const { begin_join, use_world_binding, reset_world_binding } = await import('../world-shell/session_gate.js')
const { adopt_paid_mint_if_first, adopt_predicted_character } = await import('./store_reducer')

const STALE_CHAR = `0x${'a'.repeat(64)}`
const NEW_CHAR = `0x${'b'.repeat(64)}`

let prior_selected_character_id: string | null = null

async function wait_for_selected_character(expected_id: string | null, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    if (context.get_state().selected_character_id === expected_id) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`selection store did not settle on ${expected_id ?? 'null'}`)
}

async function select_in_real_store(character_id: string | null) {
  context.dispatch('action/select_character', character_id)
  await wait_for_selected_character(character_id)
}

beforeEach(() => {
  prior_selected_character_id = context.get_state().selected_character_id
  reset_world_binding()
})

afterEach(async () => {
  await select_in_real_store(prior_selected_character_id)
  reset_world_binding()
})

describe('adopt_predicted_character — selection and the join gate can never diverge', () => {
  test('a STALE prior selection no longer survives the receipt (red before LEG ②: it did)', async () => {
    await select_in_real_store(STALE_CHAR) // simulates whatever was selected before this create landed

    adopt_predicted_character(NEW_CHAR, {
      select_character: (id) => context.dispatch('action/select_character', id),
      begin_join,
    })
    await wait_for_selected_character(NEW_CHAR)

    expect(context.get_state().selected_character_id).toBe(NEW_CHAR)
    expect(use_world_binding.getState().character_id).toBe(NEW_CHAR)
    expect(context.get_state().selected_character_id).toBe(use_world_binding.getState().character_id)
  })

  test('the ordinary empty-selection first-mint path is unaffected (was already correct)', async () => {
    await select_in_real_store(null)

    adopt_predicted_character(NEW_CHAR, {
      select_character: (id) => context.dispatch('action/select_character', id),
      begin_join,
    })
    await wait_for_selected_character(NEW_CHAR)

    expect(context.get_state().selected_character_id).toBe(NEW_CHAR)
    expect(use_world_binding.getState().character_id).toBe(NEW_CHAR)
  })
})

describe('adopt_paid_mint_if_first — paid onboarding without active-character theft', () => {
  test('a wallet first mint selects and joins its receipt-projected character immediately', async () => {
    await select_in_real_store(null)

    adopt_paid_mint_if_first(
      NEW_CHAR,
      {
        characters: [{ id: 'ghost:ReceiptHero', ghost: true }],
        selected_character_id: null,
      },
      {
        select_character: (id) => context.dispatch('action/select_character', id),
        begin_join,
      }
    )
    await wait_for_selected_character(NEW_CHAR)

    expect(context.get_state().selected_character_id).toBe(NEW_CHAR)
    expect(use_world_binding.getState().character_id).toBe(NEW_CHAR)
  })

  test('an additional paid mint preserves the active character and its join gate', async () => {
    await select_in_real_store(STALE_CHAR)
    begin_join(STALE_CHAR)

    adopt_paid_mint_if_first(
      NEW_CHAR,
      {
        characters: [{ id: STALE_CHAR }, { id: 'ghost:ReceiptHero', ghost: true }],
        selected_character_id: STALE_CHAR,
      },
      {
        select_character: (id) => context.dispatch('action/select_character', id),
        begin_join,
      }
    )

    expect(context.get_state().selected_character_id).toBe(STALE_CHAR)
    expect(use_world_binding.getState().character_id).toBe(STALE_CHAR)
  })
})
