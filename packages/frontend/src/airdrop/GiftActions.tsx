// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ComponentType } from 'react'
import { Button, Panel } from '@aresrpg/ui'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'

import type { AppCopy, CopyText } from '../i18n/copy.ts'

import type { GiftRuntime } from './gift_runtime.ts'
import type { GiftState } from './gift_state.ts'
import { gift_action, GIFT_ACTION_LABELS, type GiftPresentation, type GiftScreen } from './gift_presentation.ts'

type ActionsProps = Readonly<{
  state: GiftState
  runtime: GiftRuntime
  copy: AppCopy
  text: CopyText
  skip: (() => void) | null
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
      {text(GIFT_ACTION_LABELS[action] ?? 'check_status')}
    </Button>
  )
}
const RewardActions = ({ runtime, copy, text }: ActionsProps) => (
  <>
    <Button tone="primary" onClick={() => runtime.dispatch({ type: 'view', view: 'play' })}>
      {copy.create_character}
    </Button>
    <button type="button" className="gift-link" onClick={() => runtime.dispatch({ type: 'view', view: 'later' })}>
      {text('later')}
    </button>
  </>
)
const OpeningActions = (props: ActionsProps) =>
  props.skip ? <Button onClick={props.skip}>{props.text('skip')}</Button> : <ProgressAction {...props} />
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
const PlayNext = ({ text, runtime, enter }: ActionsProps) => (
  <>
    <Panel className="gift-note">
      <strong>{text('start_adventure')}</strong>
      <div className="gift-metric">
        <span>{text('character_cost')}</span>
        <b>{Number(CHARACTER_PRICE_MIST) / 1_000_000_000} SUI</b>
      </div>
      <div className="gift-metric">
        <span>{text('fee_label')}</span>
        <b>{text('fee_value')}</b>
      </div>
      <p>{text('funding_note')}</p>
    </Panel>
    <Button tone="primary" onClick={enter}>
      {text('fund_cta')}
    </Button>
    <button type="button" className="gift-link" onClick={() => runtime.dispatch({ type: 'view', view: 'later' })}>
      {text('later')}
    </button>
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
  play: PlayNext,
  later: LaterActions,
}
export const GiftActions = ({ view, ...props }: ActionsProps & Readonly<{ view: GiftPresentation }>) => {
  const Actions = ACTIONS[view.screen]
  return (
    <div className="gift-actions">
      <Actions {...props} />
      {view.help === 'welcome' && (
        <p className="gift-help">
          <strong>{props.text('free_hint')}</strong>
          <br />
          {props.text('save_hint')}
        </p>
      )}
      {view.help === 'open_hint' && <p className="gift-help">{props.text('open_hint')}</p>}
    </div>
  )
}
