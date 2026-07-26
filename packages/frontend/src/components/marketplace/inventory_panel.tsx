// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Package, Send, Check, X } from 'lucide-react'
import { slugs } from 'virtual:item_catalog'

import { type ItemInfo } from '../../types/chain'
import { use_marketplace_chain, type ListableItem, type ListableCharacter } from '../../stores/marketplace_chain'
import { use_game_state } from '../../game/store.js'
import { get_level } from '../../experience'
import { class_color } from '../../constants/class_colors'
import { ItemSlot } from '../items'
import { ItemSendModal } from '../item_send_modal'
import { type SendItem } from '../../stores/item_send'
import { cosmetic_icon_of } from '../../game/cosmetic_icons.js'
import { group_by_stack_identity } from '../../game/item_classification'

// SELL — RIGHT column. The player's sellable inventory as a grid of cells. STACKABLES are AGGREGATED to ONE cell
// per template (the SUMMED balance, e.g. WOOL ×187) — NEVER one cell per unit (hard law: the old grid drew
// ~50 individual wool cells). Non-stackable gear stays per-object (each is a distinct item, individually listable).
// CHARACTERS are a SUB-CATEGORY inside this same view (DECISIONS 07-09 — "visible among your things, never a
// separate view"): a labelled section of class-swatch cells ABOVE the items, selectable exactly like a cell.
// Clicking anything populates the middle SET-PRICE card via its on_select; listing happens in the card, not here.
//
// SEND MODE (self-contained here — sell_panel is untouched): a "SEND"
// toggle flips the grid into MULTI-SELECT over the RAW per-object items (real object ids — every gift is a
// PurchaseCap per object; the aggregated stackable cells carry a synthetic `stack:` id, so send mode renders the
// raw `listable` instead). A floating "Send (N)" CTA opens the ItemSendModal with the picks. Characters are
// items-only-out-of-scope for gifts (gift.move takes item ids), so they're hidden while sending.

// DEV-only QA/screenshot seam — exposes the marketplace store so a harness can seed a sendable inventory
// (the /v1 read layer isn't always up locally). Statically stripped from the prod build.
if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __mkt?: typeof use_marketplace_chain }).__mkt = use_marketplace_chain

type RosterEquipmentRow = string | { item_id?: unknown; id?: unknown } | null | undefined
type RosterCharacter = {
  equipment?: RosterEquipmentRow[] | null
  worn?: Record<string, RosterEquipmentRow> | null
  // The active companion — its OWN top-level field in the read-model (boot_roster), never an `equipment` row.
  pet?: RosterEquipmentRow
}

function roster_item_id(row: RosterEquipmentRow): string | null {
  if (typeof row === 'string') return row || null
  const id = row?.item_id ?? row?.id
  return typeof id === 'string' && id ? id : null
}

// `/v1/characters` is the equipment UI's wallet-wide source: every roster row carries its equipped Item ids,
// with worn cosmetics additionally keyed under `worn`. Union the WHOLE roster (never only the selected
// character), then defensively remove stale owner-items rows that still name an equipped object.
export function sell_listable_items(
  listable: ListableItem[],
  characters: RosterCharacter[] | null | undefined
): ListableItem[] {
  const equipped_ids = new Set<string>()
  for (const character of characters ?? []) {
    for (const row of character.equipment ?? []) {
      const id = roster_item_id(row)
      if (id) equipped_ids.add(id)
    }
    for (const row of Object.values(character.worn ?? {})) {
      const id = roster_item_id(row)
      if (id) equipped_ids.add(id)
    }
    // The active pet is a single sibling under `pet`, not an equipment row — worn just the same, so it must
    // never surface as sellable — equipped gear/cosmetic/pet must never appear in the sell tab.
    const pet_id = roster_item_id(character.pet)
    if (pet_id) equipped_ids.add(pet_id)
  }
  return equipped_ids.size === 0 ? listable : listable.filter((row) => !equipped_ids.has(row.id))
}

