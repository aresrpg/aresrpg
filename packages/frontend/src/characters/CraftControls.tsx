// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  craft_batch_limit,
  craft_required_level,
  craft_success_percent,
  craft_xp_at_level,
  item_is_stackable,
  type JobSlug,
} from '@aresrpg/immutable'
import { Button } from '@aresrpg/ui'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { useState, type CSSProperties } from 'react'

import { encyclopedia_catalog, titleize, type SeedRecipe } from '../content/catalog.ts'
import { type CopyText } from '../i18n/copy.ts'
import { localized_error } from '../i18n/error_text.ts'
import { useText } from '../i18n/useText.ts'
import { useVocabulary } from '../i18n/useVocabulary.ts'
import {
  available_item_stacks,
  craft_output_stack_plan,
  craft_stack_plan,
  encumbered_asset_ids,
} from '../inventory_stacks.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { retry_after_version_race, run_direct_transaction } from '../transaction_guard.ts'

import { JobItemIcon } from './JobItemIcon.tsx'

export const craft_result_tone = (successes: number): 'error' | 'success' => (successes === 0 ? 'error' : 'success')

/** Inline craft controls — the bill of materials + the real Craft button, as detail children. */
export const CraftControls = ({
  recipe,
  character,
  inventory_override,
  job,
  level,
  t,
  open_ingredient,
}: Readonly<{
  recipe: Readonly<SeedRecipe>
  character?: Readonly<CharacterRow>
  inventory_override?: readonly ItemRow[]
  job: JobSlug
  level: number
  t: CopyText
  open_ingredient: (item_type: string) => void
}>) => {
  const vocabulary = useVocabulary()
  const ui = useText()
  const wallet = useAppStore(({ session }) => session.wallet)
  const live_inventory = useAppStore(({ session }) => session.inventory)
  const inventory = inventory_override ?? live_inventory
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const encumbered = encumbered_asset_ids(listings, trades)
  const [pending, set_pending] = useState(false)
  const [attempts, set_attempts] = useState(1)
  const output = encyclopedia_catalog.item(recipe.output_type)!.item
  const stackable_output = item_is_stackable(output.category)
  const batch_limit = craft_batch_limit(output.category)
  const kiosk = character?.kiosk ?? ''
  const stack_plan = craft_stack_plan(recipe.inputs, attempts, inventory, encumbered, kiosk)

  const rows = Object.entries(recipe.inputs).map(([item_type, per_attempt]) => {
    const stacks = available_item_stacks(inventory, encumbered, item_type, kiosk)
    const need = per_attempt * attempts
    return {
      item_type,
      need,
      have: stacks.reduce((total, stack) => total + stack.amount, 0),
      enough: stacks.reduce((total, stack) => total + stack.amount, 0) >= need,
    }
  })
  const required = craft_required_level(Object.keys(recipe.inputs).length)
  const maximum_attempts = Math.min(
    batch_limit,
    ...rows.map(({ item_type, have }) => Math.floor(have / recipe.inputs[item_type]!))
  )
  const level_ok = level >= required
  const affordable = stack_plan !== null
  const can_craft = !!wallet && inventory_override === undefined && level_ok && affordable && !pending
  const success_chance = craft_success_percent(level)

  const on_craft = (): void => {
    if (!can_craft || !wallet || !character || !stack_plan) return
    const input_ids = new Set(stack_plan.flatMap(({ target_id, source_ids }) => [target_id, ...source_ids]))
    const output_plan = craft_output_stack_plan(
      inventory,
      encumbered,
      recipe.output_type,
      character.kiosk,
      attempts,
      input_ids
    )
    const transaction = run_direct_transaction(() =>
      retry_after_version_race(() =>
        wallet.character.craft({
          character_id: character.id,
          output_type: recipe.output_type,
          input_item_ids: stack_plan.map(({ target_id }) => target_id),
          merges: stack_plan,
          existing: output_plan?.target_id ?? null,
          attempts,
          custody: { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap },
        })
      )
    )
    if (!transaction) return
    set_pending(true)
    const { name } = output
    const pending_toast = toast.loading(t('jobs.craft.prepare_tooltip', { count: attempts, name }))
    void transaction
      .then(({ digest, attempts: completed_attempts, successes, job_xp_gained, inventory_changes }) => {
        if (read_app_state().session.wallet !== wallet) return
        dispatch_app({ type: 'inventory/amounts_changed', changes: inventory_changes })
        dispatch_app({
          type: 'character/crafted',
          digest,
          successes,
          attempts: completed_attempts,
          output_type: recipe.output_type,
          character_id: character.id,
          job,
          xp: job_xp_gained,
        })
        const message = t('jobs.craft.craft_result', { attempts: completed_attempts, successes, name })
        if (craft_result_tone(successes) === 'error') pending_toast.error(localized_error(message))
        else pending_toast.success(message)
      })
      .catch(pending_toast.error)
      .finally(() => set_pending(false))
  }

  return (
    <div className="jobs__craft">
      <div className="jobs__craft-head">{t('jobs.craft.ingredients_head')}</div>
      <div className="jobs__craft-profession">
        <span>
          {vocabulary.job(job)} · {t('jobs.lv_badge', { level })}
        </span>
        <span>
          {craft_xp_at_level(Object.keys(recipe.inputs).length, level)} {ui('ui.xp')}
        </span>
      </div>
      <div className="jobs__ingredients" style={{ '--ingredient-rows': Math.min(3, rows.length) } as CSSProperties}>
        {rows.map(({ item_type, need, have, enough }) => {
          const seed = encyclopedia_catalog.item(item_type)?.item
          return (
            <button
              className="jobs__ingredient"
              key={item_type}
              onClick={() => open_ingredient(item_type)}
              type="button"
            >
              <JobItemIcon icon={item_type} size={32} />
              <span className="jobs__ingredient-id">
                <span className="jobs__ingredient-name">{seed?.name ?? titleize(item_type)}</span>
                <span className="jobs__ingredient-lvl hud-num">{t('jobs.lv_badge', { level: seed?.level ?? 1 })}</span>
              </span>
              <span className={`jobs__ingredient-amt hud-num ${enough ? 'is-enough' : 'is-short'}`}>
                {have} / {need}
              </span>
            </button>
          )
        })}
      </div>

      <div className="jobs__craft-chance">
        <span className="jobs__craft-chance-label">{t('jobs.craft.starting_chance')}</span>
        <span className="jobs__craft-chance-value hud-num">{success_chance}%</span>
      </div>

      <div className="jobs__craft-bar" data-stackable-output={String(stackable_output)}>
        <fieldset className="jobs__craft-amount" disabled={pending} hidden={!stackable_output}>
          <span className="jobs__craft-amount-label">{t('jobs.craft.amount')}</span>
          <input
            aria-label={t('jobs.craft.amount')}
            className="jobs__craft-input hud-num"
            max={batch_limit}
            min={1}
            onChange={({ currentTarget }) =>
              set_attempts(Math.max(1, Math.min(batch_limit, Math.floor(Number(currentTarget.value)))))
            }
            type="number"
            value={attempts}
          />
          <Button disabled={maximum_attempts < 1} onClick={() => set_attempts(maximum_attempts)} type="button">
            {t('jobs.craft.max')}
          </Button>
        </fieldset>
        <Button
          tone="primary"
          className="jobs__craft-btn"
          disabled={!can_craft}
          onClick={on_craft}
          title={
            !level_ok
              ? t('jobs.craft.requires_level', { job: vocabulary.job(job), required, level })
              : !affordable
                ? t('jobs.craft.not_enough')
                : t('jobs.craft.craft_tooltip', {
                    count: attempts,
                    name: output.name,
                  })
          }
          type="button"
        >
          {pending
            ? t('jobs.craft.crafting')
            : level_ok
              ? t('jobs.craft.craft_button', { count: attempts })
              : t('jobs.craft.locked_level', { level: required })}
        </Button>
      </div>
    </div>
  )
}
