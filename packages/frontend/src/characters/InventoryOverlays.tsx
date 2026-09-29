// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The bag's item actions: the right-click context menu (feed / consume / crush / destroy)
// and its modals. Every action composes ONE SDK transaction and folds the proven receipt
// through the session reducer. The grind-safe claims a box open or a crush lands are settled
// by the SILENT claimer (modules/claims.ts); the receipt and item stream reunite in the
// crush-result modal.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ItemRow } from '@aresrpg/protocol'
import { BookOpen, Cat, ExternalLink, Gift, Hammer, Loader2, MessageSquarePlus, Trash2 } from 'lucide-react'
import { Button, GameWindow, NativeModal } from '@aresrpg/ui'

import { ContextMenu } from '../components/ContextMenu.tsx'
import { env } from '../env.ts'
import { encyclopedia_item_path } from '../encyclopedia/routes.ts'
import { explorer_object_url } from '../explorer.ts'
import { encyclopedia_catalog } from '../content/catalog.ts'
import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { encumbered_asset_ids, stack_merge_sources } from '../inventory_stacks.ts'
import { dispatch_app, read_app_state, useAppStore } from '../store.ts'
import { toast } from '../toast.ts'
import { crush_results } from '../crush_result.ts'
import { run_direct_transaction } from '../transaction_guard.ts'

import { is_forge_gear } from './forge_eligibility.ts'
import { InventoryItemCell } from './InventoryItemCell.tsx'
import { crush_selection, crush_blocked_ids } from './inventory_selection.ts'
import { UseBoxModal } from './UseBoxModal.tsx'
import { FeedPetModal } from './FeedPetModal.tsx'

export type ItemMenuState = Readonly<{
  x: number
  y: number
  item: ItemRow
  items: readonly Readonly<ItemRow>[]
}> | null

export const is_loot_box = (item: Readonly<Pick<ItemRow, 'item_type'>>): boolean =>
  encyclopedia_catalog.item(item.item_type)?.item.consumable?.type === 'loot_box'

const is_feedable_pet = (item: Readonly<ItemRow>): boolean =>
  item.category === 'pet' && (encyclopedia_catalog.item(item.item_type)?.item.pet_foods?.length ?? 0) > 0

const ConfirmModal = ({
  title,
  body,
  cta,
  busy,
  copy,
  confirm,
  close,
  children,
  disabled = false,
}: Readonly<{
  title: string
  body: string
  cta: string
  busy: boolean
  copy: AppCopy
  confirm: () => void
  close: () => void
  children?: ReactNode
  disabled?: boolean
}>) => (
  <NativeModal close={busy ? null : close} label={title} className="aui-modal-scrim">
    <GameWindow title={title} close={close} close_label={copy.wallet_close} className="aui-item-confirm">
      <div className="flex flex-col gap-4 p-6">
        <p className="text-[10px] leading-6 text-text">{body}</p>
        {children}
        <div className="flex justify-end gap-2">
          <Button disabled={busy} onClick={close}>
            {copy_text(copy.characters_page)('cancel')}
          </Button>
          <Button tone="danger" disabled={busy || disabled} onClick={confirm} type="button">
            {busy ? <Loader2 className="inline animate-spin" size={11} /> : cta}
          </Button>
        </div>
      </div>
    </GameWindow>
  </NativeModal>
)

const CrushConfirm = ({
  copy,
  items,
  busy,
  available,
  disabled,
  close,
  confirm,
}: Readonly<{
  copy: AppCopy
  items: readonly Readonly<ItemRow>[]
  busy: boolean
  available: boolean
  disabled: boolean
  close: () => void
  confirm: () => void
}>) => {
  const t = copy_text(copy.characters_page)
  return (
    <ConfirmModal
      body={t('crush_confirm_selection', { count: items.length })}
      busy={busy}
      close={close}
      confirm={confirm}
      copy={copy}
      cta={t('crush_cta_count', { count: items.length })}
      disabled={!available || disabled}
      title={t('crush_title')}
    >
      <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto" data-crush-selection>
        {items.map((item) => (
          <li className="flex items-center gap-3 text-xs" key={item.id} data-crush-item={item.id}>
            <InventoryItemCell disabled item={item} />
            <span className="min-w-0 flex-1 break-words">{item.name}</span>
            <span>{copy_text(copy.encyclopedia_page)('level_short', { level: item.level })}</span>
          </li>
        ))}
      </ul>
      {!available && (
        <p className="text-xs text-red-400" role="alert">
          {t('crush_selection_changed')}
        </p>
      )}
    </ConfirmModal>
  )
}

export type InventoryMenuEntry = Readonly<{
  key: string
  Icon: typeof Cat
  label: string
  act: () => void
  disabled?: boolean
}>
type ItemActionSelection = Pick<Exclude<ItemMenuState, null>, 'item' | 'items'> | null

