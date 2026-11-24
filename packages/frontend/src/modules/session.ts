// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type {
  AgentPairingIdentity,
  CharacterRow,
  ClaimRow,
  ClientPacket,
  ItemAmountChange,
  GiftcardRow,
  ItemRow,
  ServerPacket,
} from '@aresrpg/protocol'
import type { CharacteristicName, CharacteristicValues } from '@aresrpg/immutable'

import {
  fold_agent_inventory,
  observe_inventory_subscription,
  type AgentInventoryView,
  type AgentInventoryViewInput,
} from '../agents/inventory_state.ts'
import { fold_owner_connection, type OwnerConnection, type OwnerConnectionInput } from '../agents/owner_state.ts'
import { fold_agent_view, agent_subscription } from '../agents/observation.ts'
import { fold_agent_inventory_target, type AgentInventoryInput } from '../agents/inventory_target.ts'
import type { AgentView, AgentViewInput } from '../agents/observation.ts'
import type { AuthSession } from '../auth.ts'
import { remember_selected_character_change } from '../auth_storage.ts'
import { env } from '../env.ts'
import { create_remembered_auth, type RememberedAuth } from '../remembered_auth.ts'
import { connect_server, type ServerLink } from '../server_link.ts'
import type { AppInput, ModuleContext, SiteContext, SiteModule, SiteState } from '../store.ts'
import { toast } from '../toast.ts'
import { return_home } from '../components/app_layout.ts'

import { fold_character_creation, type CharacterCreation, type CharacterCreationInput } from './character_creation.ts'
import { fold_character_deletion } from './character_roster.ts'
import { fold_character_receipt, type CraftOutcome } from './character_folds.ts'
import { observe_failure_toasts } from './session_toasts.ts'
import { accepted_link, fold_link_input } from './session_link.ts'
import { fold_inventory_input, fold_session_packet, initial_session_state } from './session_state.ts'
import { observe_character_requests, observe_wallet_balances } from './session_wallet.ts'
export { initial_session_state } from './session_state.ts'
export type AuthRequest = 'restore' | 'google'
/** A sign-in in progress, or how the last one ended. The signed-in account is `wallet`; while it is set
 *  no sign-in starts. Each attempt is a new object: a late answer to an older attempt finds another one. */
export type SignIn =
  Readonly<{ status: 'idle'; error: string | null }> | Readonly<{ status: 'connecting'; request: AuthRequest }>
