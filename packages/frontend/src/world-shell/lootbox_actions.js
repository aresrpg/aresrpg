// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET LOOT-BOX action seam — the two-phase OPEN → COLLECT flow against the (parallel-lane) `aresrpg::loot_box`
// door. Mirrors items_sale_actions.js (buy orchestrator) + consume_actions.js (kiosk-resolve + template map):
//   1. open_box  — TERMINAL &Random: burns the bought box, rolls, transfers a SOULBOUND PetBoxClaim to the
//      sender + emits LootBoxOpened{ box_template, rolled_template, opener }. Submitted via run_tx_random
//      (un-simulatable &Random; the SDK PINS the budget). The rolled pet is READ OFF THE EVENT — the reveal is
//      TRUTHFUL, never a client re-roll (INVARIANT).
//   2. claim_pet — DETERMINISTIC: consumes the claim + the rolled template ref → mints + KIOSK-LOCKS the pet
//      (kiosk-lock constitution: every pet is kiosk-locked forever). Normal self-pay run_tx (dry-run gas guard).
//
// TX-RETRY LAW (money safety): an EXECUTED failure (a digest exists = gas burned) is NEVER auto-retried — the
// run_tx / run_tx_random choke throws the humanized abort and we let it propagate. Only a PRE-FLIGHT/build throw
// is re-routed through the ONE decoder (tx_error). No auto-retry anywhere in this module.
//
// GAS (un-simulatable): open_box consumes &Random, so its budget is PINNED in the SDK from a MEASURED constant
// (null until stamped → the SDK REFUSES LOUDLY). Mirror the buy path's UNSAFE testnet override so a pre-measure
// QA can open once the door is live: gas_budget_mist = gas_override_mist(1) (VITE_UNSAFE_DEV_GAS, ../env).
//
// RESOLVER RESIDUAL (confirmed at door publish): the event/claim `rolled_template` may be a template OBJECT ID
// (0x-hex) or an item_type SLUG. resolve_rolled handles BOTH — 0x ⇒ template_id (reverse-mapped to a slug for
// display), else ⇒ slug (mapped to an id for the claim). Which form the chain emits is the one open integration item.
// KIOSK RESIDUAL: the box's holding kiosk is resolved via buy_destination_kiosk (the active character's kiosk —
// where the buy landed it), same assumption as items_sale_actions; a multi-kiosk box would need a box-derived walk.

import { use_auth } from '../auth'
import { get_sdk } from '../chain/sdk'
import { get_template_map, get_template_by_item_type_map } from '../chain/read_findables.js'
import { context } from '../game/core/game.js'
import { tx_error, humanize_tx_error } from '../game/core/abort_copy.js'
import { UNSAFE_DEV_GAS_MIST } from '../env'
import { game_log } from '../core/log.js'
import { get_pet_claims } from '../rpc/client'
import i18n from '../i18n'
import { use_toast } from '../toast'
import {
  begin_claim,
  end_claim,
  hydrate_claim_latches,
  is_latch_durable,
  sweep_eligible_claims,
} from '../game/screens/hud/lootbox-retry-guard.js'
import { load_roster } from '../roster/load_roster.js'

import { run_tx, run_tx_random } from './tx.js'
// Kiosk-resolve law (mirror of items_sale_actions): land / find the box + minted pet in the ACTIVE character's
// kiosk — the SAME kiosk equip/dungeon/buy resolve — falling back (logged) to any personal kiosk.
import { buy_destination_kiosk } from './kiosk_resolve.js'
import { collect_one_claim, parse_open_box_receipt, resolve_box_template } from './lootbox_util.js'
// #265 (second mint path): claim_pet IS a mint receipt — fold it through the SAME inventory reducer door the
// fight-settle path uses, so the pet lands in the bag without a page refresh.
import { reduce_minted_receipt } from './loot_inventory_effect.js'

// The box detector lives in the import-free leaf (bun:test can't import THIS module — `../auth` touches `window`
// at load); re-export so Inventory + shop keep one import home.
export { is_lootbox } from './lootbox_util.js'

/** UNSAFE testnet override → a TOTAL open_box gas budget mirroring the SDK's × 1.5 per-open formula. Undefined
 *  when VITE_UNSAFE_DEV_GAS is unset, so the SDK falls to its measured constant (and refuses loudly if unset). */
