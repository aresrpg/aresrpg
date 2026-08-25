// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The established paper-doll layout, extracted from the inventory for reuse by local character
// authoring AND the live characters page (drag-drop staging rides the optional slot_state).

import { Award, Cat, CircleDot, Crown, Footprints, Gem, Minus, Shirt, Sparkles, Star, Swords } from 'lucide-react'
import type { DragEvent, ReactNode } from 'react'
import { relic_slots, rig_slots, type CharacterEquipmentSlot } from '@aresrpg/immutable'

/** The anatomical body order — DOM reading order IS the layout (the .inv__rig auto-flow
 *  grid), so the slot ORDER belongs to this component, never its callers (the canon doll's
 *  law). Hat, cloak, and title are ordinary equipment in this same grid. */
const RIG_ORDER = Object.freeze([
  'tool',
  'hat',
  'amulet',
  'cloak',
  'weapon',
  'left_ring',
  'belt',
  'right_ring',
  'pet',
  'title',
  'boots',
] as const satisfies readonly (typeof rig_slots)[number][])

import { item_icon } from '../content/assets.ts'

/** What a slot needs to paint — the seed catalog rows and the projected chain rows both fit. */
export type DollItem = Readonly<{ name: string; item_type: string; level: number }>

/** Optional live-page interactivity per slot: drop targets, drag-over highlight, staged mark. */
export type DollSlotState = Readonly<{
  valid?: boolean
  staged?: boolean
  on_drop?: (event: Readonly<DragEvent<HTMLButtonElement>>) => void
}>

const SLOT_ICON: Readonly<Record<string, typeof Sparkles>> = Object.freeze({
  relic: Sparkles,
  hat: Crown,
  cloak: Shirt,
  amulet: Gem,
  title: Award,
  weapon: Swords,
  tool: Swords,
  ring: CircleDot,
  belt: Minus,
  boots: Footprints,
  pet: Cat,
})

const label_of = (slot: CharacterEquipmentSlot): string =>
  slot.startsWith('relic_') ? slot.replace('_', ' ') : slot === 'left_ring' || slot === 'right_ring' ? 'ring' : slot

const EquipmentSlot = ({
  item,
  open,
  slot,
  state,
}: Readonly<{
  item: DollItem | null
  open: (slot: CharacterEquipmentSlot) => void
  slot: CharacterEquipmentSlot
  state?: DollSlotState
}>) => {
  const label = label_of(slot)
  const Glyph = SLOT_ICON[label] ?? Sparkles
  return (
    <button
      className={`inv__slot inv__slot--${slot}${item ? ' is-filled' : ''}${state?.valid ? ' is-valid' : ''}${state?.staged ? ' is-staged' : ''}`}
      data-equipment-slot={slot}
      onClick={() => open(slot)}
      onDragOver={state?.on_drop ? (event) => event.preventDefault() : undefined}
      onDrop={state?.on_drop}
      title={item?.name ?? label}
      type="button"
    >
      {item ? (
        <>
          {item_icon(item.item_type) ? (
            <img alt="" className="inv__slot-art" src={item_icon(item.item_type)!} />
          ) : (
            <Glyph className="inv__slot-glyph" />
          )}
          <span className="inv__slot-lvl">{item.level}</span>
        </>
      ) : (
        <>
          <Glyph aria-hidden="true" className="inv__slot-glyph" strokeWidth={1.5} />
          <span className="inv__slot-label">{label}</span>
        </>
      )}
    </button>
  )
}

export const EquipmentDoll = ({
  item_for,
  open,
  slot_state,
  footer,
  flat = false,
  compact = false,
}: Readonly<{
  item_for: (slot: CharacterEquipmentSlot) => DollItem | null
  open: (slot: CharacterEquipmentSlot) => void
  slot_state?: (slot: CharacterEquipmentSlot) => DollSlotState
  footer?: ReactNode
  /** layout only, no frame — for surfaces that are already a card (a dialog) */
  flat?: boolean
  /** fixed index-size cells — for wide dialogs where stretching misfires */
  compact?: boolean
}>) => (
  <div className="flex w-full flex-col gap-2">
    <div className={`inv__doll${flat ? ' inv__doll--flat' : ''}${compact ? ' inv__doll--compact' : ''}`}>
      <div className="inv__doll-body">
        <div className="inv__relics">
          {relic_slots.map((slot) => (
            <EquipmentSlot item={item_for(slot)} key={slot} open={open} slot={slot} state={slot_state?.(slot)} />
          ))}
        </div>
        <div className="inv__rig">
          {RIG_ORDER.map((slot) => (
            <EquipmentSlot item={item_for(slot)} key={slot} open={open} slot={slot} state={slot_state?.(slot)} />
          ))}
        </div>
      </div>
    </div>
    {footer}
  </div>
)
