// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  HTTP_DOOR,
  create_request_limiter,
  admit_visitor,
  type RequestLimiter,
} from '@aresrpg/protocol/request-limiter'
import type { BotIdentity } from '@aresrpg/protocol/hosted-bot-client'
import type { TelegramAccess } from '@aresrpg/protocol/telegram-access'

import { waitlist_card } from './admission.ts'
import { initial_session, outcome, outcome_card, reduce_companion, type Session } from './companion.ts'
import type { Copy, CopyKey } from './copy.ts'
import { perform, read_view, type Action, type Bot } from './hosted.ts'
import { read_update } from './http.ts'
import type { LinkService } from './link.ts'
import { button, card, page_button, type Telegram } from './transport.ts'
import type { Input } from './wire.ts'

/** The picture above the welcome. Telegram fetches it from the game's public site, so it must stay served there. */
const WELCOME_BANNER = 'https://aresrpg.world/social/x-banner-v3-1500x500.png'
/** What Telegram sends, followed by the link's parameter, when a player taps START on a deep link to the bot. */
const START = '/start '

export const create_connected = (
  options: Readonly<{
    access: TelegramAccess
    links: LinkService
    telegram: Pick<Telegram, 'send' | 'acknowledge'>
    /** The bot's public name. The browser returns to this chat after a login, to its START button. */
    bot_username: string
    copy: (locale: string) => Copy
    secret: string
    max_request_bytes: number
    /** How long a strategy review stays approvable. */
    review_ttl_ms: number
    now?: () => number
    /** One allowance per browser address on the login pages, one per Telegram sender on the webhook. */
    visitor_limiter?: RequestLimiter
    sender_limiter?: RequestLimiter
  }>
) => {
  const { access, links, telegram, review_ttl_ms, now = Date.now } = options
  const visitor_limiter = options.visitor_limiter ?? create_request_limiter(HTTP_DOOR)
  const sender_limiter = options.sender_limiter ?? create_request_limiter()
  /** One record per linked sender, written only with its reducer's result. Process-local and disposable. */
  const sessions = new Map<number, Session>()
  const pending = new Map<number, Promise<unknown>>()
  const copy_for = (input: Input) => options.copy(input.locale)
  const send = (input: Input, value: string, buttons: Parameters<typeof card>[1] = []) =>
    telegram.send(input.sender, card(value, buttons))
  const serialize = (sender: number, operation: () => Promise<void>) => {
    const previous = pending.get(sender) ?? Promise.resolve()
    const result = previous.then(operation)
    const settled = result.then(
      () => undefined,
      () => undefined
    )
    pending.set(sender, settled)
    void settled.then(() => {
      if (pending.get(sender) === settled) pending.delete(sender)
    })
    return result
  }
  const forget = async (sender: number) => {
    await links.revoke(sender)
    sessions.delete(sender)
  }
  // Log in again: an expired login is dropped, and the same update then shows the welcome with a fresh
  // login button. A working login stays; it still needs an explicit /unlink.
  const replace_expired_login = async (sender: number) => {
    if (!(await links.current(sender))) return
    const expired = await links.authenticate(sender).then(
      () => false,
      (error: unknown) => {
        if (failure_kind(code_of(error)) !== 'failure_reconnect') throw error
        return true
      }
    )
    if (expired) await forget(sender)
  }
  /** Each request is sent once, in order. The first one the bot does not confirm ends the batch by its code. */
  const act = async (input: Input, bot: Bot, actions: readonly Action[]): Promise<string | null> => {
    const copy = copy_for(input)
    const lines: string[] = []
    let refused: string | null = null
    for (const action of actions) {
      const line = outcome(action, await perform(bot, action), copy)
      if (!line.ok) {
        refused = line.error
        break
      }
      lines.push(line.value)
    }
    if (lines.length) await telegram.send(input.sender, outcome_card(lines, copy))
    return refused
  }
  /** One update of an admitted sender: one fresh observation, one reduction, then its card or its requests. */
  const play = async (input: Input, previous: Session, bot: Bot, identity: BotIdentity) => {
    const view = await read_view(bot, identity)
    if (!view.ok) return view.error
    const step = reduce_companion(previous, input, view.value, { copy: copy_for(input), now: now(), review_ttl_ms })
    sessions.set(input.sender, step.session)
    if ('refused' in step) return step.refused
    if ('actions' in step) return act(input, bot, step.actions)
    await telegram.send(input.sender, step.card)
    return null
  }
  /** Answers one update. A refusal is returned as its code; only an effect that failed to happen throws. */
  const handle = async (input: Input): Promise<string | null> => {
    // Ended link attempts are retired on the sender's next interaction; a failed revoke retries next time.
    await links.expire_attempts(input.sender).catch((error: unknown) => {
      console.error('Telegram attempt retirement failed', code_of(error))
    })
    if (input.text === '/unlink') {
      await forget(input.sender)
      await send(input, copy_for(input).unlinked)
      return null
    }
    if (input.text === '/link') await replace_expired_login(input.sender)
    // START on the deep link the browser returned to. A token that is not this chat's own held login
    // changes nothing and is never echoed or logged: the update goes on as any other.
    if (input.text.startsWith(START)) await links.confirm(input.sender, input.text.slice(START.length))
    // An unlinked sender only ever sees the welcome card and leaves no navigation state, also when its
    // login ended outside this chat: the operator removed the owner, or the hosted bot ended the grant.
    // The card's one button is the login page itself: one tap, then START when the browser returns here.
    if (!(await links.current(input.sender))) {
      sessions.delete(input.sender)
      const copy = copy_for(input)
      const url = await links.begin(input.sender, input.locale)
      await telegram.send(input.sender, {
        ...card(copy.welcome, [[page_button(copy.connect_google, url)]]),
        photo: WELCOME_BANNER,
      })
      return null
    }
    const previous = sessions.get(input.sender) ?? initial_session()
    // Taken before any hosted read, so every older button is stale even when that read fails.
    sessions.set(input.sender, { ...previous, revision: previous.revision + 1, review: null })
    const linked = await links.authenticate(input.sender)
    // The one admission gate, read live on every update: an owner admitted meanwhile plays at this
    // update with the login it already has, and a removed one is refused at this update.
    if (!(await access.admitted(linked.identity.owner))) {
      await telegram.send(input.sender, await waitlist_card(access, input, copy_for(input), linked.identity.owner))
      return null
    }
    return play(input, previous, linked.bot, linked.identity)
  }
  const notify = (input: Input, kind: FailureKind) => {
    const copy = copy_for(input)
    const { next } = FAILURE_RESPONSES[kind]
    return send(input, copy[kind], next ? [[button(copy[next.label], next.command)]] : [])
  }
  /** The refusal code of one update, whether it was returned as data or thrown by an effect. */
  const attempt = (input: Input) => handle(input).catch(code_of)
  // Telegram redelivers non-2xx updates. A refusal is answered 200 once the player got a reply; an
  // undelivered reply answers 503. Every mutating input is guarded by its own phase or revision, so a
  // redelivery never acts twice and needs no update deduplication.
  const receive = async (input: Input) => {
    // Acknowledging only clears the button spinner. A redelivered update carries a query Telegram no
    // longer accepts, so a refused acknowledgment is reported and never decides the update's outcome.
    if (input.callback_id)
      await telegram.acknowledge(input.callback_id).catch((error: unknown) => {
        console.error('Telegram callback acknowledgment failed', code_of(error))
      })
    await serialize(input.sender, async () => {
      const refused = await attempt(input)
      if (refused === null) return
      console.error('Telegram request refused', refused)
      const kind = failure_kind(refused)
      await notify(input, kind)
      // A stale action is not an error: say it was updated, then show what is true now.
      if (kind !== 'failure_changed') return
      const again = await attempt({ ...input, text: '/menu', callback_id: undefined })
      if (again === null) return
      console.error('Telegram current state unavailable', again)
      await notify(input, failure_kind(again) === 'failure_changed' ? 'failure_temporary' : failure_kind(again))
    })
  }
  const browser_response = async (request: Request, url: URL) => {
    if (url.pathname.startsWith('/link/')) {
      const result = await links.browser(url.pathname.slice(6))
      return new Response(null, {
        status: 302,
        headers: {
          Location: result.location,
          'Set-Cookie': `__Host-ares-telegram=${result.cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(result.expires).toUTCString()}`,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        },
      })
    }
    if (url.pathname !== '/oauth/callback') return new Response(null, { status: 404 })
    const cookie =
      request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('__Host-ares-telegram='))
        ?.slice('__Host-ares-telegram='.length) ?? ''
    // The return proves an account, not a chat: anyone can be sent through a chat's login page. So it
    // links nothing and tells the chat nothing. The browser goes back to Telegram with a one-use token,
    // and the START tap there sends it from the chat of the person who signed in: only the chat that
    // asked is then linked (owner ruling 2026-11-21). The token is shown and typed nowhere.
    const token = await links.callback(url.searchParams, cookie)
    return new Response(null, {
      status: 303,
      headers: { ...PRIVATE_PAGE, Location: `https://t.me/${options.bot_username}?start=${token}` },
    })
  }
  const browser = async (request: Request) => {
    const url = new URL(request.url)
    try {
      return await browser_response(request, url)
    } catch (error) {
      console.error('Telegram browser request refused', code_of(error))
      const path_id = url.pathname.startsWith('/link/') ? url.pathname.slice(6) : null
      const locale = (await links.browser_locale(path_id, url.searchParams.get('state'))) ?? accepted_language(request)
      const { status, page } = FAILURE_RESPONSES[failure_kind(code_of(error))]
      return browser_page(status, options.copy(locale)[page])
    }
  }
  const fetch = async (request: Request): Promise<Response> => {
    try {
      if (request.method === 'GET')
        return admit_visitor(visitor_limiter, request)
          ? await browser(request)
          : browser_page(429, options.copy(accepted_language(request)).failure_temporary)
      const input = await read_update(request, options.secret, options.max_request_bytes)
      if (input instanceof Response) return input
      // Telegram redelivers every update not answered 2xx, so one past its sender's allowance is
      // acknowledged and dropped: answering it would spend the very thing the allowance protects.
      if (sender_limiter.take(String(input.sender))) await receive(input)
      return new Response(null, { status: 200 })
    } catch (error) {
      console.error('Telegram request failed', code_of(error))
      return new Response(null, { status: 503 })
    }
  }
  return {
    fetch,
    drain: () => Promise.allSettled([...pending.values()]),
    sessions: sessions as ReadonlyMap<number, Session>,
  }
}

