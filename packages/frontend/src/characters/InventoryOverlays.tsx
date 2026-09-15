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

import { ModalFrame } from '../components/ModalFrame.tsx'
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
import { BoxReveal } from './BoxReveal.tsx'
import { FeedPetModal } from './FeedPetModal.tsx'

export type ItemMenuState = Readonly<{
  x: number
  y: number
  item: ItemRow
  items: readonly Readonly<ItemRow>[]
}> | null

export const is_loot_box = (item: Readonly<ItemRow>): boolean =>
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
  soft = false,
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
  soft?: boolean
  children?: ReactNode
  disabled?: boolean
}>) => (
  <ModalFrame close={close} close_label={copy.wallet_close} label={title} soft={soft}>
    <div className="flex flex-col gap-4 p-6">
      <p className="text-[10px] tracking-[0.22em] text-gold uppercase">{title}</p>
      <p className="text-[10px] leading-6 text-text">{body}</p>
      {children}
      <div className="flex justify-end gap-2">
        <button className="btn-outline chr-btn" disabled={busy} onClick={close} type="button">
          {copy_text(copy.characters_page)('cancel')}
        </button>
        <button
          className="chr-btn cursor-pointer border border-[#ff496c]/60 bg-[#ff496c]/10 text-[#ff7d94] hover:border-[#ff496c]"
          disabled={busy || disabled}
          onClick={confirm}
          type="button"
        >
          {busy ? <Loader2 className="inline animate-spin" size={11} /> : cta}
        </button>
      </div>
    </div>
  </ModalFrame>
)

const CrushConfirm = ({
  copy,
  items,
  busy,
  available,
  close,
  confirm,
}: Readonly<{
  copy: AppCopy
  items: readonly Readonly<ItemRow>[]
  busy: boolean
  available: boolean
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
      disabled={!available}
      soft
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

type InventoryMenuEntry = Readonly<{ key: string; Icon: typeof Cat; label: string; act: () => void }>

export const InventoryMenu = ({
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
    <div
      className="fixed z-[60] flex min-w-[150px] flex-col border border-border bg-surface-low shadow-[0_14px_40px_rgba(0,0,0,0.6)]"
      style={{
        left: Math.min(menu.x, globalThis.innerWidth - 170),
        top: Math.min(menu.y, globalThis.innerHeight - (entries.length + 3) * 34 - 10),
      }}
    >
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
      {entries.map(({ key, Icon, label, act }) => (
        <button
          className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-[9px] tracking-[0.16em] text-text uppercase hover:bg-gold/10 hover:text-gold"
          key={key}
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
    </div>
  )
}

const inventory_menu_entries = (
  menu: ItemMenuState,
  blocked: ReadonlySet<string>,
  t: CopyText,
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
      Icon: Cat,
      label: t('menu_feed'),
      visible: single && is_feedable_pet(menu.item),
      act: () => actions.feed(menu.item),
    },
    {
      key: 'consume',
      Icon: Gift,
      label: t('menu_consume'),
      visible: single && is_loot_box(menu.item),
      act: () => actions.consume(menu.item),
    },
    {
      key: 'crush',
      Icon: Hammer,
      label: t('crush_cta_count', { count: menu.items.length }),
      visible: menu.items.every(is_forge_gear),
      act: () => actions.crush(menu.items),
    },
    { key: 'destroy', Icon: Trash2, label: t('menu_destroy'), visible: single, act: () => actions.destroy(menu.item) },
  ].filter(({ visible }) => visible)
}

/** The bag's right-click surface: menu + every modal + the transactions they fire. */
export const InventoryActionOverlays = ({
  copy,
  menu,
  close_menu,
  reveal_box,
  set_reveal_box,
}: Readonly<{
  copy: AppCopy
  menu: ItemMenuState
  close_menu: () => void
  reveal_box: ItemRow | null
  set_reveal_box: (box: Readonly<ItemRow> | null) => void
}>) => {
  const t = copy_text(copy.characters_page)
  const wallet = useAppStore(({ session }) => session.wallet)
  const inventory = useAppStore(({ session }) => session.inventory)
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
    if (!wallet || busy || items.length === 0) return
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
    if (!wallet || busy) return
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

  const entries = inventory_menu_entries(menu, blocked, t, {
    feed: set_feed_pet,
    consume: set_reveal_box,
    crush: set_crush_target,
    destroy: set_destroy_target,
  })

  return (
    <>
      {menu && <InventoryMenu close_menu={close_menu} copy={copy} entries={entries} menu={menu} />}
      {feed_pet && <FeedPetModal close={() => set_feed_pet(null)} copy={copy} pet={feed_pet} />}
      {reveal_box && <BoxReveal box={reveal_box} close={() => set_reveal_box(null)} copy={copy} />}
      {crush_target && (
        <CrushConfirm
          copy={copy}
          items={crush_target}
          busy={busy}
          available={Boolean(crush_selection(crush_target, inventory, blocked))}
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
          cta={t('destroy_cta')}
          title={t('destroy_title')}
        />
      )}
    </>
  )
}
