// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KOLIZEUM lobby actions (S-18 War Table) — the tx seam over @aresrpg/sdk/kolizeum's lobby builders, funneled
// through the ONE instrumented run_tx choke point (world-shell/tx.js) like every gameplay tx. The builders
// target the MERGED `aresrpg` package via the SDK's stamp-or-throw deployment home: until the publish
// ceremony stamps the ids these REFUSE LOUDLY (honest toast + raw console error), and the same code goes
// live at stamp time with zero frontend changes. Money law: the pledge is an EXACT split checked on-chain
// (`pledge.value() == pledge_amount` or abort) — no client-side rounding can overpay.

import { create_public_ptb, join_ptb, exit_ptb, cancel_ptb } from '@aresrpg/sdk/kolizeum'

import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'

import { run_tx } from './tx.js'

// The builder context: network + the memoized SDK's kiosk client. create/join run the personal-cap borrow-val
// dance (with_borrowed_character → borrow_personal_kiosk_cap), which reads `context.kiosk_client` — WITHOUT it the
// borrow dance hard-crashed the UI thread (P0: `read_client.client` on undefined). Mirrors dungeon_actions.js
// `ctx_of` exactly; ONE context home for the whole file (exit/cancel don't borrow but share it for consistency).
const ctx_of = (/** @type {any} */ sdk) => ({ network: DEMO_NETWORK, kiosk_client: sdk.kiosk_client })

/**
 * CREATE a public lobby — the creator pledges + seats side A in the same tx.
 * @param {{ format_slots:number, pledge_mist:bigint|string, max_level_diff:number,
 *           character_id:string, kiosk_id:string, personal_kiosk_cap_id:string }} args
 */
export async function create_lobby({
  format_slots,
  pledge_mist,
  max_level_diff,
  character_id,
  kiosk_id,
  personal_kiosk_cap_id,
}) {
  const sdk = await get_sdk()
  const tx = create_public_ptb(ctx_of(sdk))({
    format_slots,
    pledge_amount: pledge_mist,
    max_level_diff,
    character_id,
    kiosk_id,
    personal_kiosk_cap_id,
  })
  return run_tx('kolizeum_create', tx)
}

/**
 * JOIN an open lobby with an exact pledge.
 * @param {{ kolizeum_id:string, pledge_mist:bigint|string, character_id:string, kiosk_id:string,
 *           personal_kiosk_cap_id:string }} args
 */
export async function join_lobby({ kolizeum_id, pledge_mist, character_id, kiosk_id, personal_kiosk_cap_id }) {
  const sdk = await get_sdk()
  const tx = join_ptb(ctx_of(sdk))({
    kolizeum_id,
    pledge_amount: pledge_mist,
    character_id,
    kiosk_id,
    personal_kiosk_cap_id,
  })
  return run_tx('kolizeum_join', tx)
}

/** EXIT before start — full pledge refund (the chain refuses if not a member / already started). */
export async function exit_lobby(kolizeum_id) {
  const sdk = await get_sdk()
  return run_tx('kolizeum_exit', exit_ptb(ctx_of(sdk))({ kolizeum_id }))
}

/** CANCEL an own open lobby — refunds every pledge (creator only, chain-enforced). */
export async function cancel_lobby(kolizeum_id) {
  const sdk = await get_sdk()
  return run_tx('kolizeum_cancel', cancel_ptb(ctx_of(sdk))({ kolizeum_id }))
}
