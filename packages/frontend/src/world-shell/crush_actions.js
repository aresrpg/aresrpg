// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRUSH actions (SINGLE TX) — the tx seam over @aresrpg/sdk/game's `crush_ptb`,
// funneled through the terminal-&Random door (world-shell/tx.js `run_tx_random` — keep-budget class, the shop
// buy idiom). ONE user action: right-click → confirm → `forgemagie::crush` destroys the gear, rolls the yield
// AND kiosk-locks the minted rune stacks in the same call (35 fixed template slots, distinct-padding law) —
// no receipt, no resume machine, nothing to claim afterwards.
//
// PRE-FLIGHT GUARDS (zero-gas honest refusals, thrown as translated Errors the modal's toast surfaces):
//   • template resolution (item_type slug → the template OBJECT id off the /v1 template map — the slug is an
//     art key, never an object id);
//   • item-location resolution: the crush runs in the CHARACTER's kiosk (the chain borrows the character out of
//     it and extracts the gear from it), so gear whose `/v1` row names another kiosk is refused for zero gas;
//   • the REGISTRY guard: every rune this item's stat lines can yield (deterministic set —
//     `reachable_rune_keys`) must be registered on the CrushBoard, else the chain would abort
//     `EMissingTemplate` mid-tx — refused here for free instead.
//
// GAS (money law): crush consumes `&Random` (value-dependent mint loop) ⇒ the budget comes from the MEASURED
// constant in the SDK (`MEASURED_CRUSH_GAS_MIST` — null + loud-refuse until the publish rehearsal stamps it);
// run_tx_random keeps it as the MAX bound while the simulate-refuse gate still runs. NEVER auto-retried: an
// executed failure (digest exists) surfaces and stops — retry is the player's explicit choice.

import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'
import {
  crush_ptb,
  get_crush_registry,
  reachable_rune_keys,
  crush_yield_preview,
  rune_key,
  CRUSH_TEMPLATE_SLOTS,
} from '@aresrpg/sdk/game'

import { use_auth } from '../auth'
import i18n from '../i18n'
import { get_sdk } from '../chain/sdk'
import { DEMO_NETWORK } from '../chain/deployment'
import { get_template_by_item_type_map, get_template_map } from '../chain/read_findables.js'
import { load_roster } from '../roster/load_roster.js'
import { get_taux_rows } from '../rpc/client'

import { kiosk_for_character } from './kiosk_resolve.js'
import { resolve_crush_template } from './crush_resolve.js'
import { run_tx_random } from './tx.js'

const CTX = { network: DEMO_NETWORK }
// The shared forgemagie::CrushBoard — the crush door's one runtime seed arg (stamped in deployment/aresrpg.js).
const CRUSH_BOARD = aresrpg_id(DEMO_NETWORK, 'CRUSH_BOARD')

/** Resolve the item's TEMPLATE row (object id + level) off the cached /v1 template map. A projected owner-item
 * row's exact `template_id` wins; legacy chain-read rows fall back to their `item_type` slug. Returns
 * `{ tmpl, removed }`: `removed:true` when the
 * template was DELETED on-chain (the loaded map holds real templates but not this
 * slug), so the caller shows the honest "removed from the game" state instead of a raw error. An EMPTY map
 * means the read itself failed (memoized-empty / RPC outage), NOT a deletion — that keeps the honest
 * transient `crush.no_template` throw so a live item is never mislabelled "removed" during an outage. */
async function resolve_template(item) {
  const exact = !!item?.template_id
  const catalog = exact ? await get_template_map() : await get_template_by_item_type_map()
  const tmpl = resolve_crush_template(item, exact ? catalog : null, exact ? null : catalog)
  if (tmpl?.id) return { tmpl, removed: false }
  if (catalog.size > 0) return { tmpl: null, removed: true }
  throw new Error(i18n.t('crush.no_template'))
}

/**
 * The confirm modal's YIELD PREVIEW: the deterministic per-stat rune set + the honest quantity band
 * (`crush_yield_preview` — the integer mirror of the on-chain formula), priced at the template's LIVE
 * effective coefficient off `/v1/taux` (falls back to the neutral 100% — flagged `estimated`). A statless
 * item previews empty (it yields nothing — still crushable, the destruction is the point).
 * @param {{ id: string, template_id?: string|null, item_type: string, level?: number }} item  an owner-item row
 * @returns {Promise<{ removed: boolean, rows: { stat: number, stat_key: string, min: number, max: number }[], coeff_milli: number, estimated: boolean }>}
 *   `removed:true` when the item's template was deleted on-chain — the modal shows the "removed from the game"
 *   notice + a disabled (pending-upgrade) crush button instead of a yield.
 */
