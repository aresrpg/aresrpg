// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterCreateInput } from '@aresrpg/sdk/character'
import { is_valid_character_name, normalize_character_name } from '@aresrpg/sdk/character-name'

import type { DappAccount } from './account.ts'
import type { DappDirect, DappObservation } from './observation.ts'

/** The direct commands of the bot's gameplay catalogue that act for one hero. */
export type HeroDirectAction =
  'raise_stats' | 'raise_spell' | 'equip_item' | 'use_consumable' | 'dungeon_leave' | 'craft'
/** Every direct command this page sends. The others act for the wallet as a whole. Sale proceeds are
 * collected by the bot itself: its `market_collect` is the bot's own command, never a request of this page. */
export type DirectAction = HeroDirectAction | 'market_buy' | 'market_sell' | 'market_delist' | 'create_character'
export type DirectPayload = Readonly<Record<string, unknown>>
/** What the pushed account shows once a request that spends SUI went through, whatever the bot still says. */
/** The new hero, by the name the chain stores: trimmed and lower-cased. Nothing else proves a request
 * the bot holds no command for: a bag cannot prove a purchase, because a hero's own find adds the same units. */
export type DirectProof = Readonly<{ kind: 'hero'; name: string }>
/**
 * One direct command of the bot wallet, which holds one at a time. It is sent once, then followed in
 * the bot's observations: `accepted` waits in the bot's signing queue, `uncertain` waits for an
 * observation and is never sent again.
 */
export type DirectRequest = Readonly<{
  id: string
  action: DirectAction
  /** Null for a request of the wallet as a whole. */
  hero_id: string | null
  /** The bot's typed action, exactly as it is sent. */
  payload: DirectPayload
  /** The item and the units the request is about, for the sentence that tells its outcome. */
  item_type: string | null
  amount: number
  /** The direct command the bot held before this request, which is never this request's own. */
  after: string | null
  proof: DirectProof | null
  status: 'pending' | 'accepted' | 'uncertain' | 'done' | 'refused'
  error: string | null
}>
export const direct_open = (request: DirectRequest | null): request is DirectRequest =>
  request !== null && ['pending', 'accepted', 'uncertain'].includes(request.status)

export type DirectSeen = Readonly<{ observation: DappObservation; account: DappAccount }>
type Draft = Pick<DirectRequest, 'action' | 'payload'> &
  Partial<Pick<DirectRequest, 'hero_id' | 'item_type' | 'amount' | 'proof'>>
/** A request the bot would refuse anyway is refused here, with the bot's own code, and nothing is sent. */
export const direct_request = (
  id: string,
  observation: DappObservation,
  draft: Draft,
  refusal: string | null = null
): DirectRequest => ({
  id,
  hero_id: null,
  item_type: null,
  amount: 0,
  proof: null,
  ...draft,
  after: observation.direct?.id ?? null,
  status: refusal ? 'refused' : 'pending',
  error: refusal,
})

/**
 * What a hero request is about, for its outcome sentence. A craft names its recipe and its tries; a
 * gear change and a potion name a bag row, and the sentence names that item.
 */
const request_subject = (
  { inventory }: DappAccount,
  { item_id, output_type, attempts }: DirectPayload
): Pick<DirectRequest, 'item_type' | 'amount'> =>
  typeof output_type === 'string'
    ? { item_type: output_type, amount: Number(attempts) }
    : { item_type: inventory.find((row) => row.id === item_id)?.item_type ?? null, amount: 0 }
/** A stat, spell, gear, potion, dungeon-leave or craft request of one hero, with the bot's own payload. */
export const hero_request = (
  id: string,
  { observation, account }: DirectSeen,
  request: Readonly<{ hero_id: string; action: HeroDirectAction; payload: DirectPayload }>
): DirectRequest => direct_request(id, observation, { ...request, ...request_subject(account, request.payload) })

/**
 * A new hero of the bot account. The bot wallet pays its price; the new hero row proves it. A creation
 * the bot would refuse is refused here, and so is a name the account already holds: the hero that
 * proves the creation can then only be the new one.
 */
export const create_request = (
  id: string,
  { observation, account }: DirectSeen,
  hero: CharacterCreateInput
): DirectRequest => {
  const draft = (name: string): Draft => ({ action: 'create_character', payload: hero, proof: { kind: 'hero', name } })
  if (!is_valid_character_name(hero.name)) return direct_request(id, observation, draft(''), 'invalid_character_name')
  const name = normalize_character_name(hero.name)
  const taken = account.characters.some((row) => row.name.toLowerCase() === name)
  return direct_request(id, observation, draft(name), taken ? 'character_name_taken' : null)
}

/** A bot failure reads `Error: code` or `code:detail`; anything that is not a plain code is a request
 * that did not go through. */
const refusal_code = (error: string | null): string => {
  const [code = ''] = (error ?? '').replace(/^Error: /, '').split(':', 1)
  return /^[a-z_]+$/.test(code) ? code : 'direct_failed'
}
const same_payload = (left: DirectPayload, right: DirectPayload): boolean =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => JSON.stringify(value) === JSON.stringify(right[key]))
const own_command = (request: DirectRequest, direct: DappDirect | null): DappDirect | null =>
  direct !== null &&
  [direct.id !== request.after, direct.kind === request.action, same_payload(direct.payload, request.payload)].every(
    Boolean
  )
    ? direct
    : null

const proven = ({ proof }: DirectRequest, { phase, characters }: DappAccount): boolean =>
  proof !== null && phase === 'ready' && characters.some((hero) => hero.name.toLowerCase() === proof.name)

/** The request did not go through as far as this page can tell: the player checks before asking again. */
const UNCONFIRMED = 'direct_unconfirmed'
const done = (request: DirectRequest): DirectRequest => ({ ...request, status: 'done', error: null })
const OUTCOMES: Readonly<Record<string, DirectRequest['status']>> = {
  accepted: 'accepted',
  executing: 'accepted',
  completed: 'done',
  uncertain: 'uncertain',
}
/**
 * A fresh observation is the truth of a sent request: the bot's own command for it. Without one, only
 * the account can prove a creation, once it is fully read; anything else stays unconfirmed.
 */
export const followed_direct = (
  request: DirectRequest | null,
  observation: DappObservation,
  account: DappAccount
): DirectRequest | null => {
  if (!request || !['accepted', 'uncertain'].includes(request.status)) return request
  const command = own_command(request, observation.direct)
  if (command) {
    const status = OUTCOMES[command.status] ?? 'refused'
    return { ...request, status, error: status === 'refused' ? refusal_code(command.error) : null }
  }
  if (account.phase !== 'ready') return request
  return proven(request, account) ? done(request) : { ...request, status: 'refused', error: UNCONFIRMED }
}
/**
 * The game server may push the new hero after the bot's last word: a creation left unconfirmed is
 * proven the moment the account shows that hero, whose name no other hero of the account has.
 * The same account returns the same request.
 */
export const proven_direct = (request: DirectRequest | null, account: DappAccount): DirectRequest | null =>
  request?.error === UNCONFIRMED && proven(request, account) ? done(request) : request
