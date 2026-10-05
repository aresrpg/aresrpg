// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useEffect, useReducer, useSyncExternalStore } from 'react'
import { Button } from '@aresrpg/ui'

import { ModalFrame } from '../components/ModalFrame.tsx'
import { copy_text, type AppCopy } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

type CraftFailureState = Readonly<{ digest: string | null; pending: boolean; completed: boolean }>

/** Completion/reset changes establish a silent baseline; a new failure stays pending until acknowledged. */
export const observe_craft_failure = (
  state: CraftFailureState,
  input: Readonly<{ digest: string | null; failed: boolean; completed: boolean }>
): CraftFailureState => {
  if (state.digest === input.digest && state.completed === input.completed) return state
  return {
    digest: input.digest,
    completed: input.completed,
    pending: !input.completed && !state.completed && (state.pending || input.failed),
  }
}

const page_visible = (): boolean => globalThis.document?.visibilityState !== 'hidden'
const observe_visibility = (changed: () => void): (() => void) => {
  globalThis.document?.addEventListener('visibilitychange', changed)
  return () => globalThis.document?.removeEventListener('visibilitychange', changed)
}

export const CraftFailureNotice = ({
  copy,
  completed,
  complete,
  available,
}: Readonly<{
  copy: AppCopy
  completed: boolean
  complete: () => void
  available: boolean
}>) => {
  const result = useAppStore(({ session }) => session.craft_result)
  const [state, observe] = useReducer(observe_craft_failure, {
    digest: result?.digest ?? null,
    pending: false,
    completed,
  })
  const visible = useSyncExternalStore(observe_visibility, page_visible, () => false)
  useEffect(
    () => observe({ digest: result?.digest ?? null, failed: result?.successes === 0, completed }),
    [result, completed]
  )
  if (![available, visible, !completed, state.pending].every(Boolean)) return null
  const text = copy_text(copy.tutorial)
  return (
    <ModalFrame label={text('craft_failure_title')} close={complete} close_label={text('got_it')}>
      <div className="space-y-4 p-5" data-tutorial="craft_failure">
        <p className="text-sm leading-relaxed text-slate-300">{text('craft_failure_body')}</p>
        <Button tone="primary" onClick={complete}>
          {text('got_it')}
        </Button>
      </div>
    </ModalFrame>
  )
}
