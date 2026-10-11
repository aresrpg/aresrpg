// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AnalyticsEvent } from '../analytics.ts'
import { adventure_quest } from '../adventure/quest.ts'
import { character_creation_surface } from '../modules/character_creation.ts'
import type { AppContext, AppState } from '../store.ts'

export const FEEDBACK_ANSWERS = ['unclear', 'controls', 'performance', 'funding', 'not_interested'] as const
export type FeedbackAnswer = (typeof FEEDBACK_ANSWERS)[number] | 'dismissed'
export type FeedbackState =
  'pending' | 'available' | 'done' | Readonly<{ stage: string; answer: FeedbackAnswer | null }>
export type FeedbackInput =
  | Readonly<{ type: 'analytics/feedback_loaded'; seen: boolean }>
  | Readonly<{ type: 'analytics/feedback_offered'; stage: string }>
  | Readonly<{ type: 'analytics/feedback_answered'; answer: FeedbackAnswer }>

export const feedback_target = (state: AppState): string | null => {
  if (!state.copy || state.fight.mounted || state.session.auth_status === 'connecting') return null
  if (character_creation_surface(state.session, state.navigation) === 'welcome') return 'funding'
  if (state.adventure.phase === 'explore' && state.adventure.character && !state.navigation.dialog)
    return `demo_${adventure_quest(state.adventure)}`
  return null
}

export const feedback_events = (current: FeedbackState, previous: FeedbackState): readonly AnalyticsEvent[] => {
  if (typeof current !== 'object' || current === previous) return []
  return [
    {
      name: current.answer === null ? 'onboarding_feedback_shown' : 'onboarding_feedback',
      properties: { onboarding_step: current.stage, ...(current.answer ? { answer: current.answer } : {}) },
    },
  ]
}

const FEEDBACK_STORAGE_KEY = 'aresrpg:onboarding-feedback:v1'
export const observe_feedback = ({ events, dispatch, get_state, signal }: AppContext): void => {
  try {
    dispatch({ type: 'analytics/feedback_loaded', seen: localStorage.getItem(FEEDBACK_STORAGE_KEY) !== null })
  } catch (error) {
    console.warn('Onboarding feedback preference is unavailable.', error)
    dispatch({ type: 'analytics/feedback_loaded', seen: true })
  }
  let target: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const sync = (): void => {
    const state = get_state()
    const next =
      state.analytics.feedback === 'available' && document.visibilityState !== 'hidden' ? feedback_target(state) : null
    if (next === target) return
    clearTimeout(timer)
    target = next
    if (next) timer = setTimeout(() => dispatch({ type: 'analytics/feedback_offered', stage: next }), 120_000)
  }
  events.on('STATE_UPDATED', (state, previous) => {
    const { feedback } = state.analytics
    if (typeof feedback === 'object' && typeof previous.analytics.feedback !== 'object') {
      try {
        localStorage.setItem(FEEDBACK_STORAGE_KEY, 'shown')
      } catch (error) {
        console.warn('Onboarding feedback preference could not be saved.', error)
      }
    }
    if (typeof feedback === 'object' && feedback.answer === null && feedback_target(state) !== feedback.stage)
      dispatch({ type: 'analytics/feedback_answered', answer: 'dismissed' })
    sync()
  })
  document.addEventListener('visibilitychange', sync, { signal })
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
  sync()
}
