// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The established paper-doll layout, extracted from the inventory for reuse by local character authoring.

import {
  Award,
  Cat,
  CircleDot,
  Crown,
  Footprints,
  Gem,
  Minus,
  Shield,
  Shirt,
  Sparkles,
  Star,
  Swords,
} from 'lucide-react'
import { cosmetic_slots, relic_slots, rig_slots, type CharacterEquipmentSlot } from '@aresrpg/immutable'

import { item_icon } from '../content/assets.ts'
import type { SeedItem } from '../content/catalog.ts'

const SLOT_ICON: Readonly<Record<string, typeof Sparkles>> = Object.freeze({
  relic: Sparkles,
  helmet: Crown,
  hat: Crown,
  cloak: Shirt,
  amulet: Gem,
  chestplate: Shirt,
  gauntlets: Shield,
  pants: Star,
  title: Award,
  weapon: Swords,
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
}: Readonly<{ item: SeedItem | null; open: (slot: CharacterEquipmentSlot) => void; slot: CharacterEquipmentSlot }>) => {
  const label = label_of(slot)
  const Glyph = SLOT_ICON[label] ?? Sparkles
  return (
    <button
      className={`inv__slot inv__slot--${slot}${item ? ' is-filled' : ''}`}
      onClick={() => open(slot)}
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
}: Readonly<{
  item_for: (slot: CharacterEquipmentSlot) => SeedItem | null
  open: (slot: CharacterEquipmentSlot) => void
}>) => (
  <div className="flex flex-col items-start gap-2">
    <div className="inv__doll inv__doll--flat inv__doll--compact">
      <div className="inv__doll-body">
        <div className="inv__relics">
          {relic_slots.map((slot) => (
            <EquipmentSlot item={item_for(slot)} key={slot} open={open} slot={slot} />
          ))}
        </div>
        <div className="inv__rig">
          <div aria-hidden="true" className="inv__slot-gap" />
          {rig_slots.map((slot) => (
            <EquipmentSlot item={item_for(slot)} key={slot} open={open} slot={slot} />
          ))}
        </div>
      </div>
    </div>
    <div className="inv__cosmetics inv__cosmetics--compact">
      {cosmetic_slots.map((slot) => (
        <EquipmentSlot item={item_for(slot)} key={slot} open={open} slot={slot} />
      ))}
    </div>
  </div>
)
