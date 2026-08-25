// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ZONE DISCOVERY PROMPT — the one HUD-anchored nametag. Every other card in the game floats
// over a body the engine positions; this one names the ground you are standing on, which has no
// crown to hang from, so it sits under the compass instead. Same card, different anchor.
//
// It shows exactly while a search would change state: the zone is absent or its reroll TTL elapsed.
// The key press and the card read the same predicate, so the chip can never offer a press the
// door would refuse.

/* eslint-disable functional/prefer-immutable-types -- React lifecycle boundary. */
import { useEffect, useMemo } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { searchable_zone } from '../modules/world.ts'
import { dispatch_app, useAppStore } from '../store.ts'
import { useWorldPose } from '../game/core/pose_feed.ts'

import { NametagCard } from './NametagCard.tsx'
import { PromptKey, split_key_template } from './PromptChip.tsx'

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

  useEffect(() => {
    if (!search_target) return
    const on_key = (event: KeyboardEvent): void => {
      if (event.code !== SEARCH_KEY || event.repeat) return
      // never steal the key from a text field — the chat bar lives on this same screen
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '')) return
      event.preventDefault()
      dispatch_app({ type: 'world/search_zone', target: search_target })
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [search_target])

  if (!search_kind) return null
  const text = copy_text(copy.world_hud)
  const reroll = search_kind === 'reroll'
  const [before, after] = split_key_template(text(reroll ? 'zone_press_reroll' : 'zone_press_search'))
  return (
    <div className="pointer-events-none absolute top-[68px] left-1/2 z-20 -translate-x-1/2">
      {/* the card hangs BELOW its anchor here (it is under the compass, not over a crown), so
          the shared card's upward shift is cancelled rather than re-styled */}
      <div className="translate-y-full">
        <NametagCard
          lines={[
            {
              key: 'press',
              text: (
                <span className="inline-flex items-center gap-1.5">
                  {before?.trim()}
                  <PromptKey label="G" />
                  {after?.trim()}
                </span>
              ),
            },
          ]}
          name={text(reroll ? 'zone_reroll_title' : 'zone_unsearched_title')}
        />
      </div>
    </div>
  )
}
