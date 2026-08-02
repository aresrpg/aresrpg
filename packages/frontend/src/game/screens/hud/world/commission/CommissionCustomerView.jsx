// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CUSTOMER view — pick an artisan, see the recipes THAT ARTISAN can craft (their on-chain job levels
// filter the list; recipe level requirements + success chance ride each row), each row's ingredient bill
// checked against the CUSTOMER's OWN kiosk stock (`s.sui.items`, the same chain-truth bag the JobsDrawer
// reads): a row the customer can't supply is GREYED with a "missing: X×2" tail. Selecting a
// craftable recipe reveals the optional SUI payment (0 allowed) + REQUEST CRAFT. All derivation is the
// live-/v1-backed commission_recipes.js + the pure commission_logic.js (unit-tested); the request itself
// goes through the chain-decoupled stub (commission_actions.js) so this is complete + demoable now.
//
// Issue #800: the recipe list + every bill of materials used to resolve through the BUNDLED seed catalog
// (@aresrpg/sdk/jobs `craft_recipes` / `recipe_ingredients` → packages/sdk/src/{items,recipes}.json, `{}` in
// this repo BY CONSTRUCTION), so this view was guaranteed empty. It now reads the same `/v1/encyclopedia`
// projection the Jobs drawer crafts from — and an in-flight read renders as LOADING, never as "no recipes".

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { JOBS, job_level_progress } from '@aresrpg/sdk/jobs'

import { useGameState, context } from '../../../../store.js'
import { use_toast } from '../../../../../toast'
import { use_auth } from '../../../../../auth'
import { get_encyclopedia } from '../../../../../rpc/client'
import { useRpcView } from '../../../../../rpc/use_view'
import { refresh_friends, use_friends } from '../../../../../world-shell/friends_adapter.js'
import { add_friend_flow } from '../../../../../world-shell/friends_actions'
import { ItemIcon } from '../../ItemIcon.jsx'
import { artisan_craftable_recipes } from './commission_recipes.js'
import { owned_from_items, commission_recipe_row, missing_summary, artisan_net_mist } from './commission_logic.js'
import { artisans_from_rows, request_craft, to_mist, from_mist, meets_min_payment, MIN_PAYMENT_SUI } from './commission_actions.js'

const JOB_LABEL = /** @type {Record<string, string>} */ (Object.fromEntries(JOBS.map(j => [j.id, j.label])))

/** The artisan's craft jobs as "Sword Smith 46" chips, derived from their on-chain `jobs` xp map. */
function artisan_job_chips(/** @type {Record<string, number>} */ jobs) {
  return Object.entries(jobs ?? {}).map(([id, xp]) => ({
    id,
    label: JOB_LABEL[id] ?? id,
    level: job_level_progress(xp).level,
  }))
}

