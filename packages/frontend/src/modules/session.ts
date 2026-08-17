// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type {
  AirdropState,
  CharacterRow,
  ClaimRow,
  ItemRow,
  ListingRow,
  ServerPacket,
  ShopState,
  TradeRow,
} from '@aresrpg/protocol'
import { fight_action_to_wire } from '@aresrpg/fight'

import type { Auth, AuthSession } from '../auth.ts'
import { browser_auth_storage, clear_auth_wallet, read_auth_wallet, remember_auth_wallet } from '../auth_storage.ts'
import { env } from '../env.ts'
import { connect_server, type ServerLink } from '../server_link.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

export type AuthStatus = 'idle' | 'connecting' | 'authenticated'
export type AuthRequest = 'restore' | 'google' | Readonly<{ wallet: string }>
export type LinkStatus = 'idle' | 'connecting' | 'connected' | 'ready'
const BALANCE_POLL_MS = 5_000
export type SessionState = Readonly<{
  auth_status: AuthStatus
  auth_request: AuthRequest | null
  auth_error: string | null
  link_status: LinkStatus
  link_error: string | null
  latency_ms: number | null
  indexing_lag: number | null
  game_frozen: boolean | null
  roster_loaded: boolean
  characters: readonly CharacterRow[]
  inventory: readonly ItemRow[]
  friends: readonly string[]
  claims: readonly ClaimRow[]
  giftcards: readonly { id: string; template: string; amount: number }[]
  listings: readonly ListingRow[]
  trades: readonly TradeRow[]
  selected_character_id: string | null
  online: number | null
  auth_ready: boolean
  wallets: readonly string[]
  wallet: AuthSession | null
  sui_balance_mist: bigint | null
  gas_spent_mist: bigint
  shop: Readonly<ShopState> | null
}>

export type SessionInput =
  | Readonly<{ type: 'auth/connecting' }>
  | Readonly<{ type: 'auth/ready'; wallets: readonly string[] }>
  | Readonly<{ type: 'auth/login_google' }>
  | Readonly<{ type: 'auth/login_wallet'; name: string }>
  | Readonly<{ type: 'auth/connected'; session: AuthSession }>
  | Readonly<{ type: 'auth/failed'; error: string }>
  | Readonly<{ type: 'auth/rejected'; error: string }>
  | Readonly<{ type: 'auth/disconnected' }>
  | Readonly<{ type: 'link/connecting' }>
  | Readonly<{ type: 'link/rejected'; reason: string }>
  | Readonly<{ type: 'link/failed'; error: string }>
  | Readonly<{ type: 'link/latency'; latency_ms: number }>
  | Readonly<{ type: 'server/packet'; packet: Readonly<ServerPacket> }>
  | Readonly<{ type: 'character/select'; character_id: string }>
  | Readonly<{ type: 'wallet/refresh' }>
  | Readonly<{ type: 'wallet/refreshed'; balance_mist: bigint; gas_spent_mist: bigint }>
  | Readonly<{ type: 'shop/purchased'; item_type: string; quantity: number }>
  | Readonly<{ type: 'airdrop/claimed'; drop_id: string }>
  | Readonly<{
      type: 'wallet/resolve_character'
      name: string
      resolve: (recipient: Readonly<{ address: string; name: string }>) => void
      reject: (error: Readonly<Error>) => void
    }>

export const initial_session_state = (): SessionState =>
  Object.freeze({
    auth_status: 'idle',
    auth_request: null,
    auth_error: null,
    link_status: 'idle',
    link_error: null,
    latency_ms: null,
    indexing_lag: null,
    game_frozen: null,
    roster_loaded: false,
    characters: [],
    inventory: [],
    friends: [],
    claims: [],
    giftcards: [],
    listings: [],
    trades: [],
    selected_character_id: null,
    online: null,
    auth_ready: false,
    wallets: [],
    wallet: null,
    sui_balance_mist: null,
    gas_spent_mist: 0n,
    shop: null,
  })

