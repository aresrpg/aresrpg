// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef, useState } from 'react'

import { play_audio, preload_audio } from '../game/audio/audio_registry.ts'

export const useRewardReveal = (total: number, active: boolean) => {
  const [visible, set_visible] = useState(0)
  const [reduced, set_reduced] = useState(false)
  const sounded = useRef(0)
  useEffect(() => {
    preload_audio(['loot_open', 'gather', 'level_up'])
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = (): void => set_reduced(motion.matches)
    sync()
    motion.addEventListener('change', sync)
    return () => motion.removeEventListener('change', sync)
  }, [])
  useEffect(() => {
    if (!active || visible >= total) return undefined
    if (reduced) {
      set_visible(total)
      return undefined
    }
    const timer = setTimeout(() => set_visible((count) => Math.min(total, count + 1)), visible === 0 ? 250 : 850)
    return () => clearTimeout(timer)
  }, [active, reduced, total, visible])
  useEffect(() => {
    if (!active || visible <= sounded.current) return
    // eslint-disable-next-line functional/immutable-data -- The modal lifetime retains its last sounded reveal across combat pauses.
    sounded.current = visible
    play_audio(visible === total ? 'level_up' : visible === 1 ? 'loot_open' : 'gather')
  }, [active, total, visible])
  return { visible, reveal_all: (): void => set_visible(total) }
}
