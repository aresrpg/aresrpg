// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- React refs own the private cooldown and timer effect handles. */

import { useEffect, useRef, useState } from 'react'

import { city_at_position } from '../content/worlds.ts'
import { titleize } from '../content/catalog.ts'
import { play_procedural_cue } from '../game/audio/procedural_cues.ts'
import { pose_matches_character, useWorldPose } from '../game/core/pose_feed.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { copy_text } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import './city_arrival_banner.css'

export const CITY_ARRIVAL_COOLDOWN_MS = 5 * 60 * 1_000
const CITY_TITLE_DURATION_MS = 4_800

export type CityArrivalMemory = Readonly<{
  inside: string | null
  shown_at: Readonly<Record<string, number>>
}>

export const initial_city_arrival_memory = (): CityArrivalMemory => Object.freeze({ inside: null, shown_at: {} })

export const city_arrival_after = (
  memory: CityArrivalMemory,
  city: string | null | undefined,
  now: number
): Readonly<{ memory: CityArrivalMemory; entered: boolean }> => {
  if (city === undefined) return Object.freeze({ memory, entered: false })
  if (city === memory.inside) return Object.freeze({ memory, entered: false })
  if (city === null) return Object.freeze({ memory: Object.freeze({ ...memory, inside: null }), entered: false })
  const last = memory.shown_at[city]
  const entered = last === undefined || now - last >= CITY_ARRIVAL_COOLDOWN_MS
  return Object.freeze({
    memory: Object.freeze({
      inside: city,
      shown_at: entered ? Object.freeze({ ...memory.shown_at, [city]: now }) : memory.shown_at,
    }),
    entered,
  })
}

export const CityArrivalContent = ({ title }: Readonly<{ title: string | null }>) =>
  title ? (
    <div aria-live="polite" className="city-arrival" role="status">
      <div className="city-arrival__ornament" />
      <div className="city-arrival__title">{title}</div>
      <div className="city-arrival__ornament is-lower" />
    </div>
  ) : null

export const CityArrivalBanner = ({ active, copy }: Readonly<{ active: boolean; copy: AppCopy }>) => {
  const pose = useWorldPose()
  const selected_character_id = useAppStore(({ session }) => session.selected_character_id)
  const world = useAppStore(
    ({ session }) => session.characters.find(({ id }) => id === session.selected_character_id)?.world ?? null
  )
  const music_enabled = useAppStore(({ settings }) => settings.music_enabled)
  const observing = active && pose_matches_character(pose, selected_character_id)
  const city = observing ? city_at_position(world, pose.x, pose.z) : null
  const city_key = observing ? (city && world ? `${world}:${city.id}` : null) : undefined
  const memory = useRef(initial_city_arrival_memory())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [title, set_title] = useState<string | null>(null)

  useEffect(() => {
    const now = Date.now()
    const next = city_arrival_after(memory.current, city_key, now)
    memory.current = next.memory
    if (!next.entered || !city) return
    set_title(copy_text(copy.world_hud)('dungeon_city', { city: titleize(city.id) }))
    if (music_enabled) play_procedural_cue('city')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => set_title(null), CITY_TITLE_DURATION_MS)
  }, [city, city_key, copy, music_enabled])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  return <CityArrivalContent title={active ? title : null} />
}
