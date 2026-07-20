// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Simulator equipment picker — each slot is a BUTTON that opens an encyclopedia-style item
// PICKER (browse the seeded items VALID for that slot + select one), replacing the old native <select>.
// Choosing a template equips it; "Empty" clears it. The chosen items flow up to the SimulatorDrawer, which
// feeds them into the synth character so the derived combat profile updates. SSOT: slots + valid items +
// the flatten come from simulator-equip.js. The slot/card LOOK follows the equipment-UI design pass; this
// pass delivers the picker-opens-a-browser interaction.

import { useState, useMemo } from 'react'

import { ItemIcon } from './ItemIcon.jsx'
import { quality_color, rarity_tint } from './quality.js'
import { titleize } from './encyclopedia-data.js'
import {
  EQUIPPABLE_SLOTS,
  SLOT_LABEL,
  items_for_slot,
  equip_item,
} from './simulator-equip.js'

/** Title-case a slot caption, with an index for the repeated relic / ring slots. */
function slot_caption(/** @type {string} */ slot) {
  if (slot.startsWith('relic')) return `Relic ${slot.split('_')[1]}`
  if (slot === 'left_ring') return 'Ring I'
  if (slot === 'right_ring') return 'Ring II'
  const base = SLOT_LABEL[slot] ?? slot
  return base.replace(/^\w/, m => m.toUpperCase())
}

/**
 * @param {{
 *   equipment: Record<string, any>,
 *   on_equip: (slot: string, item: any | null) => void,
 * }} props
 * @returns {import('react').JSX.Element}
 */
export function SimulatorEquip({ equipment, on_equip }) {
  const [picker_slot, set_picker_slot] = useState(
    /** @type {string | null} */ (null),
  )
  const equipped_count = EQUIPPABLE_SLOTS.filter(s => equipment[s]).length

  return (
    <div className="sim__equip-wrap">
      <div className="sim__section-row">
        <span className="sim__section">Equipment</span>
        <span className="sim__budget">
          {equipped_count} / {EQUIPPABLE_SLOTS.length} slots
        </span>
      </div>
      <div className="sim__equip">
        {EQUIPPABLE_SLOTS.map(slot => {
          const item = equipment[slot]
          // --slot-tint = the quality COLOR (caption + name TEXT only — text ≠ border). The rarity CELL
          // signal is the SHARED inset radial tint (rarity_tint SSOT, quality.js) applied inline as a
          // background layer — the SAME treatment as items.tsx ItemSlot. NO rarity border (D11).
          const tint = item ? quality_color(item.quality) : 'var(--hair-strong)'
          return (
            <button
              key={slot}
              type="button"
              className={`sim__equip-slot${item ? ' is-on' : ''}`}
              style={
                /** @type {import('react').CSSProperties} */ ({
                  '--slot-tint': tint,
                  ...(item
                    ? { background: `${rarity_tint(item.quality)}, rgba(255,255,255,0.02)` }
                    : {}),
                })
              }
              onClick={() => set_picker_slot(slot)}
            >
              <span className="sim__equip-cap">{slot_caption(slot)}</span>
              {item ? (
                <span className="sim__equip-item">
                  <ItemIcon item={item} className="sim__equip-icon" />
                  <span className="sim__equip-name" style={{ color: tint }}>
                    {item.name || item.id}
                  </span>
                </span>
              ) : (
                <span className="sim__equip-empty">Choose item…</span>
              )}
            </button>
          )
        })}
      </div>

      {picker_slot && (
        <SimulatorPicker
          slot={picker_slot}
          current={equipment[picker_slot]}
          on_pick={item => {
            on_equip(picker_slot, item)
            set_picker_slot(null)
          }}
          on_close={() => set_picker_slot(null)}
          caption={slot_caption(picker_slot)}
        />
      )}
    </div>
  )
}

/**
 * The per-slot item picker — an encyclopedia-style browser of the items valid for the slot, overlaying the
 * simulator panel (not the whole game). Search + click-to-equip + an Empty (unequip) row.
 * @param {{
 *   slot: string,
 *   caption: string,
 *   current: any,
 *   on_pick: (item: any | null) => void,
 *   on_close: () => void,
 * }} props
 * @returns {import('react').JSX.Element}
 */
function SimulatorPicker({ slot, caption, current, on_pick, on_close }) {
  const [query, set_query] = useState('')
  const [cat, set_cat] = useState('all')
  const options = items_for_slot(slot)
  // the distinct fine SDK categories present in THIS slot (e.g. a weapon slot spans longsword / dagger /
  // bow / staff / ...). Same `item.category` taxonomy the encyclopedia sub-filters on (titleize labels),
  // never an invented set. The chips render only when the slot actually spans more than one category.
  const categories = useMemo(
    () => [...new Set(options.map(o => o.category))].sort(),
    [options],
  )
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return options.filter(
      o =>
        (cat === 'all' || o.category === cat) &&
        (needle === '' || (o.name || o.id).toLowerCase().includes(needle)),
    )
  }, [options, query, cat])

  return (
    <div className="sim__picker" role="dialog" aria-label={`Choose ${caption}`}>
      <div className="sim__picker-head">
        <span className="sim__picker-title">{caption}</span>
        <input
          className="sim__picker-search"
          type="text"
          placeholder="Search items…"
          value={query}
          onChange={e => set_query(e.target.value)}
        />
        <button
          type="button"
          className="sim__picker-close"
          onClick={on_close}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {categories.length > 1 && (
        <div
          className="sim__picker-cats"
          role="group"
          aria-label="Filter by type"
        >
          <button
            type="button"
            className={`sim__picker-chip${cat === 'all' ? ' is-active' : ''}`}
            onClick={() => set_cat('all')}
          >
            All
          </button>
          {categories.map(c => (
            <button
              key={c}
              type="button"
              className={`sim__picker-chip${cat === c ? ' is-active' : ''}`}
              onClick={() => set_cat(c)}
            >
              {titleize(c)}
            </button>
          ))}
        </div>
      )}
      <div className="sim__picker-list">
        <button
          type="button"
          className={`sim__picker-row sim__picker-row--empty${current ? '' : ' is-selected'}`}
          onClick={() => on_pick(null)}
        >
          <span className="sim__picker-name">Empty (unequip)</span>
        </button>
        {filtered.map(o => {
          const tint = quality_color(o.quality)
          return (
            <button
              key={o.id}
              type="button"
              className={`sim__picker-row${current?.id === o.id ? ' is-selected' : ''}`}
              style={
                /** @type {import('react').CSSProperties} */ ({ '--q': tint })
              }
              onClick={() => on_pick(equip_item(o))}
            >
              <ItemIcon item={o} className="sim__picker-icon" />
              <span className="sim__picker-name" style={{ color: tint }}>
                {o.name || o.id}
              </span>
              <span className="sim__picker-lvl hud-num">Lv {o.level}</span>
            </button>
          )
        })}
        {filtered.length === 0 && (
          <div className="sim__picker-none">No items match.</div>
        )}
      </div>
    </div>
  )
}
