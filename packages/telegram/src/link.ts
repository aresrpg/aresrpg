// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'

import {
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
/** Everything a consent was given for, as one comparable value. */
export const binding_of = (identity: BotIdentity) => JSON.stringify(identity)
export type Pending = Readonly<{
  /** The link capability itself; its record key is only its hash. */
  id: string
  sender: number
  /** The starting chat's language, for its cards and its browser pages. */
  locale?: string
  /** The OAuth request. Its deadline ends the whole attempt, whatever its phase. */
  authorization: PendingAuthorization
  cancelled?: boolean
  phase: 'new' | 'browser' | 'exchanging' | 'confirm' | 'retiring'
  browser?: string
  tokens?: BotTokens
  /** Phase confirm: who the tokens act for, held until the chat that asked sends the one-use token back. */
  identity?: BotIdentity
  /** Phase confirm: the hash of that token. The token itself is never stored. */
  confirm?: string
}>
// One record per entity: a sender's grant, an owner's sender, one link attempt, a sender's attempts.
export const user_id = (sender: number) => `user:${sender}`
const owner_id = (owner: string) => `owner:${hash(owner)}`
const pending_id = (link: string) => `pending:${hash(link)}`
const attempts_id = (sender: number) => `attempts:${sender}`
// An unopened attempt has no tokens, so Redis may expire it at its deadline. From the exchange on it
// may hold tokens (a grant waiting for its chat's confirmation is one): Redis never expires it, and
// expire_attempts retires it (revoking any tokens) once the deadline passes. Consumed attempts are deleted.
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
// An unopened link is offered again to its own chat: every update of an unlinked chat shows the login
// button, and a redelivered one must show the same link, not mint another.
const reoffer = (attempts: readonly (readonly [string, Pending])[], now: number) =>
  attempts.find(([, entry]) => entry.phase === 'new' && entry.authorization.expires_at > now)?.[1]
/** The grant an attempt holds for its chat's confirmation. */
const held_grant = ({ tokens, identity }: Pending): BotGrant | null =>
  tokens && identity ? { ...tokens, identity } : null
export const create_links = (
  records: Records,
  hosted: BotClient,
  callback_url: string,
  ttl_ms: number,
  now = Date.now
) => {
  if (new URL(callback_url).protocol !== 'https:') throw new Error('https_callback_required')
  const link_url = (link: string) => new URL(`/link/${link}`, callback_url).href
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
    const written = await records.change([id], (get) => {
      const pending = get<Pending>(id)
      if (!pending || pending.cancelled || pending.authorization.expires_at <= now()) throw new Error('link_expired')
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
  /** The attempt while it may still link. A cancelled or ended one is retired here, revoking any tokens. */
  const live_pending = async (id: string) => {
    const latest = await records.read<Pending>(id)
    if (!latest) throw new Error('link_expired_or_removed')
    if ([latest.cancelled, latest.authorization.expires_at <= now()].some(Boolean)) {
      await retire(id, latest)
      throw new Error('link_expired_or_removed')
    }
    return latest
  }
  // Every login asks for play scope. Whether the chat may play is the allowlist's answer, read by the
  // runtime on every update: a login never has to be made twice.
  const create_attempt = async (sender: number, locale: string) => {
    const authorization = unwrap(
      await hosted.begin({ client_name: 'AresRPG Telegram', redirect_uri: callback_url, scope: PLAY_SCOPE, ttl_ms })
    )
    // The link is a one-way image of the state: the callback finds its record, the chat never learns the state.
    const link = hash(authorization.state)
    const id = pending_id(link)
    const pending: Pending = { id: link, sender, locale, authorization, phase: 'new' }
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
  // A refused link leaves no grant behind: it is revoked now, not at the attempt's deadline.
  const leave_no_grant = (id: string, entry: Pending) => async (error: unknown) => {
    if (error instanceof Error && error.message === 'owner_already_linked') await retire(id, entry)
    throw error
  }
  /**
   * The browser proved an account, never a chat: whoever opens a chat's login page signs in as
   * themselves. So the verified grant is only held with its attempt, under a fresh one-use token that
   * the browser carries back to Telegram; the attempt keeps the token's hash alone. The token is 32
   * random bytes (256 bits) in 43 characters of the alphabet Telegram allows in a start parameter.
   */
  const hold = async (id: string, pending: Pending, grant: BotGrant) => {
    const token = random_token()
    const [user, owner] = [user_id(pending.sender), owner_id(grant.identity.owner)]
    await records.change([id, user, owner], (get) => {
      const entry = get<Pending>(id)
      const current_attempt = [
        entry?.phase === 'exchanging',
        entry?.tokens?.access_token === grant.access_token,
        pending.authorization.expires_at > now(),
      ].every(Boolean)
      if (!entry || !current_attempt) throw new Error('link_changed')
      if ([get(user), get(owner)].some(Boolean)) throw new Error('owner_already_linked')
      return { [id]: kept({ ...entry, phase: 'confirm', identity: grant.identity, confirm: hash(token) }) }
    })
    return token
  }
  /**
   * The browser's return from the login. The attempt carries its sender from the chat's own update, the
   * owner is read back from the bot with the fresh tokens, and nothing the browser sends names either.
   * It links nothing: it answers the one-use token the chat that asked must send back (confirm).
   */
  const callback = async (query: URLSearchParams, cookie: string) => {
    const [id, retained] = await pending_for_state(query.get('state') ?? '')
    const code = unwrap(hosted.authorization_code(retained.authorization, query))
    const pending = await exchange(id, cookie, code)
    const { tokens } = pending
    if (!tokens) throw new Error('tokens_missing')
    await live_pending(id)
    if (!same_scope(tokens.scope, pending.authorization.scope)) {
      await retire(id, pending)
      throw new Error('unexpected_oauth_scope')
    }
    const grant = unwrap(await hosted.verify(tokens, null))
    const latest = await live_pending(id)
    return hold(id, pending, grant).catch(leave_no_grant(id, latest))
  }
  /** Whether a token's hash confirms this attempt: held for this sender, before its deadline. Hash equality. */
  const confirmed_by = (entry: Pending | null, sender: number, proof: string) =>
    [
      entry?.phase === 'confirm',
      entry?.sender === sender,
      entry?.confirm === proof,
      (entry?.authorization.expires_at ?? 0) > now(),
    ].every(Boolean)
  /** Consuming the attempt and establishing the link are one atomic commit. */
  const establish = (id: string, sender: number, proof: string, grant: BotGrant) => {
    const [user, owner] = [user_id(sender), owner_id(grant.identity.owner)]
    return records.change([id, attempts_id(sender), user, owner], (get) => {
      // A held attempt never changes under the same token, so the grant read before this commit is its grant.
      if (!confirmed_by(get<Pending>(id), sender, proof)) throw new Error('link_changed')
      if ([get(user), get(owner)].some(Boolean)) throw new Error('owner_already_linked')
      return { ...removal(get, id, sender), [user]: { value: grant }, [owner]: { value: sender } }
    })
  }
  /**
   * START from a chat, with the token its tap carries. Only this sender's own attempts are read, so the
   * token of a login another chat asked for matches nothing here: the tap proves that the person who
   * signed in controls the chat that asked. Answers whether the chat is now linked; a token that is
   * unknown, used, expired or another chat's changes nothing and tells nothing.
   */
  const confirm = async (sender: number, token: string) => {
    const proof = hash(token)
    const held = (await sender_pending(sender)).find(([, entry]) => confirmed_by(entry, sender, proof))
    const grant = held ? held_grant(held[1]) : null
    if (!held || !grant) return false
    await establish(held[0], sender, proof, grant).catch(leave_no_grant(...held))
    return true
  }
  const revoke_link = async (sender: number) => {
    const linked = await current(sender)
    if (!linked) return
    unwrap(await hosted.revoke(linked))
    // A link established meanwhile is a newer one and stays.
    await grant_store(sender).replace(linked, null)
  }
  /** Ends every attempt of a sender. One whose exchange has no known outcome is cancelled: its tokens,
   * if they arrive, are revoked by the callback that receives them. */
  const end_attempts = async (sender: number) => {
    for (const [id, entry] of await sender_pending(sender)) {
      if (entry.phase === 'exchanging' && !entry.tokens)
        await records.change([id], (get) => {
          const latest = get<Pending>(id)
          return latest ? { [id]: kept({ ...latest, cancelled: true }) } : {}
        })
      else await retire(id, entry)
    }
  }
  const revoke = async (sender: number) => {
    await end_attempts(sender)
    await revoke_link(sender)
  }
  /** The login page of an unlinked chat. An unopened link is offered again; an opened one that never
   * finished (a grant its chat never confirmed included) is ended and replaced, so a chat has at most
   * one usable link and never a dead end. */
  const begin = async (sender: number, locale = 'en') => {
    if (![Number.isSafeInteger(sender), sender > 0].every(Boolean)) throw new Error('invalid_sender')
    if (await current(sender)) throw new Error('unlink_before_relink')
    await expire_attempts(sender)
    const offered = reoffer(await sender_pending(sender), now())
    if (offered) return link_url(offered.id)
    await end_attempts(sender)
    return create_attempt(sender, locale)
  }
  /** Startup pass over every sender's attempts; the only full scan, never on a request path. It retires
   * ended attempts of senders who never came back; a failed revoke is reported and retried next time. */
  const retire_ended_attempts = async () => {
    for (const id of await records.ids('attempts:'))
      await expire_attempts(Number(id.slice('attempts:'.length))).catch((error: unknown) => {
        console.error('Telegram attempt retirement failed', error instanceof Error ? error.message : 'unknown')
      })
  }
  /** A live link: who it acts for and its calls on the hosted bot. Admission is not decided here. */
  const authenticate = async (sender: number) => {
    const linked = await current(sender)
    if (!linked) throw new Error('reauthorization_required')
    // Every login holds play scope. One that holds less was made before that rule: it logs in again, once.
    if (!same_scope(linked.scope, PLAY_SCOPE)) throw new Error('reauthorization_required')
    const bot = hosted.session(grant_store(sender))
    const identity = unwrap(await bot.identity())
    if (binding_of(identity) !== binding_of(linked.identity)) throw new Error('identity_changed')
    // A link revoked or replaced during that read must not authenticate.
    if ((await current(sender))?.identity.grant_id !== identity.grant_id) throw new Error('link_changed')
    return { identity, bot }
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
