// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Zone discovery shares one search control beside the compass on every viewport.
//
// It shows exactly while a search would change state: the zone is absent or its reroll TTL elapsed.
// The key press and the button read the same predicate, so neither can offer an action the
// door would refuse.

import { IconButton } from '@aresrpg/ui'
import { Search } from 'lucide-react'
import { useMemo } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { searchable_zone } from '../modules/world.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { useWorldPose } from '../game/core/pose_feed.ts'

import { usePromptKey } from './PromptChip.tsx'

/** Discovery is a WORLD action, not an interaction with a thing — E stays for the mob group and
 *  the resource node you are pointed at, F for a fight sword's join. */
const SEARCH_KEY = 'KeyG'

export const ZonePrompt = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  // the pose feed ticks per frame outside the reducer; subscribing here is what re-evaluates
  // the predicate as the character walks across a zone boundary
  const pose = useWorldPose()
  // Zustand's React 19 snapshot must be referentially stable. Select the stored state itself,
  // then derive the short-lived target outside the external-store selector.
  const app_state = useAppStore((state) => state)
  const search_target = useMemo(() => (pose ? searchable_zone(app_state) : null), [app_state, pose])
  const search_kind = search_target?.kind ?? null

  const activate = () => {
    if (search_target) dispatch_app({ type: 'world/search_zone', target: search_target })
  }
  usePromptKey({ enabled: search_target !== null, code: SEARCH_KEY, activate })

  if (!search_kind) return null
  const text = copy_text(copy.world_hud)
  const reroll = search_kind === 'reroll'
  const template = text(reroll ? 'zone_press_reroll' : 'zone_press_search')
  return (
    <IconButton
      className="world-zone-search pointer-events-auto"
      data-world-interaction
      label={text(reroll ? 'zone_press_reroll_touch' : 'zone_press_search_touch')}
      title={template.replace('{{key}}', 'G')}
      icon={<Search className="text-emerald-400" size={20} />}
      onClick={activate}
    />
  )
}
