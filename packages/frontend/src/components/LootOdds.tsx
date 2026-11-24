// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What a crate can give: one tile per reward with its picture, its amount and, when the crate draws at random, its
// chance as a figure and a bar. The likeliest come first; the rarest carries the gold of a jackpot.
import type { ReactNode } from 'react'

import { item_detail_icon } from '../content/item_detail_assets.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

export type LootReward = Readonly<{ item_type: string; name: string; amount: number; percent: number }>

const TILE =
  'group relative grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-ui border border-line bg-surface-low px-3 py-2.5 text-left text-text no-underline shadow-none hover:border-line-strong'

/** `wrap` gives each tile its door: a button that opens the item here, or a link to its page. */
export const LootOdds = ({
  rewards,
  random,
  wrap,
}: Readonly<{
  rewards: readonly LootReward[]
  /** Whether the crate draws one reward at random; a sure reward shows no chance. */
  random: boolean
  wrap: (reward: LootReward, tile_class: string, tile: Readonly<ReactNode>) => ReactNode
}>) => {
  const numbers = useNumbers()
  const ordered = rewards.toSorted((left, right) => right.percent - left.percent)
  const rarest = Math.min(...rewards.map(({ percent }) => percent))
  const jackpot = random && rewards.some(({ percent }) => percent > rarest)
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2" data-loot-rewards="">
      {ordered.map((reward) => {
        const icon = item_detail_icon(reward.item_type)
        return (
          <li key={reward.item_type} className="contents">
            {wrap(
              reward,
              `${TILE} ${jackpot && reward.percent === rarest ? 'border-hue-gold/45 bg-hue-gold/6' : ''}`,
              <>
                <span className="grid size-14 place-items-center">
                  {icon && (
                    <img
                      className="max-h-full max-w-full object-contain drop-shadow-[0_4px_6px_#0008]"
                      src={icon}
                      alt=""
                      loading="lazy"
                    />
                  )}
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="line-clamp-2 text-sm leading-tight font-bold wrap-anywhere">{reward.name}</span>
                  <span className="font-mono text-xs text-muted tabular-nums">×{numbers.number(reward.amount)}</span>
                </span>
                {random && (
                  <b
                    className={`font-mono text-base tabular-nums ${jackpot && reward.percent === rarest ? 'text-hue-gold' : 'text-soft'}`}
                  >
                    {numbers.decimal(reward.percent)}%
                  </b>
                )}
                {random && (
                  <span
                    className={`absolute bottom-0 left-0 h-0.5 ${jackpot && reward.percent === rarest ? 'bg-hue-gold' : 'bg-gold/55'}`}
                    style={{ width: `${Math.min(100, reward.percent)}%` }}
                    aria-hidden="true"
                  />
                )}
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
