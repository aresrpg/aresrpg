// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedConnectRequest } from '@aresrpg/protocol'

export type HostedPhase = 'idle' | 'authenticating' | 'ready' | 'authorizing' | 'failed' | 'complete'
export type HostedState<T> = Readonly<{
  generation: number
  session: object | null
  phase: HostedPhase
  failure: 'retry' | 'restart' | null
  authorization_id: string | null
  bots: readonly T[]
  consent: HostedConnectRequest | null
  selected: string
  verified: string
}>
export type HostedInput<T> = Readonly<
  | { type: 'reset'; session: object | null; resume_authorization?: boolean }
  | { type: 'start'; phase: 'authenticating' | 'authorizing' }
  | { type: 'result'; generation: number; values: Partial<Omit<HostedState<T>, 'generation' | 'session'>> }
>
export const empty_hosted = <T>(): HostedState<T> => ({
  generation: 0,
  session: null,
  phase: 'idle',
  failure: null,
  authorization_id: null,
  bots: [],
  consent: null,
  selected: '',
  verified: '',
})
export const hosted_pending = (phase: HostedPhase) => ['authenticating', 'authorizing'].includes(phase)
export const reduce_hosted = <T>(state: HostedState<T>, input: HostedInput<T>): HostedState<T> => {
  if (input.type === 'reset') {
    const same_session = [state.generation === 0, state.session === input.session].some(Boolean)
    const resumed = same_session
      ? ({ phase: 'authenticating' } as const)
      : ({ phase: 'failed', failure: 'restart' } as const)
    return {
      ...empty_hosted<T>(),
      generation: state.generation + 1,
      session: input.session,
      ...([input.resume_authorization, input.session].every(Boolean) ? resumed : {}),
    }
  }
  if ([input.type === 'start', hosted_pending(state.phase)].every(Boolean)) return state
  if (input.type === 'start') {
    const previous = input.phase === 'authenticating' ? empty_hosted<T>() : state
    return { ...previous, session: state.session, generation: state.generation + 1, phase: input.phase }
  }
  if (![input.generation === state.generation, hosted_pending(state.phase)].every(Boolean)) return state
  return { ...state, ...input.values }
}

export const hosted_failure = (error: unknown, authorization_id: string | null): 'restart' | 'retry' =>
  authorization_id !== null &&
  error instanceof Error &&
  ['invalid_session', 'invalid_challenge', 'invalid_grant', 'invalid_client'].includes(String(error.cause))
    ? 'restart'
    : 'retry'
