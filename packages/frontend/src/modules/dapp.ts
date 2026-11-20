// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  create_bot_client,
  type BotClient,
  type BotEnv,
  type BotFetch,
  type BotGrant,
  type PendingAuthorization,
} from '@aresrpg/protocol/hosted-bot-client'

import type { AppContext, AppModule, AppState } from '../store.ts'
import type { AuthSession } from '../auth.ts'
import { env } from '../env.ts'
import { toast } from '../toast.ts'
import {
  authorization_request,
  grant_store,
  is_callback,
  local_storage,
  read_pending,
  REQUEST_TIMEOUT_MS,
  save_pending,
  session_storage,
  without_callback,
  type DappStorage,
} from '../dapp/oauth.ts'
import { parse_observation, parse_revisions, type DappObservation, type DappRevisions } from '../dapp/observation.ts'
import type { MarketOrder } from '../dapp/market.ts'
import {
  account_followed,
  observation_proven,
  reduce_dapp,
  initial_dapp_state,
  type CommandOutcome,
  type DappCommand,
  type DappInput,
  type DappMode,
} from '../dapp/state.ts'
import { dapp_text, item_name } from '../dapp/copy.ts'

export { initial_dapp_state, type DappInput, type DappState } from '../dapp/state.ts'

const MODE_KEY = 'aresrpg:dapp:mode'

export type DappEffects = Readonly<{
  issuer: string
  fetcher: BotFetch
  grants: DappStorage | null
  pending: DappStorage | null
  now: () => number
  /** Serializes token refreshes of one owner across tabs; absent where the browser has no Web Locks. */
  lock: BotEnv['lock']
  /** The page URL, read at the lifecycle edge; replacing it never reloads. */
  location: () => Readonly<Pick<Location, 'href' | 'search' | 'origin'>>
  replace_url: (path: string) => void
  navigate: (url: string) => void
}>
/** Wall time that never repeats: a read asked in the same millisecond as an answer still comes after it. */
export const strict_clock = (wall: () => number = Date.now) => {
  let last = 0
  return () => (last = Math.max(last + 1, wall()))
}
const browser_effects = (): DappEffects => ({
  issuer: env.bot_service_url,
  // eslint-disable-next-line functional/prefer-tacit -- Browser fetch must not run with the effects object as its receiver.
  fetcher: (input, init) => fetch(input, init),
  grants: local_storage(),
  pending: session_storage(),
  now: strict_clock(),
  lock: globalThis.navigator?.locks
    ? (owner, task) => globalThis.navigator.locks.request(`aresrpg:dapp:refresh:${owner}`, task)
    : undefined,
  location: () => globalThis.location,
  replace_url: (path) => globalThis.history.replaceState(globalThis.history.state, '', path),
  navigate: (url) => globalThis.location.assign(url),
})

const read_mode = (storage: Readonly<DappStorage> | null): DappMode | null => {
  try {
    const mode = storage?.getItem(MODE_KEY)
    return mode === 'basic' || mode === 'advanced' ? mode : null
  } catch (error) {
    console.warn('The saved dapp mode could not be read.', error)
    return null
  }
}
const write_mode = (storage: Readonly<DappStorage> | null, mode: DappMode): void => {
  try {
    storage?.setItem(MODE_KEY, mode)
  } catch (error) {
    // The toggle remains usable for this page when device storage is unavailable.
    console.warn('The dapp mode could not be saved.', error)
  }
}

const error_code = (error: unknown): string =>
  error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'unavailable'

/** The grant of the signed-in owner; signed out there is none, so every call asks to connect again. */
const owner_grants = (context: AppContext, effects: DappEffects) =>
  grant_store(effects.grants, context.get_state().session.wallet?.address ?? '')

