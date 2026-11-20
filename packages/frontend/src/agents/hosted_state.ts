// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedConnectRequest } from '@aresrpg/protocol'

export type HostedPhase = 'idle' | 'authenticating' | 'ready' | 'authorizing' | 'failed' | 'complete'
export type HostedState<T> = Readonly<{
  generation: number
  session: object | null
  /** The first signed-in account that received this request; the request stays its own. */
  holder: string | null
  phase: HostedPhase
  failure: 'retry' | 'restart' | null
  authorization_id: string | null
  bots: readonly T[]
  consent: HostedConnectRequest | null
  selected: string
  verified: string
}>
export type HostedInput<T> = Readonly<
  /** `requested`: the page was entered with an authorization request. `account`: the session's address. */
  | { type: 'reset'; session: object | null; account?: string | null; requested?: boolean }
  | { type: 'start'; phase: 'authenticating' | 'authorizing' }
  | { type: 'result'; generation: number; values: Partial<Omit<HostedState<T>, 'generation' | 'session'>> }
>
export const empty_hosted = <T>(): HostedState<T> => ({
  generation: 0,
  session: null,
  holder: null,
  phase: 'idle',
  failure: null,
  authorization_id: null,
  bots: [],
  consent: null,
  selected: '',
  verified: '',
})
export const hosted_pending = (phase: HostedPhase) => ['authenticating', 'authorizing'].includes(phase)
/**
 * A request waits for a start: arriving signs nothing and creates nothing. It belongs to the first
 * account that receives it, so another account must start again. A page that mounts before the
 * session is restored, or a new session object for the same account, is still that same player.
 */
const reset_hosted = <T>(
  state: HostedState<T>,
  { session, account = null, requested = false }: Extract<HostedInput<T>, { type: 'reset' }>
): HostedState<T> => {
  const holder = state.holder ?? account
  const foreign = [requested, account !== null, holder !== account].every(Boolean)
  return {
    ...empty_hosted<T>(),
    generation: state.generation + 1,
    session,
    holder,
    ...(foreign ? ({ phase: 'failed', failure: 'restart' } as const) : {}),
  }
}
export const reduce_hosted = <T>(state: HostedState<T>, input: HostedInput<T>): HostedState<T> => {
  if (input.type === 'reset') return reset_hosted(state, input)
  if ([input.type === 'start', hosted_pending(state.phase)].every(Boolean)) return state
  if (input.type === 'start') {
    const previous = input.phase === 'authenticating' ? { ...empty_hosted<T>(), holder: state.holder } : state
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
