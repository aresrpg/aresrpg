// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef } from 'react'

import type { create_world } from '../game/core/world.ts'
import { report_error } from '../reporting.ts'
import { dispatch_app, useAppStore } from '../store.ts'

import type { AdventurePositions } from './actors.ts'
import { play_adventure_ending } from './ending.ts'
import { ADVENTURE_ENCOUNTERS } from './content.ts'
import './rebirth.css'

export const AdventureEnding = ({
  world,
  positions,
}: Readonly<{
  world: ReturnType<typeof create_world> | null
  positions: AdventurePositions
}>) => {
  const hero = useAppStore((state) => state.adventure.character)
  const companion = useAppStore((state) => state.adventure.companion)
  const active = useAppStore(
    (state) =>
      state.adventure.result?.winner === 0 &&
      (state.adventure.phase === 'ending' || state.adventure.phase === 'complete')
  )
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const overlay = root.current
    if (!active || !world || !hero || !overlay) return
    const controller = new AbortController()
    const fallback = ADVENTURE_ENCOUNTERS.at(-1)!.position
    const origin = positions.get(hero.id) ?? ([fallback.x, fallback.y, fallback.z] as const)
    const finish = () => {
      if (!controller.signal.aborted) dispatch_app({ type: 'adventure/ending_finished' })
    }
    void play_adventure_ending({
      world,
      roster: [hero, companion].filter((character) => character !== null),
      origin,
      signal: controller.signal,
      reduced_motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      present: ({ blur, dying }) => {
        overlay.style.setProperty('--ending-blur', `${blur}px`)
        overlay.setAttribute('data-stage', dying ? 'dying' : blur > 0 ? 'poison' : 'orbit')
      },
    })
      .then(finish)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        report_error(error, { area: 'adventure', action: 'ending' })
        finish()
      })
    return () => controller.abort()
  }, [active, companion, hero, positions, world])
  return active ? (
    <div ref={root} className="adventure-ending" data-adventure-ending="" data-stage="loading" aria-hidden="true" />
  ) : null
}
