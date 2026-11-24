// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one Add Funds window of a signed-in surface, the game and every page of the site.
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'

import type { FundingAuthorization } from '../funding/recipient.ts'
import type { AppInput, SiteModule, SiteState } from '../store.ts'

/** The open window: the cost it asks to cover and, when funds go to an agent, whom they go to. */
export type FundingState = Readonly<{ cost_mist: bigint; authorization?: FundingAuthorization }> | null

export type FundingInput =
  /** Without a cost, the account's own top-up: the first character's price until the roster has one. */
  | Readonly<{ type: 'funding/open'; cost_mist?: bigint; authorization?: FundingAuthorization }>
  | Readonly<{ type: 'funding/close' }>

const top_up = ({ session }: SiteState): FundingState =>
  Object.freeze({ cost_mist: session.characters.length === 0 ? CHARACTER_PRICE_MIST : 0n })

const own_funding = (state: SiteState, input: AppInput): FundingState => {
  switch (input.type) {
    case 'funding/open':
      return input.cost_mist === undefined
        ? top_up(state)
        : Object.freeze({ cost_mist: input.cost_mist, authorization: input.authorization })
    case 'funding/close':
    case 'auth/rejected':
    case 'auth/disconnected':
      return null
    default:
      return state.funding
  }
}

/** While the player watches an agent's character, only top-ups open: the account's own, or its agent's. */
const watching_funding = (state: SiteState, input: AppInput): FundingState => {
  if (input.type === 'funding/open' && (input.cost_mist === undefined || input.authorization))
    return own_funding(state, input)
  return input.type === 'agent/watch' || input.type === 'funding/close' ? null : state.funding
}

const reduce: NonNullable<SiteModule['reduce']> = (state, input) => {
  const funding = state.session.agent_view.request ? watching_funding(state, input) : own_funding(state, input)
  return funding === state.funding ? state : Object.freeze({ ...state, funding })
}

export default Object.freeze({ name: 'funding', initial: () => ({ funding: null }), reduce }) satisfies SiteModule
