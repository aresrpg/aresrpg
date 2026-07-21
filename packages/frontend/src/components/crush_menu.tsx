// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CRUSH — the right-click item action: crushing is like feeding a pet — a simple
// right-click > crush on the item. NOT a page section anymore. This is the reusable seam used EVERYWHERE
// the inventory renders — the runeforge's right panel AND the main inventory grid — mirroring the S-18 pet
// feed idiom exactly: a right-click context menu (positioned popover, outside-click/Escape dismiss) whose
// entry opens a confirm modal (portal + scrim, PetFeedModal's shape).
//
// SINGLE-TX CEREMONY: `forgemagie::crush` destroys the gear, rolls the yield AND
// kiosk-locks the minted rune stacks in ONE terminal-&Random call (crush_actions.js). The confirm modal shows
// the DETERMINISTIC yield SET with honest quantity BANDS (`crush_preview` — tiers/counts roll on-chain, so a
// range, never a promise), then fires `crush_item` through the one humanizing tx pipeline.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Hammer, Loader2 } from 'lucide-react'

import { use_game_state } from '../game/store.js'
import { use_toast } from '../toast'
import i18n from '../i18n'
import { crush_preview, crush_item } from '../world-shell/crush_actions.js'
import { humanize_tx_error } from '../game/core/abort_copy.js'
import { ItemIcon } from '../game/screens/hud/ItemIcon.jsx'
import { project_inventory_context_actions } from '../game/screens/hud/inventory_context_actions'

import { is_crushable } from './forge_eligibility'
import { RemovedItemNotice } from './item_detail_view'
import { ExplorerMenuRow } from './explorer_link'
import { ItemSendMenuRow } from './item_send_menu_row'

// House tokens with hard fallbacks — menu + modal portal outside .game-tab, so a fallback guarantees the
// gothic-terminal gold look even when a scoped var doesn't resolve on the body node (mirrors PetFeedModal).
const T = {
  gold: 'var(--accent, #c8963c)',
  surface: 'var(--surface, #12121a)',
  bg: 'var(--bg, #0a0a0f)',
  fg: 'var(--fg, #e8e4dc)',
  muted: 'var(--fg-faint, #6b7280)',
  hair: 'var(--hair, rgba(255,255,255,0.08))',
  mono: 'var(--font-mono, "JetBrains Mono", ui-monospace, monospace)',
}

export type CrushTarget = { x: number; y: number; item: any } | null

type CrushPreview = {
  removed?: boolean
  failed?: boolean
  rows: { stat_key: string; min: number; max: number }[]
  estimated: boolean
}

/** The one item-shape gate shared by the menu, confirm button, and press handler. */
export const crush_disabled_reason = (item: any): string | null => (is_crushable(item) ? null : 'crush.not_crushable')

/** Preview is display-only: a slow preview must never turn a valid transaction button into a dead end. */
export function crush_confirm_disabled({
  item,
  busy,
  preview,
}: {
  item: any
  busy: boolean
  preview: CrushPreview | null
}): boolean {
  return busy || !!preview?.removed || !!crush_disabled_reason(item)
}

/** True only for a DEFINITIVE zero yield — the preview's deterministic rune set is empty. Never inferred while
 * still loading/failed/removed, so a slow or broken read can never mislabel a real yield as a destroy (issue
 * #270 — the confirm copy and the result toast share this ONE signal). */
export const crush_is_zero_yield = (preview: CrushPreview | null): boolean =>
  !!preview && !preview.removed && !preview.failed && preview.rows.length === 0

/** The confirm dialog's headline copy key: the honest DESTROY framing for a definitive zero yield, the rune
 * framing otherwise (including while loading — the preview never blocks or relabels the button). */
export const crush_line_key = (preview: CrushPreview | null): string =>
  crush_is_zero_yield(preview) ? 'crush.destroy_line' : 'crush.line'

/** The result toast's success key — same zero-yield signal as the confirm copy, so the two can never disagree. */
export const crush_success_key = (preview: CrushPreview | null): string =>
  crush_is_zero_yield(preview) ? 'crush.success_destroyed' : 'crush.success'

/**
 * Testable click seam for the confirm button. The eligibility refusal is created inside the toast-owned promise,
 * so even an impossible programmatic press is humanized instead of becoming a silent rejected handler.
 */