function gas_override_mist(/** @type {number} */ count) {
  return UNSAFE_DEV_GAS_MIST == null ? undefined : Math.ceil(UNSAFE_DEV_GAS_MIST * 1.5) * count
}

/** Loud, honest refusal until Lane A stamps the composer onto the sdk object (pre-integration transient). */
function ensure_composer(/** @type {any} */ sdk, /** @type {string} */ name) {
  if (typeof sdk?.[name] !== 'function') throw new Error(`Loot boxes are not available yet (sdk.${name} unbuilt)`)
}

/** created objectChanges whose objectType ends with `suffix` (the buy-orchestrator idiom). @returns {string[]} */
function created_ids(/** @type {any} */ result, /** @type {string} */ suffix) {
  return (result?.objectChanges ?? [])
    .filter((/** @type {any} */ c) => c?.type === 'created' && String(c?.objectType ?? '').endsWith(suffix))
    .map((/** @type {any} */ c) => String(c.objectId))
}

/**
 * OPEN a bought pet box (phase 1). Resolves the holding kiosk + the box's template id, builds the terminal
 * &Random open_box PTB (budget PINNED / dev-overridden), submits WITHOUT preflight via run_tx_random, then reads
 * the rolled pet OFF the LootBoxOpened event (truthful reveal) + the created PetBoxClaim id. NEVER auto-retries an
 * executed failure. Pre-flight/build throw → tx_error (the ONE decoder).
 * @param {{ box_id: string, item_type: string, template_id?: string|null }} args
 * @returns {Promise<{ digest: string|undefined, rolled_template: string|null, claim_id: string|null }>}
 */
export async function open_box({ box_id, item_type, template_id }) {
  // D2 ("the unsealing took 20s") ONE-SHOT STAGE MARKS — game_log is the single debug flag (?debug=1 /
  // localStorage.ares_debug): each pre-tx read + the tx phases get a number so the slow stage is NAMED,
  // never guessed. run_tx_random's own timing carries sign_ms/wait_ms; this line carries the rest.
  const t0 = Date.now()
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  ensure_composer(sdk, 'open_box_ptb')
  const t_sdk = Date.now()

  const active_character_id = context.get_state().selected_character_id
  const handle = await buy_destination_kiosk(sdk, address, active_character_id)
  if (!handle) throw new Error('No personal kiosk holds this box — buy one first')
  const t_kiosk = Date.now()

  // A bought/indexed Item carries its exact stamped template identity. Preserve that identity: the event-replayed
  // item_type map is lossy when stale/re-authored templates share a slug, and choosing the wrong object burns gas
  // before loot_box::open_box aborts ENotBox. Legacy rows without template_id retain the slug fallback.
  const template = resolve_box_template(
    { template_id, item_type },
    template_id ? await get_template_map() : null,
    template_id ? null : await get_template_by_item_type_map()
  )
  if (!template?.id) throw new Error(`[lootbox] could not resolve the box template (item_type=${item_type})`)
  const t_template = Date.now()

  let tx
  try {
    tx = sdk.open_box_ptb({
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      box_id,
      box_template_id: template.id,
      gas_budget_mist: gas_override_mist(1),
    })
  } catch (e) {
    throw tx_error(e)
  }

  // UN-SIMULATABLE &Random: submit WITHOUT preflight (the budget is pinned in the builder). run_tx_random throws
  // the humanized abort on an executed failure; a PRE-EXEC throw (gas selection) is re-routed through the SAME
  // decoder (tx_error is idempotent on the already-humanized executed-failure throw — mirrors items_sale_actions).
  // This is HUMANIZING, never a retry (a digest exists = gas burned — TX-RETRY law).
  let result, timing
  try {
    ;({ result, timing } = await run_tx_random('open_box', tx))
  } catch (e) {
    throw tx_error(e)
  }
  game_log(
    'lootbox-perf',
    `open_box stages: sdk ${t_sdk - t0}ms · kiosk-resolve ${t_kiosk - t_sdk}ms · template-map ${t_template - t_kiosk}ms · ` +
      `sign+submit ${timing?.sign_ms ?? '?'}ms · finality ${timing?.wait_ms ?? '?'}ms · total ${Date.now() - t0}ms`
  )
  const { rolled_template, claim_id } = parse_open_box_receipt(result)
  return { digest: timing?.digest, rolled_template, claim_id }
}

