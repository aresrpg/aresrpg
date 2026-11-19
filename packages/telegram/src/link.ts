// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

import {
  OBSERVE_SCOPE,
  PLAY_SCOPE,
  random_token,
  same_scope,
  unwrap,
  type BotClient,
  type BotGrant,
  type BotIdentity,
  type BotTokens,
  type GrantStore,
  type PendingAuthorization,
} from '@aresrpg/protocol/hosted-bot-client'

import type { Records, Writes } from './secure_records.ts'

const hash = (value: string) => createHash('sha256').update(value).digest('base64url')
const scope_for = (expected_owner: string | null) => (expected_owner ? PLAY_SCOPE : OBSERVE_SCOPE)
/** Everything a consent was given for, as one comparable value. */
export const binding_of = (identity: BotIdentity) => JSON.stringify(identity)
export type Pending = Readonly<{
  /** The link capability itself; its record key is only its hash. */
  id: string
  sender: number
  /** The starting chat's language, for the pairing message and browser pages. */
  locale?: string
  expected_owner: string | null
  /** The OAuth request. Its deadline ends the whole attempt, whatever its phase. */
  authorization: PendingAuthorization
  cancelled?: boolean
  phase: 'new' | 'browser' | 'exchanging' | 'confirm' | 'retiring'
  browser?: string
  code_hash?: string
  confirmation?: string
  tokens?: BotTokens
  identity?: BotIdentity
}>
// One record per entity: a sender's grant, an owner's sender, one link attempt, a sender's attempts.
export const user_id = (sender: number) => `user:${sender}`
const owner_id = (owner: string) => `owner:${hash(owner)}`
const pending_id = (link: string) => `pending:${hash(link)}`
const attempts_id = (sender: number) => `attempts:${sender}`
// An unopened attempt has no tokens, so Redis may expire it at its deadline. From the exchange on it
// may hold tokens: Redis never expires it, and expire_attempts retires it (revoking any tokens) once
// the deadline passes. Consumed attempts are deleted.
const kept = (pending: Pending) => ({
  value: pending,
  expires_at: ['new', 'browser'].includes(pending.phase) ? pending.authorization.expires_at : null,
})
type Get = <T>(id: string) => T | null
// Drops a finished attempt and its entry in the sender's attempt list in the same commit.
const removal = (get: Get, id: string, sender: number): Writes => {
  const remaining = (get<readonly string[]>(attempts_id(sender)) ?? []).filter((entry) => entry !== id)
  return { [id]: null, [attempts_id(sender)]: remaining.length ? { value: remaining } : null }
}
// An unopened link of the same kind is re-offered to its own chat, so a redelivered /link or /enable
// cannot strand the player behind finish_existing_link.
const reoffer = (attempts: readonly (readonly [string, Pending])[], scope: string, now: number) =>
  attempts.find(([, entry]) =>
    [entry.phase === 'new', entry.authorization.expires_at > now, entry.authorization.scope === scope].every(Boolean)
  )?.[1]
