// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The edges of a real store start: the browser's address bar and storage, the server's socket, the sign-in and
// the wallet. Everything between them is production code: the store, its module lists, the session observer and
// the real server link, which parses every frame a test pushes through the fake socket.
import type { CharacterRow, ClientPacket, ItemRow, ServerPacket } from '@aresrpg/protocol'

import type { AuthSession } from '../src/auth.ts'
import { observe_session } from '../src/modules/session.ts'
import { create_remembered_auth, type AuthProvider } from '../src/remembered_auth.ts'
import { connect_server } from '../src/server_link.ts'
import { start_app, read_app_state, dispatch_app, type AppInput, type AppModule, type AppState } from '../src/store.ts'
import { toast, type Toast } from '../src/toast.ts'

type Storage = Readonly<{
  values: Map<string, string>
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}>

export const memory_storage = (entries: Readonly<Record<string, string>> = {}): Storage => {
  const values = new Map(Object.entries(entries))
  return Object.freeze({
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  })
}

/** The address bar: `history` moves it, as a browser's does. */
const install_address = (href: string): void => {
  const address = { current: new URL(href) }
  const location = {
    get href() {
      return address.current.href
    },
    get origin() {
      return address.current.origin
    },
    get pathname() {
      return address.current.pathname
    },
    get search() {
      return address.current.search
    },
    get hash() {
      return address.current.hash
    },
    assign: (next: string) => void (address.current = new URL(next, address.current.href)),
  }
  const move = (_state: unknown, _title: string, next: string): void => location.assign(next)
  replace_globals({ location, history: { pushState: move, replaceState: move }, navigator: browser_navigator('en-US') })
}

/** The runtime's navigator with a browser language: every other property reads through to the real one. */
export const browser_navigator = (language: string): Navigator =>
  Object.create(globalThis.navigator ?? null, { language: { value: language, enumerable: true } }) as Navigator

