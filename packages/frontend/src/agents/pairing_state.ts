// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AgentPairingIdentity } from '@aresrpg/protocol'

export type PairingState = Readonly<{
  attempt: number
  status: 'idle' | 'starting' | 'waiting' | 'failed' | 'verified'
  public_identifier: string | null
  link: string | null
  identity: AgentPairingIdentity | null
}>
export type PairingInput = Readonly<
  | { type: 'clear' }
  | { type: 'start'; public_identifier: string | null }
  | { type: 'link'; attempt: number; link: string }
  | { type: 'verified'; attempt: number; identity: AgentPairingIdentity }
  | { type: 'failed'; attempt: number }
>
export const EMPTY_PAIRING: PairingState = {
  attempt: 0,
  status: 'idle',
  public_identifier: null,
  link: null,
  identity: null,
}
export const reduce_pairing = (state: PairingState, input: PairingInput): PairingState => {
  if (input.type === 'clear') return { ...EMPTY_PAIRING, attempt: state.attempt + 1 }
  if (input.type === 'start')
    return {
      ...EMPTY_PAIRING,
      attempt: state.attempt + 1,
      public_identifier: input.public_identifier,
      status: input.public_identifier ? 'starting' : 'failed',
    }
  if (input.attempt !== state.attempt) return state
  switch (input.type) {
    case 'link':
      return { ...state, status: 'waiting', link: input.link }
    case 'verified':
      return { ...state, status: 'verified', public_identifier: null, link: null, identity: input.identity }
    case 'failed':
      return { ...state, status: 'failed', public_identifier: null, link: null, identity: null }
  }
}
