// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_groups, job_level_from_xp, type JobSlug } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'

const ALL_JOBS = Object.freeze(Object.values(job_groups).flat())

export type JobLevelUp = Readonly<{
  id: string
  character_id: string
  character_name: string
  job: JobSlug
  level_before: number
  level_after: number
}>

export type JobLevelUpState = Readonly<{
  current: JobLevelUp | null
  queued: readonly JobLevelUp[]
}>

export type JobLevelUpInput =
  Readonly<{ type: 'job_level_up/detected'; level_up: JobLevelUp }> | Readonly<{ type: 'job_level_up/acknowledged' }>

export const initial_job_level_up_state = (): JobLevelUpState =>
  Object.freeze({ current: null, queued: Object.freeze([]) })

export const job_level_changes = (
  previous: readonly CharacterRow[],
  current: readonly CharacterRow[]
): readonly JobLevelUp[] =>
  Object.freeze(
    current.flatMap((character) => {
      const before = previous.find(({ id }) => id === character.id)
      if (!before) return []
      return ALL_JOBS.flatMap((job) => {
        const level_before = job_level_from_xp(Number(before.jobs[job] ?? 0))
        const level_after = job_level_from_xp(Number(character.jobs[job] ?? 0))
        return level_after > level_before
          ? [
              Object.freeze({
                id: `${character.id}:${job}:${level_after}`,
                character_id: character.id,
                character_name: character.name,
                job,
                level_before,
                level_after,
              }),
            ]
          : []
      })
    })
  )

const enqueue = (state: AppState, level_up: JobLevelUp): AppState => {
  if (state.job_level_up.current?.id === level_up.id || state.job_level_up.queued.some(({ id }) => id === level_up.id))
    return state
  const job_level_up = state.job_level_up.current
    ? Object.freeze({ ...state.job_level_up, queued: Object.freeze([...state.job_level_up.queued, level_up]) })
    : Object.freeze({ ...state.job_level_up, current: level_up })
  return Object.freeze({ ...state, job_level_up })
}

const acknowledge = (state: AppState): AppState => {
  const [current = null, ...queued] = state.job_level_up.queued
  return Object.freeze({ ...state, job_level_up: Object.freeze({ current, queued: Object.freeze(queued) }) })
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'job_level_up/detected') return enqueue(state, input.level_up)
  if (input.type === 'job_level_up/acknowledged') return acknowledge(state)
  if (input.type === 'auth/rejected' || input.type === 'auth/disconnected')
    return Object.freeze({ ...state, job_level_up: initial_job_level_up_state() })
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch }) => {
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.characters === previous.session.characters) return
    job_level_changes(previous.session.characters, state.session.characters).forEach((level_up) =>
      dispatch({ type: 'job_level_up/detected', level_up })
    )
  })
}

export default Object.freeze({ name: 'job_level_up', reduce, observe }) satisfies AppModule
