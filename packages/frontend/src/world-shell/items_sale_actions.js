// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ITEMS MINT-ON-SALE buy ORCHESTRATOR — REAL on-chain purchase against `aresrpg_items::shop::buy`/`buy_many`
// via the SDK builders (the &Clock + &Random terminal ABI). Supersedes the retired world-shell/m1_buy_ptb.js
// (which lacked the &Clock arg). The id home is the SDK's deployment/items.js (SINGLE home): the SDK builders
// resolve it internally, so the frontend no longer reads the stale ITEMS_V2_DEPLOYMENT for a buy.
//
// KIOSK ONBOARD + RESUME: `buy` is a terminal `&Random` command, so a kiosk-less buyer creates + SHARES a
// personal kiosk in a PRIOR tx (`onboard_kiosk_ptb`). RESUME / abandon-between: every buy first re-scans the
// CURRENT wallet's personal kiosks; if one already exists (a prior half-finished onboarding, or an existing
// player) we skip the create leg and go straight to buy — the two-tx flow runs the create ONCE, ever.
//
// GAS (un-simulatable): `buy` consumes `&Random`, so it CANNOT be dry-run — the SDK pins the budget from a
// MEASURED per-item constant × 1.5 (× quantity), refusing loudly until it is stamped at the publish rehearsal.
// A pre-measurement testnet build MAY set VITE_UNSAFE_DEV_GAS (per-item MIST) to override — surfaced honestly,
// never a silent default. SELF-PAY ONLY: buy_ptb splits the item PRICE off tx.gas, so the buyer's own coin funds
// it (a sponsored gas coin would pay the item price → a sponsor drain).
//
// TX-RETRY LAW (money safety): an EXECUTED buy that FAILED (a digest exists) is NEVER auto-retried.

import { items_deployment_ready } from '@aresrpg/sdk/deployment/items'

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'
import { tx_error } from '../game/core/abort_copy.js'
import { context } from '../game/core/game.js'
import i18n from '../i18n'
import { UNSAFE_DEV_GAS_MIST } from '../env'

import { run_tx, run_tx_random } from './tx'
// Kiosk-resolve law (mirror of the settlement bug): a purchase locks into the ACTIVE character's kiosk — the SAME
// kiosk equip/dungeon-burn resolve — so the bought item is reachable by those flows; falls back (logged) only
// when there is no active character. any_personal_kiosk stays legal here purely as that fallback.
import { buy_destination_kiosk } from './kiosk_resolve.js'

// Mirrors `aresrpg_items::shop` MAX_BUY_QUANTITY (the on-chain gas backstop). This only caps the client picker;
// the SDK's `buy_many_ptb` re-clamps as the real enforcer (it throws out of range), so a drift can only be safe.
const MAX_BUY_QUANTITY = 100

// Parse the onboarding tx's created objects → { kiosk_id, personal_kiosk_cap_id } for the follow-up buy.
function created_kiosk_handle(/** @type {any} */ result) {
  const created = (result?.objectChanges ?? []).filter((/** @type {any} */ c) => c?.type === 'created')
  const kiosk = created.find((/** @type {any} */ c) => String(c?.objectType ?? '').endsWith('::kiosk::Kiosk'))
  const pkcap = created.find((/** @type {any} */ c) =>
    String(c?.objectType ?? '').endsWith('::personal_kiosk::PersonalKioskCap')
  )
  if (!kiosk?.objectId || !pkcap?.objectId)
    throw new Error('Kiosk onboarding did not create a personal kiosk + cap — cannot proceed to buy')
  return { kiosk_id: String(kiosk.objectId), personal_kiosk_cap_id: String(pkcap.objectId) }
}

// UNSAFE testnet override → a TOTAL gas budget mirroring the SDK's per-item × 1.5 × quantity formula. Undefined
// when unset, so the SDK falls through to its measured constant (and refuses loudly if that too is unmeasured).
function gas_override_mist(/** @type {number} */ quantity) {
  return UNSAFE_DEV_GAS_MIST == null ? undefined : Math.ceil(UNSAFE_DEV_GAS_MIST * 1.5) * quantity
}

/**
 * Buy `quantity` items from an aresrpg_items mint-on-sale. Detects the buyer's personal kiosk; if none, ONBOARDS
 * first (a one-time create + share, a normal simulatable tx through run_tx's gas guard), then fires the TERMINAL
 * single-step buy (`buy_ptb` for one, `buy_many_ptb` for a pack). The buy is submitted WITHOUT preflight (the
 * un-simulatable &Random tx carries the SDK-pinned budget). Never auto-retries an executed failure (TX-RETRY law).
 * Returns the created `::item::Item` object id(s) from the tx effects + the destination kiosk handle so the
 * caller can OPTIMISTICALLY hydrate the bag (store_patch.hydrate_bought_items) instead of waiting on the
 * indexer-lagged /v1 owner-items reconcile ("the just-bought key took ages to show").
 * @param {{ sale_id: string, template_id: string, price_mist: string|bigint, quantity?: number }} args
 * @returns {Promise<{ digest: string, created_item_ids: string[], kiosk_id: string, kiosk_cap_id: string }>}
 */