/** @returns {import('react').JSX.Element} */
export function CommissionCustomerView() {
  const { t } = useTranslation()
  // The customer's OWN kiosk stock — the already-loaded on-chain bag (no fetch), the SAME source the
  // JobsDrawer prices a craft against, so a greyed row matches exactly what a craft could NOT burn.
  const items = useGameState(s => s.sui.items)
  const address = use_auth(s => s.address)

  const friend_rows = use_friends((state) => state.rows)
  const friends_loading = use_friends((state) => state.loading)
  const friends_loaded = use_friends((state) => state.loaded)
  const artisans = useMemo(() => artisans_from_rows(friend_rows), [friend_rows])
  const loading = !!address && (friends_loading || !friends_loaded)
  const [selected_address, set_selected_address] = useState(/** @type {string | null} */ (null))
  const [selected_recipe_id, set_selected_recipe_id] = useState(/** @type {string | null} */ (null))
  const [payment, set_payment] = useState(String(MIN_PAYMENT_SUI))
  const [pending, set_pending] = useState(false)
  // Empty-state SHORTCUT: paste an artisan's 0x address to add them as a friend (Commission Flow v2 — the artisan
  // list IS the friend list). Reuses the SAME add flow the presence panel uses (add_friend_flow); no redesign.
  const [add_input, set_add_input] = useState('')

  // The artisan list is a projection of the ONE friend atom. This mount only starts a reconcile read; confirmed
  // add/remove results paint the shared rows immediately, so there is no callback-owned reload lane.
  useEffect(() => {
    const controller = new AbortController()
    void refresh_friends(address, controller.signal)
    return () => controller.abort()
  }, [address])

  useEffect(() => {
    set_selected_address((previous) =>
      previous && artisans.some((artisan_row) => artisan_row.address === previous)
        ? previous
        : (artisans[0]?.address ?? null)
    )
  }, [artisans])

  const artisan = useMemo(
    () => artisans.find(a => a.address === selected_address) ?? null,
    [artisans, selected_address]
  )
  const owned = useMemo(() => owned_from_items(items), [items])

  // The live crafting corpus — ONE batched, session-cached `/v1/encyclopedia` read (items + recipes in a
  // single envelope), the SAME source the Jobs drawer projects through craft_recipes_for_job.
  const { data: encyclopedia, loading: catalog_loading } = useRpcView(
    (signal) => get_encyclopedia(undefined, signal),
    { deps: [] }
  )

  // The recipes THIS artisan can craft (their job levels vs each recipe's CHAIN gate filter the list), each
  // priced against the customer's stock into a greying row (commission_recipe_row — the unit-tested core).
  // The bill of materials rides ON the projected row — one walk, no second lookup, no second source.
  const rows = useMemo(() => {
    if (!artisan) return []
    return artisan_craftable_recipes(artisan.jobs, encyclopedia?.recipes, encyclopedia?.items).map(recipe =>
      commission_recipe_row(recipe, recipe.ingredients, owned)
    )
  }, [artisan, owned, encyclopedia])

  const selected_row = useMemo(
    () => rows.find(r => r.recipe.recipe_id === selected_recipe_id) ?? null,
    [rows, selected_recipe_id]
  )

  // Honest money split (PLATFORM CUTS): the artisan nets 90% of whatever's typed,
  // floor-rounded exactly like the chain (artisan_net_mist). Live-recomputed as the payment field changes.
  const artisan_receives_sui = useMemo(() => from_mist(artisan_net_mist(to_mist(payment))), [payment])

  // Switching artisan drops the recipe selection (a recipe belongs to the artisan it was picked under).
  useEffect(() => {
    set_selected_recipe_id(null)
  }, [selected_address])

  const on_request = async () => {
    if (!selected_row?.craftable || !artisan || pending) return
    // CLIENT FLOOR: a commission pays the artisan ≥ 0.1 SUI. Refuse below it with the
    // humanized toast (no-silent-failure law) — the on-chain assert (EAmountTooLow) is the belt when the PTB lands.
    if (!meets_min_payment(payment)) {
      use_toast.getState().add(t('commission.min_payment', { min: MIN_PAYMENT_SUI }), 'error')
      return
    }
    set_pending(true)
    try {
      // The customer's own name/address ride the request so the artisan's live notification + inbox row name WHO asked.
      const state = context.get_state()
      const me = state.sui.characters.find(c => c.id === state.selected_character_id)
      await request_craft({
        artisan_address: artisan.address,
        // The on-chain `crafting::Recipe` object id — the craft tx's own input, not the output template.
        recipe_id: selected_row.recipe.recipe_id,
        job_id: selected_row.recipe.job_id,
        payment_mist: to_mist(payment),
        customer_address: address ?? undefined,
        customer_name: me?.name || undefined,
        recipe_name: selected_row.recipe.name,
        // The chain art key (`items/{item_type}.png`); the object id is not an art identity.
        recipe_icon: selected_row.recipe.item_type,
        recipe_category: selected_row.recipe.category,
      })
      use_toast.getState().add(t('commission.request_sent', { recipe: selected_row.recipe.name }), 'info')
      set_selected_recipe_id(null)
      set_payment(String(MIN_PAYMENT_SUI))
    } catch (error) {
      // no-silent-failure law: the humanized copy reaches the player; the raw error stays in console.
      use_toast.getState().add(error?.message || t('commission.request_failed'), 'error')
    } finally {
      set_pending(false)
    }
  }

  // The add-artisan-as-friend shortcut in the empty state — reuses the presence panel's exact add flow, then the
  // shared friend reducer paints the new artisan immediately. Guards empty input; the flow toasts the rest.
  const on_add_friend = async () => {
    const v = add_input.trim()
    if (!v) return
    set_add_input('')
    await add_friend_flow(address, v)
  }

  if (loading) {
    return (
      <div className="gw-cm__view">
        <div className="gw-cm__loading">{t('commission.loading')}</div>
      </div>
    )
  }
  if (artisans.length === 0) {
    // Friends-only discovery: no friends yet → hint + the add-an-artisan shortcut.
    return (
      <div className="gw-cm__view">
        <div className="gw-cm__empty gw-cm__empty--friends">
          <p className="gw-cm__empty-title">{t('commission.no_friend_artisans')}</p>
          <p className="gw-cm__empty-hint">{t('commission.add_artisans_hint')}</p>
          <div className="gw-cm__add">
            <input
              className="gw-cm__add-input"
              placeholder={t('friends.add_placeholder')}
              value={add_input}
              onChange={e => set_add_input(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && on_add_friend()}
            />
            <button type="button" className="gw-cm__btn" onClick={on_add_friend} disabled={!add_input.trim()}>
              {t('commission.add_artisan')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="gw-cm__view">
      <div className="gw-cm__body">
        <div className="gw-cm__section-h">{t('commission.pick_artisan')}</div>
        <div className="gw-cm__artisans">
          {artisans.map(a => (
            <button
              key={a.address}
              type="button"
              className={`gw-cm__artisan${a.address === selected_address ? ' is-selected' : ''}`}
              onClick={() => set_selected_address(a.address)}
            >
              <span className="gw-cm__artisan-name">{a.name}</span>
              <span className="gw-cm__artisan-jobs">
                {artisan_job_chips(a.jobs).map(job => (
                  <span key={job.id} className="gw-cm__artisan-job">
                    {job.label} <b>{job.level}</b>
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>

        <div className="gw-cm__section-h">{t('commission.recipes_head')}</div>
        {catalog_loading ? (
          // Cache law: absence is not emptiness. "This artisan has no craftable recipes yet" is a claim
          // nothing has established until the corpus read lands.
          <div className="gw-cm__empty">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="gw-cm__empty">{t('commission.no_recipes')}</div>
        ) : (
          <div className="gw-cm__recipes">
            {rows.map(row => {
              const greyed = !row.craftable
              const selected = row.recipe.recipe_id === selected_recipe_id
              return (
                <button
                  key={row.recipe.recipe_id}
                  type="button"
                  disabled={greyed}
                  aria-disabled={greyed}
                  className={`gw-cm__recipe${greyed ? ' is-greyed' : ''}${selected ? ' is-selected' : ''}`}
                  onClick={() => !greyed && set_selected_recipe_id(row.recipe.recipe_id)}
                >
                  <span className="gw-cm__recipe-icon">
                    <ItemIcon
                      item={{
                        icon: row.recipe.item_type,
                        id: row.recipe.recipe_id,
                        category: row.recipe.category,
                      }}
                      alt={row.recipe.name}
                    />
                  </span>
                  <span className="gw-cm__recipe-id">
                    <span className="gw-cm__recipe-name">{row.recipe.name}</span>
                    <span className="gw-cm__recipe-meta">
                      <span className="gw-cm__recipe-lvl">
                        {t('commission.req_level', { level: row.required_level })}
                      </span>
                      <span className="gw-cm__recipe-chance">
                        {t('commission.success_chance', { pct: row.success_chance })}
                      </span>
                    </span>
                    {greyed && (
                      <span className="gw-cm__recipe-missing">
                        {row.seeded
                          ? t('commission.missing', { list: missing_summary(row.missing) })
                          : t('commission.not_seeded')}
                      </span>
                    )}
                  </span>
                  {!greyed && <span className="gw-cm__recipe-ok">{t('commission.in_stock')}</span>}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="gw-cm__foot">
        <label className="gw-cm__pay">
          <span className="gw-cm__pay-label">{t('commission.payment_label')}</span>
          <input
            type="number"
            min={String(MIN_PAYMENT_SUI)}
            step="0.1"
            inputMode="decimal"
            className={`gw-cm__pay-input${meets_min_payment(payment) ? '' : ' is-invalid'}`}
            value={payment}
            onChange={e => set_payment(e.target.value)}
          />
          <span className="gw-cm__pay-label">
            {t('commission.artisan_receives', { amount: artisan_receives_sui })}
          </span>
        </label>
        <span className="gw-cm__foot-spacer">
          {!meets_min_payment(payment) ? (
            <span className="gw-cm__pay-floor">{t('commission.min_payment', { min: MIN_PAYMENT_SUI })}</span>
          ) : selected_row ? (
            <>
              {t('commission.for_recipe')} <b>{selected_row.recipe.name}</b>
            </>
          ) : (
            t('commission.select_recipe')
          )}
        </span>
        <button
          type="button"
          className="gw-cm__btn"
          disabled={!selected_row?.craftable || pending || !meets_min_payment(payment)}
          onClick={on_request}
        >
          {pending ? t('commission.requesting') : t('commission.request_craft')}
        </button>
      </div>
    </div>
  )
}