export const inventory_action_selection = (
  item: Readonly<ItemRow> | undefined,
  selected: readonly ItemRow[]
): ItemActionSelection => {
  if (!item) return null
  return { item, items: selected.some(({ id }) => id === item.id) ? selected : [item] }
}

export const InventoryMenuRows = ({
  copy,
  menu,
  close_menu,
  entries,
}: Readonly<{
  copy: AppCopy
  menu: Exclude<ItemMenuState, null>
  close_menu: () => void
  entries: readonly InventoryMenuEntry[]
}>) => {
  const t = copy_text(copy.characters_page)
  const recipe_path = encyclopedia_item_path(menu.item.item_type)
  return (
    <>
      {menu.items.length === 1 && (
        <>
          <a
            className="flex items-center gap-2.5 px-3.5 py-2 text-left text-[9px] tracking-[0.16em] text-text uppercase hover:bg-gold/10 hover:text-gold"
            href={recipe_path}
            onClick={(event) => {
              event.preventDefault()
              close_menu()
              dispatch_app({ type: 'path/open', pathname: recipe_path })
            }}
          >
            <BookOpen className="opacity-60" size={11} />
            {t('menu_view_recipes')}
          </a>
          <a
            className="flex items-center gap-2.5 px-3.5 py-2 text-left text-[9px] tracking-[0.16em] text-text uppercase hover:bg-gold/10 hover:text-gold"
            href={explorer_object_url(env.network, menu.item.id)}
            onClick={close_menu}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink className="opacity-60" size={11} />
            {t('menu_explorer')}
          </a>
          <button
            className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-[9px] tracking-[0.16em] text-text uppercase hover:bg-gold/10 hover:text-gold"
            onClick={() => {
              close_menu()
              dispatch_app({ type: 'chat/link_item', item: { id: menu.item.id, name: menu.item.name } })
            }}
            type="button"
          >
            <MessageSquarePlus className="opacity-60" size={11} />
            {t('menu_link_chat')}
          </button>
        </>
      )}
      {entries.map(({ key, Icon, label, act, disabled }) => (
        <button
          className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-[9px] tracking-[0.16em] text-text uppercase hover:bg-gold/10 hover:text-gold"
          key={key}
          disabled={disabled}
          onClick={() => {
            close_menu()
            act()
          }}
          type="button"
        >
          <Icon className="opacity-60" size={11} />
          {label}
        </button>
      ))}
    </>
  )
}

export const InventoryMenu = (props: Parameters<typeof InventoryMenuRows>[0]) => (
  <ContextMenu x={props.menu.x} y={props.menu.y}>
    <InventoryMenuRows {...props} />
  </ContextMenu>
)

const inventory_action_entries = (
  menu: ItemActionSelection,
  blocked: ReadonlySet<string>,
  t: CopyText,
  can_write: boolean,
  actions: Readonly<{
    feed: (item: Readonly<ItemRow>) => void
    consume: (item: Readonly<ItemRow>) => void
    crush: (items: readonly Readonly<ItemRow>[]) => void
    destroy: (item: Readonly<ItemRow>) => void
  }>
): readonly InventoryMenuEntry[] => {
  if (!menu) return []
  const single = menu.items.length === 1 && !blocked.has(menu.item.id)
  return [
    {
      key: 'feed',
      disabled: !can_write,
      Icon: Cat,
      label: t('menu_feed'),
      visible: single && is_feedable_pet(menu.item),
      act: () => actions.feed(menu.item),
    },
    {
      key: 'consume',
      disabled: !can_write,
      Icon: Gift,
      label: t('menu_consume'),
      visible: single && is_loot_box(menu.item),
      act: () => actions.consume(menu.item),
    },
    {
      key: 'crush',
      Icon: Hammer,
      label: t('crush_cta_count', { count: menu.items.length }),
      visible: menu.items.every((item) => is_forge_gear(item) && !blocked.has(item.id)),
      act: () => actions.crush(menu.items),
    },
    { key: 'destroy', Icon: Trash2, label: t('menu_destroy'), visible: single, act: () => actions.destroy(menu.item) },
  ].filter(({ visible }) => visible)
}