function to_slot_item(it: ListableItem): ItemInfo {
  const template_slug = slugs[it.name]
  const icon_slug = cosmetic_icon_of({ slug: template_slug ?? it.slug, name: it.name }) ?? template_slug ?? it.slug
  return {
    // Object ids remain grouping/transaction truth. Cosmetics use their authored icon; every ordinary item
    // falls through to its indexed item-type slug, which ItemImage resolves through item_icon_url.
    template_id: icon_slug,
    appearance: '',
    quantity: it.quantity,
    rarity: 'common',
  } as unknown as ItemInfo
}

// Group stackables by canonical template (sum quantities) → ONE synthetic ListableItem per template; keep
// every non-stackable per-object. Stackables first (tokens), then gear — both by level for a stable read
// order. THE grouping mechanism is group_by_stack_identity (item_classification.ts) — the HUD bag grid
// consumes the exact same function (issue #10: the two homes used to be able to disagree). The synthetic
// `stack:` id (never a real object id) keeps an aggregated cell from being mistaken for one sendable object.
export function aggregate_listable(listable: ListableItem[]): ListableItem[] {
  const singles = listable.filter((it) => !it.stackable).sort((a, b) => a.level - b.level)
  const grouped = group_by_stack_identity(
    listable.filter((it) => it.stackable),
    'quantity'
  )
    .map((it: ListableItem) => ({ ...it, id: `stack:${it.template_id ?? it.id}` }))
    .sort((a, b) => a.level - b.level)
  return [...grouped, ...singles]
}

const to_send_item = (it: ListableItem): SendItem => {
  const template_slug = slugs[it.name]
  return {
    id: it.id,
    kiosk_id: it.kiosk_id,
    template_id: it.template_id,
    slug: cosmetic_icon_of({ slug: template_slug, name: it.name }) ?? template_slug ?? '',
    name: it.name,
    category: it.category,
    level: it.level,
    amount: it.quantity,
    stackable: it.stackable,
    sources: [{ id: it.id, kiosk_id: it.kiosk_id, amount: it.quantity }],
  }
}

