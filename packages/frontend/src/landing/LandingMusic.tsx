// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- this component owns its native audio element's lifecycle. */
import { Volume2, VolumeX } from 'lucide-react'
import { useEffect, useReducer, useRef } from 'react'

import { load_enabled, load_volume, save_enabled } from './landing_sound.ts'

const start_music = (player: Readonly<HTMLAudioElement>): void => {
  void player.play().catch((error: unknown) => {
    // Autoplay waits for a gesture; source removal on unmount aborts pending playback.
    if (error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name)) return
    console.warn('Landing music could not play.', error)
  })
}

export const LandingMusic = ({ enable_label, mute_label }: Readonly<{ enable_label: string; mute_label: string }>) => {
  const [enabled, set_enabled] = useReducer(
    (_previous: boolean, next: boolean) => next,
    true,
    () => load_enabled()
  )
  const audio_ref = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const player = audio_ref.current
    if (!player) return
    player.volume = load_volume()
    const resume = (event: Readonly<Event>): void => {
      if (event.target instanceof Element && event.target.closest('[data-landing-sound]')) return
      if (!player.muted && player.paused) start_music(player)
    }
    const pause = (): void => player.pause()
    globalThis.addEventListener('pointerdown', resume)
    globalThis.addEventListener('keydown', resume)
    globalThis.addEventListener('pageshow', resume)
    globalThis.addEventListener('pagehide', pause)
    return () => {
      globalThis.removeEventListener('pointerdown', resume)
      globalThis.removeEventListener('keydown', resume)
      globalThis.removeEventListener('pageshow', resume)
      globalThis.removeEventListener('pagehide', pause)
      player.pause()
      player.removeAttribute('src')
      player.load()
    }
  }, [])

  useEffect(() => {
    save_enabled(enabled)
    const player = audio_ref.current
    if (!player) return
    if (enabled) start_music(player)
    else player.pause()
  }, [enabled])

  const toggle = (): void => {
    const player = audio_ref.current
    if (player) {
      player.muted = enabled
      if (enabled) player.pause()
      else start_music(player) // Stay inside the trusted click for mobile autoplay policies.
    }
    set_enabled(!enabled)
  }

  const label = enabled ? mute_label : enable_label
  return (
    <>
      <audio hidden loop muted={!enabled} preload="none" ref={audio_ref} src="/landing/pixel-journey.mp3" />
      <button
        aria-label={label}
        aria-pressed={enabled}
        className="landing-sound"
        data-landing-sound
        onClick={toggle}
        title={label}
        type="button"
      >
        {enabled ? <Volume2 aria-hidden size={19} /> : <VolumeX aria-hidden size={19} />}
      </button>
    </>
  )
}
