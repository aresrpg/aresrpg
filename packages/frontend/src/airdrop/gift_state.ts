// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { GiftProof, GiftStatus } from '@aresrpg/sdk/gift'

import type { AuthSession } from '../auth.ts'

export type GiftWallet = Pick<
  AuthSession,
  | 'address'
  | 'wallet_name'
  | 'identity'
  | 'gift'
  | 'inspect_giftcard_link'
  | 'claim_giftcard_link'
  | 'on_invalidated'
  | 'dispose'
  | 'disconnect'
>
export type GiftTaskKind = 'boot' | 'login' | 'check' | 'transfer' | 'redeem' | 'open' | 'collect' | 'logout'
export type GiftTask = Readonly<{ id: number; kind: GiftTaskKind; advance: boolean }>
export type GiftState = Readonly<{
  ready: boolean
  wallet: GiftWallet | null
  status: GiftStatus | null
  task: GiftTask | null
  sequence: number
  error: string | null
  skip_link: boolean
  celebrate: boolean
  view: 'gift' | 'play' | 'later'
  muted: boolean
}>
export type GiftResult =
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'connected'; wallet: GiftWallet; advance: boolean }>
  | Readonly<{ kind: 'checked'; status: GiftStatus }>
  | Readonly<{ kind: 'executed'; proof?: GiftProof }>
  | Readonly<{ kind: 'disconnected' }>
export type GiftInput =
  | Readonly<{ type: 'start' }>
  | Readonly<{ type: 'request'; kind: GiftTaskKind }>
  | Readonly<{ type: 'completed'; task: number; result: GiftResult }>
  | Readonly<{ type: 'failed'; task: number; error: string }>
  | Readonly<{ type: 'invalidated'; wallet: GiftWallet }>
  | Readonly<{ type: 'check_account' }>
  | Readonly<{ type: 'view'; view: GiftState['view'] }>
  | Readonly<{ type: 'celebrated' }>
  | Readonly<{ type: 'mute' }>

export const initial_gift_state = (): GiftState => ({
  ready: false,
  wallet: null,
  status: null,
  task: null,
  sequence: 0,
  error: null,
  skip_link: false,
  celebrate: false,
  view: 'gift',
  muted: false,
})
const task = (state: GiftState, kind: GiftTaskKind, advance = true): GiftState => ({
  ...state,
  error: null,
  sequence: state.sequence + 1,
  task: { id: state.sequence + 1, kind, advance },
})

const checked = (state: GiftState, result: Extract<GiftResult, { kind: 'checked' }>): GiftState => {
  const { status } = result
  const changed = state.status?.stage !== status.stage
  const next = {
    ...state,
    task: null,
    status,
    error: null,
    celebrate: state.celebrate || (state.status?.stage === 'crate' && status.stage === 'reward'),
  }
  const actions = { available: 'transfer', voucher: 'redeem', reward: 'collect' } as const
  const action = actions[status.stage as keyof typeof actions]
  return state.task?.advance && changed && action ? task(next, action) : next
}

const completions: {
  [Kind in GiftResult['kind']]: (state: GiftState, result: Extract<GiftResult, { kind: Kind }>) => GiftState
} = {
  ready: (state) => ({ ...state, task: null, ready: true }),
  connected: (state, result) =>
    task(
      {
        ...state,
        ready: true,
        wallet: result.wallet,
        status: state.wallet?.address === result.wallet.address ? state.status : null,
      },
      'check',
      result.advance
    ),
  checked,
  executed: (state, result) =>
    task({ ...state, status: state.status && { ...state.status, proof: result.proof ?? state.status.proof } }, 'check'),
  disconnected: (state) => ({ ...initial_gift_state(), ready: true, sequence: state.sequence }),
}

const request_allowed = (state: GiftState, kind: GiftTaskKind): boolean => {
  if (state.task || !state.ready) return false
  if (kind === 'login') return !state.wallet
  if (!state.wallet) return false
  const required = { redeem: 'voucher', open: 'crate', collect: 'reward', transfer: 'available' } as const
  const stage = required[kind as keyof typeof required]
  return stage ? state.status?.stage === stage : ['check', 'logout'].includes(kind)
}

const inputs: {
  [Type in GiftInput['type']]: (state: GiftState, input: Extract<GiftInput, { type: Type }>) => GiftState
} = {
  start: (state) => task({ ...initial_gift_state(), sequence: state.sequence }, 'boot'),
  request: (state, input) => (request_allowed(state, input.kind) ? task(state, input.kind) : state),
  completed: (state, input) =>
    state.task?.id === input.task ? completions[input.result.kind](state, input.result as never) : state,
  failed: (state, input) => (state.task?.id === input.task ? { ...state, task: null, error: input.error } : state),
  invalidated: (state, input) =>
    state.wallet === input.wallet
      ? { ...initial_gift_state(), ready: true, sequence: state.sequence, error: 'unauthorized' }
      : state,
  check_account: (state) => (state.task ? state : task({ ...state, skip_link: true, status: null }, 'check')),
  view: (state, input) => (state.status?.stage === 'collected' ? { ...state, view: input.view } : state),
  celebrated: (state) => ({ ...state, celebrate: false }),
  mute: (state) => ({ ...state, muted: !state.muted }),
}

export const reduce_gift = (state: GiftState, input: GiftInput): GiftState => inputs[input.type](state, input as never)
