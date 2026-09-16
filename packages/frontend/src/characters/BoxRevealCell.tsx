// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CSSProperties } from 'react'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import type { CopyText } from '../i18n/copy.ts'

export type BoxPhase = 'pending' | 'charging' | 'burst' | 'resolving' | 'reveal'
export type BoxResult = Readonly<{ claim_id: string; item_type: string; amount: number }>

const OpeningBox = ({ item_type, phase, text }: Readonly<{ item_type: string; phase: BoxPhase; text: CopyText }>) => (
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
    {phase === 'pending' && <div className="boxreveal__label boxreveal__label--pulse">{text('unsealing')}</div>}
  </div>
)

export const BoxRevealCell = ({
  item_type,
  phase,
  roll,
  text,
}: Readonly<{ item_type: string; phase: BoxPhase; roll?: BoxResult; text: CopyText }>) => {
  if (phase !== 'reveal' && phase !== 'resolving') return <OpeningBox item_type={item_type} phase={phase} text={text} />
  return (
    <div className="boxreveal__card-wrap" onClick={(event) => event.stopPropagation()}>
      <div className="boxreveal__eyebrow">{text('reveal_eyebrow')}</div>
      {roll ? (
        <div className="boxreveal__card">
          <img
            alt=""
            className="boxreveal__pet-art"
            draggable={false}
            src={item_detail_icon(roll.item_type) ?? undefined}
          />
          <div className="boxreveal__pet-name">
            {encyclopedia_catalog.item(roll.item_type)!.item.name}
            <span> ×{roll.amount}</span>
          </div>
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
