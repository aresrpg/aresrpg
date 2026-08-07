// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// HACK MODE'S RADIO (top-right, over the minimap corner) — "stream his album instead of our musics". Self-gates
// on hack mode exactly the way the Minimap self-gates on pose: off the grid, this component renders nothing and
// no byte is ever fetched for it (the manifest load lives behind the same gate).
//
// IT PLAYS ON THE EDGE, NOT THE ARRIVAL: reaching the grid is the intent to hear the album, so the engine
// starts on that OBSERVED state change as soon as the manifest lands — the button is an override, not the
// ignition, and a re-mount is not an edge. A browser that refuses the first attempt for want of a gesture is
// handled inside hack_radio.js (the widget just stays on its play button until then).
//
// THIS WIDGET OWNS NO PLAYBACK (#2260). The album's element, its cursor, the manifest and the channel handoff
// all live in hack_radio_latch.js, armed once per page load and driven by OBSERVED STATE DELTAS — so a canvas
// refresh that re-mounts this widget re-observes the same slice and the music plays straight through instead of
// starting a second racing radio. Here: the gate, the markup, a subscription to the latch's snapshot, and two
// control calls.
//
// THE CHANNEL HANDOFF (owner ruling, hack-mode fight music): while the session is on the grid OUT of a fight,
// ambient_music's own beds stand down (set_music_stream_owned) — one owner per channel, the D226 law follow.ts
// already lives under. A FIGHT gives the channel straight back — the dungeon/world fight-music path
// (ambient_music's set_combat, already wired from core/modules/fight.js) then self-arms and plays a random
// biome's battle track EXACTLY like a real-world fight, because nothing else is holding the channel. Leaving
// hack mode hands the channel back too, with the player's mute preference intact.
//
// THE ALBUM ITSELF pauses on the SAME fight edge (hack_radio.js's set_channel_held) rather than tearing the
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

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

import { useGameState } from '../../../store.js'
import { select_hack_presentation } from '../../../core/world_presentation.js'
import {
  arm_radio_latch,
  radio_dismiss_gesture_retry,
  radio_snapshot,
  radio_toggle,
  subscribe_radio,
} from './hack_radio_latch.js'
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
  // The latch's own snapshot — read, never owned. A re-mount gets the LIVE track line back instantly (the
  // same snapshot object until something really changes), so nothing here re-derives playback state.
  const { track, playing, failed } = useSyncExternalStore(subscribe_radio, radio_snapshot, radio_snapshot)

  // Arm the standing observer once per page load. Idempotent, and deliberately WITHOUT a cleanup: playback
  // follows the state, so this widget's unmount must never stop the album (#2260).
  useEffect(() => {
    arm_radio_latch()
  }, [])

  // The radio starts itself the moment it has tracks (hack_radio.js) — this control is the player's override,
  // and its pointerdown cancels any pending autoplay retry so the click that follows means what the label says.
  const on_toggle = useCallback(radio_toggle, [])
  const on_pointer_down = useCallback(radio_dismiss_gesture_retry, [])

  if (!hack) return null

  // `playing` already reflects the fight-forced pause (the native 'pause' event fires from set_channel_held
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
