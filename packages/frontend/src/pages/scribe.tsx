// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PenTool, Loader2, Sparkles, Gem, Swords, Plus, X } from 'lucide-react'

import { use_auth } from '../auth'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { use_game_state } from '../game/store.js'
import { get_sdk } from '../chain/sdk'
import { kiosk_for_character } from '../world-shell/kiosk_resolve.js'
import { load_roster } from '../roster/load_roster.js'
import { get_template_by_item_type_map } from '../chain/read_findables.js'
import { ItemDetailView } from '../components/item_detail_view'
import { use_template_t } from '../i18n/template_t'
import { ItemIcon } from '../game/screens/hud/ItemIcon.jsx'
import { is_forge_gear, is_rune } from '../components/forge_eligibility'
import { CrushMenu, type CrushTarget } from '../components/crush_menu'
import { ItemSendModal } from '../components/item_send_modal'
import { project_inventory_send_item, type send_item } from '../stores/item_send_model'
import { scribe_rune } from '../world-shell/scribe_actions'

import { scribe_detail_props, type Item } from './scribe_detail'

// THE RUNEFORGE — a THREE-PANEL WORKBENCH, not a card stack: LEFT the item detail
// (the SAME shared ItemDetailView every item surface renders — one home), CENTER the work surface where you
// place THE gear + a rune and apply, RIGHT the inventory (gear + runes) you pick from. Crush is no longer a
// section here — it moved to a right-click item action (crush_menu.tsx), available on any gear cell.
//
// ZERO-FETCH (indexer only, no load time): gear + runes + the character all read
// from the ALREADY-LOADED engine store (`s.sui.items` / `s.sui.characters`) — the SAME source the Equipment
// tab renders. The ONLY chain touch is at APPLY time (kiosk_for_character resolves the kiosk + cap for the
// tx, the exact seam Equipment uses on "Accept") and a one-shot template read for the left detail. The
// outcome is RANDOM (the on-chain forgemagie::apply_rune roll) — no success percentage is ever shown
// (honest-data law). Always mounted scoped to the selected character, so there is no character picker.

const CARD_BG = { background: 'linear-gradient(160deg, rgba(200,150,60,0.03) 0%, transparent 55%)' }

