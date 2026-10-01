// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { MAX_TRACKED_CHARACTERS } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { AppInput } from '../store.ts'

import type { SessionState } from './session.ts'
import type { NavigationState } from './navigation.ts'

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

/** The renderer and analytics observe the same visible creation surface. */
export const character_creation_surface = (
  session: Pick<SessionState, 'wallet' | 'characters'>,
  navigation: Pick<NavigationState, 'page' | 'dialog'>
): 'welcome' | 'character_create' | null => {
  if (!session.wallet || navigation.page !== 'world') return null
  if (navigation.dialog === 'welcome') return 'welcome'
  if (navigation.dialog === 'character_create' && session.characters.length < MAX_TRACKED_CHARACTERS)
    return 'character_create'
  return null
}