/** Every bot call runs under the signed-in owner's stored grant, which the shared client keeps fresh. */
const create_bot = (context: AppContext, effects: DappEffects) => {
  const { dispatch, get_state, signal } = context
  const client = create_bot_client({
    issuer: effects.issuer,
    fetch: effects.fetcher,
    now: effects.now,
    timeout_ms: REQUEST_TIMEOUT_MS,
    signal,
    lock: effects.lock,
  })
  const call = async (name: string, args: Readonly<Record<string, unknown>> = {}) => {
    const result = await client.session(owner_grants(context, effects)).call(name, args)
    // Only the bot's refusal of the grant ends the link; an outage keeps it for the next attempt.
    const ended = !result.ok && result.error === 'reauthorization_required'
    if (ended && get_state().dapp.link.phase === 'connected')
      dispatch({ type: 'dapp/link', link: { phase: 'disconnected', error: 'expired' } })
    return result
  }
  return { call, client }
}
type Bot = Readonly<ReturnType<typeof create_bot>>
type Read<T> = Readonly<{ ok: true; value: T } | { ok: false; error: string }>

type Observed = Readonly<{ observation: DappObservation; revisions: DappRevisions | null }>

/** One read of the bot. It wakes a sleeping bot, and it alone proves what a pushed status cannot. */
const observe_once = async (bot: Bot, context: AppContext, effects: DappEffects): Promise<Read<Observed>> => {
  const requested_ms = effects.now()
  const read = await bot.call('bot_observe', { view: 'full' })
  if (!read.ok) return read
  const observation = parse_observation(read.value)
  if (!observation) return { ok: false, error: 'invalid_observation' }
  context.dispatch({ type: 'dapp/observed', observation, requested_ms, now: effects.now() })
  return { ok: true, value: { observation, revisions: parse_revisions(read.value) } }
}

/** A refusal changed nothing; an unknown answer may have: it is observed, never sent again. */
const outcome_of = (result: Read<unknown>): CommandOutcome => {
  if (result.ok) return { kind: 'done' }
  return result.error === 'uncertain' ? { kind: 'uncertain' } : { kind: 'refused', error: result.error }
}

/** A command is admitted under the wallet's newest revisions, so each one reads the bot first. */
const revised_command = async (
  bot: Bot,
  context: AppContext,
  effects: DappEffects,
  name: string,
  args: Readonly<Record<string, unknown>>
) => {
  const observed = await observe_once(bot, context, effects)
  if (!observed.ok) return observed
  const { revisions } = observed.value
  return revisions ? bot.call(name, { ...args, ...revisions }) : ({ ok: false, error: 'needs_resync' } as const)
}

/** Stats, spell ranks and market orders go through the bot's typed gameplay catalogue as direct commands. */
const direct_command = (
  bot: Bot,
  context: AppContext,
  effects: DappEffects,
  command: Readonly<{ id: string; action: string; payload: Readonly<Record<string, unknown>> }>
) =>
  revised_command(bot, context, effects, `bot_${command.action}`, {
    idempotency_key: command.id,
    action: command.payload,
  })

const submit = async (
  bot: Bot,
  context: AppContext,
  effects: DappEffects,
  command: DappCommand
): Promise<Read<unknown>> => {
  switch (command.kind) {
    case 'start':
      return revised_command(bot, context, effects, 'bot_start_behavior', {
        script: command.script,
        idempotency_key: command.id,
      })
    case 'stop':
      return bot.call('bot_stop_behavior', { character_id: command.hero_id })
    case 'hero_action':
      return direct_command(bot, context, effects, command)
  }
}

/** Each hero's command travels by itself, so heroes never wait for one another. */
const run_command = (bot: Bot, context: AppContext, effects: DappEffects, command: DappCommand): void => {
  const settle = (outcome: CommandOutcome) => {
    if (context.signal.aborted) return
    // An accepted hero change is applied by the bot later; the next observation shows its result.
    if (outcome.kind === 'done' && command.kind === 'hero_action')
      toast.rich(dapp_text(context.get_state().copy, 'hero_action_sent'), [], 'success')
    const { hero_id, id } = command
    context.dispatch({ type: 'dapp/command_settled', hero_id, id, outcome, now: effects.now() })
  }
  void submit(bot, context, effects, command).then(
    (result) => settle(outcome_of(result)),
    (error: unknown) => {
      console.warn('A hosted bot command failed unexpectedly.', error)
      settle({ kind: 'uncertain' })
    }
  )
}

