// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { dispatch_app, useAppStore } from '../store.ts'

import { FEEDBACK_ANSWERS, feedback_target } from './feedback.ts'

export const OnboardingFeedback = () => {
  const feedback = useAppStore((state) => state.analytics.feedback)
  const target = useAppStore(feedback_target)
  const copy = useAppStore((state) => state.copy?.ui)
  if (!copy || typeof feedback !== 'object' || feedback.answer !== null || target !== feedback.stage) return null
  return (
    <aside
      className="ph-no-capture pointer-events-auto fixed right-4 bottom-4 z-[190] w-[min(22rem,calc(100vw-2rem))] border border-gold/30 bg-surface-raised p-4 font-mono text-sm text-text shadow-xl"
      aria-label={copy.feedback_question}
    >
      <p className="mb-3 text-gold">{copy.feedback_question}</p>
      <div className="grid grid-cols-2 gap-2">
        {FEEDBACK_ANSWERS.map((answer) => (
          <button
            key={answer}
            type="button"
            className="min-h-11 border border-white/15 px-2 py-2 text-left hover:border-gold/50"
            onClick={() => dispatch_app({ type: 'analytics/feedback_answered', answer })}
          >
            {copy[`feedback_${answer}`]}
          </button>
        ))}
        <button
          type="button"
          className="min-h-11 px-2 py-2 text-left text-white/50 hover:text-white"
          onClick={() => dispatch_app({ type: 'analytics/feedback_answered', answer: 'dismissed' })}
        >
          {copy.feedback_dismiss}
        </button>
      </div>
    </aside>
  )
}