export async function crush_preview(item) {
  const [sdk, { tmpl, removed }] = await Promise.all([get_sdk(), resolve_template(item)])
  // ORPHAN state (a deleted template): the template is gone, so there is no level/coefficient to price
  // a yield against — the modal shows the "removed from the game" notice + the pending-upgrade crush state.
  if (removed) return { removed: true, rows: [], coeff_milli: 100_000, estimated: false }
  const stats = await sdk.get_rolled_stats(item.id)
  if (!stats) return { removed: false, rows: [], coeff_milli: 100_000, estimated: false }

  let coeff_milli = 100_000
  let recipe_less = false
  let estimated = true
  try {
    const [row] = await get_taux_rows([tmpl.id])
    if (row) {
      ;({ coeff_milli, recipe_less } = row)
      estimated = false
    }
  } catch {
    // /v1 unreachable → preview at neutral, honestly labelled an estimate (the chain prices at crush time anyway)
  }

  const rows = crush_yield_preview({
    centered_stats: stats,
    item_level: Number(tmpl.level ?? item.level ?? 0),
    coeff_milli,
    recipe_less,
  })
  return { removed: false, rows, coeff_milli, estimated }
}

/**
 * CRUSH one bag item — the WHOLE ceremony in ONE tx: destroy the gear, roll the yield, mint + kiosk-lock the
 * rune stacks. Resolves the item's actual holding kiosk + cap, guards the rune registry, fills the
 * 35 distinct template slots (every registered rune + template-map fillers), and executes through the
 * keep-budget &Random door. Throws translated Errors for the modal's toast; refreshes the shared roster/bag
 * store on success (the equip post-tx pattern).
 * @param {{ item: { id: string, template_id?: string|null, item_type: string, kiosk_id?: string, level?: number }, character_id: string }} args
 * @returns {Promise<{ result: any, timing: any }>}
 */
export async function crush_item({ item, character_id }) {
  const { address } = use_auth.getState()
  if (!address || !character_id) throw new Error(i18n.t('crush.no_kiosk'))

  const [sdk, { tmpl, removed }] = await Promise.all([get_sdk(), resolve_template(item)])
  // ORPHAN item (a deleted template): the standard `forgemagie::crush` takes the gear's &ItemTemplate by
  // reference AND reads the item level off it (the Item carries no level) — a DELETED template is unpassable,
  // so crush is uncallable until the additive `crush_orphan` door + its SDK composer ship (staged Move patch,
  // next ceremony). Refuse honestly and loudly — never compose a knowably-doomed tx against a ghost template.
  if (removed) throw new Error(i18n.t('removed_item.crush_pending'))

  // ── ONE KIOSK, BY THE CHAIN'S CONSTRUCTION (#1162) ──
  // `forgemagie::crush` borrows the CHARACTER out of the kiosk it is handed (the level bracket prices the yield)
  // AND extracts the gear from that SAME kiosk. So the kiosk is the CHARACTER's — passing the item's kiosk merely
  // moved the abort from the gear lookup to the character lookup, with the same `0x2::kiosk::EItemNotFound` and
  // the same toast. `/v1/owner-items.kiosk_id` is the truth of where the gear sits, so a mismatch is a state we
  // can name for free instead of burning gas on a tx that can only abort.
  const handle = await kiosk_for_character(sdk, address, character_id)
  if (!handle?.kiosk_id || !handle?.personal_kiosk_cap_id) throw new Error(i18n.t('crush.no_kiosk'))
  if (!item?.kiosk_id) throw new Error(i18n.t('crush.no_kiosk'))
  if (String(item.kiosk_id) !== String(handle.kiosk_id)) throw new Error(i18n.t('errors.item_wrong_kiosk'))

  // ── the REGISTRY guard: every reachable rune needs its registered template (else on-chain EMissingTemplate) ──
  const [stats, registry] = await Promise.all([
    sdk.get_rolled_stats(item.id),
    get_crush_registry({ grpc_client: sdk.grpc_client, network: DEMO_NETWORK })(),
  ])
  const reachable = stats ? reachable_rune_keys(stats) : []
  const missing = reachable.filter(({ stat, tier }) => !registry.by_key.has(rune_key(stat, tier)))
  if (missing.length) throw new Error(i18n.t('crush.registry_missing'))

  // ── the 35 DISTINCT slots: every registered rune template + template-map fillers (distinct-padding law) ──
  const rune_template_ids = [...registry.by_key.values()]
  const by_type = await get_template_by_item_type_map()
  const taken = new Set([...rune_template_ids.map(String), String(tmpl.id)])
  const filler_template_ids = []
  for (const row of by_type.values()) {
    if (filler_template_ids.length >= CRUSH_TEMPLATE_SLOTS) break
    if (!row?.id || taken.has(String(row.id))) continue
    taken.add(String(row.id))
    filler_template_ids.push(row.id)
  }

  const tx = crush_ptb(CTX)({
    crush_board_id: CRUSH_BOARD,
    kiosk_id: handle.kiosk_id,
    personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
    character_id,
    gear_template_id: tmpl.id,
    gear_item_ids: [item.id],
    rune_template_ids,
    filler_template_ids,
    // gas: builder-pinned from MEASURED_CRUSH_GAS_MIST (loud-refuse until the rehearsal stamps it) — money law.
  })
  const out = await run_tx_random('crush', tx)
  // Refresh the shared store so the destroyed gear + minted rune stacks repaint everywhere (equip's post-tx pattern).
  load_roster().catch(() => {})
  return out
}