/** One controller owns detail/context actions, confirmations, and receipt-driven updates. */
export const useInventoryActions = ({
  copy,
  menu,
  close_menu,
  reveal_box,
  set_reveal_box,
  detail = null,
  inventory_override,
}: Readonly<{
  copy: AppCopy
  menu: ItemMenuState
  detail?: ItemActionSelection
  inventory_override?: readonly ItemRow[]
  close_menu: () => void
  reveal_box: ItemRow | null
  set_reveal_box: (box: Readonly<ItemRow> | null) => void
}>) => {
  const t = copy_text(copy.characters_page)
  const wallet = useAppStore(({ session }) => session.wallet)
  const stored_inventory = useAppStore(({ session }) => session.inventory)
  const inventory = inventory_override ?? stored_inventory
  const can_write = !!wallet && inventory_override === undefined
  const listings = useAppStore(({ marketplace }) => marketplace.own_listings)
  const trades = useAppStore(({ trade }) => trade.rows)
  const [feed_pet, set_feed_pet] = useState<ItemRow | null>(null)
  const [crush_target, set_crush_target] = useState<readonly Readonly<ItemRow>[] | null>(null)
  const characters = useAppStore(({ session }) => session.characters)
  const blocked = crush_blocked_ids({ listings, trades, characters })
  const [destroy_target, set_destroy_target] = useState<ItemRow | null>(null)
  const [busy, set_busy] = useState(false)

  useEffect(() => {
    if (!menu) return
    globalThis.addEventListener('click', close_menu)
    return () => globalThis.removeEventListener('click', close_menu)
  }, [menu, close_menu])

  const listed = useMemo(() => encumbered_asset_ids(listings, trades), [listings, trades])

  const crush = (items: readonly Readonly<ItemRow>[]): void => {
    if (!can_write || !wallet || busy || items.length === 0) return
    const transaction = run_direct_transaction(() => {
      const state = read_app_state()
      const available = crush_selection(
        items,
        state.session.inventory,
        crush_blocked_ids({
          listings: state.marketplace.own_listings,
          trades: state.trade.rows,
          characters: state.session.characters,
        })
      )
      if (state.session.wallet !== wallet || !available) throw new Error(t('crush_selection_changed'))
      return wallet.character.crush_gear({
        gear_ids: available.map(({ id }) => id),
        custody: { kiosk: available[0]!.kiosk },
      })
    })
    if (!transaction) return
    set_crush_target(null)
    crush_results.start(items)
    set_busy(true)
    void transaction
      .then(({ claim_id }) => {
        if (read_app_state().session.wallet !== wallet) return
        dispatch_app({ type: 'inventory/gear_crushed', gear_ids: items.map(({ id }) => id), claim_id })
      })
      .catch((error) => {
        console.error('Crushing failed', error)
        if (read_app_state().session.wallet === wallet) crush_results.fail(error)
      })
      .finally(() => set_busy(false))
  }

  const destroy = (item: Readonly<ItemRow>): void => {
    if (!can_write || !wallet || busy) return
    const transaction = run_direct_transaction(() =>
      wallet.character.destroy_item({
        item_id: item.id,
        amount: item.amount,
        merge_sources: stack_merge_sources(inventory, listed, item),
        custody: { kiosk: item.kiosk },
      })
    )
    if (!transaction) return
    set_busy(true)
    const pending = toast.loading(t('destroy_pending'))
    void transaction
      .then(({ inventory_changes }) => {
        dispatch_app({ type: 'inventory/amounts_changed', changes: inventory_changes })
        set_destroy_target(null)
        pending.success(t('destroy_success'))
      })
      .catch(pending.error)
      .finally(() => set_busy(false))
  }

  const actions = {
    feed: set_feed_pet,
    consume: set_reveal_box,
    crush: set_crush_target,
    destroy: set_destroy_target,
  }
  const entries = inventory_action_entries(menu, blocked, t, can_write, actions)
  const detail_entries = inventory_action_entries(detail, blocked, t, can_write, actions)

  const overlays = (
    <>
      {menu && <InventoryMenu close_menu={close_menu} copy={copy} entries={entries} menu={menu} />}
      {feed_pet && <FeedPetModal close={() => set_feed_pet(null)} copy={copy} pet={feed_pet} />}
      {reveal_box && <UseBoxModal box={reveal_box} close={() => set_reveal_box(null)} copy={copy} />}
      {crush_target && (
        <CrushConfirm
          copy={copy}
          items={crush_target}
          busy={busy}
          available={Boolean(crush_selection(crush_target, inventory, blocked))}
          disabled={!can_write}
          close={() => set_crush_target(null)}
          confirm={() => crush(crush_target)}
        />
      )}
      {destroy_target && (
        <ConfirmModal
          body={t('destroy_confirm_body', { name: destroy_target.name, amount: destroy_target.amount })}
          busy={busy}
          close={() => set_destroy_target(null)}
          confirm={() => destroy(destroy_target)}
          copy={copy}
          disabled={!can_write}
          cta={t('destroy_cta')}
          title={t('destroy_title')}
        />
      )}
    </>
  )
  return { detail_entries, overlays }
}

export const InventoryActionOverlays = (props: Parameters<typeof useInventoryActions>[0]) =>
  useInventoryActions(props).overlays