export type LinkStatus = 'idle' | 'connecting' | 'connected' | 'ready' | 'replaced'
export type SessionState = Readonly<{
  agent_connection: OwnerConnection
  agent_view: AgentView
  agent_inventory: AgentInventoryView
  agent_pairing_candidate: AgentPairingIdentity | null
  inventory_pairing: AgentPairingIdentity | null
  character_creation: CharacterCreation | null
  sign_in: SignIn
  link_status: LinkStatus
  link_error: string | null
  link_violation: string | null // red until a connection is accepted after a server rule violation
  latency_ms: number | null
  indexing_lag: number | null
  current_epoch: string | null
  game_frozen: boolean | null
  consumption_result: Pick<Extract<SessionInput, { type: 'character/consumed' }>, 'digest' | 'effect'> | null
  craft_result: CraftOutcome | null
  roster_loaded: boolean
  deleted_character_ids: readonly string[]
  characters: readonly CharacterRow[]
  inventory: readonly ItemRow[]
  removed_item_versions: Readonly<Record<string, string>>
  claims: readonly ClaimRow[]
  redeemed_claims: readonly string[]
  redeemed_giftcards: readonly string[]
  giftcards: readonly GiftcardRow[]
  selected_character_id: string | null
  online: number | null
  online_characters: number | null
  /** Every live socket on the server, visitors included; null while unknown. */
  online_sockets: number | null
  /** Hosted bots among `online`. Only an admin's server sends it; absent or null is unknown. */
  online_agents: number | null | undefined
  /** Where a player's own sign-out leads. The observer acts on it after the wallet is released. */
  after_sign_out: 'home' | undefined
  /** The installed wallets this surface offers to sign in with; null until the sign-in code has loaded. */
  wallets: readonly string[] | null
  wallet: AuthSession | null
  sui_balance_mist: bigint | null
  kares_balance: bigint | null
  gas_spent_mist: bigint
}>
export type SessionInput =
  | OwnerConnectionInput
  | AgentViewInput
  | AgentInventoryViewInput
  | AgentInventoryInput
  | CharacterCreationInput
  | Readonly<{ type: 'inventory/amounts_changed'; changes: readonly ItemAmountChange[] }>
  | Readonly<{ type: 'auth/connecting' }>
  | Readonly<{ type: 'auth/ready'; wallets: readonly string[] }>
  | Readonly<{ type: 'auth/login_google' }>
  | Readonly<{ type: 'auth/connected'; session: AuthSession }>
  | Readonly<{ type: 'auth/failed'; error: string }>
  | Readonly<{ type: 'auth/rejected'; error: string }>
  /** `then: 'home'` opens the home page once the sign-out has finished. */
  | Readonly<{ type: 'auth/disconnected'; then?: 'home' }>
  | Readonly<{ type: 'link/connecting' }>
  | Readonly<{ type: 'link/replaced' }>
  | Readonly<{ type: 'link/rejected'; reason: string }>
  | Readonly<{ type: 'link/failed'; error: string }>
  | Readonly<{ type: 'link/violation'; reason: string }>
  | Readonly<{ type: 'link/latency'; latency_ms: number }>
  | Readonly<{ type: 'server/packet'; packet: Readonly<ServerPacket> }>
  /** The one door to the server: the live link sends the packet, and no link drops it. */
  | Readonly<{ type: 'server/send'; packet: Readonly<ClientPacket> }>
  | Readonly<{ type: 'character/deleted'; character_id: string; wallet: AuthSession }>
  | Readonly<{ type: 'character/select'; character_id: string }>
  | Readonly<{ type: 'wallet/refresh' }>
  | Readonly<{ type: 'wallet/refreshed'; balance_mist: bigint; kares_balance: bigint | null; gas_spent_mist: bigint }>
  | Readonly<{ type: 'giftcard/received'; giftcard: GiftcardRow }>
  | Readonly<{ type: 'giftcard/redeemed'; giftcard: string }>
  | Readonly<{
      type: 'character/equip_folded'
      character_id: string
      equipped: readonly Readonly<{ slot: string; item_id: string }>[]
      unequipped: readonly Readonly<{ slot: string; item_id: string }>[]
    }>
  /** `before`: the values the transaction was priced from. */
  | Readonly<{
      type: 'character/stats_raised'
      character_id: string
      spending: Readonly<Partial<Record<CharacteristicName, number>>>
      before: CharacteristicValues
    }>
  /** `before`: the spell's rank the transaction raised. */
  | Readonly<{ type: 'character/spell_raised'; character_id: string; spell: string; before: number }>
  | Readonly<{
      type: 'character/consumed'
      digest: string
      character_id: string
      item_id: string
      effect: 'heal' | 'reset_stats' | 'reset_spells' | 'recall' | 'city'
      heal: number
      /** The health the transaction healed from. */
      before: Readonly<Pick<CharacterRow, 'hp' | 'hp_ms'>>
    }>
  | Readonly<{
      type: 'character/world_joined'
      character_id: string
      joined: Readonly<{ world: string; x: number; z: number; first_join: boolean }>
    }>
  | Readonly<{ type: 'inventory/boxes_opened'; claims: readonly ClaimRow[] }>
  | Readonly<{ type: 'inventory/claims_settled'; claim_ids: readonly string[] }>
  | Readonly<{ type: 'inventory/gear_crushed'; gear_ids: readonly string[]; claim_id: string }>
  /** `before`: the pet's power the feeding raised. */
  | Readonly<{ type: 'inventory/pet_fed'; pet_id: string; before: number }>
  /** `before`: the job's experience the craft added to. */
  | (CraftOutcome & Readonly<{ type: 'character/crafted'; character_id: string; xp: number; before: string }>)
  | Readonly<{
      type: 'wallet/resolve_character'
      name: string
      resolve: (recipient: Readonly<{ address: string; name: string }>) => void
      reject: (error: Readonly<Error>) => void
    }>
