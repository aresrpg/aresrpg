// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AuthSession } from '../auth.ts'
import type { AppInput } from '../store.ts'

import type { SessionState } from './session.ts'

export type CharacterCreation =
  Readonly<{ status: 'submitted' | 'failed' }> | Readonly<{ status: 'confirmed'; digest: string }>
export type CharacterCreationInput =
  | Readonly<{ type: 'character/creation_started' | 'character/creation_failed'; wallet: AuthSession }>
  | Readonly<{ type: 'character/creation_confirmed'; wallet: AuthSession; digest: string }>

export const fold_character_creation = (session: SessionState, input: AppInput): SessionState => {
  if (!('wallet' in input) || input.wallet !== session.wallet) return session
  if (input.type === 'character/creation_started') return { ...session, character_creation: { status: 'submitted' } }
  if (session.character_creation?.status !== 'submitted') return session
  switch (input.type) {
    case 'character/creation_failed':
      return { ...session, character_creation: { status: 'failed' } }
    case 'character/creation_confirmed':
      return { ...session, character_creation: { status: 'confirmed', digest: input.digest } }
    default:
      return session
  }
}
