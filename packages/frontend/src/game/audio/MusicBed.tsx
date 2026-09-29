// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- browser media and its React ref belong to this lifecycle edge. */
import { useEffect, useRef } from 'react'

import { useAppStore } from '../../store.ts'
import { master_volume_from, scale_audio_volume } from '../core/audio_volume.ts'

const MUSIC_VOLUME = 0.35
const play = (player: Readonly<HTMLAudioElement>): void => {
  void player.play().catch((error: unknown) => {
    if (!(error instanceof DOMException) || error.name !== 'NotAllowedError')
      console.warn('Music could not play.', error)
  })
}
export const MusicBed = ({ url }: Readonly<{ url: string | null }>) => {
  const enabled = useAppStore(({ settings }) => settings.music_enabled)
  const master_volume = useAppStore(({ settings }) => master_volume_from(settings.master_volume))
  const player_ref = useRef<HTMLAudioElement | null>(null)
  const source = enabled ? url : null
  useEffect(() => {
    const player = player_ref.current
    if (!source) {
      player?.pause()
      return
    }
    const active_player = player ?? new Audio()
    if (!player) player_ref.current = active_player
    active_player.pause()
    active_player.src = source
    active_player.loop = true
    active_player.preload = 'auto'
    active_player.volume = scale_audio_volume(MUSIC_VOLUME)
    active_player.load()
    play(active_player)
  }, [source])

  useEffect(() => {
    if (player_ref.current) player_ref.current.volume = scale_audio_volume(MUSIC_VOLUME, master_volume)
  }, [master_volume])

  useEffect(() => {
    const resume = (): void => {
      const player = player_ref.current
      if (source && player?.paused) play(player)
    }
    globalThis.addEventListener('pointerdown', resume)
    globalThis.addEventListener('keydown', resume)
    return () => {
      globalThis.removeEventListener('pointerdown', resume)
      globalThis.removeEventListener('keydown', resume)
    }
  }, [source])

  useEffect(
    () => () => {
      player_ref.current?.pause()
      player_ref.current = null
    },
    []
  )

  return null
}
