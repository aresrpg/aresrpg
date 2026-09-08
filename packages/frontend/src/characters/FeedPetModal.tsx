// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useMemo, useReducer } from 'react'
import type { ItemRow } from '@aresrpg/protocol'
import { Heart, Loader2, Utensils } from 'lucide-react'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { play_fight_audio, preload_fight_audio } from '../game/audio/fight_audio_registry.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import {
  available_inventory_items,
  encumbered_asset_ids,
  inventory_groups,
  stack_merge_sources,
} from '../inventory_stacks.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import { InventoryItemCell } from './InventoryItemCell.tsx'
import { PetPower } from './PetPower.tsx'
import { PetFeedingStage } from './PetFeedingStage.tsx'
import { FEEDING_ANIMATION, feeding_gate, initial_feeding, reduce_feeding, type FeedingState } from './pet_feeding.ts'

import './pet_feeding.css'

const FeedingControls = ({
  state,
  foods,
  selected,
  gate,
  connected,
  pet_name,
  text,
  select,
  confirm,
  close,
}: Readonly<{
  state: FeedingState
  foods: ReturnType<typeof inventory_groups>
  selected: Readonly<ItemRow> | undefined
  gate: string | null
  connected: boolean
  pet_name: string
  text: CopyText
  select: (id: string) => void
  confirm: () => void
  close: () => void
}>) => {
  const view = {
    selecting: 'selecting',
    pending: 'pending',
    throwing: 'pending',
    celebrating: 'happy',
    done: 'happy',
  } as const
  const mode = view[state.phase]
  const selection_note = selected
    ? text('feed_consumes', { name: selected.name })
    : text(foods.length ? 'feed_daily_note' : 'feed_no_food')
  const feedback = {
    selecting: gate ? text(gate) : selection_note,
    pending: text('feed_pending'),
    happy: text('feed_happy', { name: pet_name }),
  }[mode]
  const action = {
    selecting: { label: text('feed_confirm'), disabled: !selected || !connected || gate !== null, run: confirm },
    pending: { label: text('feed_pending'), disabled: true, run: confirm },
    happy: { label: text('continue_cta'), disabled: false, run: close },
  }[mode]
  return (
    <>
      <div className="min-h-32">
        {mode === 'selecting' && !gate && (
          <>
            <p className="mb-3 text-[9px] tracking-[0.12em] text-muted uppercase">{text('feed_pick_food')}</p>
            <div className="flex flex-wrap justify-center gap-2" data-feed-foods="">
              {foods.map(({ item, amount }) => (
                <InventoryItemCell
                  class_name={`size-14 shrink-0 ${item.id === state.selected_id ? 'is-selected' : ''}`}
                  item={item}
                  amount={amount}
                  key={item.id}
                  aria-pressed={item.id === state.selected_id}
                  onClick={() => select(item.id)}
                />
              ))}
            </div>
          </>
        )}
        <div className="mt-3 flex flex-col items-center gap-2 text-center" role="status">
          {mode === 'pending' && <Loader2 size={18} className="animate-spin text-gold" />}
          {mode === 'happy' && <Heart size={18} className="text-rose-300" fill="currentColor" />}
          <p className="text-[10px] leading-5 text-muted">{feedback}</p>
          {mode === 'happy' && <p className="text-[10px] text-gold">{text('feed_gain')}</p>}
        </div>
      </div>
      {state.error && (
        <p className="text-center text-[10px] text-rose-300" role="alert">
          {state.error}
        </p>
      )}
      <button
        type="button"
        className="btn-gold flex min-h-11 items-center justify-center gap-2 px-4 text-[10px] disabled:opacity-40"
        disabled={action.disabled}
        onClick={action.run}
      >
        <Utensils size={13} />
        {action.label}
      </button>
    </>
  )
}

export const FeedPetModal = ({
  pet,
  copy,
  close,
}: Readonly<{ pet: Readonly<ItemRow>; copy: AppCopy; close: () => void }>) => {
  const t = copy_text(copy.characters_page)
  const wallet = useAppStore(({ session }) => session.wallet)
  const inventory = useAppStore(({ session }) => session.inventory)
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const [state, dispatch] = useReducer(reduce_feeding, initial_feeding)
  const live = inventory.find(({ id }) => id === pet.id)
  const diet = encyclopedia_catalog.item(pet.item_type)?.item.pet_foods ?? []
  const encumbered = useMemo(() => encumbered_asset_ids(listings, trades), [listings, trades])
  const foods = inventory_groups(
    available_inventory_items(inventory, encumbered, pet.kiosk).filter((row) => diet.includes(row.item_type))
  )
  const selected = foods.find(({ item }) => item.id === state.selected_id)?.item
  const gate = feeding_gate(live, encumbered.has(pet.id), Math.floor(Date.now() / 86_400_000))
  const choosing = state.phase === 'selecting'

  useEffect(() => {
    preload_fight_audio(Object.values(FEEDING_ANIMATION).map(({ sound }) => sound))
  }, [])
  useEffect(() => {
    if (state.phase !== 'throwing' && state.phase !== 'celebrating') return
    const step = FEEDING_ANIMATION[state.phase]
    play_fight_audio(step.sound, 0.28)
    const reduced = globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = setTimeout(() => dispatch({ type: step.input }), reduced ? 0 : step.duration)
    return () => clearTimeout(timer)
  }, [state.phase])

  const confirm = (): void => {
    if (!wallet || !selected || !choosing || gate) return
    const food = selected
    const transaction = run_direct_transaction(() =>
      wallet.character.feed_pet({
        pet_id: pet.id,
        pet_item_type: pet.item_type,
        food_id: food.id,
        merge_sources: stack_merge_sources(inventory, encumbered, food),
        custody: { kiosk: pet.kiosk },
      })
    )
    if (!transaction) return
    dispatch({ type: 'confirm', food: { id: food.id, item_type: food.item_type, name: food.name } })
    const pending = toast.loading(t('feed_pending'))
    void transaction
      .then(({ inventory_changes }) => {
        dispatch_app({ type: 'inventory/amounts_changed', changes: inventory_changes })
        dispatch_app({ type: 'inventory/pet_fed', pet_id: pet.id, food_id: food.id })
        dispatch({ type: 'succeeded' })
        pending.success(t('feed_success'))
      })
      .catch((error: unknown) => {
        console.error('Pet feeding failed.', error)
        dispatch({ type: 'failed', error: error instanceof Error ? error.message : String(error) })
        pending.error(error)
      })
  }

  return (
    <ModalFrame close={close} close_label={copy.wallet_close} label={t('feed_title')} max_width="max-w-md" soft>
      <div className="pet-feed flex flex-col gap-4 p-6" data-pet-feeding="" data-phase={state.phase}>
        <header className="pr-6">
          <p className="text-[8px] tracking-[0.24em] text-gold uppercase">{t('feed_title')}</p>
          <h2 className="mt-2 text-lg font-semibold tracking-wide text-text">{pet.name}</h2>
        </header>
        <PetFeedingStage pet={live ?? pet} food={state.food ?? selected ?? null} phase={state.phase} />
        <PetPower item={live ?? pet} text={t} />
        <FeedingControls
          state={state}
          foods={foods}
          selected={selected}
          gate={gate}
          connected={wallet !== null}
          pet_name={pet.name}
          text={t}
          select={(food_id) => {
            dispatch({ type: 'select', food_id })
            play_fight_audio('menu_carousel', 0.15)
          }}
          confirm={confirm}
          close={close}
        />
      </div>
    </ModalFrame>
  )
}
