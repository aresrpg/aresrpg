// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One serial presentation queue for local, streamed, and reconciled fight event batches.

import type { FightPresentationCue } from '@aresrpg/engine'

export type FightCuePhase = 'start' | 'complete'

export const create_fight_presenter = ({
  play,
  observe = () => {},
}: Readonly<{
  play: (cue: FightPresentationCue) => Promise<boolean>
  observe?: (cue: FightPresentationCue, phase: FightCuePhase) => void
}>) => {
  let tail = Promise.resolve()
  let disposed = false

  const present_one = async (cue: FightPresentationCue): Promise<void> => {
    if (disposed) return
    observe(cue, 'start')
    try {
      await play(cue)
    } catch (error) {
      console.error(`Fight presentation cue ${cue.id} failed.`, error)
    }
    if (!disposed) observe(cue, 'complete')
  }

  return Object.freeze({
    present: (cues: readonly FightPresentationCue[]): void => {
      const owned = Object.freeze([...cues])
      owned.forEach((cue) => {
        tail = tail.then(() => present_one(cue))
      })
    },
    settled: (): Promise<void> => tail,
    dispose: (): void => {
      disposed = true
    },
  })
}
