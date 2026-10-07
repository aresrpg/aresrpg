// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ComponentType } from 'react'
import { Button } from '@aresrpg/ui'

import type { CopyText } from '../i18n/copy.ts'

import type { GiftRuntime } from './gift_runtime.ts'
import type { GiftState } from './gift_state.ts'
import { gift_action, GIFT_ACTION_LABELS, type GiftPresentation, type GiftScreen } from './gift_presentation.ts'

type ActionsProps = Readonly<{
  state: GiftState
  runtime: GiftRuntime
  text: CopyText
  enter: () => void
}>
const ProgressAction = ({ state, runtime, text }: ActionsProps) => {
  const action = gift_action(state)
  if (state.error && !state.ready) return <Button onClick={() => globalThis.location.reload()}>{text('reload')}</Button>
  return (
    <Button
      tone="primary"
      busy={state.task !== null}
      disabled={!state.ready}
      onClick={() => runtime.dispatch({ type: 'request', kind: action })}
    >
      {text(GIFT_ACTION_LABELS[action] ?? 'continue_cta')}
    </Button>
  )
}
const RewardActions = ({ runtime, enter, text }: ActionsProps) => (
  <>
    <Button tone="primary" onClick={enter}>
      {text('continue_game')}
    </Button>
    <button type="button" className="gift-link" onClick={() => runtime.dispatch({ type: 'view', view: 'later' })}>
      {text('later')}
    </button>
  </>
)
const OpeningActions = (props: ActionsProps) => (props.state.celebrate ? null : <ProgressAction {...props} />)
const MissingActions = ({ state, runtime, text }: ActionsProps) => (
  <>
    <Button tone="primary" disabled={state.task !== null} onClick={() => runtime.dispatch({ type: 'check_account' })}>
      {text('check_account')}
    </Button>
    {state.wallet && !state.task && (
      <button type="button" className="gift-link" onClick={() => runtime.dispatch({ type: 'request', kind: 'logout' })}>
        {text('change_account')}
      </button>
    )}
  </>
)
const LaterActions = ({ text, enter }: ActionsProps) => (
  <Button tone="primary" onClick={enter}>
    {text('continue_game')}
  </Button>
)
const ACTIONS: Record<GiftScreen, ComponentType<ActionsProps>> = {
  welcome: ProgressAction,
  working: ProgressAction,
  received: ProgressAction,
  reserved: ProgressAction,
  opening: OpeningActions,
  reward: RewardActions,
  missing: MissingActions,
  later: LaterActions,
}
export const GiftActions = ({ view, ...props }: ActionsProps & Readonly<{ view: GiftPresentation }>) => {
  const Actions = ACTIONS[view.screen]
  return (
    <div className="gift-actions">
      <Actions {...props} />
      {view.screen === 'welcome' && <p className="gift-help">{props.text('save_hint')}</p>}
    </div>
  )
}
