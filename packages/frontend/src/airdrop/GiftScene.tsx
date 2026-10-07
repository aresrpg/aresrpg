// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useRef } from 'react'

import { copy_text, type AppCopy, type CopyText } from '../i18n/copy.ts'
import { items_by_type } from '../content/items.ts'
import { BoxRevealCell, type BoxPhase, type BoxResult } from '../characters/BoxRevealCell.tsx'

import type { gift_content } from './gift_content.ts'
import type { GiftState } from './gift_state.ts'
import { GIFT_TASK_LABELS, type GiftPresentation } from './gift_presentation.ts'

export const GiftScene = ({
  view,
  state,
  content,
  roll,
  phase,
  copy,
  text,
}: Readonly<{
  view: GiftPresentation
  state: GiftState
  content: ReturnType<typeof gift_content>
  roll?: BoxResult
  phase: BoxPhase
  copy: AppCopy
  text: CopyText
}>) => {
  const heading = useRef<HTMLHeadingElement>(null)
  const reward = roll ? items_by_type[roll.item_type]!.name : ''
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [view.screen])
  return (
    <section className="gift-content">
      <p className="gift-eyebrow">{text(roll ? 'confirmed' : 'welcome_eyebrow')}</p>
      <h2 ref={heading} tabIndex={-1}>
        {text(view.title, { count: content.count, item: reward })}
      </h2>
      <p className="gift-intro">{text(view.body, { count: content.count, item: reward })}</p>
      {view.art && (
        <div className={`boxreveal gift-art ${phase === 'spinning' ? 'gift-art--carousel' : ''}`} data-phase={phase}>
          <BoxRevealCell
            item_type={content.box.item_type}
            phase={phase}
            roll={roll}
            text={copy_text(copy.characters_page)}
          />
        </div>
      )}
      {view.screen === 'welcome' && <span className="gift-edition">{text('edition', { count: content.count })}</span>}
      {state.task && (
        <p className="gift-status" role="status">
          <span className="aui-spinner" aria-hidden="true" />
          {text(GIFT_TASK_LABELS[state.task.kind])}
        </p>
      )}
      {view.screen === 'reward' && <p className="gift-saved">{text('reward_saved')}</p>}
      {state.error && (
        <p className="aui-service-note gift-error" role="alert">
          {text(`error_${state.error}`)}
        </p>
      )}
    </section>
  )
}
