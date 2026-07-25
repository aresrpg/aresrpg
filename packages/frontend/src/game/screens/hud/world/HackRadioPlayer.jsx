// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE'S RADIO (top-right, over the minimap corner) — "stream his album instead of our musics". Self-gates
// on hack mode exactly the way the Minimap self-gates on pose: off the grid, this component renders nothing and
// no byte is ever fetched for it (the manifest load lives behind the same gate).
//
// IT PLAYS ON ARRIVAL: arming hack mode is the intent to hear the album, so the engine starts as soon as the
// manifest lands — the button is an override, not the ignition. A browser that refuses the first attempt for
// want of a gesture is handled inside hack_radio.js (the widget just stays on its play button until then).
//
// THE CHANNEL HANDOFF is the mount itself: while this widget lives, ambient_music's own beds stand down
// (set_music_stream_owned) — one owner per channel, the D226 law follow.ts already lives under. Unmount hands
// the channel back, so a player leaving hack mode hears the game again with their mute preference intact.
// It deliberately does NOT hide during a fight (unlike the minimap): the radio dying on every fight enter
// would kill the stream, un-suppress the battle bed, and lose the player's place in the album.
//
// This is a TEXT widget: a micro-label, the track line and one control. There is no image and no player
// region — the album streams from our own asset host as plain audio (hack_radio.js), so there is nothing to
// show and nothing third-party to keep visible.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { set_music_stream_owned } from '../../../core/audio/ambient_music.js'
import { use_game_state } from '../../../store.js'
import { select_hack_presentation } from '../../../core/world_presentation.js'
import { create_radio, load_radio_tracks } from './hack_radio.js'

/** @returns {import('react').ReactElement | null} null unless the player is on the hack grid */
export function HackRadioPlayer() {
  const { t } = useTranslation()
  // The LIVE session's presentation, not a second read of the preference: GameWorldHost outlives every route
  // change, so a settings flip must reach this widget through the reducer door (embed_voxel publishes it on
  // every session (re)boot) or the radio would only appear after a page reload. Spectate is never the grid.
  const hack = use_game_state(select_hack_presentation)
  const radio_ref = useRef(/** @type {ReturnType<typeof create_radio>} */ (null))
  const [tracks, set_tracks] = useState(/** @type {ReadonlyArray<{ src: string, title: string }>} */ ([]))
  const [playing, set_playing] = useState(false)
  const [track, set_track] = useState('')
  const [failed, set_failed] = useState(false)

  // The handoff: our beds are silent for exactly as long as this widget exists.
  useEffect(() => {
    if (!hack) return undefined
    set_music_stream_owned(true)
    return () => set_music_stream_owned(false)
  }, [hack])

  // The manifest re-enters as an INPUT — the async result sets state, it never reaches into the engine below.
  useEffect(() => {
    if (!hack) return undefined
    let disposed = false
    load_radio_tracks().then((result) => {
      if (disposed) return
      set_tracks(result.tracks)
      set_failed(result.error)
    })
    return () => {
      disposed = true
    }
  }, [hack])

  // ONE engine for as long as there is a track list; it owns the single audio element and the cursor.
  useEffect(() => {
    if (!hack || tracks.length === 0) return undefined
    radio_ref.current = create_radio(tracks, {
      on_track: set_track,
      on_playing: set_playing,
      on_error: () => set_failed(true), // never a silent failure — the widget says so on its track line
    })
    return () => {
      radio_ref.current?.dispose()
      radio_ref.current = null
    }
  }, [hack, tracks])

  // The radio starts itself the moment it has tracks (hack_radio.js) — this control is the player's override,
  // and its pointerdown cancels any pending autoplay retry so the click that follows means what the label says.
  const on_toggle = useCallback(() => radio_ref.current?.toggle(), [])
  const on_pointer_down = useCallback(() => radio_ref.current?.dismiss_gesture_retry(), [])

  if (!hack) return null

  const action = playing ? t('world.radio_pause') : t('world.radio_play')
  return (
    <div className="gw-radio gw-panel">
      <div className="gw-radio__text">
        <span className="gw-radio__lbl">{t('world.radio_label')}</span>
        <span className="gw-radio__track" title={track || undefined}>
          {failed ? t('world.radio_error') : track || t('world.radio_loading')}
        </span>
      </div>
      <button
        type="button"
        className="gw-radio__btn"
        onClick={on_toggle}
        onPointerDown={on_pointer_down}
        disabled={failed || !track}
        aria-label={action}
      >
        {playing ? '❚❚' : '▶'}
      </button>
    </div>
  )
}
