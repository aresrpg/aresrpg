// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { GIFT_FUNDING_MIST, type GiftStatus } from '@aresrpg/sdk/gift'

import type { AuthSession } from '../auth.ts'

export type GiftWallet = Pick<
  AuthSession,
  | 'address'
  | 'wallet_name'
  | 'identity'
  | 'gift'
  | 'inspect_giftcard_link'
  | 'read_sui_balance'
  | 'on_invalidated'
  | 'dispose'
  | 'disconnect'
>
export type GiftTaskKind = 'boot' | 'login' | 'check' | 'transfer' | 'redeem' | 'open' | 'collect' | 'logout'
export type GiftTask = Readonly<{ id: number; kind: GiftTaskKind; advance: boolean | 'open' }>
export type GiftState = Readonly<{
  ready: boolean
  wallet: GiftWallet | null
  status: GiftStatus | null
  /** The game account's SUI, read with each status check; a confirmed step never rereads it. */
  balance: bigint | null
  task: GiftTask | null
  sequence: number
  error: string | null
  skip_link: boolean
  celebrate: boolean
  view: 'gift' | 'later'
  muted: boolean
}>
export type GiftResult =
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'connected'; wallet: GiftWallet; advance: GiftTask['advance'] }>
  | Readonly<{ kind: 'checked'; status: GiftStatus; balance: bigint | null }>
  | Readonly<{ kind: 'executed'; status: GiftStatus }>
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
  balance: null,
  task: null,
  sequence: 0,
  error: null,
  skip_link: false,
  celebrate: false,
  view: 'gift',
  muted: false,
})
const task = (state: GiftState, kind: GiftTaskKind, advance: GiftTask['advance'] = true): GiftState => ({
  ...state,
  error: null,
  sequence: state.sequence + 1,
  task: { id: state.sequence + 1, kind, advance },
})

const PAID_STAGES: ReadonlySet<GiftStatus['stage']> = new Set(['available', 'voucher', 'crate', 'reward'])

/** The link is settled once the chain shows anything but an unclaimed card (claimed into the account, or spent), or
 * once the SDK refused it as not valid: no retry can claim it. */
export const gift_link_settled = ({ status, error }: GiftState): boolean =>
  error === 'invalid' || (status !== null && status.stage !== 'available')

/** Every remaining gift step is player-paid, so an account below the floor funds before any step starts. */
export const gift_needs_funding = ({ task, status, balance }: GiftState): boolean =>
  !task && !!status && PAID_STAGES.has(status.stage) && balance !== null && balance < GIFT_FUNDING_MIST

/** The next automatic step, or none: a crate opens only on request, and an unfunded account waits. */
const next_action = (state: GiftState, next: GiftState): GiftTaskKind | null => {
  if (!state.task?.advance || gift_needs_funding(next)) return null
  const actions = {
    available: 'transfer',
    voucher: 'redeem',
    reward: 'collect',
    crate: state.task.advance === 'open' ? 'open' : null,
  } as const
  return actions[next.status!.stage as keyof typeof actions] ?? null
}

const checked = (state: GiftState, result: Extract<GiftResult, { kind: 'checked' }>): GiftState => {
  const { status } = result
  const next = {
    ...state,
    task: null,
    status,
    balance: result.balance,
    error: null,
    celebrate: state.celebrate || (state.status?.stage === 'crate' && status.stage === 'reward'),
  }
  const action = next_action(state, next)
  return action ? task(next, action) : next
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
        balance: state.wallet?.address === result.wallet.address ? state.balance : null,
      },
      'check',
      result.advance
    ),
  checked,
  executed: (state, result) => checked(state, { kind: 'checked', status: result.status, balance: state.balance }),
  disconnected: (state) => ({ ...initial_gift_state(), ready: true, sequence: state.sequence }),
}

const request_allowed = (state: GiftState, kind: GiftTaskKind): boolean => {
  if (state.task || !state.ready) return false
  if (kind === 'login') return !state.wallet
  if (!state.wallet) return false
  const required = { redeem: 'voucher', open: 'crate', collect: 'reward', transfer: 'available' } as const
  const stage = required[kind as keyof typeof required]
  return stage ? state.status?.stage === stage && !gift_needs_funding(state) : ['check', 'logout'].includes(kind)
}

const inputs: {
  [Type in GiftInput['type']]: (state: GiftState, input: Extract<GiftInput, { type: Type }>) => GiftState
} = {
  start: (state) => task({ ...initial_gift_state(), sequence: state.sequence }, 'boot'),
  request: (state, input) =>
    request_allowed(state, input.kind)
      ? task(
          state,
          input.kind,
          input.kind === 'check' && state.status?.stage === 'crate' && state.error !== 'uncertain' ? 'open' : true
        )
      : state,
  completed: (state, input) =>
    state.task?.id === input.task ? completions[input.result.kind](state, input.result as never) : state,
  // A link the SDK refused as not valid is never inspected again: a later check reads the account.
  failed: (state, input) =>
    state.task?.id === input.task
      ? { ...state, task: null, error: input.error, skip_link: state.skip_link || input.error === 'invalid' }
      : state,
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
