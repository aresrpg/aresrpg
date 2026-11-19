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
import { button, card, type Telegram } from './transport.ts'
import type { Input } from './wire.ts'

export const create_connected = (
  options: Readonly<{
    access: TelegramAccess
    links: LinkService
    telegram: Telegram
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
  // An expired login is replaced by /link in one step; a working one still needs an explicit /unlink.
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
  const process_link = async (input: Input): Promise<boolean> => {
    if (input.text === '/unlink') {
      await forget(input.sender)
      await send(input, copy_for(input).unlinked)
      return true
    }
    if (['/link', '/enable'].includes(input.text)) {
      if (input.text === '/link') await replace_expired_login(input.sender)
      const url = await (input.text === '/enable' ? links.upgrade : links.begin)(input.sender, input.locale)
      await send(input, `${copy_for(input).link}\n${url}`)
      return true
    }
    if (input.text.startsWith('/confirm ')) {
      await links.confirm(input.sender, input.text.slice('/confirm '.length).trim())
      await send(input, copy_for(input).linked, [[button(copy_for(input).check_access, '/start')]])
      return true
    }
    return false
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
    if (await process_link(input)) return null
    // An unlinked sender only ever sees the login card and leaves no navigation state, also when its
    // login ended outside this chat: the operator removed the owner, or the hosted bot ended the grant.
    if (!(await links.current(input.sender))) {
      sessions.delete(input.sender)
      await send(input, copy_for(input).link, [[button(copy_for(input).connect_google, '/link')]])
      return null
    }
    const previous = sessions.get(input.sender) ?? initial_session()
    // Taken before any hosted read, so every older button is stale even when that read fails.
    sessions.set(input.sender, { ...previous, revision: previous.revision + 1, review: null })
    const linked = await links.authenticate(input.sender)
    if (!(await access.admitted(linked.identity.owner))) {
      await telegram.send(input.sender, await waitlist_card(access, input, copy_for(input), linked.identity.owner))
      return null
    }
    if (!linked.play) {
      await send(input, copy_for(input).play_consent, [[button(copy_for(input).enable_agent, '/enable')]])
      return null
    }
    return play(input, previous, linked.bot, linked.identity)
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
    const result = await links.callback(url.searchParams, cookie)
    const copy = options.copy(result.locale ?? 'en')
    // The code is shown only to the browser that consented. It is never sent to the chat that began
    // the link: that chat may belong to someone else, and the code is what binds the two.
    return browser_page(
      200,
      `${copy.confirm}\n${copy.confirm_warning}\n\n${result.owner}\n${result.address}\n\n/confirm ${result.code}`
    )
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
  | 'waiting'
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
    'confirmation_consumed',
    'confirmation_expired',
    'confirmation_mismatch',
    'exchange_unavailable',
    'identity_changed',
    'inventory_page_expired',
    'link_already_started',
    'link_changed',
    'link_expired',
    'link_expired_or_removed',
    'needs_resync',
    'owner_mismatch',
    'play_already_enabled',
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
  failure_unlink_first: ['finish_existing_link', 'owner_already_linked', 'revocation_pending', 'unlink_before_relink'],
  failure_busy: ['bot_busy_or_paused'],
  failure_run_limit: ['run_limit_reached'],
  waiting: ['owner_not_admitted'],
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
  failure_unlink_first: { status: 409, page: 'failure_unlink_first' },
  failure_busy: { status: 409, page: 'failure_busy', next: { label: 'check_status', command: '/status' } },
  failure_run_limit: { status: 409, page: 'failure_run_limit', next: { label: 'stop', command: '/stop' } },
  waiting: { status: 403, page: 'waiting', next: { label: 'check_access', command: '/start' } },
  city_required: { status: 409, page: 'city_required' },
  observation_unknown: { status: 409, page: 'observation_unknown' },
  unknown: { status: 504, page: 'unknown', next: { label: 'check_status', command: '/status' } },
  failure_temporary: { status: 503, page: 'failure_temporary' },
}
const browser_page = (status: number, text: string) =>
  new Response(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
const accepted_language = (request: Request) =>
  request.headers.get('accept-language')?.split(',')[0]?.split(/[-;]/)[0]?.trim().toLowerCase() || 'en'