/**
 * COLLECT the rolled pet (phase 2, deterministic). Consumes the PetBoxClaim + the rolled template ref → mints +
 * kiosk-locks the pet into the active character's kiosk. Normal self-pay run_tx (dry-run gas guard). Pre-flight/
 * build throw → tx_error; an executed failure throws the humanized abort (no auto-retry — the claim survives, so
 * the caller may let the user retry COLLECT).
 * @param {{ claim_id: string, rolled_template: string }} args
 * @returns {Promise<{ digest: string|undefined, created_pet_id: string|null }>}
 */
export async function claim_pet({ claim_id, rolled_template }) {
  const { address } = use_auth.getState()
  if (!address) throw new Error('Not connected')
  const sdk = await get_sdk()
  ensure_composer(sdk, 'claim_pet_ptb')

  const active_character_id = context.get_state().selected_character_id
  const handle = await buy_destination_kiosk(sdk, address, active_character_id)
  if (!handle) throw new Error('No personal kiosk to receive the pet — select a character first')

  const { template_id } = await resolve_rolled({ rolled_template })
  if (!template_id) throw new Error(`[lootbox] could not resolve the rolled pet template (${rolled_template})`)

  let tx
  try {
    tx = sdk.claim_pet_ptb({
      kiosk_id: handle.kiosk_id,
      personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
      claim_id,
      rolled_template_id: template_id,
    })
  } catch (e) {
    throw tx_error(e)
  }
  // Deterministic self-pay: run_tx throws the humanized abort on an executed failure; a pre-flight/gas throw is
  // re-routed through the SAME decoder. No auto-retry — the claim survives a failure, so the user may retry COLLECT.
  // Identity captured BEFORE the tx (the fight-settle door's same race guard): a wallet switch mid-flight must
  // never paint the new owner's bag with the pet THIS signer minted. `address` (use_auth, fetched at entry) —
  // NEVER `context.sui.selected_address`, a field nothing has written since embed.js's start_session was
  // deleted in 671266c2 (see loot_inventory_effect.js's header for the #265-recurrence story).
  const owner_address = address
  let result, timing
  try {
    ;({ result, timing } = await run_tx('claim_pet', tx))
  } catch (e) {
    throw tx_error(e)
  }
  // #265: the claim's own receipt already proves the minted pet (item::ItemMinted) — fold it into the bag NOW,
  // through the ONE reducer door (loot_inventory_effect.js), instead of waiting on a caller's load_roster refetch.
  await reduce_minted_receipt(
    { receipt: result, kiosk_id: handle.kiosk_id, kiosk_cap_id: handle.personal_kiosk_cap_id },
    owner_address,
    { load_templates: get_template_map, reducer_door: context, current_address: () => use_auth.getState().address }
  )
  return { digest: timing?.digest, created_pet_id: created_ids(result, '::item::Item')[0] ?? null }
}

/**
 * Read every UNCLAIMED PetBoxClaim the wallet owns (interrupted opens) → `[{ claim_id, rolled_template }]`, so
 * the shop can surface a COLLECT chip. /v1-PROJECTED (docs/V1_SWEEP_PLAN.md §3 item 9 — the last sanctioned
 * chain-direct read, retired): the indexer object-snapshots PetBoxClaim create/delete (soulbound, no kiosk join
 * possible), served at /v1/pet-claims?owner=. Best-effort: any read failure resolves to `[]` (never throws to
 * the UI) — rpc_get already funnels network/HTTP failures through the ONE RpcError shape.
 * @param {string|null|undefined} address
 * @returns {Promise<Array<{ claim_id: string, rolled_template: string }>>}
 */
export async function read_pet_box_claims(address) {
  if (!address) return []
  try {
    return await get_pet_claims(address)
  } catch (e) {
    game_log('lootbox', 'read_pet_box_claims failed (degrading to none)', e)
    return []
  }
}

/** One sweep per address per session — a route re-entry must not re-walk claims the boot already handled. */
const swept_addresses = new Set()

/** Log the storage-degraded auto-collect-off notice at most once per session (a log, not a toast — no spam). */
let sweep_degraded_logged = false

