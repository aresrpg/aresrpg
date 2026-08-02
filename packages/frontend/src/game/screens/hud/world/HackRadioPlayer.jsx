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
// THE CHANNEL HANDOFF is NOT the mount itself anymore (owner ruling, hack-mode fight music): while this
// widget lives OUT of a fight, ambient_music's own beds stand down (set_music_stream_owned) — one owner per
// channel, the D226 law follow.ts already lives under. A FIGHT gives the channel straight back — the
// dungeon/world fight-music path (ambient_music's set_combat, already wired from core/modules/fight.js) then
// self-arms and plays a random biome's battle track EXACTLY like a real-world fight, because nothing else is
// holding the channel. Unmounting entirely (leaving hack mode) hands the channel back too, so a player leaving
// hack mode mid-fight or not hears the game again with their mute preference intact.
//
// THE ALBUM ITSELF pauses on the SAME fight edge (hack_radio.js's set_fight_paused) rather than tearing the
// engine down — the cursor and loaded track survive the fight, so it resumes exactly where it left off
// (never a restart at track one) the instant the channel comes back. A manual pause held into the fight stays
// paused after it; the control itself refuses to resume the album while a fight owns the channel.
//
// PERSISTS ACROSS EVERY PAGE (owner ruling): mounted by GameWorldHost (route-independent, survives every
// navigation) rather than the route-gated GameWorldHud, so leaving the world tab while hack mode is armed
// never falls back to page music — one mount, one home.
//
// This is a TEXT widget: a micro-label, the track line and one control. There is no image and no player
// region — the album streams from our own asset host as plain audio (hack_radio.js), so there is nothing to
// show and nothing third-party to keep visible.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { set_music_stream_owned } from '../../../core/audio/ambient_music.js'
import { useGameState } from '../../../store.js'
import { select_hack_presentation } from '../../../core/world_presentation.js'
import { create_radio, load_radio_tracks } from './hack_radio.js'
// Rendered outside GameWorldHud now (see the top comment) — this widget owns its own stylesheet import so its
// classes (`.gw-radio`, `.gw-panel`) load with whichever chunk mounts it first.
import './game-world-hud.css'

/** @returns {import('react').ReactElement | null} null unless the player is on the hack grid */
export function HackRadioPlayer() {
  const { t } = useTranslation()
  // The LIVE session's presentation, not a second read of the preference: GameWorldHost outlives every route
  // change, so a settings flip must reach this widget through the reducer door (embed_voxel publishes it on
  // every session (re)boot) or the radio would only appear after a page reload. Spectate is never the grid.
  const hack = useGameState(select_hack_presentation)
  // The engine's own fight flag (core/modules/fight.js dispatches it on the null↔non-null fight edge, the
  // SAME edge that drives ambient_music's set_combat) — the ONE fight signal, never a second read.
  const fight_mode = useGameState((s) => s.fight_mode)
  const radio_ref = useRef(/** @type {ReturnType<typeof create_radio>} */ (null))
  const [tracks, set_tracks] = useState(/** @type {ReadonlyArray<{ src: string, title: string }>} */ ([]))
  const [playing, set_playing] = useState(false)
  const [track, set_track] = useState('')
  const [failed, set_failed] = useState(false)

  // The handoff: our beds are silent for exactly as long as this widget lives OUT of a fight. A fight gives
  // the channel back so the world's own battle track can play (see the top comment).
  useEffect(() => {
    if (!hack || fight_mode) return undefined
    set_music_stream_owned(true)
    return () => set_music_stream_owned(false)
  }, [hack, fight_mode])

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

  // ONE engine for as long as there is a track list; it owns the single audio element and the cursor. NOT
  // re-keyed on fight_mode — a fight edge pauses/resumes this SAME engine (the effect below), it never rebuilds
  // it, so the album never restarts at track one on every fight.
  useEffect(() => {
    if (!hack || tracks.length === 0) return undefined
    radio_ref.current = create_radio(tracks, {
      on_track: set_track,
      on_playing: set_playing,
      on_error: () => set_failed(true), // never a silent failure — the widget says so on its track line
      fight_active: fight_mode, // a fight already live when hack mode is entered gets no opening beat
    })
    return () => {
      radio_ref.current?.dispose()
      radio_ref.current = null
    }
    // fight_mode deliberately NOT a dep here — it's read ONCE at construction; every later edge is driven by
    // the sync effect below (set_fight_paused), never a rebuild.
  }, [hack, tracks])

  // FIGHT EDGE: pause/resume the SAME element on every fight_mode flip — see the top comment. Idempotent
  // no-op on mount (matches the constructor's own fight_active read above).
  useEffect(() => {
    radio_ref.current?.set_fight_paused(fight_mode)
  }, [fight_mode])

  // The radio starts itself the moment it has tracks (hack_radio.js) — this control is the player's override,
  // and its pointerdown cancels any pending autoplay retry so the click that follows means what the label says.
  const on_toggle = useCallback(() => radio_ref.current?.toggle(), [])
  const on_pointer_down = useCallback(() => radio_ref.current?.dismiss_gesture_retry(), [])

  if (!hack) return null

  // `playing` already reflects the fight-forced pause (the native 'pause' event fires from set_fight_paused
  // exactly like a manual pause) — the control just also disables, so a click cannot attempt to resume the
  // album mid-fight.
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
        disabled={fight_mode || failed || !track}
        aria-label={action}
      >
        {playing ? '❚❚' : '▶'}
      </button>
    </div>
  )
}
