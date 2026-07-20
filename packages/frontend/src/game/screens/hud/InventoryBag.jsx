import { useTranslation } from 'react-i18next'
import { slugs } from 'virtual:item_catalog'

import { ItemIcon } from './ItemIcon.jsx'
import { inventory_item_icon } from './inventory-equip.js'
import { rarity_tint } from './quality.js'
import { box_retry_digest } from './lootbox-retry-guard.js'
import './inventory-guard.css'

/** The latched-box tooltip: the plain-language cause + the short tx proof when the failure executed (D1). */
function retry_blocked_title(t, item) {
  const digest = box_retry_digest(item.id)
  const cause = t('lootbox.retry_blocked')
  return digest ? `${cause} ${t('lootbox.retry_blocked_digest', { digest: `${digest.slice(0, 6)}…${digest.slice(-4)}` })}` : cause
}

/** Right-side inventory bag. Listed marketplace rows are filtered at their owner-items data source. */
export function InventoryBag({
  category,
  set_category,
  tabs,
  counts,
  total_count,
  grid_items,
  empty_count,
  selected_item_id,
  equip_lock,
  is_removed,
  is_retry_blocked,
  on_select,
  on_activate,
  on_context_menu,
  on_drag_start,
  on_drag_end,
  on_hover_enter,
  on_hover_move,
  on_hover_leave,
  on_dismiss_tooltip,
}) {
  const { t } = useTranslation()

  return (
    <div className="inv__bag">
      <div className="inv__baghead">
        <div className="inv__eyebrow">
          <b>Bag</b>
        </div>
        <span className="inv__bagcount hud-num">{total_count} items</span>
      </div>
      <div className="inv__tabs">
        {tabs.map(([key, label_key]) => (
          <button
            key={key}
            type="button"
            className={`inv__tab${category === key ? ' is-active' : ''}`}
            onClick={() => set_category(key)}
          >
            {t(label_key)} <span className="inv__tab-ct hud-num">{counts[key]}</span>
          </button>
        ))}
      </div>
      <div className="inv__grid">
        {grid_items.map((item) => {
          const removed = is_removed(item)
          const retry_blocked = is_retry_blocked(item)
          // `/v1/owner-items.item_type` is a generic gameplay type (for example `cloak`), not the icon key.
          // Recover the template slug from the seed name join, then apply the authored cosmetic filename alias.
          const icon_slug = inventory_item_icon(item, slugs)
          return (
            <div className="inv__cell-shell" key={item.id}>
              <button
                type="button"
                className={`inv__cell inv__cell--filled${selected_item_id === item.id ? ' is-selected' : ''}${
                  retry_blocked ? ' is-action-disabled' : ''
                }`}
                style={
                  /** @type {import('react').CSSProperties} */ ({
                    '--q-tint': rarity_tint(item.quality ?? item.rarity),
                  })
                }
                draggable={(category === 'equipment' || category === 'cosmetics') && !equip_lock}
                disabled={retry_blocked}
                aria-disabled={retry_blocked}
                title={retry_blocked ? retry_blocked_title(t, item) : undefined}
                onClick={() => {
                  on_dismiss_tooltip()
                  on_select(item.id)
                }}
                onDoubleClick={() => on_activate(item)}
                onContextMenu={(event) => {
                  on_dismiss_tooltip()
                  on_context_menu(event, item)
                }}
                onDragStart={(event) => {
                  on_dismiss_tooltip()
                  event.dataTransfer.setData('text/plain', item.id)
                  on_drag_start(item)
                }}
                onDragEnd={on_drag_end}
                onMouseEnter={(event) => on_hover_enter(event, item)}
                onMouseMove={on_hover_move}
                onMouseLeave={on_hover_leave}
              >
                {item.amount > 1 && <span className="inv__cell-amount hud-num">×{item.amount}</span>}
                <ItemIcon
                  item={{ slug: icon_slug, category: item.item_category }}
                  alt={item.name}
                  className="inv__cell-art"
                />
                {removed && (
                  <span className="inv__cell-removed" aria-hidden="true" title={t('removed_item.name')}>
                    ✕
                  </span>
                )}
              </button>
              {retry_blocked && (
                <span className="inv__cell-listed inv__cell-listed--blocked">{t('lootbox.retry_blocked_short')}</span>
              )}
            </div>
          )
        })}
        {[...Array(empty_count).keys()].map((index) => (
          <div key={`empty-${index}`} className="inv__cell inv__cell--empty" aria-hidden="true" />
        ))}
      </div>
    </div>
  )
}