export function InventoryPanel({
  selected_id,
  on_select,
  selected_character_id,
  on_select_character,
}: {
  selected_id: string | null
  on_select: (item: ListableItem) => void
  selected_character_id: string | null
  on_select_character: (character: ListableCharacter) => void
}) {
  const { t } = useTranslation()
  const { listable, listable_loading, listable_characters } = use_marketplace_chain()
  const characters = use_game_state((state) => state.sui.characters)

  const sell_listable = useMemo(() => sell_listable_items(listable, characters), [characters, listable])
  const items = useMemo(() => aggregate_listable(sell_listable), [sell_listable])
  // Raw per-object items, level-ordered — the SEND-mode grid (each cell = one giftable object).
  const sendable = useMemo(() => [...sell_listable].sort((a, b) => a.level - b.level), [sell_listable])

  const [send_mode, set_send_mode] = useState(false)
  const [picked, set_picked] = useState<Set<string>>(new Set())
  const [modal_open, set_modal_open] = useState(false)

  const picked_items = useMemo(() => sendable.filter((i) => picked.has(i.id)).map(to_send_item), [sendable, picked])

  const toggle_pick = (id: string) =>
    set_picked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exit_send = () => {
    set_send_mode(false)
    set_picked(new Set())
  }

  const empty = items.length === 0 && listable_characters.length === 0

  return (
    <div className="flex flex-col min-h-0 lg:overflow-hidden">
      <div className="px-4 pt-3 pb-2 shrink-0 flex items-center justify-between gap-2">
        <span className="text-[10px] tracking-[0.25em] uppercase font-semibold text-gold">
          {send_mode ? t('gift.send.pick_title') : t('marketplace.tab_inventory')}
        </span>
        {send_mode ? (
          <button
            type="button"
            onClick={exit_send}
            className="flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase text-muted hover:text-text cursor-pointer transition-colors"
          >
            <X size={11} /> {t('common.cancel')}
          </button>
        ) : (
          sendable.length > 0 && (
            <button
              type="button"
              onClick={() => set_send_mode(true)}
              className="flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase text-cyan/80 hover:text-cyan border border-cyan/25 hover:border-cyan/50 px-2 py-1 cursor-pointer transition-all"
            >
              <Send size={10} /> {t('gift.send.send_items')}
            </button>
          )
        )}
      </div>

      {listable_loading ? (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 size={13} className="animate-spin text-gold opacity-40" />
          <span className="text-[9px] tracking-[0.2em] uppercase text-muted animate-pulse">{t('common.loading')}</span>
        </div>
      ) : empty ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center text-muted">
          <Package size={18} style={{ opacity: 0.2 }} />
          <span className="text-[9px] tracking-[0.15em] uppercase">{t('marketplace.empty_inventory')}</span>
        </div>
      ) : send_mode ? (
        // ── SEND MODE — multi-select over raw per-object items ──
        <div className="flex flex-col min-h-0 lg:overflow-hidden">
          <div className="flex flex-col px-4 pb-4 lg:overflow-y-auto">
            <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, 48px)' }}>
              {sendable.map((it) => {
                const is_picked = picked.has(it.id)
                return (
                  <div key={it.id} className="relative">
                    <ItemSlot item={to_slot_item(it)} selected={is_picked} on_click={() => toggle_pick(it.id)} />
                    {is_picked && (
                      <span
                        className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-cyan text-bg pointer-events-none"
                        aria-hidden
                      >
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {/* Floating SEND (N) CTA */}
          <div className="shrink-0 px-4 py-3 border-t border-border bg-surface/80 flex items-center gap-3">
            <span className="text-[9px] tracking-[0.15em] uppercase text-muted flex-1">
              {t('gift.send.selected_count', { count: picked.size })}
            </span>
            <button
              type="button"
              disabled={picked.size === 0}
              onClick={() => set_modal_open(true)}
              className="btn-gold px-4 py-2 text-[10px] tracking-[0.2em] uppercase inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={11} />
              {t('gift.send.send_n', { count: picked.size })}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col px-4 pb-4 lg:overflow-y-auto">
          {listable_characters.length > 0 && (
            <>
              <div className="text-[8px] tracking-[0.16em] uppercase text-muted mb-1.5">
                {t('marketplace.section_characters')}
              </div>
              <div className="grid gap-1 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, 48px)' }}>
                {listable_characters.map((c) => {
                  const color = class_color(c.classe)
                  const is_selected = selected_character_id === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => on_select_character(c)}
                      title={`${c.name} · Lv. ${get_level(c.experience)} ${c.classe}`}
                      className="flex flex-col items-center justify-center border cursor-pointer transition-all"
                      style={{
                        width: 48,
                        height: 48,
                        borderColor: is_selected ? '#c8963c' : `${color}55`,
                        background: is_selected ? 'rgba(200,150,60,0.12)' : `${color}1a`,
                        boxShadow: is_selected ? '0 0 14px rgba(200,150,60,0.25)' : 'none',
                      }}
                    >
                      <span className="text-[9px] uppercase font-semibold" style={{ color }}>
                        {(c.classe || '?').slice(0, 2)}
                      </span>
                      <span className="text-[7px] text-muted tabular-nums">Lv.{get_level(c.experience)}</span>
                    </button>
                  )
                })}
              </div>
              <div className="text-[8px] tracking-[0.16em] uppercase text-muted mb-1.5">
                {t('marketplace.section_items')}
              </div>
            </>
          )}
          <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fill, 48px)' }}>
            {items.map((it) => (
              <ItemSlot
                key={it.id}
                item={to_slot_item(it)}
                selected={selected_id === it.id}
                on_click={() => on_select(it)}
              />
            ))}
          </div>
        </div>
      )}

      {modal_open && (
        <ItemSendModal
          items={picked_items}
          on_close={() => {
            set_modal_open(false)
            exit_send()
          }}
        />
      )}
    </div>
  )
}