/** The first value of each global a suite replaced, so the process gets it back: other packages share it. */
const originals = new Map<string, PropertyDescriptor | undefined>()
const put_back = (name: string, descriptor: PropertyDescriptor | undefined): void => {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor)
  else Reflect.deleteProperty(globalThis, name)
}
/** Replaces browser globals; the returned function restores what each name held just before. */
export const replace_globals = (globals: Readonly<Record<string, unknown>>): (() => void) => {
  const previous = Object.keys(globals).map(
    (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const
  )
  previous.forEach(([name, descriptor]) => void (originals.has(name) || originals.set(name, descriptor)))
  Object.entries(globals).forEach(([name, value]) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  )
  return () => previous.forEach(([name, descriptor]) => put_back(name, descriptor))
}
/** Restores every global any suite replaced to the value the process started with. */
export const restore_globals = (): void => {
  originals.forEach((descriptor, name) => put_back(name, descriptor))
  originals.clear()
}

export type FakeSocket = Readonly<{
  url: URL
  readonly readyState: number
  readonly closed: Readonly<{ code: number; reason: string }> | null
  /** The packets the client sent, oldest first. */
  readonly sent: readonly ClientPacket[]
  send: (data: string) => void
  close: (code: number, reason: string) => void
  addEventListener: (name: string, listener: (event: unknown) => void) => void
  /** A frame from the server, as text: the link parses it like any other. */
  deliver: (packet: Readonly<ServerPacket> | Readonly<Record<string, unknown>>) => void
  /** The server closes the socket. */
  drop: (code: number, reason: string) => void
}>

const sockets = new Set<FakeSocket>()
const open_socket = (url: string): FakeSocket => {
  const listeners = new Map<string, readonly ((event: unknown) => void)[]>()
  const emit = (name: string, event: unknown): void =>
    (listeners.get(name) ?? []).forEach((listener) => listener(event))
  let ready = 1
  let closed: FakeSocket['closed'] = null
  let sent: readonly ClientPacket[] = []
  const socket: FakeSocket = Object.freeze({
    url: new URL(url),
    get readyState() {
      return ready
    },
    get closed() {
      return closed
    },
    get sent() {
      return sent
    },
    send: (data: string) => void (sent = [...sent, JSON.parse(data) as ClientPacket]),
    close: (code: number, reason: string) => {
      ready = 3
      closed = { code, reason }
    },
    addEventListener: (name: string, listener: (event: unknown) => void) =>
      void listeners.set(name, [...(listeners.get(name) ?? []), listener]),
    deliver: (packet: Readonly<ServerPacket> | Readonly<Record<string, unknown>>) =>
      emit('message', { data: JSON.stringify(packet) }),
    drop: (code: number, reason: string) => {
      ready = 3
      emit('close', { code, reason })
    },
  })
  sockets.add(socket)
  return socket
}
/** The WebSocket the server link constructs with `new`: it records and returns a fake socket. */
function FakeWebSocket(url: string): FakeSocket {
  return open_socket(url)
}
Object.defineProperties(FakeWebSocket, {
  CONNECTING: { value: 0 },
  OPEN: { value: 1 },
  CLOSING: { value: 2 },
  CLOSED: { value: 3 },
})

/** The browser edges alone, for a door that opens its own link without a store. */
export const install_browser = (href = 'https://aresrpg.world/', storage = memory_storage()): void => {
  install_address(href)
  replace_globals({ localStorage: storage, WebSocket: FakeWebSocket })
}
/** The socket opened last, by any link. */
export const last_socket = (): FakeSocket => {
  const socket = [...sockets].at(-1)
  if (!socket) throw new Error('no socket was opened')
  return socket
}

/** A wallet: what the account signs with. A case gives the chain hands it uses. */
export const fake_wallet = (overrides: Readonly<Record<string, unknown>> = {}, address = `0x${'a'.repeat(64)}`) => {
  return Object.freeze({
    address,
    wallet_name: 'Sign in with Google',
    identity: 'zklogin',
    sign_personal_message: async (message: Uint8Array) => ({
      bytes: Buffer.from(message).toString('base64'),
      signature: 'signed',
    }),
    read_sui_balance: async () => 50_000_000_000n,
    read_kares_balance: async () => 7n,
    gas_spent_24h: () => 0n,
    is_transaction_idle: () => true,
    on_transaction: () => () => undefined,
    disconnect: async () => undefined,
    suins: Object.freeze({ managed: false, snapshot: async () => ({ default_name: null, names: [] }) }),
    ...overrides,
  }) as unknown as AuthSession
}

/** A character as the server's roster sends it. */
export const character_row = (id: string, overrides: Partial<CharacterRow> = {}): CharacterRow => ({
  id,
  name: 'Nox',
  classe: 'senshi',
  sex: 'male',
  experience: '0',
  level: 1,
  color_1: 0xffffff,
  color_2: 0xd9af57,
  color_3: 0x8b6539,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: {},
  kiosk: `0xkiosk_${id}`,
  equipment: [],
  ...overrides,
})

type Account = Readonly<{
  /** The wallet the next sign-in or restore returns. */
  wallet: AuthSession | null
  /** A remembered wallet name: the surface restores it at start. */
  remembered?: string
  restore_error?: Error
}>

export type Started = Readonly<{
  state: () => AppState
  dispatch: (input: AppInput) => void
  /** Every socket the link opened, oldest first. */
  sockets: () => readonly FakeSocket[]
  socket: () => FakeSocket
  /** The packets the account sent on the current socket, by type. */
  sent: (type?: string) => readonly ClientPacket[]
  /** Pushes frames through the current socket. */
  receive: (...packets: readonly (Readonly<ServerPacket> | Readonly<Record<string, unknown>>)[]) => void
  toasts: () => readonly Toast[]
  storage: Storage
  stop: () => void
}>

/** Signs the started surface in with the account's wallet: the server accepts its link and sends its roster and bag. */
export const sign_in = async (
  started: Started,
  {
    characters = [],
    inventory = [],
  }: Readonly<{ characters?: readonly CharacterRow[]; inventory?: readonly ItemRow[] }> = {}
): Promise<AuthSession> => {
  if (!started.state().session.wallet) started.dispatch({ type: 'auth/login_google' })
  await settle()
  const { wallet } = started.state().session
  if (!wallet) throw new Error('the account did not sign in')
  started.receive(
    {
      type: 'packet/connection_accepted',
      stage: started.socket().url.searchParams.has('seat') ? 'seated' : 'signed',
      address: wallet.address,
    },
    { type: 'packet/characters', characters },
    { type: 'packet/inventory', items: inventory }
  )
  await settle()
  return wallet
}

/** Lets the queued promises of an observer settle. */
export const settle = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Starts the real store with a surface's real module list; only the edges are fakes. */
export const start_surface = async (
  modules: readonly AppModule[],
  {
    seat,
    account = { wallet: null },
    href = seat ? 'https://aresrpg.world/world' : 'https://aresrpg.world/',
    storage = memory_storage(account.remembered ? { last_wallet: account.remembered } : {}),
  }: Readonly<{ seat: boolean; account?: Account; href?: string; storage?: Storage }>
): Promise<Started> => {
  install_address(href)
  replace_globals({ localStorage: storage, WebSocket: FakeWebSocket })
  const first_socket = sockets.size
  const provider: AuthProvider<AuthSession> = {
    connect_google: async () => {
      if (!account.wallet) throw new Error('Sign-in cancelled')
      return account.wallet
    },
    restore: async () => {
      if (account.restore_error) throw account.restore_error
      return account.wallet
    },
    dispose: () => undefined,
  }
  const remembered = create_remembered_auth(async () => provider, storage)
  const with_fake_edges = modules.map((module) =>
    module.name === 'session'
      ? Object.freeze({
          ...module,
          observe: (context: Parameters<NonNullable<AppModule['observe']>>[0]) =>
            observe_session(context, { account: remembered, connect: connect_server }),
        })
      : module
  )
  let shown: readonly Toast[] = []
  const unsubscribe = toast.subscribe((event) => {
    if (event.type === 'show') shown = [...shown, event.toast]
  })
  const stop_store = start_app(with_fake_edges, { seat })
  await settle()
  const mine = (): readonly FakeSocket[] => [...sockets].slice(first_socket)
  const socket = (): FakeSocket => {
    const current = mine().at(-1)
    if (!current) throw new Error('no socket was opened')
    return current
  }
  return Object.freeze({
    state: read_app_state,
    dispatch: dispatch_app,
    sockets: mine,
    socket,
    sent: (type) => socket().sent.filter((packet) => !type || packet.type === type),
    receive: (...packets) => packets.forEach((packet) => socket().deliver(packet)),
    toasts: () => shown,
    storage,
    stop: () => {
      unsubscribe()
      stop_store()
      restore_globals()
    },
  })
}
