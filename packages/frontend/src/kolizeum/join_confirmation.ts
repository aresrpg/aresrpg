// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The immutable review snapshot shown before a wagered join. Confirmation dispatches these
// exact identities, so changing character tabs cannot silently change the signer intent.

import { format_sui } from '../wallet_amount.ts'

export type KolizeumJoinReview = Readonly<{
  kolizeum: string
  character_id: string
  character_name: string
  side: 0 | 1
  stake_mist: bigint
  stake_sui: string
}>

const exact_sui = (mist: bigint): string => {
  const [whole = '0', fraction = ''] = format_sui(mist, 9).split('.')
  const significant = fraction.replace(/0+$/, '')
  return significant ? `${whole}.${significant}` : whole
}

export const kolizeum_join_review = (
  lobby: Readonly<{ id: string; pledge_mist: string }>,
  character: Readonly<{ id: string; name: string }>,
  side: 0 | 1
): KolizeumJoinReview => {
  const stake_mist = BigInt(lobby.pledge_mist)
  return Object.freeze({
    kolizeum: lobby.id,
    character_id: character.id,
    character_name: character.name,
    side,
    stake_mist,
    stake_sui: exact_sui(stake_mist),
  })
}