/** A market order is sent once; from then on the bot's observations say what became of it. */
const run_order = (bot: Bot, context: AppContext, effects: DappEffects, order: MarketOrder): void => {
  const settle = (outcome: CommandOutcome) => {
    if (!context.signal.aborted)
      context.dispatch({ type: 'dapp/order_sent', id: order.id, outcome, now: effects.now() })
  }
  void direct_command(bot, context, effects, order).then(
    (result) => settle(outcome_of(result)),
    (error: unknown) => {
      console.warn('A hosted bot market order failed unexpectedly.', error)
      settle({ kind: 'uncertain' })
    }
  )
}

const refused = (error: string): Read<never> => ({ ok: false, error })
/** An unexpected failure of a link step is told like a refusal; its cause stays in the console. */
const unexpected = (error: unknown): Read<never> => {
  console.warn('A hosted bot link step failed unexpectedly.', error)
  return refused(error_code(error))
}

const connect = async ({ client }: Bot, effects: DappEffects, wallet: AuthSession): Promise<Read<null>> => {
  if (wallet.identity !== 'zklogin') return refused('google_required')
  const pending = await client.begin(authorization_request(effects.location().origin))
  if (!pending.ok) return pending
  if (!save_pending(effects.pending, pending.value)) return refused('storage_unavailable')
  effects.navigate(await client.authorization_url(pending.value))
  return { ok: true, value: null }
}

/** Ends a grant the dapp no longer keeps; when the bot cannot be reached the grant's own expiry still applies. */
const drop_grant = (client: BotClient, grant: BotGrant) =>
  void client.revoke(grant).then((revoked) => {
    if (!revoked.ok) console.warn('Hosted bot grant revocation failed; its expiry still applies.', revoked.error)
  })

/** A code is exchanged once, and its tokens become a grant only for the owner they act for. */
const verified_grant = async (client: BotClient, pending: PendingAuthorization, code: string, owner: string) => {
  const tokens = await client.exchange(pending, code)
  return tokens.ok ? client.verify(tokens.value, owner) : tokens
}

/** The consent redirect returns once to this tab; its code becomes a grant only for the signed-in
 * owner. The value says whether this page load was that return. */
const complete_authorization = async (
  { client }: Bot,
  context: AppContext,
  effects: DappEffects,
  wallet: AuthSession
): Promise<Read<boolean>> => {
  const { search, href } = effects.location()
  if (!is_callback(search)) return { ok: true, value: false }
  const pending = read_pending(effects.pending, effects.now())
  effects.replace_url(without_callback(href))
  save_pending(effects.pending, null)
  const code = pending && client.authorization_code(pending, new URLSearchParams(search))
  if (!pending || !code?.ok) return refused('consent_failed')
  context.dispatch({ type: 'dapp/link', link: { phase: 'exchanging' } })
  const grant = await verified_grant(client, pending, code.value, wallet.address)
  if (!grant.ok) return grant
  if (!grant_store(effects.grants, wallet.address).save(grant.value)) {
    drop_grant(client, grant.value)
    return refused('storage_unavailable')
  }
  context.dispatch({ type: 'dapp/link', link: { phase: 'connected' } })
  return { ok: true, value: true }
}

/** A link step that did not finish returns to Connect with its reason. */
const link_refused = (context: AppContext, error: string): void => {
  if (!context.signal.aborted) context.dispatch({ type: 'dapp/link', link: { phase: 'disconnected', error } })
}

