// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CSSProperties } from 'react'
import { Heart, Sparkles } from 'lucide-react'
import type { ItemRow } from '@aresrpg/protocol'

import { item_detail_icon } from '../content/item_detail_assets.ts'

import { FEEDING_ANIMATION, type FeedingFood, type FeedingState } from './pet_feeding.ts'

export const PetFeedingStage = ({
  pet,
  food,
  phase,
}: Readonly<{ pet: Readonly<ItemRow>; food: FeedingFood | null; phase: FeedingState['phase'] }>) => (
  <div
    className="pet-feed-stage"
    aria-hidden="true"
    style={
      {
        '--feed-flight': `${FEEDING_ANIMATION.throwing.duration}ms`,
      } as CSSProperties
    }
  >
    <div className="pet-feed-aura" />
    <div className="pet-feed-shadow" />
    <div className="pet-feed-pet">
      <img src={item_detail_icon(pet.item_type) ?? undefined} alt="" draggable={false} />
    </div>
    <div className="pet-feed-dish" />
    {food && phase !== 'celebrating' && phase !== 'done' && (
      <div className="pet-feed-food" data-feeding-food={food.item_type}>
        <img src={item_detail_icon(food.item_type) ?? undefined} alt="" draggable={false} />
      </div>
    )}
    {phase === 'celebrating' && (
      <>
        <div className="pet-feed-ring" />
        <div className="pet-feed-sparks">
          {Array.from({ length: 8 }, (_, index) => (
            <Sparkles key={index} size={12} style={{ '--i': index } as CSSProperties} />
          ))}
        </div>
        <div className="pet-feed-hearts" data-pet-hearts="">
          {Array.from({ length: 5 }, (_, index) => (
            <Heart key={index} size={16} fill="currentColor" style={{ '--i': index } as CSSProperties} />
          ))}
        </div>
      </>
    )}
  </div>
)
