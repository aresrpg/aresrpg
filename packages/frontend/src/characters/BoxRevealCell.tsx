// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CSSProperties } from 'react'

import { items_by_type } from '../content/items.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import type { CopyText } from '../i18n/copy.ts'

import { BoxCarousel } from './BoxCarousel.tsx'
import type { BoxPhase } from './useBoxAnimation.ts'
export type { BoxPhase } from './useBoxAnimation.ts'
export type BoxResult = Readonly<{ claim_id: string; item_type: string; amount: number }>

const OpeningBox = ({ item_type }: Readonly<{ item_type: string }>) => (
  <div className="boxreveal__stage">
    <div aria-hidden="true" className="boxreveal__aura" />
    <div className="boxreveal__box">
      <img alt="" className="boxreveal__box-art" draggable={false} src={item_detail_icon(item_type) ?? undefined} />
    </div>
    <div aria-hidden="true" className="boxreveal__sparks">
      {Array.from({ length: 10 }, (_, index) => (
        <span
          className={`boxreveal__spark boxreveal__spark--${index % 2 ? 'cyan' : 'gold'}`}
          key={index}
          style={{ '--i': index } as CSSProperties}
        />
      ))}
    </div>
    <div aria-hidden="true" className="boxreveal__flash" />
  </div>
)

export const BoxRevealCell = ({
  item_type,
  phase,
  roll,
  text,
  sound = true,
}: Readonly<{ item_type: string; phase: BoxPhase; roll?: BoxResult; text: CopyText; sound?: boolean }>) => {
  if (phase === 'spinning' && roll) return <BoxCarousel box={item_type} reward={roll.item_type} sound={sound} />
  if (phase !== 'reveal') return <OpeningBox item_type={item_type} />
  return (
    <div className="boxreveal__card-wrap" onClick={(event) => event.stopPropagation()}>
      {roll ? (
        <div className="boxreveal__card">
          <img
            alt=""
            className="boxreveal__reward-art"
            draggable={false}
            src={item_detail_icon(roll.item_type) ?? undefined}
          />
          <div className="boxreveal__reward-name">{items_by_type[roll.item_type]?.name}</div>
          <strong className="boxreveal__quantity">×{roll.amount}</strong>
        </div>
      ) : (
        <div aria-busy="true" className="boxreveal__card boxreveal__card--resolving">
          <div aria-hidden="true" className="boxreveal__shimmer" />
          <div className="boxreveal__resolving-label">{text('revealing')}</div>
        </div>
      )}
    </div>
  )
}