const bind_wallet = (bot: Bot, context: AppContext, effects: DappEffects, wallet: AuthSession | null) => {
  if (!wallet) return context.dispatch({ type: 'dapp/link', link: { phase: 'idle' } })
  void complete_authorization(bot, context, effects, wallet)
    .catch(unexpected)
    .then((completed) => {
      if (!completed.ok) return link_refused(context, completed.error)
      if (completed.value || context.get_state().session.wallet !== wallet) return
      const connected = grant_store(effects.grants, wallet.address).read() !== null
      // No connect screen: a signed-in player without a grant is connected at once. The page that
      // receives the bot's consent redirect is already finishing that request, so it starts no other.
      const consenting = new URLSearchParams(effects.location().search).has('authorization_id')
      const unlinked = consenting
        ? ({ phase: 'disconnected', error: null } as const)
        : ({ phase: 'authorizing' } as const)
      context.dispatch({ type: 'dapp/link', link: connected ? { phase: 'connected' } : unlinked })
    })
}

/**
 * The bot's account is read on the game socket, never from the bot: a connected grant names the
 * wallet, and the session's one read-only account subscription follows it. Without a grant it follows none.
 */
const follow_account = (context: AppContext, effects: DappEffects): void => {
  const { session, dapp } = context.get_state()
  const { wallet } = session
  if (!wallet) return
  const identity = dapp.link.phase === 'connected' ? grant_store(effects.grants, wallet.address).read()?.identity : null
  const pairing = identity
    ? { address: identity.address, multisig_public_key: identity.descriptor, signer_mode: 'host-persistent' as const }
    : null
  if (session.inventory_pairing?.address === pairing?.address) return
  context.dispatch({ type: 'agent/inventory_target', wallet, pairing })
}

/** Finds are announced from the haul's own delta, so a repeated observation never repeats a toast. */
const announce_finds = (state: AppState, previous: AppState) => {
  const before = previous.dapp.haul?.found
  if (!before) return
  const gains = Object.entries(state.dapp.haul?.found ?? {}).map(
    ([item_type, amount]) => [item_type, amount - (before[item_type] ?? 0)] as const
  )
  for (const [item_type, added] of gains.filter(([, added]) => added > 0))
    toast.rich(
      dapp_text(state.copy, 'found_toast'),
      [
        { text: `${dapp_text(state.copy, 'found_toast')} `, tone: 'default' },
        { text: `+${added} ${item_name(item_type)}`, tone: 'gold' },
      ],
      'success'
    )
}

/**
 * The player signed out of a linked page. Only sign-out folds the link to idle in the reduction that
 * removes the wallet; a session taken away keeps its link until the next one, and keeps its grant.
 */
const signed_out = (state: AppState, previous: AppState): boolean =>
  [
    previous.session.wallet !== null,
    state.session.wallet === null,
    previous.dapp.link.phase === 'connected',
    state.dapp.link.phase === 'idle',
  ].every(Boolean)

/** Commands the reducer just admitted: each is sent once, when it first appears. */
const issued_commands = (state: AppState, previous: AppState): readonly DappCommand[] =>
  Object.values(state.dapp.commands).filter(
    (command) => command.status === 'pending' && previous.dapp.commands[command.hero_id] !== command
  )

