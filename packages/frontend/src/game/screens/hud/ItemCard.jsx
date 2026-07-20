// Canonical ITEM-CARD (c143) — ported FAITHFULLY from the AresRPG donor item-description.vue
// (aresrpg-legacy/packages/dapp/src/components/cards/item-*.vue), Vue -> React. The approved shape:
// a HEADER (name + set + level on the right), then a two-column body — the ICON top-LEFT with its
// category beneath, and the effects on the RIGHT as organized ROWS of coloured LINES (NOT chips): the
// element-coloured damage lines first, then one stat-icon + value + name row per stat (value tinted by
// the stat colour). Used identically on every item surface + inside the detail modal.
//
// <ItemCard> is the body; <ItemCardModal> is the centred detail modal (portal + backdrop + Esc). Accepts
// a normalized ItemView OR a raw inventory item OR a seeded items.json ItemDef (auto-normalized).

import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import { ItemIcon } from './ItemIcon.jsx'
import { to_item_view, is_item_view, ELEMENT_COLOR } from './item-view.js'
import './item-card.css'

// donor format: a single value reads "+12", a range reads "4 to 8" — only the numeric VALUES are
// tinted by the stat colour; the word "to" stays grey (c172).
function StatValue({ min, max, color }) {
  if (min === max)
    return (
      <span style={{ color }}>
        {min > 0 ? '+' : ''}
        {min}
      </span>
    )
  return (
    <>
      <span style={{ color }}>{min}</span>
      <span className="item-card__to"> to </span>
      <span style={{ color }}>{max}</span>
    </>
  )
}

/**
 * The canonical item card body.
 * @param {{ item: any, compare?: any, size?: 'md' | 'lg' }} props
 * @returns {import('react').JSX.Element | null}
 */
export function ItemCard({ item, compare = null, size = 'md' }) {
  const view = is_item_view(item) ? item : to_item_view(item)
  if (!view) return null
  const compare_view = compare ? to_item_view(compare) : null
  const delta_for = (
    /** @type {string} */ key,
    /** @type {number} */ value,
  ) => {
    if (!compare_view) return null
    const other = compare_view.stats.find(s => s.key === key)
    return value - (other ? (other.min + other.max) / 2 : 0)
  }

  const has_effects = view.damages.length > 0 || view.stats.length > 0

  return (
    <article
      className={`item-card item-card--${size}`}
      style={
        /** @type {import('react').CSSProperties} */ ({ '--q': view.tint })
      }
    >
      <header className="item-card__head">
        <span className="item-card__name">{view.name}</span>
        {view.set && (
          <span className="item-card__set">
            ({view.set.replace(/_/g, ' ')})
          </span>
        )}
        {view.level != null && (
          <span className="item-card__lvl hud-num">Lv {view.level}</span>
        )}
      </header>

      <div className="item-card__content">
        <div className="item-card__left">
          <ItemIcon
            item={{ icon: view.icon, id: view.id }}
            alt={view.name}
            hd
            className="item-card__icon"
          />
          <span className="item-card__cat">{view.type_label}</span>
          {view.craftable && view.amount != null && (
            <span className="item-card__amount hud-num">x{view.amount}</span>
          )}
        </div>

        <div className="item-card__right">
          {has_effects && <div className="item-card__eff">Effects</div>}
          {view.damages.map((d, i) => (
            <div
              className="item-card__line item-card__dmg"
              key={`dmg-${d.element}-${i}`}
              style={{
                color: ELEMENT_COLOR[d.element] ?? ELEMENT_COLOR.neutral,
              }}
            >
              {d.min} to {d.max} {d.element} damage
            </div>
          ))}
          {view.damages.length > 0 && view.stats.length > 0 && (
            <div className="item-card__sepa" aria-hidden="true" />
          )}
          {view.stats.map(stat => {
            const delta = delta_for(stat.key, (stat.min + stat.max) / 2)
            return (
              <div className="item-card__line item-card__stat" key={stat.key}>
                {stat.icon && (
                  <img
                    className="item-card__stat-icon"
                    src={stat.icon}
                    alt=""
                    aria-hidden="true"
                  />
                )}
                <span className="item-card__stat-val hud-num">
                  <StatValue min={stat.min} max={stat.max} color={stat.color} />
                </span>
                <span className="item-card__stat-name">{stat.label}</span>
                {delta != null && delta !== 0 && (
                  <span
                    className={`item-card__delta hud-num ${delta > 0 ? 'is-up' : 'is-down'}`}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                )}
              </div>
            )
          })}
          {!has_effects && !view.description && (
            <div className="item-card__line item-card__none">No effects</div>
          )}
        </div>
      </div>

      {view.description && (
        <p className="item-card__desc">{view.description}</p>
      )}
    </article>
  )
}

/**
 * The canonical item card as a DRAWER-SIDE detail panel (c164): NO full-screen backdrop — it docks
 * to the side so the live world stays visible + playable. Closes on Esc or its × button. No inner wrapper
 * (it would clip the card's drop shadow, c172).
 * @param {{ item: any, compare?: any, onClose: () => void }} props
 * @returns {import('react').JSX.Element | null}
 */
export function ItemCardModal({ item, compare = null, onClose }) {
  useEffect(() => {
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [onClose])

  if (!item) return null
  return createPortal(
    <div className="item-card-panel" role="dialog" aria-label="Item detail">
      <button
        type="button"
        className="item-card-panel__close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      <ItemCard item={item} compare={compare} size="lg" />
    </div>,
    document.body,
  )
}
