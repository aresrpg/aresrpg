// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What a Mastery crate can hold: each item with how many and the chance to get it, each opening its docs page in a
// new tab, then the crate's own docs page.
import { ArrowUpRight, BookOpen } from 'lucide-react'

import { NewTabLink } from '../components/links.tsx'
import { ModalFrame } from '../components/ModalFrame.tsx'
import { item_icon } from '../content/assets.ts'
import { items_by_type } from '../content/items.ts'
import { titleize } from '../content/titles.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { useNumbers } from '../i18n/useNumbers.ts'

import { offer_view } from './model.ts'

const item_name = (item_type: string): string => items_by_type[item_type]?.name ?? titleize(item_type)

export const CrateContents = ({
  copy,
  item_type,
  close,
}: Readonly<{ copy: AppCopy; item_type: string; close: () => void }>) => {
  const numbers = useNumbers()
  const text = encyclopedia_text(copy)
  const { href, contents } = offer_view(item_type)
  // One sure reward is the crate's reward; several are chances.
  const random = (contents?.length ?? 0) > 1
  return (
    <ModalFrame label={item_name(item_type)} close={close} close_label={copy.wallet_close} max_width="max-w-sm">
      <div className="grid gap-3 px-4 pt-1 pb-4" data-mastery-crate={item_type}>
        <h3 className="text-xs font-semibold tracking-[0.16em] text-muted uppercase">
          {text(random ? 'consumable_rewards' : 'consumable_reward_heading')}
        </h3>
        <ul className="grid gap-1.5">
          {contents?.map((reward) => {
            const icon = item_icon(reward.item_type)
            const name = item_name(reward.item_type)
            return (
              <li key={reward.item_type}>
                <NewTabLink
                  className="group flex min-h-11 items-center gap-3 rounded-ui border border-line bg-surface-low px-3 py-1.5 text-sm text-text no-underline hover:border-line-strong"
                  href={reward.href}
                  new_tab={copy.site.new_tab}
                >
                  {icon && <img className="size-8 flex-none object-contain" src={icon} alt="" />}
                  <span className="min-w-0 flex-1 truncate">
                    {random ? text('consumable_reward', { item: name, chance: numbers.decimal(reward.percent) }) : name}
                  </span>
                  {reward.amount > 1 && <b className="font-mono tabular-nums">×{numbers.number(reward.amount)}</b>}
                  <ArrowUpRight className="flex-none opacity-45 group-hover:opacity-100" size={14} aria-hidden="true" />
                </NewTabLink>
              </li>
            )
          })}
        </ul>
        <NewTabLink
          className="aui-button aui-button--neutral min-h-11 w-fit gap-2 no-underline"
          href={href}
          new_tab={copy.site.new_tab}
        >
          <BookOpen size={16} aria-hidden="true" />
          {copy.encyclopedia}
        </NewTabLink>
      </div>
    </ModalFrame>
  )
}