const with_session = (state: AppState, session: SessionState): AppState => Object.freeze({ ...state, session })

const with_sale_supply = (session: SessionState, item_type: string, supply: string): SessionState => {
  if (!session.shop) return session
  const sales = session.shop.sales.map((sale) => (sale.item_type === item_type ? { ...sale, supply } : sale))
  return Object.freeze({ ...session, shop: Object.freeze({ ...session.shop, sales: Object.freeze(sales) }) })
}

const with_airdrop = (
  session: SessionState,
  drop_id: string,
  update: (airdrop: AirdropState) => AirdropState
): SessionState => {
  if (!session.shop) return session
  const airdrops = session.shop.airdrops.map((airdrop) => (airdrop.drop_id === drop_id ? update(airdrop) : airdrop))
  return Object.freeze({ ...session, shop: Object.freeze({ ...session.shop, airdrops: Object.freeze(airdrops) }) })
}

const fold_shop_receipt = (session: SessionState, input: AppInput): SessionState => {
  if (input.type === 'shop/purchased') {
    const sale = session.shop?.sales.find(({ item_type }) => item_type === input.item_type)
    if (!sale) return session
    const supply = BigInt(sale.supply) - BigInt(input.quantity)
    return with_sale_supply(session, input.item_type, String(supply < 0n ? 0n : supply))
  }
  if (input.type !== 'airdrop/claimed') return session
  return with_airdrop(session, input.drop_id, (airdrop) => ({
    ...airdrop,
    eligible: false,
    eligible_count: Math.max(0, airdrop.eligible_count - 1),
  }))
}

const fold_packet = (session: SessionState, packet: Readonly<ServerPacket>): SessionState => {
  if (packet.type === 'packet/characters') {
    const selected_character_id = packet.characters.some(({ id }) => id === session.selected_character_id)
      ? session.selected_character_id
      : (packet.characters[0]?.id ?? null)
    return Object.freeze({
      ...session,
      characters: packet.characters,
      selected_character_id,
      roster_loaded: true,
      link_status: 'ready',
      link_error: null,
    })
  }
  if (packet.type === 'packet/server_info')
    return Object.freeze({ ...session, online: packet.online, indexing_lag: packet.indexing_lag })
  if (packet.type === 'packet/game_state') return Object.freeze({ ...session, game_frozen: packet.frozen })
  if (packet.type === 'packet/inventory') return Object.freeze({ ...session, inventory: packet.items })
  if (packet.type === 'packet/friends') return Object.freeze({ ...session, friends: packet.friends })
  if (packet.type === 'packet/claims') return Object.freeze({ ...session, claims: packet.claims })
  if (packet.type === 'packet/giftcards') return Object.freeze({ ...session, giftcards: packet.giftcards })
  if (packet.type === 'packet/listings') return Object.freeze({ ...session, listings: packet.listings })
  if (packet.type === 'packet/trades') return Object.freeze({ ...session, trades: packet.trades })
  if (packet.type === 'packet/shop_state')
    return Object.freeze({
      ...session,
      shop: Object.freeze({ sales: Object.freeze(packet.sales), airdrops: Object.freeze(packet.airdrops) }),
    })
  if (packet.type === 'packet/shop_supply') return with_sale_supply(session, packet.item_type, packet.supply)
  if (packet.type === 'packet/airdrop_remaining')
    return with_airdrop(session, packet.drop_id, (airdrop) => ({ ...airdrop, eligible_count: packet.eligible_count }))
  if (packet.type === 'packet/friend_added')
    return session.friends.includes(packet.who)
      ? session
      : Object.freeze({ ...session, friends: Object.freeze([...session.friends, packet.who]) })
  if (packet.type === 'packet/friend_removed')
    return Object.freeze({ ...session, friends: session.friends.filter((address) => address !== packet.who) })
  if (packet.type === 'packet/trade')
    return Object.freeze({
      ...session,
      trades: Object.freeze([...session.trades.filter(({ id }) => id !== packet.trade.id), packet.trade]),
    })
  if (packet.type === 'packet/trade_destroyed')
    return Object.freeze({ ...session, trades: session.trades.filter(({ id }) => id !== packet.trade) })
  if (packet.type === 'packet/market_delisted' || packet.type === 'packet/listing_sold')
    return Object.freeze({ ...session, listings: session.listings.filter(({ id }) => id !== packet.object) })
  if (packet.type === 'packet/error')
    return packet.id === undefined ? Object.freeze({ ...session, link_error: packet.reason }) : session
  return session
}

