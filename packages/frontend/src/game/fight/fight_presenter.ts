// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One serial presentation queue for local, streamed, and reconciled fight event batches.

import type { FightPresentationCue } from '@aresrpg/engine'

export type FightCuePhase = 'start' | 'complete'

const MOB_TURN_ANTICIPATION_MS = 1_000

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

  const turn_floor_remaining = (): number => Math.max(0, turn_shown_at + turn_min_ms - now())

  const wait_for_turn_floor = async (): Promise<void> => {
    const remaining = turn_floor_remaining()
    if (remaining > 0) await wait(remaining)
  }

  const present_one = async (cue: FightPresentationCue): Promise<void> => {
    if (disposed) return
    if (cue.type === 'turn') {
      const remaining = turn_floor_remaining()
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
    if (cue.type === 'turn' && turn_min_ms > 0) await wait(Math.min(MOB_TURN_ANTICIPATION_MS, turn_min_ms))
  }

  return Object.freeze({
    present: (cues: readonly FightPresentationCue[]): Promise<void> => {
      const owned = Object.freeze([...cues])
      owned.forEach((cue) => {
        tail = tail.then(() => present_one(cue))
      })
      // A streamed mob witness can end a batch before the following player's resting
      // checkpoint arrives. The batch itself therefore owns the same floor as the next cue.
      tail = tail.then(wait_for_turn_floor)
      return tail
    },
    settled: (): Promise<void> => tail,
    dispose: (): void => {
      disposed = true
    },
  })
}
