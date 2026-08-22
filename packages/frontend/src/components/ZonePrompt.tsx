// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ZONE DISCOVERY PROMPT — the one HUD-anchored nametag. Every other card in the game floats
// over a body the engine positions; this one names the ground you are standing on, which has no
// crown to hang from, so it sits under the compass instead. Same card, different anchor.
//
// It shows exactly while a search would work: the zone under the character has no row, so it has
// never been searched (an unsearched zone is ABSENT from the graph, never present and empty).
// The key press and the card read the same predicate, so the chip can never offer a press the
// door would refuse.

/* eslint-disable functional/prefer-immutable-types -- React lifecycle boundary. */
import { useEffect } from 'react'

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
  const searchable = useAppStore((state) => (pose ? searchable_zone(state) !== null : false))

  useEffect(() => {
    if (!searchable) return
    const on_key = (event: KeyboardEvent): void => {
      if (event.code !== SEARCH_KEY || event.repeat) return
      // never steal the key from a text field — the chat bar lives on this same screen
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target?.tagName ?? '')) return
      event.preventDefault()
      dispatch_app({ type: 'world/search_zone' })
    }
    globalThis.addEventListener('keydown', on_key)
    return () => globalThis.removeEventListener('keydown', on_key)
  }, [searchable])

  if (!searchable) return null
  const text = copy_text(copy.world_hud)
  const [before, after] = split_key_template(text('zone_press_search'))
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
          name={text('zone_unsearched_title')}
        />
      </div>
    </div>
  )
}
