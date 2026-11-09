// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedConnectRequest } from '@aresrpg/protocol'

export type HostedPhase = 'idle' | 'authenticating' | 'ready' | 'authorizing' | 'failed' | 'complete'
export type HostedState<T> = Readonly<{
  generation: number
  session: object | null
  phase: HostedPhase
  authorization_id: string | null
  bots: readonly T[]
  consent: HostedConnectRequest | null
  selected: string
  verified: string
}>
export type HostedInput<T> = Readonly<
  | { type: 'reset'; session: object | null }
  | { type: 'start'; phase: 'authenticating' | 'authorizing' }
  | { type: 'result'; generation: number; values: Partial<Omit<HostedState<T>, 'generation' | 'session'>> }
>
export const empty_hosted = <T>(): HostedState<T> => ({
  generation: 0,
  session: null,
  phase: 'idle',
  authorization_id: null,
  bots: [],
  consent: null,
  selected: '',
  verified: '',
})
export const hosted_pending = (phase: HostedPhase) => ['authenticating', 'authorizing'].includes(phase)
export const reduce_hosted = <T>(state: HostedState<T>, input: HostedInput<T>): HostedState<T> => {
  if (input.type === 'reset') return { ...empty_hosted<T>(), generation: state.generation + 1, session: input.session }
  if (input.type === 'start') {
    if (hosted_pending(state.phase)) return state
    const previous = input.phase === 'authenticating' ? empty_hosted<T>() : state
    return { ...previous, session: state.session, generation: state.generation + 1, phase: input.phase }
  }
  if (![input.generation === state.generation, hosted_pending(state.phase)].every(Boolean)) return state
  return { ...state, ...input.values }
}
