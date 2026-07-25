// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE'S RADIO (top-right, over the minimap corner) — "start streaming this playlist instead of our
// musics". Self-gates on hack mode exactly the way the Minimap self-gates on pose: off the grid, this
// component renders nothing and no byte is ever fetched from youtube.com (youtube_stream.js's lazy loader).
//
// THE CHANNEL HANDOFF is the mount itself: while this widget lives, ambient_music's own beds stand down
// (set_music_stream_owned) — one owner per channel, the D226 law follow.ts already lives under. Unmount hands
// the channel back, so a player leaving hack mode hears the game again with their mute preference intact.
// It deliberately does NOT hide during a fight (unlike the minimap): the radio dying on every fight enter
// would kill the stream, un-suppress the battle bed, and lose the player's place in the playlist.
//
// The track title comes from the API's own `getVideoData()`, read on the state changes YouTube already
// pushes (ready + every track transition) — no polling loop.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { set_music_stream_owned } from '../../../core/audio/ambient_music.js'
import { use_game_state } from '../../../store.js'
import {
  HACK_PLAYLIST_ID,
  is_playing_state,
  load_youtube_iframe_api,
  stream_player_options,
  video_title,
} from './youtube_stream.js'

/** @returns {import('react').ReactElement | null} null unless the player is on the hack grid */
export function YoutubeStreamPlayer() {
  const { t } = useTranslation()
  // The LIVE session's presentation, not a second read of the preference: GameWorldHost outlives every route
  // change, so a settings flip must reach this widget through the reducer door (embed_voxel publishes it on
  // every session (re)boot) or the radio would only appear after a page reload. Spectate is never the grid.
  const hack = use_game_state((state) => state.world_presentation === 'hackgrid')
  const mount_ref = useRef(/** @type {HTMLDivElement | null} */ (null))
  const player_ref = useRef(/** @type {any} */ (null))
  const [playing, set_playing] = useState(false)
  const [track, set_track] = useState('')
  const [failed, set_failed] = useState(false)

  // The handoff: our beds are silent for exactly as long as this widget exists.
  useEffect(() => {
    if (!hack) return undefined
    set_music_stream_owned(true)
    return () => set_music_stream_owned(false)
  }, [hack])

  useEffect(() => {
    if (!hack) return undefined
    let disposed = false
    load_youtube_iframe_api()
      .then((YT) => {
        if (disposed || !mount_ref.current) return
        // YT REPLACES the element it is handed with its iframe — give it a throwaway child so React never
        // loses the node it owns (removing a stolen node throws on unmount).
        const target = document.createElement('div')
        mount_ref.current.appendChild(target)
        player_ref.current = new YT.Player(target, {
          ...stream_player_options(HACK_PLAYLIST_ID, location.origin),
          events: {
            onReady: ({ target: player }) => set_track(video_title(player)),
            onStateChange: ({ data, target: player }) => {
              set_playing(is_playing_state(data))
              set_track(video_title(player)) // every track transition pushes one of these — no polling
            },
            onError: () => set_failed(true),
          },
        })
      })
      .catch(() => set_failed(true)) // never a silent failure — the widget says so on its title line
    return () => {
      disposed = true
      player_ref.current?.destroy?.()
      player_ref.current = null
    }
  }, [hack])

  // The user gesture browsers (and YouTube) require: playback only ever starts from this click.
  const on_toggle = useCallback(() => {
    const player = player_ref.current
    if (!player) return
    if (playing) player.pauseVideo?.()
    else player.playVideo?.()
  }, [playing])

  if (!hack) return null

  const action = playing ? t('world.youtube_stream_pause') : t('world.youtube_stream_play')
  return (
    <div className="gw-ytp gw-panel">
      {/* Kept VISIBLE on purpose — YouTube's terms require the player itself to be seen; our chrome below
          replaces its CONTROLS, not the player. */}
      <div className="gw-ytp__screen" ref={mount_ref} />
      <div className="gw-ytp__bar">
        <div className="gw-ytp__text">
          <span className="gw-ytp__lbl">{t('world.youtube_stream_label')}</span>
          <span className="gw-ytp__track" title={track || undefined}>
            {failed ? t('world.youtube_stream_error') : track || t('world.youtube_stream_loading')}
          </span>
        </div>
        <button type="button" className="gw-ytp__btn" onClick={on_toggle} disabled={failed} aria-label={action}>
          {playing ? '❚❚' : '▶'}
        </button>
      </div>
    </div>
  )
}
