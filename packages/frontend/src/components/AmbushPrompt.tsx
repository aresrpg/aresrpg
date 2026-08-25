// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { selected_world_ambush } from '../modules/world_gather.ts'
import { useAppStore } from '../store.ts'

import { NametagCard } from './NametagCard.tsx'

export const AmbushPrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const protector = useAppStore(selected_world_ambush)
  if (!protector) return null
  const text = copy_text(copy.world_hud)
  return (
    <div className="pointer-events-none absolute top-[98px] left-1/2 z-20 -translate-x-1/2 translate-y-full">
      <NametagCard
        name={text('resource_ambush_title')}
        lines={[
          {
            key: 'resolving',
            text: text('resource_resolving_ambush'),
          },
        ]}
      />
    </div>
  )
}