const reduce = (state: AppState, input: AppInput): AppState => {
  const current = state.session
  const can_start_auth = current.auth_status === 'idle' && current.auth_ready
  const shop_receipt = fold_shop_receipt(current, input)
  if (shop_receipt !== current) return with_session(state, shop_receipt)
  if (input.type === 'auth/connecting' && current.auth_status === 'idle')
    return with_session(
      state,
      Object.freeze({ ...current, auth_status: 'connecting', auth_request: 'restore', auth_error: null })
    )
  if (input.type === 'auth/ready')
    return with_session(state, Object.freeze({ ...current, auth_ready: true, wallets: input.wallets }))
  if (input.type === 'auth/login_google' && can_start_auth)
    return with_session(
      state,
      Object.freeze({ ...current, auth_status: 'connecting', auth_request: 'google', auth_error: null })
    )
  if (input.type === 'auth/login_wallet' && can_start_auth && current.wallets.includes(input.name))
    return with_session(
      state,
      Object.freeze({
        ...current,
        auth_status: 'connecting',
        auth_request: Object.freeze({ wallet: input.name }),
        auth_error: null,
      })
    )
  if (input.type === 'auth/connected' && current.auth_status === 'connecting')
    return with_session(
      state,
      Object.freeze({
        ...initial_session_state(),
        wallet: input.session,
        auth_status: 'authenticated',
        auth_request: null,
        link_status: 'connecting',
        auth_ready: current.auth_ready,
        wallets: current.wallets,
      })
    )
  if (input.type === 'auth/failed' && current.auth_status === 'connecting')
    return with_session(
      state,
      Object.freeze({ ...current, auth_status: 'idle', auth_request: null, auth_error: input.error })
    )
  if (input.type === 'auth/rejected')
    return with_session(
      state,
      Object.freeze({
        ...initial_session_state(),
        auth_error: input.error,
        auth_ready: current.auth_ready,
        wallets: current.wallets,
      })
    )
  if (input.type === 'auth/disconnected')
    return with_session(
      state,
      Object.freeze({ ...initial_session_state(), auth_ready: current.auth_ready, wallets: current.wallets })
    )
  if (input.type === 'wallet/refreshed')
    return with_session(
      state,
      Object.freeze({ ...current, sui_balance_mist: input.balance_mist, gas_spent_mist: input.gas_spent_mist })
    )
  if (input.type === 'link/connecting')
    return with_session(
      state,
      Object.freeze({ ...current, link_status: 'connecting', link_error: null, latency_ms: null, indexing_lag: null })
    )
  if (input.type === 'link/rejected')
    return with_session(
      state,
      Object.freeze({ ...current, link_status: 'idle', link_error: input.reason, latency_ms: null, indexing_lag: null })
    )
  if (input.type === 'link/failed')
    return with_session(
      state,
      Object.freeze({
        ...current,
        link_status: 'connecting',
        link_error: input.error,
        latency_ms: null,
        indexing_lag: null,
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
      return with_session(state, Object.freeze({ ...current, link_status: 'connected', link_error: null }))
    const next = fold_packet(current, input.packet)
    return next === current ? state : with_session(state, next)
  }
  if (input.type === 'character/select' && current.characters.some(({ id }) => id === input.character_id))
    return with_session(state, Object.freeze({ ...current, selected_character_id: input.character_id }))
  return state
}

const observe = ({ events, dispatch, signal, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  let link: ServerLink | null = null
  let auth: Auth | null = null
  let balance_request_id = 0
  let next_request_id = 1
  const character_requests = new Map<
    number,
    Readonly<{
      character_id: string
      timeout: ReturnType<typeof setTimeout>
      resolve: (recipient: Readonly<{ address: string; name: string }>) => void
      reject: (error: Readonly<Error>) => void
    }>
  >()
  const storage = browser_auth_storage()

  void import('../auth.ts')
    .then(({ create_auth }) => {
      if (signal.aborted) return
      auth = create_auth()
      const wallets = auth.wallets().map(({ name }) => name)
      const remembered_wallet = read_auth_wallet(storage)
      dispatch({ type: 'auth/ready', wallets })
      if (remembered_wallet) dispatch({ type: 'auth/connecting' })
    })
    .catch((error) => {
      if (signal.aborted) return
      console.error('Remembered authentication could not be restored.', error)
      clear_auth_wallet(storage)
      dispatch({ type: 'auth/ready', wallets: [] })
      dispatch({ type: 'auth/failed', error: error instanceof Error ? error.message : String(error) })
    })

  const login = (request: AuthRequest, connect: () => Promise<AuthSession | null>): void => {
    void connect()
      .then((connected) => {
        if (signal.aborted || get_state().session.auth_request !== request) return
        if (!connected) throw new Error('The remembered wallet is unavailable')
        dispatch({ type: 'auth/connected', session: connected })
      })
      .catch((error) => {
        if (signal.aborted || get_state().session.auth_request !== request) return
        console.error('Login failed.', error)
        if (request === 'restore') clear_auth_wallet(storage)
        dispatch({ type: 'auth/failed', error: error instanceof Error ? error.message : String(error) })
      })
  }

  const refresh_wallet = (): void => {
    const connected = get_state().session.wallet
    if (!connected) return
    balance_request_id += 1
    const request_id = balance_request_id
    void connected
      .read_sui_balance()
      .then((balance_mist) => {
        if (request_id !== balance_request_id || connected !== get_state().session.wallet) return
        dispatch({ type: 'wallet/refreshed', balance_mist, gas_spent_mist: connected.gas_spent_24h() })
      })
      .catch((error) => console.warn('Wallet balance could not be refreshed.', error))
  }
  events.on('wallet/refresh', refresh_wallet)
  const balance_timer = setInterval(refresh_wallet, BALANCE_POLL_MS)
  events.on('wallet/resolve_character', ({ name, resolve, reject }) => {
    const connected = get_state().session.wallet
    if (!connected) return reject(new Error('The wallet session is unavailable'))
    try {
      const character_id = connected.derive_character_id(name)
      const id = next_request_id
      next_request_id += 1
      const timeout = setTimeout(() => {
        const pending = character_requests.get(id)
        if (!pending) return
        character_requests.delete(id)
        pending.reject(new Error('The character lookup timed out'))
      }, 15_000)
      character_requests.set(id, Object.freeze({ character_id, timeout, resolve, reject }))
      if (link?.send({ type: 'packet/character_owner_request', id, character_id })) return
      clearTimeout(timeout)
      character_requests.delete(id)
      reject(new Error('The game server is unavailable'))
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
  const refresh_on_focus = (): void => {
    if (globalThis.document?.visibilityState !== 'hidden') dispatch({ type: 'wallet/refresh' })
  }
  globalThis.addEventListener('focus', refresh_on_focus)
  globalThis.document?.addEventListener('visibilitychange', refresh_on_focus)
  const dispose_link = (): void => {
    link?.dispose()
    link = null
    for (const request of character_requests.values()) {
      clearTimeout(request.timeout)
      request.reject(new Error('The wallet session ended'))
    }
    character_requests.clear()
  }
  const forget_session = (connected: AuthSession | null): void => {
    dispose_link()
    clear_auth_wallet(storage)
    void connected?.disconnect().catch((error) => console.warn('Wallet disconnect failed.', error))
  }
  events.on('server/packet', ({ packet }) => {
    if (packet.type === 'packet/character_owner_response') {
      const request = character_requests.get(packet.id)
      if (!request || request.character_id !== packet.character_id) return
      clearTimeout(request.timeout)
      character_requests.delete(packet.id)
      request.resolve(Object.freeze({ address: packet.owner, name: packet.name }))
      return
    }
    if (packet.type === 'packet/error' && packet.id !== undefined) {
      const request = character_requests.get(packet.id)
      if (!request) return
      clearTimeout(request.timeout)
      character_requests.delete(packet.id)
      request.reject(new Error(packet.reason))
      return
    }
  })
  events.on('link/rejected', ({ reason }) => {
    const { copy } = get_state()
    toast.persistent(
      copy?.address_verification_failed ?? 'We could not verify this wallet address.',
      'error',
      copy
        ? Object.freeze({
            label: copy.join_discord,
            onClick: () => globalThis.open(env.discord_url, '_blank', 'noopener,noreferrer'),
          })
        : undefined
    )
    dispatch({ type: 'auth/rejected', error: reason })
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.auth_request !== previous.session.auth_request) {
      const request = state.session.auth_request
      if (request === 'restore' && auth) {
        const remembered_wallet = read_auth_wallet(storage)
        if (remembered_wallet) login(request, () => auth!.restore(remembered_wallet))
        else dispatch({ type: 'auth/failed', error: 'The remembered wallet is unavailable' })
      } else if (request === 'google' && auth) login(request, auth.connect_google)
      else if (request && typeof request === 'object') {
        const wallet = auth?.wallets().find(({ name }) => name === request.wallet)
        if (wallet) login(request, wallet.connect)
        else dispatch({ type: 'auth/failed', error: `${request.wallet} is unavailable` })
      }
    }
    if (state.session.wallet !== previous.session.wallet && state.session.wallet) {
      remember_auth_wallet(storage, state.session.wallet.wallet_name)
      link?.dispose()
      link = connect_server({ session: state.session.wallet, dispatch })
      dispatch({ type: 'wallet/refresh' })
    }
    if (state.admin.overview.status === 'loading' && previous.admin.overview.status !== 'loading') {
      const id = next_request_id
      next_request_id += 1
      dispatch({ type: 'admin/overview_requested', request_id: id })
      if (!link?.send({ type: 'packet/admin_request', id, kind: 'stats' }))
        dispatch({ type: 'admin/overview_failed', request_id: id, error: 'The game server is unavailable' })
    }
    if (state.session.wallet !== previous.session.wallet && !state.session.wallet)
      forget_session(previous.session.wallet)
    const ready_now = state.session.link_status === 'ready'
    const selection_changed = state.session.selected_character_id !== previous.session.selected_character_id
    const became_ready = ready_now && previous.session.link_status !== 'ready'
    const character_id = state.session.selected_character_id
    if (link && character_id && (selection_changed || became_ready)) link.send({ type: 'packet/embody', character_id })
  })
  events.on('fight/input', ({ input, origin }) => {
    const state = get_state()
    const action = fight_action_to_wire(input)
    if (origin !== 'local' || state.fight.mode !== 'remote' || !state.fight.checkpoint || !action) return
    link?.send({ type: 'packet/fight_action', fight: state.fight.checkpoint.contract.id, action })
  })
  signal.addEventListener('abort', () => {
    clearInterval(balance_timer)
    dispose_link()
    auth?.dispose()
    globalThis.removeEventListener('focus', refresh_on_focus)
    globalThis.document?.removeEventListener('visibilitychange', refresh_on_focus)
  })
}

export default Object.freeze({ name: 'session', reduce, observe }) satisfies AppModule
