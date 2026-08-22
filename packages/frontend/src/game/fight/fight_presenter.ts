// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One serial presentation queue for local, streamed, and reconciled fight event batches.

import type { FightPresentationCue } from '@aresrpg/engine'

export type FightCuePhase = 'start' | 'complete'

export const create_fight_presenter = ({
  play,
  observe = () => {},
  now = () => performance.now(),
  wait = (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: Readonly<{
  play: (cue: FightPresentationCue) => Promise<boolean>
  observe?: (cue: FightPresentationCue, phase: FightCuePhase) => void
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
}>) => {
  let tail = Promise.resolve()
  let disposed = false
  let turn_shown_at = 0
  let turn_min_ms = 0

  const present_one = async (cue: FightPresentationCue): Promise<void> => {
    if (disposed) return
    if (cue.type === 'turn') {
      const remaining = turn_shown_at + turn_min_ms - now()
      if (remaining > 0) await wait(remaining)
      if (disposed) return
      turn_shown_at = now()
      turn_min_ms = cue.min_ms ?? 0
    }
    observe(cue, 'start')
    try {
      await play(cue)
    } catch (error) {
      console.error(`Fight presentation cue ${cue.id} failed.`, error)
    }
    if (!disposed) observe(cue, 'complete')
  }

  return Object.freeze({
    present: (cues: readonly FightPresentationCue[]): Promise<void> => {
      const owned = Object.freeze([...cues])
      owned.forEach((cue) => {
        tail = tail.then(() => present_one(cue))
      })
      return tail
    },
    settled: (): Promise<void> => tail,
    dispose: (): void => {
      disposed = true
    },
  })
}
