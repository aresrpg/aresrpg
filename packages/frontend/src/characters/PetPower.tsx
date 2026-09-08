// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pet_max_feeds } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'

import type { CopyText } from '../i18n/copy.ts'

export const PetPower = ({
  item,
  text,
}: Readonly<{ item: Readonly<Pick<ItemRow, 'category' | 'pet_power'>>; text: CopyText }>) => {
  if (item.category !== 'pet') return null
  const power = Math.min(pet_max_feeds, Math.max(0, item.pet_power ?? 0))
  return (
    <section className="flex w-full flex-col gap-2" data-pet-power="">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[8px] tracking-[0.18em] text-muted uppercase">{text('feed_power_label')}</span>
        <span className="text-[10px] text-gold tabular-nums">
          {text('feed_power', { count: power, max: pet_max_feeds })}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden border border-gold/15 bg-gold/5"
        role="progressbar"
        aria-label={text('feed_power_label')}
        aria-valuemin={0}
        aria-valuemax={pet_max_feeds}
        aria-valuenow={power}
      >
        <div
          className="h-full bg-gradient-to-r from-gold/60 to-gold transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${(power / pet_max_feeds) * 100}%` }}
        />
      </div>
    </section>
  )
}