/** The played character row; the roster owns custody and every transaction reads its kiosk pair here. */
export const selected_character = (session: Readonly<SessionState>): CharacterRow | null =>
  session.agent_view.request
    ? null
    : (session.characters.find(({ id }) => id === session.selected_character_id) ?? null)
export const character_custody = (character: Readonly<CharacterRow>) =>
  Object.freeze({ kiosk: character.kiosk, ...(character.kiosk_cap ? { kiosk_cap: character.kiosk_cap } : {}) })
const with_session = <S extends SiteState>(state: S, session: SessionState): S => Object.freeze({ ...state, session })
const select_character = <S extends SiteState>(state: S, character_id: string): S =>
  state.session.characters.some(({ id }) => id === character_id) && state.session.selected_character_id !== character_id
    ? with_session(state, Object.freeze({ ...state.session, selected_character_id: character_id }))
    : state
/** The session a sign-out or a new account starts from: the sign-in offer survives, nothing of the account does. */
const fresh_session = (session: SessionState): SessionState =>
  Object.freeze({
    ...initial_session_state(Math.max(session.agent_view.serial, session.agent_inventory.serial) + 1),
    wallets: session.wallets,
  })
const with_sign_in = (session: SessionState, sign_in: SignIn): SessionState => Object.freeze({ ...session, sign_in })
/** A sign-in starts only from a signed-out idle session whose sign-in code has loaded; a restore needs no code. */
const start_sign_in = (session: SessionState, request: AuthRequest, needs_code = true): SessionState =>
  session.sign_in.status === 'idle' && !session.wallet && (!needs_code || session.wallets !== null)
    ? with_sign_in(session, Object.freeze({ status: 'connecting', request }))
    : session
const answered = (session: SessionState, answer: () => SessionState): SessionState =>
  session.sign_in.status === 'connecting' ? answer() : session
type SignInInput = Extract<
  SessionInput,
  {
    type:
      | 'auth/connecting'
      | 'auth/ready'
      | 'auth/login_google'
      | 'auth/connected'
      | 'auth/failed'
      | 'auth/rejected'
      | 'auth/disconnected'
  }