export const observe_dapp = (context: AppContext, effects: DappEffects = browser_effects()) => {
  const { events, dispatch, get_state, signal } = context
  const device = local_storage()
  const saved_mode = read_mode(device)
  if (saved_mode) dispatch({ type: 'dapp/mode', mode: saved_mode })
  if (!effects.issuer) return
  const bot = create_bot(context, effects)
  let reading = false
  let asked_again = false
  /** Reads are asked by events, never by a clock; one runs at a time, and one asked meanwhile follows it. */
  const read = () => {
    if (get_state().dapp.link.phase !== 'connected') return
    asked_again = reading
    if (reading) return
    reading = true
    void observe_once(bot, context, effects)
      .catch((error: unknown): Read<never> => ({ ok: false, error: error_code(error) }))
      .then((result) => {
        if (result.ok || signal.aborted) return
        console.warn('The hosted bot observation failed.', result.error)
        dispatch({ type: 'dapp/observe_failed', error: result.error })
      })
      .finally(() => {
        reading = false
        if (asked_again && !observation_proven(get_state().dapp)) read()
      })
  }
  /** A tab shown again recovers a failed read; a proven view needs none, the bot pushes its changes. */
  const recover = () => {
    const { observe_error, observation } = get_state().dapp
    if (globalThis.document?.visibilityState !== 'hidden' && (observe_error || !observation)) read()
  }
  /**
   * Disconnect and sign-out end the owner's grant at the bot first and forget it here only once the
   * bot confirms. A grant the bot did not end stays on this device, because it is the only way to end
   * it; a Disconnect returns to its link so it can be tried again.
   */
  const revoke = (grants: Readonly<ReturnType<typeof grant_store>>) => {
    const grant = grants.read()
    if (!grant) return
    void bot.client
      .revoke(grant)
      .catch(unexpected)
      .then((revoked) => {
        if (revoked.ok) return void grants.save(null)
        console.warn('The hosted bot did not confirm the end of this grant.', revoked.error)
        if (signal.aborted) return
        toast.rich(dapp_text(get_state().copy, 'disconnect_failed'), [], 'error')
        const { session, dapp } = get_state()
        if (session.wallet?.address === grant.identity.owner && dapp.link.phase === 'disconnected')
          dispatch({ type: 'dapp/link', link: { phase: 'connected' } })
      })
  }
  const authorize = (wallet: AuthSession) =>
    void connect(bot, effects, wallet)
      .catch(unexpected)
      .then((started) => {
        if (!started.ok) link_refused(context, started.error)
      })
  // Each effect observes its own slice of the state delta.
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.wallet !== previous.session.wallet) bind_wallet(bot, context, effects, state.session.wallet)
    if (signed_out(state, previous)) revoke(grant_store(effects.grants, previous.session.wallet!.address))
    if (state.dapp.mode !== previous.dapp.mode) write_mode(device, state.dapp.mode)
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const [link, before] = [state.dapp.link, previous.dapp.link]
    if (link.phase === before.phase) return
    if (link.phase === 'authorizing' && state.session.wallet) authorize(state.session.wallet)
    if (link.phase === 'disconnected' && before.phase === 'connected' && !link.error)
      revoke(owner_grants(context, effects))
    follow_account(context, effects)
    if (link.phase === 'connected') read()
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.dapp.commands !== previous.dapp.commands)
      for (const command of issued_commands(state, previous)) run_command(bot, context, effects, command)
    if (state.dapp.haul !== previous.dapp.haul) announce_finds(state, previous)
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const { order } = state.dapp
    if (order?.status === 'pending' && order.id !== previous.dapp.order?.id) run_order(bot, context, effects, order)
  })
  // The bot's pushed status re-enters through the reducer. A push never asks the bot for a read.
  events.on('STATE_UPDATED', (state, previous) => {
    const { status } = state.session.agent_inventory
    if (status && status !== previous.session.agent_inventory.status) {
      const observation = parse_observation(status)
      if (observation) dispatch({ type: 'dapp/observed', observation, requested_ms: null, now: effects.now() })
    }
    // An answered command leaves the view unproven until the bot is read again.
    if (state.dapp.settled_ms !== previous.dapp.settled_ms) read()
  })
  globalThis.document?.addEventListener('visibilitychange', recover)
  signal.addEventListener('abort', () => globalThis.document?.removeEventListener('visibilitychange', recover), {
    once: true,
  })
  bind_wallet(bot, context, effects, get_state().session.wallet)
}

const reduce = (state: AppState, input: Parameters<NonNullable<AppModule['reduce']>>[1]): AppState => {
  const account = state.session.agent_inventory
  const folded = (): AppState['dapp'] => {
    if (input.type === 'auth/disconnected')
      return reduce_dapp(state.dapp, { type: 'dapp/link', link: { phase: 'idle' } }, account)
    // The session folded first: any input may have moved the account this page shows.
    return input.type.startsWith('dapp/')
      ? reduce_dapp(state.dapp, input as DappInput, account)
      : account_followed(state.dapp, account)
  }
  const next = folded()
  return next === state.dapp ? state : { ...state, dapp: next }
}

export default Object.freeze({
  name: 'dapp',
  reduce,
  observe: (context: AppContext) => observe_dapp(context),
}) satisfies AppModule