export function dispatch_crush_action({
  item,
  character_id,
  success_key = 'crush.success',
  crush = crush_item,
  toast = (promise, messages) => use_toast.getState().promise(promise, messages),
}: {
  item: any
  character_id: string | null
  success_key?: string
  crush?: (args: { item: any; character_id: string }) => Promise<any>
  toast?: (promise: Promise<any>, messages: { pending: string; success: string }) => Promise<any>
}): Promise<any> {
  const submitted = Promise.resolve().then(() => {
    const reason = crush_disabled_reason(item)
    if (reason) throw new Error(i18n.t(reason))
    if (!character_id) throw new Error(i18n.t('crush.no_kiosk'))
    return crush({ item, character_id })
  })
  return toast(submitted, {
    pending: i18n.t('crush.pending'),
    success: i18n.t(success_key),
  })
}

/**
 * The right-click crush affordance. Render it once per inventory surface, unconditionally, driving it with a
 * `{ x, y, item } | null` state set from the cell's `onContextMenu`. Owns its own confirm modal + dismissal.
 */
export function CrushMenu({
  menu,
  on_close,
  confirm,
  set_confirm,
  on_send,
}: {
  menu: CrushTarget
  on_close: () => void
  // The gear pending confirmation (survives the menu closing) — lifted so the parent keeps this component
  // mounted while the modal is open. null = no modal.
  confirm: any
  set_confirm: (item: any) => void
  on_send?: (item: any) => void
}) {
  const { t } = useTranslation()
  const disabled_reason = menu ? crush_disabled_reason(menu.item) : null
  const actions = project_inventory_context_actions(['crush', 'explorer'])

  // Outside-click / Escape dismiss the popover — same idiom as the pet-feed menu in Inventory.jsx.
  useEffect(() => {
    if (!menu) return undefined
    const close = () => on_close()
    const on_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') on_close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', on_key)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', on_key)
    }
  }, [menu, on_close])

  return (
    <>
      {menu && !confirm && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: menu.x,
            top: menu.y,
            zIndex: 55,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 6,
            minWidth: 168,
            background: T.surface,
            border: `1px solid ${T.gold}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
          }}
        >
          {actions.includes('crush') && (
            <button
              type="button"
              className="hud-btn"
              disabled={!!disabled_reason}
              aria-describedby={disabled_reason ? 'crush-menu-disabled-reason' : undefined}
              title={disabled_reason ? t(disabled_reason) : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}
              onClick={() => {
                set_confirm(menu.item)
                on_close()
              }}
            >
              <Hammer size={12} style={{ color: T.gold }} />
              {t('crush.action')}
            </button>
          )}
          {disabled_reason && (
            <span
              id="crush-menu-disabled-reason"
              data-crush-disabled-reason="true"
              style={{ maxWidth: 220, padding: '2px 6px 4px', fontSize: 9.5, lineHeight: 1.45, color: T.muted }}
            >
              {t(disabled_reason)}
            </span>
          )}
          {actions.includes('send') && on_send && (
            <ItemSendMenuRow
              on_send={() => {
                on_send(menu.item)
                on_close()
              }}
            />
          )}
          {actions.includes('explorer') && <ExplorerMenuRow object_id={menu.item?.id} on_navigate={on_close} />}
        </div>
      )}
      {confirm && <CrushConfirmModal item={confirm} onClose={() => set_confirm(null)} />}
    </>
  )
}

/**
 * The crush confirm dialog — the burn cost is unmissable (mirrors PetFeedModal). Shows the DETERMINISTIC yield
 * set with honest quantity bands (tiers/counts roll on-chain — ranges, never promises), then fires the ONE-TX
 * ceremony (`crush_item`) through the humanizing toast pipeline. Escape/scrim close while idle, never mid-tx.
 */
function CrushConfirmModal({ item, onClose }: { item: any; onClose: () => void }) {
  const { t } = useTranslation()
  const character_id = use_game_state((s: any) => s.selected_character_id)
  const [busy, set_busy] = useState(false)
  // ORPHAN: the item's template was deleted on-chain — crush is uncallable until
  // the `crush_orphan` door ships, so the modal shows the "removed from the game" notice + a disabled button.
  const [preview, set_preview] = useState<CrushPreview | null>(null)

  // The yield preview — deterministic SET off the item's rolled lines, quantity BANDS off the live /v1 taux
  // coefficient (estimate-labelled when the read-API is unreachable). Honest empty when it yields nothing.
  useEffect(() => {
    let alive = true
    set_preview(null)
    crush_preview(item)
      .then((p) => alive && set_preview(p))
      .catch((error) => {
        if (!alive) return
        set_preview({ rows: [], estimated: true, failed: true })
        // Background preview failures are still honest failures: one shared decoder, one visible toast.
        use_toast.getState().add(humanize_tx_error(error), 'error')
      })
    return () => {
      alive = false
    }
  }, [item])

  async function do_crush() {
    if (busy) return
    set_busy(true)
    try {
      await dispatch_crush_action({ item, character_id, success_key: crush_success_key(preview) })
      onClose()
    } catch {
      /* already surfaced by the humanizing toast (pre-flight refusals arrive translated) */
    } finally {
      set_busy(false)
    }
  }

  useEffect(() => {
    const on_key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [onClose, busy])

  if (!item) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(7,9,13,0.62)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(420px, 94vw)',
          background: T.surface,
          border: `1px solid ${T.gold}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          color: T.fg,
          fontFamily: T.mono,
        }}
      >
        <header
          style={{
            padding: '12px 16px',
            borderBottom: `1px solid ${T.hair}`,
            fontSize: 12,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: T.gold,
          }}
        >
          {t('crush.title')}
        </header>

        {/* the gear being broken — the loss is unmissable */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 16px' }}>
          <div
            style={{
              flex: 'none',
              width: 72,
              height: 72,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: T.bg,
              border: `1px solid ${T.gold}`,
            }}
          >
            <ItemIcon
              item={{ icon: item.icon ?? item.item_type, id: item.id, category: item.item_category }}
              alt={item.name}
              hd
              className="item-card__icon"
            />
          </div>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 12.5, color: T.fg, lineHeight: 1.3 }}>{item.name}</span>
            {/* Hide the "break down / permanent destroy" copy for a removed item — it can't be crushed yet, so
                that messaging would be a lie; the RemovedItemNotice below carries the honest state instead. */}
            {!preview?.removed && (
              <>
                <span style={{ fontSize: 11, color: T.muted, lineHeight: 1.5 }}>
                  {/* honest reframe (issue #270): a definitive zero-yield item destroys, it doesn't "break
                      down into runes" — crush_line_key is the SAME signal the result toast picks off */}
                  {t(crush_line_key(preview), { item: item.name })}
                </span>
                <span style={{ fontSize: 10.5, color: T.gold, letterSpacing: '0.04em', lineHeight: 1.5 }}>
                  {t('crush.warning')}
                </span>
              </>
            )}
          </div>
        </div>

        {/* ORPHAN: a removed-template item can't be priced or crushed yet — show the
            honest "removed from the game / crush it for runes" notice + the pending-upgrade line, no fake yield. */}
        {preview?.removed ? (
          <div style={{ padding: '2px 16px 16px' }}>
            <RemovedItemNotice note={t('removed_item.crush_pending')} />
          </div>
        ) : (
          /* the DETERMINISTIC yield set + honest quantity bands (tiers/counts roll on-chain at crush) */
          <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: T.muted,
              }}
            >
              {t('crush.yield_title')}
            </span>
            {!preview ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: T.muted }}>
                <Loader2 size={11} className="animate-spin" />
                {t('crush.preview_loading')}
              </span>
            ) : preview.failed ? (
              <span style={{ fontSize: 10.5, color: T.muted, lineHeight: 1.5 }}>{t('rpc.unavailable')}</span>
            ) : preview.rows.length === 0 ? (
              <span style={{ fontSize: 10.5, color: T.muted, lineHeight: 1.5 }}>{t('crush.yield_none')}</span>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {preview.rows.map((row) => (
                    <span
                      key={row.stat_key}
                      style={{
                        fontSize: 10.5,
                        padding: '3px 8px',
                        border: `1px solid ${T.hair}`,
                        color: T.fg,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {t(`stat.${row.stat_key}`)}{' '}
                      <span style={{ color: T.gold }}>×{row.min === row.max ? row.min : `${row.min}–${row.max}`}</span>
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: 9.5, color: T.muted, lineHeight: 1.5 }}>{t('crush.yield_note')}</span>
              </>
            )}
          </div>
        )}

        <footer
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '12px 16px',
            borderTop: `1px solid ${T.hair}`,
          }}
        >
          <button type="button" className="hud-btn" onClick={onClose} disabled={busy}>
            {t('crush.cancel')}
          </button>
          <button
            type="button"
            className="hud-btn hud-btn--accent"
            // Prominently KEPT but disabled for a removed item: the on-chain orphan-crush door is not live yet
            // (staged Move patch, next ceremony) — the RemovedItemNotice above says why.
            disabled={crush_confirm_disabled({ item, busy, preview })}
            aria-describedby={crush_disabled_reason(item) ? 'crush-confirm-disabled-reason' : undefined}
            onClick={do_crush}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {busy && <Loader2 size={11} className="animate-spin" />}
            {t('crush.confirm')}
          </button>
        </footer>
        {crush_disabled_reason(item) && (
          <div
            id="crush-confirm-disabled-reason"
            data-crush-disabled-reason="true"
            style={{ padding: '0 16px 12px', textAlign: 'right', fontSize: 9.5, color: T.muted }}
          >
            {t(crush_disabled_reason(item) as string)}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