>
const SIGN_IN: {
  [K in SignInInput['type']]: (session: SessionState, input: Extract<SignInInput, { type: K }>) => SessionState
} = {
  'auth/connecting': (session) => start_sign_in(session, 'restore', false),
  'auth/ready': (session, { wallets }) => Object.freeze({ ...session, wallets }),
  'auth/login_google': (session) => start_sign_in(session, 'google'),
  'auth/connected': (session, input) =>
    answered(session, () =>
      Object.freeze({ ...fresh_session(session), wallet: input.session, link_status: 'connecting' })
    ),
  'auth/failed': (session, { error }) =>
    answered(session, () => with_sign_in(session, Object.freeze({ status: 'idle', error }))),
  'auth/rejected': (session, { error }) =>
    with_sign_in(fresh_session(session), Object.freeze({ status: 'idle', error })),
  'auth/disconnected': (session, input) => Object.freeze({ ...fresh_session(session), after_sign_out: input.then }),
}
const reduce_sign_in = (session: SessionState, input: AppInput): SessionState => {
  const step = SIGN_IN[input.type as SignInInput['type']] as
    ((session: SessionState, input: SignInInput) => SessionState) | undefined
  return step ? step(session, input as SignInInput) : session
}
const reduce = <S extends SiteState>(state: S, input: AppInput): S => {
  const current = state.session
  const receipt = fold_inventory_input(
    fold_character_receipt(
      fold_character_deletion(
        fold_agent_view(
          fold_agent_inventory(
            fold_agent_inventory_target(fold_owner_connection(current, input), input),
            current,
            input
          ),
          input
        ),
        input
      ),
      input
    ),
    input
  )
  const creation = fold_character_creation(receipt, input)
  if (creation !== current) return with_session(state, creation)
  const link_state = fold_link_input(current, input)
  if (link_state !== current) return with_session(state, link_state)
  if (input.type === 'character/select') return select_character(state, input.character_id)
  const signed = reduce_sign_in(current, input)
  if (signed !== current) return with_session(state, signed)
  if (input.type === 'wallet/refreshed')
    return with_session(
      state,
      Object.freeze({
        ...current,
        sui_balance_mist: input.balance_mist,
        kares_balance: input.kares_balance,
        gas_spent_mist: input.gas_spent_mist,
      })
    )
  if (
    input.type === 'link/latency' &&
    (current.link_status === 'connected' || current.link_status === 'ready') &&
    current.latency_ms !== input.latency_ms
  )
    return with_session(state, Object.freeze({ ...current, latency_ms: input.latency_ms }))
  if (input.type === 'server/packet') {
    if (input.packet.type === 'packet/connection_accepted')
      return with_session(state, Object.freeze({ ...current, ...accepted_link(input.packet) }))
    const next = fold_session_packet(current, input.packet)
    return next === current ? state : with_session(state, next)
  }
  return state
}
/** What the session observer does outside the store. A test passes its own: no sign-in code, no socket. */
export type SessionEffects = Readonly<{ account: RememberedAuth; connect: typeof connect_server }>
const browser_effects = (): SessionEffects => ({
  account: create_remembered_auth(),
  connect: connect_server,
})
/** A domain's subscription: what it asks the server to stream after a change, or nothing. */
export type Subscription<S> = (
  state: S,
  previous: S
) => Readonly<ClientPacket> | readonly Readonly<ClientPacket>[] | null
/** Every module sends its subscriptions this way, through the one door the session forwards to the live link. */
export const observe_subscriptions = <S>(
  { events, dispatch }: Pick<ModuleContext<S>, 'events' | 'dispatch'>,
  subscriptions: readonly Subscription<S>[]
): void =>
  events.on('STATE_UPDATED', (state, previous) =>
    subscriptions
      .flatMap((subscription) => subscription(state, previous) ?? [])
      .forEach((packet) => dispatch({ type: 'server/send', packet }))
  )
/**
 * Whether the session is known to be signed out. While a remembered session is being restored the answer is not
 * known yet.
 */
export const signed_out = ({ wallet, sign_in }: Readonly<Pick<SessionState, 'wallet' | 'sign_in'>>): boolean =>
  !wallet && !(sign_in.status === 'connecting' && sign_in.request === 'restore')