const shown = (pending: Pending, code: string, identity: BotIdentity) => ({
  sender: pending.sender,
  locale: pending.locale,
  code,
  owner: identity.owner,
  address: identity.address,
})
export const create_links = (
  records: Records,
  hosted: BotClient,
  callback_url: string,
  ttl_ms: number,
  /** The operator's allowlist, read live on every use: admitting or removing an owner needs no restart. */
  admitted: (owner: string) => Promise<boolean>,
  now = Date.now
) => {
  if (new URL(callback_url).protocol !== 'https:') throw new Error('https_callback_required')
  const link_url = (link: string) => new URL(`/link/${link}`, callback_url).href
  const assert_admitted = async (owner: string) => {
    if (!(await admitted(owner))) throw new Error('owner_not_admitted')
  }
  const eligible = async (pending: Pending) =>
    pending.authorization.scope === OBSERVE_SCOPE ||
    Boolean(pending.expected_owner && (await admitted(pending.expected_owner)))
  const current = (sender: number) => records.read<BotGrant>(user_id(sender))
  /** A sender's established link as the shared client's grant store. Removing it also frees its owner. */
  const grant_store = (sender: number): GrantStore => ({
    read: () => current(sender),
    replace: async (previous, next) => {
      const [user, owner] = [user_id(sender), owner_id(previous.identity.owner)]
      try {
        await records.change([user, owner], (get) => {
          if (get<BotGrant>(user)?.refresh_token !== previous.refresh_token) throw new Error('link_changed')
          return next ? { [user]: { value: next } } : { [user]: null, [owner]: null }
        })
        return true
      } catch (error) {
        if (error instanceof Error && error.message === 'link_changed') return false
        throw error
      }
    },
  })
  const listed = async (sender: number) => (await records.read<readonly string[]>(attempts_id(sender))) ?? []
  const sender_pending = async (sender: number) => {
    const ids = await listed(sender)
    const rows = await Promise.all(ids.map((id) => records.read<Pending>(id)))
    return ids.flatMap((id, index) => (rows[index] ? [[id, rows[index]] as const] : []))
  }
  const update_pending = async (id: string, reduce: (pending: Pending) => Pending) => {
    // Admission is read before the commit: an attempt never changes its owner or its scope.
    const known = await records.read<Pending>(id)
    const allowed = !known || (await eligible(known))
    const written = await records.change([id], (get) => {
      const pending = get<Pending>(id)
      if (!pending || pending.cancelled || pending.authorization.expires_at <= now()) throw new Error('link_expired')
      if (!allowed) throw new Error('owner_not_admitted')
      return { [id]: kept(reduce(pending)) }
    })
    return written[id]!.value as Pending
  }
  const retire = async (id: string, entry: Pending) => {
    await records.change([id], (get) => {
      if (JSON.stringify(get(id)) !== JSON.stringify(entry)) throw new Error('link_changed')
      return { [id]: kept({ ...entry, phase: 'retiring' }) }
    })
    if (entry.tokens) unwrap(await hosted.revoke(entry.tokens))
    await records.change([id, attempts_id(entry.sender)], (get) => removal(get, id, entry.sender))
  }
  const eligible_pending = async (id: string) => {
    const latest = await records.read<Pending>(id)
    if (!latest) throw new Error('link_expired_or_removed')
    if ([latest.cancelled, !(await eligible(latest)), latest.authorization.expires_at <= now()].some(Boolean)) {
      await retire(id, latest)
      throw new Error('link_expired_or_removed')
    }
    return latest
  }
  const create_attempt = async (sender: number, expected_owner: string | null, locale: string) => {
    const authorization = unwrap(
      await hosted.begin({
        client_name: 'AresRPG Telegram',
        redirect_uri: callback_url,
        scope: scope_for(expected_owner),
        ttl_ms,
      })
    )
    // The link is a one-way image of the state: the callback finds its record, the chat never learns the state.
    const link = hash(authorization.state)
    const id = pending_id(link)
    const pending: Pending = { id: link, sender, locale, expected_owner, authorization, phase: 'new' }
    const known = await listed(sender)
    await records.change([user_id(sender), attempts_id(sender), id, ...known], (get) => {
      if (get(user_id(sender))) throw new Error('unlink_before_relink')
      const live = (get<readonly string[]>(attempts_id(sender)) ?? []).filter((entry) => get(entry))
      return { [id]: kept(pending), [attempts_id(sender)]: { value: [...live, id] } }
    })
    return link_url(link)
  }
  /** Retires this sender's attempts past their deadline and drops list entries Redis already expired. */
  const expire_attempts = async (sender: number) => {
    const ids = await listed(sender)
    const rows = await Promise.all(ids.map((id) => records.read<Pending>(id)))
    for (const [index, row] of rows.entries())
      if (row && row.authorization.expires_at <= now()) await retire(ids[index]!, row)
    if (rows.every(Boolean)) return
    await records.change([attempts_id(sender), ...ids], (get) => {
      const live = (get<readonly string[]>(attempts_id(sender)) ?? []).filter((id) => get(id))
      return { [attempts_id(sender)]: live.length ? { value: live } : null }
    })
  }
  const begin_link = async (sender: number, expected_owner: string | null, locale: string) => {
    if (![Number.isSafeInteger(sender), sender > 0].every(Boolean)) throw new Error('invalid_sender')
    if (expected_owner) await assert_admitted(expected_owner)
    if (await current(sender)) throw new Error('unlink_before_relink')
    await expire_attempts(sender)
    const attempts = await sender_pending(sender)
    const offered = reoffer(attempts, scope_for(expected_owner), now())
    if (offered) return link_url(offered.id)
    if (attempts.length) throw new Error('finish_existing_link')
    return create_attempt(sender, expected_owner, locale)
  }
  const browser = async (link: string) => {
    const cookie = random_token()
    const updated = await update_pending(pending_id(link), (pending) => {
      if (pending.phase !== 'new') throw new Error('link_already_started')
      return { ...pending, phase: 'browser', browser: hash(cookie) }
    })
    const { authorization } = updated
    return { cookie, location: await hosted.authorization_url(authorization), expires: authorization.expires_at }
  }
  const exchange = async (id: string, cookie: string, code: string) => {
    const pending = await update_pending(id, (entry) => {
      if (entry.browser !== hash(cookie)) throw new Error('browser_mismatch')
      if (entry.phase === 'exchanging' && entry.tokens) return entry // Only identity read may retry.
      if (entry.phase !== 'browser') throw new Error('exchange_unavailable')
      return { ...entry, phase: 'exchanging' }
    })
    if (pending.tokens) return pending
    const tokens = unwrap(await hosted.exchange(pending.authorization, code))
    const written = await records
      .change([id], (get) => {
        const entry = get<Pending>(id)
        if (!entry || entry.phase !== 'exchanging' || entry.tokens) throw new Error('link_changed')
        return { [id]: kept({ ...entry, tokens }) }
      })
      .catch(async (error: unknown) => {
        // Tokens that cannot be recorded (the attempt ended meanwhile) are revoked, never orphaned.
        unwrap(await hosted.revoke(tokens))
        throw error
      })
    return written[id]!.value as Pending
  }
  const pending_for_state = async (state: string) => {
    const id = pending_id(hash(state))
    const pending = await records.read<Pending>(id)
    if (!pending) throw new Error('unknown_link')
    return [id, pending] as const
  }
  /** A reloaded callback page shows the same confirmation again; it never exchanges twice. */
  const confirmation_shown = async (id: string, retained: Pending, cookie: string) => {
    await eligible_pending(id)
    if ([retained.browser !== hash(cookie), retained.authorization.expires_at <= now()].some(Boolean))
      throw new Error('browser_mismatch')
    const { confirmation, identity } = retained
    if (!confirmation || !identity) throw new Error('confirmation_consumed')
    return shown(retained, confirmation, identity)
  }
  const callback = async (query: URLSearchParams, cookie: string) => {
    const [id, retained] = await pending_for_state(query.get('state') ?? '')
    const code = unwrap(hosted.authorization_code(retained.authorization, query))
    if (retained.phase === 'confirm') return confirmation_shown(id, retained, cookie)
    const pending = await exchange(id, cookie, code)
    const { tokens } = pending
    if (!tokens) throw new Error('tokens_missing')
    await eligible_pending(id)
    if (!same_scope(tokens.scope, pending.authorization.scope)) {
      await retire(id, pending)
      throw new Error('unexpected_oauth_scope')
    }
    const verified = await hosted.verify(tokens, pending.expected_owner)
    if (!verified.ok) {
      // The client reports a grant for another owner only once the bot confirmed its revoke: the attempt just ends.
      if (verified.error === 'owner_mismatch')
        await records.change([id, attempts_id(pending.sender)], (get) => removal(get, id, pending.sender))
      throw new Error(verified.error)
    }
    const { identity } = verified.value
    await eligible_pending(id)
    const confirmation = random_token()
    await update_pending(id, (entry) => {
      if (entry.phase !== 'exchanging' || entry.tokens?.access_token !== tokens.access_token)
        throw new Error('link_changed')
      return { ...entry, phase: 'confirm', code_hash: hash(confirmation), confirmation, identity }
    })
    return shown(pending, confirmation, identity)
  }
  const confirm = async (sender: number, code: string) => {
    const entry = (await sender_pending(sender)).find(([, pending]) => pending.code_hash === hash(code))
    if (!entry) throw new Error('confirmation_mismatch')
    const [id] = entry
    const pending = await eligible_pending(id)
    const { tokens, identity } = pending
    if (!tokens || !identity || pending.phase !== 'confirm') throw new Error('confirmation_consumed')
    const grant = unwrap(await hosted.verify(tokens, identity.owner))
    await eligible_pending(id)
    if (binding_of(grant.identity) !== binding_of(identity)) throw new Error('identity_changed')
    // Consuming the attempt and establishing the link are one atomic commit.
    await records.change([id, attempts_id(sender), user_id(sender), owner_id(identity.owner)], (get) => {
      if (get<Pending>(id)?.phase !== 'confirm' || pending.authorization.expires_at <= now())
        throw new Error('confirmation_expired')
      if ([get(user_id(sender)), get(owner_id(identity.owner))].some(Boolean)) throw new Error('owner_already_linked')
      return {
        ...removal(get, id, sender),
        [user_id(sender)]: { value: grant },
        [owner_id(identity.owner)]: { value: sender },
      }
    })
  }
  const revoke_link = async (sender: number) => {
    const linked = await current(sender)
    if (!linked) return
    unwrap(await hosted.revoke(linked))
    // A link established meanwhile is a newer one and stays.
    await grant_store(sender).replace(linked, null)
  }
  const revoke = async (sender: number) => {
    for (const [id, entry] of await sender_pending(sender)) {
      if (entry.phase === 'exchanging' && !entry.tokens)
        await records.change([id], (get) => {
          const latest = get<Pending>(id)
          return latest ? { [id]: kept({ ...latest, cancelled: true }) } : {}
        })
      else await retire(id, entry)
    }
    await revoke_link(sender)
  }
  /** Startup pass over every sender's attempts; the only full scan, never on a request path. It retires
   * ended attempts of senders who never came back; a failed revoke is reported and retried next time. */
  const retire_ended_attempts = async () => {
    for (const id of await records.ids('attempts:'))
      await expire_attempts(Number(id.slice('attempts:'.length))).catch((error: unknown) => {
        console.error('Telegram attempt retirement failed', error instanceof Error ? error.message : 'unknown')
      })
  }
  /** A live link: who it acts for, whether it may play, and its calls on the hosted bot. */
  const authenticate = async (sender: number) => {
    const linked = await current(sender)
    if (!linked) throw new Error('reauthorization_required')
    const play = same_scope(linked.scope, PLAY_SCOPE)
    if (play) await assert_admitted(linked.identity.owner)
    const bot = hosted.session(grant_store(sender))
    const identity = unwrap(await bot.identity())
    if (binding_of(identity) !== binding_of(linked.identity)) throw new Error('identity_changed')
    // A link revoked or replaced during that read must not authenticate.
    if ((await current(sender))?.identity.grant_id !== identity.grant_id) throw new Error('link_changed')
    return { identity, play, bot }
  }
  const begin = (sender: number, locale = 'en') => begin_link(sender, null, locale)
  const upgrade = async (sender: number, locale = 'en') => {
    // A redelivered /enable finds its unopened play link after the first one revoked the observe login.
    const offered = reoffer(await sender_pending(sender), PLAY_SCOPE, now())
    if (offered) return link_url(offered.id)
    const linked = await authenticate(sender)
    await assert_admitted(linked.identity.owner)
    if (linked.play) throw new Error('play_already_enabled')
    await revoke(sender)
    return begin_link(sender, linked.identity.owner, locale)
  }
  const assert_revoked = async (sender: number) => {
    if (await current(sender)) throw new Error('revocation_pending')
    if ((await sender_pending(sender)).length) throw new Error('pending_exchange_outcome_unknown')
  }
  /** The starting chat's language for a browser page about this link, when the link is known. */
  const browser_locale = async (link: string | null, state: string | null) => {
    const known = link ?? (state ? hash(state) : null)
    return known ? ((await records.read<Pending>(pending_id(known)))?.locale ?? null) : null
  }
  return {
    begin,
    upgrade,
    browser,
    callback,
    confirm,
    authenticate,
    current,
    /** The chat an owner's established link belongs to; null when that owner has none. */
    sender_of: (owner: string) => records.read<number>(owner_id(owner)),
    revoke,
    retire_ended_attempts,
    assert_revoked,
    browser_locale,
    expire_attempts,
  }
}
export type LinkService = ReturnType<typeof create_links>
