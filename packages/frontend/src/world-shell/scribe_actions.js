// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SCRIBE actions (S-18 Runeforge → S-57 forgemagie re-point) — the tx seam over @aresrpg/sdk/game's
// `scribe_rune_ptb`, funneled through the ONE instrumented run_tx choke point (world-shell/tx.js) like every
// gameplay tx. The DEPLOYED door is `forgemagie::scribe_rune` (upgrade #2): apply exactly ONE rune to a
// kiosk-locked gear — 1 rune unit is consumed PRE-ROLL (identical every outcome) and the on-chain
// foundation `apply_rune` decides CS/NS/CF off a fresh `&Random` seed. GATED at job level ≥ 70 on-chain. The
// shell never predicts an outcome and never trusts a client-side formula. run_tx signs+executes and THROWS a
// humanized error on failure; the page toasts it — DO NOT toast in here.
//
// CEREMONY OBJECTS (S-57): the shared ItemExtractPolicy now resolves STATICALLY inside `scribe_rune_ptb`
// (S-51b — the old `item_extract_policy_id` arg is gone). The shared `forgemagie::CrushBoard` is a SEED
// object minted post-publish (packages/move/scripts/qa/board_bootstrap.mjs) — it now has an
// `@aresrpg/sdk/deployment/aresrpg` resolver (CRUSH_BOARD comes from release.json) — resolved below,
// never hardcoded here.

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import { scribe_rune_ptb } from '@aresrpg/sdk/game'

import { DEMO_NETWORK } from '../chain/deployment'

import { run_tx } from './tx.js'

const CTX = { network: DEMO_NETWORK }
// The shared forgemagie::CrushBoard — the scribe/crush doors' one runtime seed arg (lineage-4, stamped 2026-07-10).
const CRUSH_BOARD = aresrpg_id(DEMO_NETWORK, 'CRUSH_BOARD')

/**
 * SCRIBE one rune onto an equipped gear (signed by the caller; job-70 gated on-chain; outcome = the door's own
 * CS/NS/CF roll — random, never guaranteed). ONE rune per tx (the SDK composes sequences). Returns the run_tx
 * promise → `{ result, timing }`.
 * @param {{ kiosk_id:string, personal_kiosk_cap_id:string, character_id:string, gear_item_id:string,
 *           gear_template_id:string, rune_item_id:string, rune_template_id:string }} args
 */
export function scribe_rune({
  kiosk_id,
  personal_kiosk_cap_id,
  character_id,
  gear_item_id,
  gear_template_id,
  rune_item_id,
  rune_template_id,
}) {
  const tx = scribe_rune_ptb(CTX)({
    crush_board_id: CRUSH_BOARD,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    gear_item_id,
    gear_template_id,
    rune_item_id,
    rune_template_id,
  })
  return run_tx('scribe_rune', tx)
}