const observe = (context: SiteContext, { account, connect }: SessionEffects = browser_effects()): void => {
  const { events, dispatch, signal, get_state, seat } = context
  let link: ServerLink | null = null
  // The one link rule: the game links a signed-in account only; the site reads the public stage at once and
  // upgrades to the account's link when a sign-in or a remembered restore ends.
  const link_for = ({ wallet }: SessionState): ServerLink | null =>
    wallet || !seat ? connect({ session: wallet, seat, dispatch }) : null
  const send = (packet: Readonly<ClientPacket>): boolean => link?.send(packet) ?? false
  const end_requests = observe_character_requests(context, send)
  const refresh_wallet = observe_wallet_balances(context)
  // The sign-in code loads in the background. It says which sign-ins this surface offers; a restore awaits it itself.
  void account
    .provider()
    .then((auth) => {
      if (signal.aborted) return
      dispatch({ type: 'auth/ready', wallets: auth.wallets?.().map(({ name }) => name) ?? [] })
    })
    .catch((error) => {
      if (signal.aborted) return
      console.error('Remembered authentication could not be restored.', error)
      account.forget()
      dispatch({ type: 'auth/ready', wallets: [] })
      dispatch({ type: 'auth/failed', error: error instanceof Error ? error.message : String(error) })
    })
  const connect_request = (request: AuthRequest): Promise<AuthSession | null> => {
    if (request === 'restore') return account.restore()
    return account.connect()
  }
  // An answer counts only while its own attempt is the one in progress.
  const login = (attempt: SignIn): void => {
    if (attempt.status !== 'connecting') return
    const current = (): boolean => !signal.aborted && get_state().session.sign_in === attempt
    void connect_request(attempt.request)
      .then((connected) => {
        if (!current()) return
        if (!connected) throw new Error('The remembered wallet is unavailable')
        dispatch({ type: 'auth/connected', session: connected })
      })
      .catch((error) => {
        if (!current()) return
        console.error('Login failed.', error)
        dispatch({ type: 'auth/failed', error: error instanceof Error ? error.message : String(error) })
      })
  }
  const dispose_link = (): void => {
    link?.dispose()
    link = null
    end_requests()
  }
  // Google sign-out clears its stored session in several asynchronous steps. A page change before
  // they finish would leave that session restorable, so the home page opens only afterwards.
  const forget_session = (connected: AuthSession | null, destination: SessionState['after_sign_out']): void => {
    dispose_link()
    void account
      .sign_out(connected)
      .catch((error) => console.warn('Wallet disconnect failed.', error))
      .finally(() => {
        if (destination === 'home') return_home()
      })
  }
  /** A sign-in or a sign-out ends the link of the previous account and opens the next one's. Opening a link
   *  dispatches at once, so this runs again before `link` is assigned: only a changed account opens one. */
  const follow_link = (session: SessionState, previous: SessionState): void => {
    if (session.wallet === previous.wallet) return
    if (session.wallet) link?.dispose()
    else forget_session(previous.wallet, session.after_sign_out)
    link = link_for(session)
    if (session.wallet) dispatch({ type: 'wallet/refresh' })
  }
  /** The game has no sign-in of its own (owner ruling): signed out, it returns to the site, which holds the one. */
  const leave_signed_out_game = (): void => {
    if (seat && signed_out(get_state().session)) return_home()
  }
  events.on('server/send', ({ packet }) => void send(packet))
  observe_failure_toasts(context)
  observe_inventory_subscription({ events, dispatch, send, refresh_balances: refresh_wallet })
  observe_subscriptions<SiteState>(context, [(state, previous) => agent_subscription(state.session, previous.session)])
  events.on('STATE_UPDATED', (state, previous) => {
    remember_selected_character_change(state.session.selected_character_id, previous.session.selected_character_id)
    if (state.session.sign_in !== previous.session.sign_in) login(state.session.sign_in)
    follow_link(state.session, previous.session)
    // A remembered session that did not restore: nobody signed in on this document, so no sign-out is running.
    if (!previous.session.wallet && state.session.sign_in !== previous.session.sign_in) leave_signed_out_game()
  })
  signal.addEventListener('abort', () => {
    dispose_link()
    account.dispose()
  })
  // A remembered wallet is known before the first render, so its restore starts now and not once the
  // sign-in code has loaded: a returning player's game does not wait for it. The restore is started by the
  // state listener above, from the change this input makes.
  if (account.returning) dispatch({ type: 'auth/connecting' })
  else leave_signed_out_game()
  link ??= link_for(get_state().session)
}
// Named for the tests that pass their own effects; `observe` stays the name the complexity baseline keys on.
export { observe as observe_session }
export default Object.freeze({
  name: 'session',
  initial: () => ({ session: initial_session_state() }),
  reduce,
  observe,
}) satisfies SiteModule