const code_of = (error: unknown) => (error instanceof Error ? error.message : 'unknown')

type FailureKind =
  | 'failure_changed'
  | 'failure_reconnect'
  | 'failure_unlink_first'
  | 'failure_busy'
  | 'failure_run_limit'
  | 'city_required'
  | 'observation_unknown'
  | 'unknown'
  | 'failure_temporary'
/** The one owner of player-facing failures: every code, the hosted bot's and its client's included, picks
 * the copy key that explains it. Unmapped and operator codes render failure_temporary. */
export const FAILURE_CODES: Readonly<Record<FailureKind, readonly string[]>> = {
  failure_changed: [
    'action_expired',
    'behavior_revision_conflict',
    'behavior_run_not_found',
    'character_changed',
    'exchange_unavailable',
    'identity_changed',
    'inventory_page_expired',
    'link_already_started',
    'link_changed',
    'link_expired',
    'link_expired_or_removed',
    'needs_resync',
    'owner_mismatch',
    'review_changed',
    'review_expired',
    'unknown_strategy',
  ],
  failure_reconnect: [
    'browser_mismatch',
    'callback_mismatch',
    'insufficient_scope',
    'invalid_token',
    'reauthorization_required',
    'tokens_missing',
    'unexpected_oauth_scope',
    'unknown_link',
  ],
  failure_unlink_first: ['owner_already_linked', 'revocation_pending', 'unlink_before_relink'],
  failure_busy: ['bot_busy_or_paused'],
  failure_run_limit: ['run_limit_reached'],
  city_required: ['city_required'],
  observation_unknown: ['observation_unknown'],
  unknown: ['control_unconfirmed', 'pending_exchange_outcome_unknown', 'uncertain'],
  failure_temporary: [
    'admission_command_invalid',
    'cleanup_limits_required',
    'cleanup_owner_not_linked',
    'cleanup_requires_exact_sender',
    'https_callback_required',
    'invalid_bind_host',
    'invalid_callback_path',
    'invalid_issuer',
    'invalid_owner',
    'invalid_response',
    'invalid_sender',
    'limits_required',
    'local_limits_required',
    'record_not_locked',
    'storage_key_required',
    'strategy_identity_required',
    'telegram_delivery_failed',
    'telegram_identity_unknown',
    'telegram_token_required',
    'tool_failed',
    'unavailable',
    'unknown_limit',
  ],
}
const FAILURE_KINDS: ReadonlyMap<string, FailureKind> = new Map(
  Object.entries(FAILURE_CODES).flatMap(([kind, codes]) => codes.map((code) => [code, kind as FailureKind] as const))
)
const failure_kind = (code: string): FailureKind => FAILURE_KINDS.get(code) ?? 'failure_temporary'
/** page: the browser text; next: the one Telegram step offered after the message. */
type FailureResponse = Readonly<{ status: number; page: CopyKey; next?: Readonly<{ label: CopyKey; command: string }> }>
/** Browser status and the one supported next step. An unconfirmed outcome only offers Status, never a retry.
 * A stale action needs no step: the current state is rendered after it. */