export async function buy_items_sale({ sale_id, template_id, price_mist, quantity = 1 }) {
  if (!items_deployment_ready(DEMO_NETWORK)) throw new Error(i18n.t('errors.items_not_deployed'))
  const { address, wallet_name } = use_auth.getState()
  if (!address || !wallet_name) throw new Error('Not connected')
  // Clamp to [1, MAX] up front (mirrors the SDK clamp; buy_many_ptb re-clamps as the on-chain enforcer).
  const q = Math.max(1, Math.min(MAX_BUY_QUANTITY, Math.floor(Number(quantity) || 1)))
  const sdk = await get_sdk()

  // DESTINATION: land the purchase in the ACTIVE character's kiosk (the SAME kiosk equip/dungeon-burn resolve),
  // so the bought item is reachable by those flows — never stranded in a first-cap sibling kiosk. No active
  // character (roster-screen buy) → any personal kiosk (logged). No personal kiosk at all → onboard one first.
  const active_character_id = context.get_state().selected_character_id
  let handle
  try {
    handle = await buy_destination_kiosk(sdk, address, active_character_id)
  } catch (e) {
    // Every resolver read is pre-sign: keep the opaque RPC detail in game_log and send only phase-honest copy to toast.
    throw tx_error(e, { preflight: true, phase: 'kiosk_lookup' })
  }
  if (!handle) {
    // Onboarding is a normal self-pay tx (NOT terminal-&Random), so a low/zero-SUI wallet already rides the
    // gas-station sponsor fallback here (tx/gas_fallback.ts) — usually silent. A RAW pre-exec throw only
    // escapes when that ALSO fails (sponsor down/refused/non-zkLogin): humanize it the same way the terminal
    // buy below does — no-silent-failure law, one shared decoder for every throw this orchestrator can raise.
    let onboard_result
    try {
      onboard_result = await run_tx('items_onboard_kiosk', sdk.onboard_kiosk_ptb())
    } catch (e) {
      throw tx_error(e)
    }
    handle = created_kiosk_handle(onboard_result.result)
  }

  // Build the terminal buy through the SDK (resolves the id home + &Clock + &Random + the pinned gas budget).
  // buy_ptb throws a loud refusal when the measured gas constant is unset AND no override is passed — humanize it.
  const gas_budget_mist = gas_override_mist(q)
  let buy_tx
  try {
    buy_tx =
      q === 1
        ? sdk.buy_ptb({
            sale_id,
            template_id,
            price_mist,
            kiosk_id: handle.kiosk_id,
            personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
            gas_budget_mist,
          })
        : sdk.buy_many_ptb({
            sale_id,
            template_id,
            price_mist,
            quantity: q,
            kiosk_id: handle.kiosk_id,
            personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
            gas_budget_mist,
          })
  } catch (e) {
    if (/MEASURED_BUY_GAS_MIST is unset/.test(String(/** @type {any} */ (e)?.message ?? e)))
      throw new Error(i18n.t('errors.buy_gas_unmeasured'))
    throw e
  }

  // UN-SIMULATABLE &Random: self-pay submit WITHOUT preflight (the budget is pinned above), then wait + verify —
  // now through the ONE instrumented terminal-&Random choke (run_tx_random), so the buy lands in
  // window.__TX_TIMINGS ('buy' class) with real sign/wait phase numbers (the manual inline submit+wait it
  // replaces was invisible to the latency table — a "buy too slow" report had no trace). Identical contract:
  // ONE waitForTransaction, throw the humanized abort on an executed failure, NEVER auto-retry a burned tx.
  // PRE-EXECUTION throw (no digest — the gas-split-drain exclusion means a buy never falls back to the sponsor,
  // so a 0-SUI self-pay wallet raises a raw wallet/RPC gas-selection error): the try/catch re-routes it through
  // the SAME shared decoder (tx_error → GAS_BALANCE_RE → the honest "not enough SUI" copy, proven in
  // abort_copy.test.js). tx_error is idempotent on run_tx_random's already-humanized executed-failure throw (it
  // re-reads the structured abort off `.cause`). Nothing about the buy changes — self-pay only, always.
  let buy_result
  try {
    buy_result = await run_tx_random('buy', buy_tx, undefined, { sponsor_excluded: true }) // splits the item PRICE off tx.gas → self-pay only
  } catch (e) {
    throw tx_error(e)
  }
  // The bought item(s) are minted + kiosk-locked in THIS tx, so they surface as `created` object changes of
  // type `::item::Item` (same parse `created_kiosk_handle` uses on the onboarding tx). Hand the real ids back
  // so the caller paints the bag optimistically — the id makes the paint self-reconciling (the reducer's
  // settled-loot floor drops it the instant the /v1 read includes it). Empty on the (defensive) miss → the caller skips the paint
  // and the load_roster reconcile is the only path, never a fabricated id.
  const created_item_ids = (buy_result.result?.objectChanges ?? [])
    .filter((/** @type {any} */ c) => c?.type === 'created' && String(c?.objectType ?? '').endsWith('::item::Item'))
    .map((/** @type {any} */ c) => String(c.objectId))
  return {
    digest: buy_result.timing?.digest,
    created_item_ids,
    kiosk_id: handle.kiosk_id,
    kiosk_cap_id: handle.personal_kiosk_cap_id,
  }
}