export function ScribePage({ character_id = null }: { character_id?: string | null } = {}) {
  const { t } = useTranslation()
  const tt = use_template_t()
  const address = use_auth((s) => s.address)
  // SSOT reads — the engine-store slices the Equipment tab already renders. No effect, no fetch, no spinner
  // on open: the workbench paints instantly and repaints reactively when a tx refresh lands.
  const items = use_game_state((s: any) => s.sui.items)
  const characters = use_game_state((s: any) => s.sui.characters)

  const [gear_id, set_gear_id] = useState<string | null>(null)
  const [rune_id, set_rune_id] = useState<string | null>(null)
  const [busy, set_busy] = useState(false)
  const [tab, set_tab] = useState<'gear' | 'runes'>('gear')
  // The one-shot template map (item_type → template) that resolves the LEFT detail into the shared
  // ItemDetailView shape — the SAME chain-direct lookup the inventory hover tooltip uses.
  const [template_map, set_template_map] = useState<Map<string, any>>(() => new Map())
  // Crush right-click affordance (moved OFF the page into an item action). `crush_menu` = the popover anchor;
  // `crush_confirm` = the gear pending the confirm modal (lifted so CrushMenu stays mounted while it's open).
  const [crush_menu, set_crush_menu] = useState<CrushTarget>(null)
  const [crush_confirm, set_crush_confirm] = useState<any>(null)
  const [send_item, set_send_item] = useState<send_item | null>(null)

  useEffect(() => {
    let alive = true
    get_template_by_item_type_map()
      .then((m) => alive && set_template_map(m))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const gear = useMemo<Item[]>(() => (Array.isArray(items) ? items : []).filter(is_forge_gear), [items])
  const runes = useMemo<Item[]>(() => (Array.isArray(items) ? items : []).filter(is_rune), [items])
  const as_char = useMemo<{ id: string } | null>(
    () => (Array.isArray(characters) ? characters : []).find((c: { id: string }) => c.id === character_id) ?? null,
    [characters, character_id]
  )

  const sel_gear = useMemo(() => gear.find((g) => g.id === gear_id) ?? null, [gear, gear_id])
  const sel_rune = useMemo(() => runes.find((r) => r.id === rune_id) ?? null, [runes, rune_id])
  const can_apply = !!as_char && !!sel_gear && !!sel_rune && !busy

  // The selected gear's REAL rolled stats (prod regression: the card rendered an empty CHARACTERISTICS
  // block — the template catalog's statsJson is a deliberate '{}', read_findables.js:43-44). One chain-direct
  // DF read per selection change via the SAME sdk.get_rolled_stats(item.id) crush already uses for this exact
  // gear (world-shell/crush_actions.js) — see scribe_detail.ts for the full diagnosis. Resets to null the
  // instant the selection changes, so a slow read never paints a stale item's stats onto a freshly-picked one.
  const [gear_stats, set_gear_stats] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let alive = true
    set_gear_stats(null)
    if (!sel_gear) return
    get_sdk()
      .then((sdk) => sdk.get_rolled_stats(sel_gear.id))
      .then((stats: any) => alive && set_gear_stats(stats ?? null))
      .catch(() => alive && set_gear_stats(null))
    return () => {
      alive = false
    }
  }, [sel_gear?.id])

  // LEFT detail — see scribe_detail.ts. null until a gear is picked or the template map is still loading
  // (honest empty, never fabricated). tt is a fresh identity each render (it reads the live language at call
  // time) — including it keeps the memo honest and re-resolves the description on language / catalog changes.
  const detail_props = useMemo(
    () => scribe_detail_props(sel_gear, template_map, gear_stats, tt),
    [sel_gear, template_map, gear_stats, tt]
  )

  async function do_scribe() {
    if (!address || !as_char || !sel_gear || !sel_rune) return
    set_busy(true)
    try {
      // The ONE chain touch, only on an explicit Apply: resolve the character's kiosk + personal cap the SAME
      // way Equipment does on Accept (derive-from-character, never a first-cap scan). A miss → honest toast.
      const sdk = await get_sdk()
      const handle = await kiosk_for_character(sdk, address, as_char.id)
      if (!handle) return void use_toast.getState().add(i18n.t('scribe.no_kiosk'), 'error')
      // The PTB needs the on-chain ItemTemplate OBJECT ids — item_type is the SLUG (the template map is the
      // slug→template home; passing the slug raw fails at dry-run with an invalid-object error).
      const gear_tmpl = template_map.get(sel_gear.item_type)
      const rune_tmpl = template_map.get(sel_rune.item_type)
      if (!gear_tmpl?.id || !rune_tmpl?.id) return void use_toast.getState().add(i18n.t('scribe.no_kiosk'), 'error')
      await use_toast.getState().promise(
        scribe_rune({
          kiosk_id: handle.kiosk_id,
          personal_kiosk_cap_id: handle.personal_kiosk_cap_id,
          character_id: as_char.id,
          gear_item_id: sel_gear.id,
          gear_template_id: gear_tmpl.id,
          rune_item_id: sel_rune.id,
          rune_template_id: rune_tmpl.id,
        }),
        {
          pending: i18n.t('scribe.pending'),
          success: i18n.t('scribe.success'),
        }
      )
      set_rune_id(null) // the rune was consumed — clear the center slot
      // Refresh the shared store so the consumed rune / changed gear repaint everywhere (equip's post-tx pattern).
      load_roster().catch(() => {})
    } catch {
      /* already surfaced by the humanizing toast */
    } finally {
      set_busy(false)
    }
  }

  const empty = (label: string, hint?: string) => (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center text-muted">
      <Sparkles size={18} className="opacity-25" />
      <span className="text-[10px] uppercase tracking-[0.16em]">{label}</span>
      {hint && <span className="max-w-[260px] text-[9px] leading-relaxed tracking-[0.06em] text-muted/70">{hint}</span>}
    </div>
  )

  const panel_head = (label: string, count?: number) => (
    <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
      <span className="text-[9px] font-semibold uppercase tracking-[0.24em] text-muted">{label}</span>
      {count != null && <span className="hud-num text-[9px] tracking-[0.1em] text-muted/70">{count}</span>}
    </div>
  )

  // ── header (title + the honest job-70 requirement chip) ───────────────────────────────────────────────
  const header = (
    <div className="flex shrink-0 items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <PenTool size={14} className="text-gold opacity-60" />
        <span className="gold-glow text-[11px] font-semibold uppercase tracking-[0.28em] text-gold">
          {t('scribe.title')}
        </span>
      </div>
      <div className="flex items-center gap-2.5 border border-gold/25 bg-gold/[0.04] px-3.5 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-gold/70" />
        <span className="text-[10px] uppercase tracking-[0.14em] text-gold">{t('scribe.gate_main')}</span>
        <span className="text-[9px] uppercase tracking-[0.1em] text-muted">{t('scribe.gate_sub')}</span>
      </div>
    </div>
  )

  if (!address)
    return (
      <div className="glass-panel m-4 flex flex-1 flex-col gap-6 p-6">
        {header}
        {empty(t('scribe.not_signed_in'))}
      </div>
    )

  // ── one work slot (the CENTER gear/rune drop targets) ─────────────────────────────────────────────────
  const work_slot = (kind: 'gear' | 'rune', sel: Item | null, clear: () => void, place: (id: string) => void) => {
    const Glyph = kind === 'gear' ? Swords : Gem
    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData('text/plain')
          const pool = kind === 'gear' ? gear : runes
          if (pool.some((i) => i.id === id)) place(id)
        }}
        className={`relative flex h-[136px] w-[136px] flex-col items-center justify-center gap-2 border p-3 text-center transition-all ${
          sel ? 'border-gold/60 bg-gold/[0.05]' : 'border-dashed border-border bg-white/[0.01]'
        }`}
      >
        {sel ? (
          <>
            <button
              type="button"
              onClick={clear}
              aria-label={t('scribe.clear')}
              className="absolute right-1 top-1 text-muted transition-colors hover:text-gold"
            >
              <X size={13} />
            </button>
            <ItemIcon
              item={{ icon: sel.item_type, category: sel.item_category }}
              alt={sel.name}
              hd
              className="h-14 w-14 object-contain"
            />
            <span className="line-clamp-2 text-[9.5px] uppercase leading-tight tracking-[0.05em] text-text">
              {sel.name}
            </span>
          </>
        ) : (
          <>
            <Glyph size={20} className="opacity-25" />
            <span className="text-[9px] uppercase tracking-[0.14em] text-muted">
              {t(kind === 'gear' ? 'scribe.place_gear' : 'scribe.place_rune')}
            </span>
          </>
        )}
      </div>
    )
  }

  // ── LEFT: item detail (the shared ItemDetailView — one home) ──────────────────────────────────────────
  const left = (
    <div className="flex flex-col border border-border lg:min-h-0" style={CARD_BG}>
      {panel_head(t('scribe.detail_title'))}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {detail_props ? <ItemDetailView item={detail_props} /> : empty(t('scribe.inspect_empty'))}
      </div>
    </div>
  )

  // ── CENTER: the work surface (place gear + rune, apply) ───────────────────────────────────────────────
  const center = (
    <div className="flex flex-col border border-border lg:min-h-0" style={CARD_BG}>
      {panel_head(t('scribe.forge_title'))}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-5">
        {!as_char ? (
          empty(t('scribe.no_kiosk'))
        ) : (
          <>
            <div className="flex items-center justify-center gap-3 pt-2">
              {work_slot('gear', sel_gear, () => set_gear_id(null), set_gear_id)}
              <Plus size={16} className="shrink-0 text-gold/50" />
              {work_slot('rune', sel_rune, () => set_rune_id(null), set_rune_id)}
            </div>

            {/* honest outcome copy — NO success-percentage, ever */}
            <div className="max-w-[340px] text-center text-[9.5px] leading-relaxed tracking-[0.03em] text-muted">
              {t('scribe.random_notice')}
            </div>

            <div className="w-full max-w-[340px]">
              <button
                type="button"
                disabled={!can_apply}
                onClick={do_scribe}
                className="btn-gold flex w-full items-center justify-center gap-2 py-3 tracking-[0.22em] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy && <Loader2 size={13} className="animate-spin" />}
                {t('scribe.apply_cta')}
              </button>
              <div className="mt-2 text-center text-[9px] uppercase tracking-[0.1em] text-muted">
                {t('scribe.one_rune_note')}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )

  // ── RIGHT: the inventory (gear + runes) you pick from ─────────────────────────────────────────────────
  const pool = tab === 'gear' ? gear : runes
  const right = (
    <div className="flex flex-col border border-border lg:min-h-0" style={CARD_BG}>
      {panel_head(t('scribe.inventory_title'))}
      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
        {(['gear', 'runes'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => set_tab(k)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[9px] uppercase tracking-[0.12em] transition-colors ${
              tab === k ? 'text-gold' : 'text-muted hover:text-text'
            }`}
          >
            {t(k === 'gear' ? 'scribe.tab_gear' : 'scribe.tab_runes')}
            <span className="hud-num text-[9px] opacity-70">{k === 'gear' ? gear.length : runes.length}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {pool.length === 0 ? (
          empty(tab === 'gear' ? t('scribe.no_gear') : t('scribe.no_runes'))
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-2">
            {pool.map((it) => {
              const selected = (tab === 'gear' ? gear_id : rune_id) === it.id
              return (
                <button
                  key={it.id}
                  type="button"
                  draggable
                  onClick={() => (tab === 'gear' ? set_gear_id(it.id) : set_rune_id(it.id))}
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', it.id)}
                  onContextMenu={(e) => {
                    // Every inventory row gets the shared action menu. Rune rows keep CRUSH disabled but gain
                    // SEND + Explorer; gear rows retain the active CRUSH action.
                    e.preventDefault()
                    set_crush_menu({ x: e.clientX, y: e.clientY, item: it })
                  }}
                  title={it.name}
                  className={`relative flex aspect-square items-center justify-center border transition-all ${
                    selected ? 'border-gold bg-gold/[0.09]' : 'border-border hover:border-gold/40'
                  }`}
                >
                  {it.amount > 1 && (
                    <span className="hud-num absolute bottom-0 right-0.5 text-[8px] text-gold-light">×{it.amount}</span>
                  )}
                  <ItemIcon
                    item={{ icon: it.item_type, category: it.item_category }}
                    alt={it.name}
                    className="h-4/5 w-4/5 object-contain"
                  />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="m-4 flex min-h-0 flex-1 flex-col gap-4">
      {header}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(230px,290px)_minmax(300px,1fr)_minmax(230px,320px)] lg:overflow-hidden">
        {left}
        {center}
        {right}
      </div>
      <CrushMenu
        menu={crush_menu}
        on_close={() => set_crush_menu(null)}
        confirm={crush_confirm}
        set_confirm={set_crush_confirm}
        on_send={(item) => set_send_item(project_inventory_send_item(item, items))}
      />
      {send_item && <ItemSendModal items={[send_item]} on_close={() => set_send_item(null)} />}
    </div>
  )
}
