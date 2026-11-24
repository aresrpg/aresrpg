// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The small parts the market page's browse view and its item page share.
import { SuiLogo } from '@aresrpg/ui'
import type { ReactNode } from 'react'

import { item_icon } from '../content/assets.ts'
import { useLocale } from '../i18n/LocaleScope.tsx'
import { useText } from '../i18n/useText.ts'
import { market_item_href } from '../site/routes.ts'
import { SiteLink } from '../site/SiteShell.tsx'

import { price_change } from './market_browse.ts'
import { format_unit_price } from './price_history_model.ts'

/** A link to an item's page: a plain click stays in the site, a modified click opens a new tab. */
export const ItemLink = ({
  item_type,
  className,
  children,
}: Readonly<{ item_type: string; className: string; children: ReactNode }>) => (
  <SiteLink className={className} href={market_item_href(item_type)}>
    {children}
  </SiteLink>
)

/** An item's picture at the size its box gives it; the box is there before the picture. */
export const ItemArt = ({ item_type, className }: Readonly<{ item_type: string | null; className: string }>) => {
  const icon = item_type ? item_icon(item_type) : null
  return <span className={className}>{icon && <img alt="" src={icon} loading="lazy" decoding="async" />}</span>
}

/** A SUI amount: the blue Sui mark, then the number. No other number on the page looks like this. Relative, so its
 *  screen-reader unit stays inside a shelf that scrolls sideways; `size` sets its type where a figure leads. */
export const SuiPrice = ({ sui, size = '' }: Readonly<{ sui: number | null; size?: string }>) => {
  const locale = useLocale()
  const text = useText()
  return sui === null ? (
    <span className="text-xs/normal text-muted">{text('marketplace_page.floor_unavailable')}</span>
  ) : (
    <span
      className={`relative inline-flex items-center gap-[0.35em] font-mono whitespace-nowrap tabular-nums [&>svg]:size-[1.15em] [&>svg]:flex-none ${size}`}
    >
      <SuiLogo />
      <b className="font-bold text-text">{format_unit_price(sui, locale)}</b>
      <span className="aui-sr"> SUI</span>
    </span>
  )
}

/** The last full UTC day against the day before, signed and coloured; a dash when the item did not sell on both days. */
export const PriceChange = ({
  change_bps,
  size = 'text-[13px] leading-[normal]',
}: Readonly<{ change_bps: number | null | undefined; size?: string }>) => {
  const change = price_change(change_bps, useLocale())
  const text = useText()
  return (
    <span
      className={`font-mono font-bold whitespace-nowrap text-muted tabular-nums data-[direction=down]:text-danger data-[direction=up]:text-success ${size}`}
      data-direction={change?.direction}
      title={text('marketplace_page.change_hint')}
    >
      {change?.text ?? '—'}
    </span>
  )
}

/** A line of text that is still on its way: a skeleton of the line's own height, or of the box `size` gives it. */
export const Pending = ({ size = 'h-[1em] w-[7em]' }: Readonly<{ size?: string }>) => (
  <span aria-hidden="true" className={`aui-skeleton inline-block max-w-full align-middle ${size}`} />
)

/** One choice of a list of choices: plain text, muted, lit on hover, the chosen one in ink with a dot. */
export const Choice = ({
  chosen,
  pick,
  children,
}: Readonly<{ chosen: boolean; pick: () => void; children: ReactNode }>) => (
  <button
    aria-pressed={chosen}
    className="flex min-h-10 cursor-pointer items-center gap-2.5 text-left text-sm leading-[normal] font-medium text-muted transition-colors duration-150 ease-ui before:size-1.5 before:flex-none before:rounded-full hover:text-soft focus-visible:text-soft aria-pressed:text-text aria-pressed:before:bg-current pointer-coarse:min-h-11"
    onClick={pick}
    type="button"
  >
    {children}
  </button>
)
