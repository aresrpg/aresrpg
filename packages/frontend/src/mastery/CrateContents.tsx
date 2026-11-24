// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What a Mastery crate can hold: each item with how many and the chance to get it, each opening its docs page in a
// new tab, then the crate's own docs page.
import { BookOpen } from 'lucide-react'

import { NewTabLink } from '../components/links.tsx'
import { LootOdds } from '../components/LootOdds.tsx'
import { ModalFrame } from '../components/ModalFrame.tsx'
import { items_by_type } from '../content/items.ts'
import { titleize } from '../content/titles.ts'
import { encyclopedia_text } from '../encyclopedia/copy.ts'
import type { AppCopy } from '../i18n/copy.ts'

import { offer_view } from './model.ts'

const item_name = (item_type: string): string => items_by_type[item_type]?.name ?? titleize(item_type)

export const CrateContents = ({
  copy,
  item_type,
  close,
}: Readonly<{ copy: AppCopy; item_type: string; close: () => void }>) => {
  const text = encyclopedia_text(copy)
  const { href, contents } = offer_view(item_type)
  // One sure reward is the crate's reward; several are chances.
  const random = (contents?.length ?? 0) > 1
  return (
    <ModalFrame label={item_name(item_type)} close={close} close_label={copy.wallet_close} max_width="max-w-xl">
      <div className="grid gap-3 px-4 pt-1 pb-4" data-mastery-crate={item_type}>
        <h3 className="text-xs font-semibold tracking-[0.16em] text-muted uppercase">
          {text(random ? 'consumable_rewards' : 'consumable_reward_heading')}
        </h3>
        <LootOdds
          random={random}
          rewards={(contents ?? []).map((reward) => ({ ...reward, name: item_name(reward.item_type) }))}
          wrap={(reward, tile_class, tile) => (
            <NewTabLink
              className={tile_class}
              href={(contents ?? []).find(({ item_type }) => item_type === reward.item_type)!.href}
              new_tab={copy.site.new_tab}
            >
              {tile}
            </NewTabLink>
          )}
        />
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
