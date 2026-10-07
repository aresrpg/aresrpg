// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useCallback, useEffect, useRef, useState } from 'react'

import { play_audio } from '../game/audio/audio_registry.ts'

import { BOX_CHARGE_MS, BOX_BURST_MS, BOX_SPIN_MS } from './box_carousel.ts'

export type BoxPhase = 'pending' | 'charging' | 'burst' | 'spinning' | 'reveal'

/** One presentation clock; receipts name the reward, never the animation. */
export const useBoxAnimation = (identity: string | null, spinning = true) => {
  const [phase, set_phase] = useState<BoxPhase>('pending')
  const stop = useRef<() => void>(() => {})
  useEffect(() => {
    if (!identity) {
      set_phase('pending')
      return
    }
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const timers: ReturnType<typeof setTimeout>[] = []
    const cancel = (): void => timers.forEach(clearTimeout)
    const finish = (): void => {
      cancel()
      set_phase('reveal')
    }
    // eslint-disable-next-line functional/immutable-data -- This ref owns cancellation for the current presentation lifetime.
    stop.current = cancel
    if (motion.matches) finish()
    else {
      set_phase('charging')
      // eslint-disable-next-line functional/immutable-data -- These timers belong only to this effect and are all cleared on teardown.
      timers.push(setTimeout(() => set_phase('burst'), BOX_CHARGE_MS))
      if (spinning) {
        // eslint-disable-next-line functional/immutable-data -- These timers belong only to this effect and are all cleared on teardown.
        timers.push(setTimeout(() => set_phase('spinning'), BOX_CHARGE_MS + BOX_BURST_MS))
      }
      // eslint-disable-next-line functional/immutable-data -- These timers belong only to this effect and are all cleared on teardown.
      timers.push(setTimeout(finish, BOX_CHARGE_MS + BOX_BURST_MS + (spinning ? BOX_SPIN_MS + 450 : 0)))
    }
    const change = (): void => {
      if (motion.matches) finish()
    }
    motion.addEventListener('change', change)
    return () => {
      cancel()
      motion.removeEventListener('change', change)
    }
  }, [identity, spinning])
  useEffect(() => {
    if (phase === 'charging') play_audio('cast_charge_water', 0.22)
    if (phase === 'burst') play_audio('button_confirm', 0.17)
    if (phase === 'reveal') play_audio('loot_open')
  }, [phase])
  const skip = useCallback((): void => {
    stop.current()
    set_phase('reveal')
  }, [])
  return { phase, skip }
}
