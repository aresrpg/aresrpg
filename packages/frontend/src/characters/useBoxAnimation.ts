// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useCallback, useEffect, useRef, useState } from 'react'

import { play_audio, preload_audio } from '../game/audio/audio_registry.ts'
import { box_rewards } from '../content/items.ts'
import { item_detail_icon } from '../content/item_detail_assets.ts'
import { report_error } from '../reporting.ts'

import { BOX_CHARGE_MS, BOX_BURST_MS, BOX_SPIN_MS } from './box_carousel.ts'

export type BoxPhase = 'pending' | 'charging' | 'burst' | 'spinning' | 'reveal'

/** One presentation clock; receipts name the reward, never the animation. */
export const useBoxAnimation = (identity: string | null, box: string) => {
  const [images, set_images] = useState<Readonly<{ box: string; loaded: boolean }> | null>(null)
  const ready = images?.box === box
  const spinning = box_rewards(box).length > 1
  useEffect(() => {
    let active = true
    preload_audio(['cast_charge_water', 'button_confirm', 'level_up'])
    const sources = [box, ...box_rewards(box).map(({ item_type }) => item_type)]
      .map(item_detail_icon)
      .filter((src): src is string => src !== null)
    void Promise.all(
      sources.map(async (src) => {
        const image = new Image()
        // eslint-disable-next-line functional/immutable-data -- This effect owns the newly created browser image.
        image.src = src
        await image.decode()
      })
    )
      .then(() => {
        if (active) set_images({ box, loaded: true })
      })
      .catch((error: unknown) => {
        report_error(error, { area: 'box-images' })
        // A broken image must not trap a confirmed reward behind the carousel.
        if (active) set_images({ box, loaded: false })
      })
    return () => {
      active = false
    }
  }, [box])
  const [phase, set_phase] = useState<BoxPhase>('pending')
  const stop = useRef<() => void>(() => {})
  useEffect(() => {
    if (!identity || !ready) {
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
    if (motion.matches || !images?.loaded) finish()
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
  }, [identity, spinning, ready, images?.loaded])
  useEffect(() => {
    if (phase === 'charging') play_audio('cast_charge_water', 0.22)
    if (phase === 'burst') play_audio('button_confirm', 0.17)
    if (phase === 'reveal') play_audio('level_up')
  }, [phase])
  const skip = useCallback((): void => {
    stop.current()
    set_phase('reveal')
  }, [])
  return { phase, skip }
}