/**
 * BOOT/REFRESH SWEEP (claiming must be automatic at opening, or at refresh if it ever failed) —
 * find every stranded durable PetBoxClaim in the FRESH `/v1` read and auto-fire its claim, sequentially.
 * The guard bounds it under the TX-RETRY law: one flight per claim across surfaces, and an executed/ambiguous
 * failure DURABLY latches against any further AUTO fire (persisted — so this AUTO gas path never re-fires an
 * aborted claim on the NEXT boot; the shop chip keeps the manual retry). Only a never-executed / zero-gas-refused
 * claim stays sweep-eligible. Cross-tab serialized (navigator.locks) so two boots never fire one live claim.
 * Outcomes are narrated by the same toasts as every other claim surface; a read failure degrades to a no-op.
 * @returns {Promise<void>}
 */
export async function sweep_stranded_claims() {
  const { address } = use_auth.getState()
  if (!address || swept_addresses.has(address)) return
  swept_addresses.add(address)
  // Cross-tab election (P2): serialize the sweep across this origin's tabs so two simultaneous boots never fire
  // the same live claim. navigator.locks auto-releases on tab close/crash (no stale lock); absent → run directly.
  const locks = /** @type {any} */ (globalThis.navigator)?.locks
  if (locks?.request) await locks.request('ares:lootbox:sweep', () => sweep_claims_once(address))
  else await sweep_claims_once(address)
}

/** The sweep body, under the cross-tab lock. @param {string} address @returns {Promise<void>} */
async function sweep_claims_once(address) {
  hydrate_claim_latches() // boot INPUT + durability PROBE (read-back verify) before the auto-sweep decides
  // DURABILITY GATE (P1 round 3): if localStorage cannot confirm the executed-fail latch (private mode / quota /
  // disabled), the AUTO-sweep must NOT run — an executed-fail it could not persist would silently re-burn every
  // boot. Degrade to the existing MANUAL one-click path (the shop chip lists every stranded claim, ungated).
  if (!is_latch_durable()) {
    if (!sweep_degraded_logged) {
      sweep_degraded_logged = true
      game_log(
        'lootbox',
        'boot sweep OFF: localStorage cannot confirm the executed-fail latch (private mode / quota) — auto-collect disabled; stranded pet claims stay on the manual shop-chip path'
      )
    }
    return
  }
  const claims = await read_pet_box_claims(address)
  const eligible_ids = new Set(sweep_eligible_claims(claims.map((c) => c.claim_id)))
  const stranded = claims.filter((c) => eligible_ids.has(c.claim_id))
  if (!stranded.length) return
  game_log('lootbox', `boot sweep: auto-collecting ${stranded.length} stranded claim(s)`)
  let collected = 0
  for (const { claim_id, rolled_template } of stranded) {
    if (!begin_claim(claim_id)) continue
    // The success/failure verdict + latch key ONLY on claim_pet; the display-name read is cosmetic and its
    // failure degrades the toast name, never re-latching a succeeded claim (honest-toast law — one home in util).
    const ok = await collect_one_claim(
      { claim_id, rolled_template },
      {
        do_claim: claim_pet,
        settle: end_claim,
        resolve_name: async ({ rolled_template: rt }) => {
          const { slug } = await resolve_rolled({ rolled_template: rt })
          const tmpl = (await get_template_by_item_type_map()).get(slug)
          return tmpl?.name ?? String(slug || rt).replace(/_/g, ' ')
        },
        toast_ok: (name) => use_toast.getState().add(i18n.t('lootbox.collected', { name }), 'info'),
        toast_err: (error) => use_toast.getState().add(humanize_tx_error(error), 'error'),
      }
    )
    if (ok) collected += 1
  }
  if (collected) load_roster().catch(() => {})
}

/**
 * Resolve a `rolled_template` (either a template OBJECT ID `0x…` or an item_type SLUG — the confirmed-at-publish
 * residual) into BOTH forms `{ slug, template_id }`. 0x ⇒ id (reverse-mapped to a slug for display); else ⇒ slug
 * (forward-mapped to an id for the claim). Empty fields on a miss (never throws).
 * @param {{ rolled_template: string }} args
 * @returns {Promise<{ slug: string, template_id: string }>}
 */
export async function resolve_rolled({ rolled_template }) {
  const raw = String(rolled_template ?? '')
  const by_type = await get_template_by_item_type_map() // slug → template row (row.id = object id)
  if (raw.startsWith('0x')) {
    for (const tmpl of by_type.values())
      if (String(tmpl.id) === raw) return { slug: String(tmpl.item_type), template_id: raw }
    return { slug: '', template_id: raw } // unknown id — claim still works, display degrades to the raw id
  }
  return { slug: raw, template_id: String(by_type.get(raw)?.id ?? '') }
}