const FAILURE_RESPONSES: Readonly<Record<FailureKind, FailureResponse>> = {
  failure_changed: { status: 410, page: 'browser_expired' },
  failure_reconnect: { status: 400, page: 'browser_expired', next: { label: 'log_in_again', command: '/link' } },
  failure_unlink_first: {
    status: 409,
    page: 'failure_unlink_first',
    next: { label: 'disconnect', command: '/unlink' },
  },
  failure_busy: { status: 409, page: 'failure_busy', next: { label: 'check_status', command: '/status' } },
  failure_run_limit: { status: 409, page: 'failure_run_limit', next: { label: 'stop', command: '/stop' } },
  city_required: { status: 409, page: 'city_required', next: { label: 'back', command: '/menu' } },
  observation_unknown: { status: 409, page: 'observation_unknown' },
  unknown: { status: 504, page: 'unknown', next: { label: 'check_status', command: '/status' } },
  failure_temporary: { status: 503, page: 'failure_temporary' },
}
/** A login answer is never stored and never names itself to the next site. */
const PRIVATE_PAGE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
const browser_page = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: { ...PRIVATE_PAGE, 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
  })
const accepted_language = (request: Request) =>
  request.headers.get('accept-language')?.split(',')[0]?.split(/[-;]/)[0]?.trim().toLowerCase() || 'en'
