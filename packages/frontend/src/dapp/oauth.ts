// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  grant_of,
  pending_of,
  PLAY_SCOPE,
  type BotGrant,
  type GrantStore,
  type PendingAuthorization,
} from '@aresrpg/protocol/hosted-bot-client'

/** The web dapp is an ordinary public OAuth client of the hosted bot, like Telegram or an AI client. */
export const DAPP_ROUTE = '/dapp'
/** How long the browser waits for one answer of the bot. */
export const REQUEST_TIMEOUT_MS = 15_000
/** What the dapp asks the bot for; consent returns to the dapp page of this origin. */
export const authorization_request = (origin: string) => ({
  client_name: 'AresRPG web dapp',
  redirect_uri: new URL(DAPP_ROUTE, origin).href,
  scope: PLAY_SCOPE,
  // The bot keeps an authorization request for its default BOT_REQUEST_TTL_MS; the browser keeps no longer.
  ttl_ms: 600_000,
})
const PENDING_KEY = 'aresrpg:dapp:authorization'
const GRANT_KEY = 'aresrpg:dapp:grant'

export type DappStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const read_json = (storage: DappStorage | null, key: string): unknown => {
  try {
    return JSON.parse(storage?.getItem(key) ?? 'null')
  } catch (error) {
    console.warn('A saved dapp record could not be read.', error)
    return null
  }
}
const write = (storage: DappStorage | null, key: string, value: unknown): boolean => {
  try {
    if (value === null) storage?.removeItem(key)
    else storage?.setItem(key, JSON.stringify(value))
    return storage !== null
  } catch (error) {
    console.warn('A dapp record could not be saved.', error)
    return false
  }
}

export const session_storage = (): DappStorage | null => {
  try {
    return globalThis.sessionStorage ?? null
  } catch (error) {
    console.warn('Tab storage is unavailable.', error)
    return null
  }
}
export const local_storage = (): DappStorage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch (error) {
    console.warn('Device storage is unavailable.', error)
    return null
  }
}

/** The request this tab started lives in tab storage, so only this tab can finish it. */
export const read_pending = (storage: DappStorage | null, now: number): PendingAuthorization | null =>
  pending_of(read_json(storage, PENDING_KEY), now)
export const save_pending = (storage: DappStorage | null, pending: PendingAuthorization | null): boolean =>
  write(storage, PENDING_KEY, pending)

/**
 * A grant persists per owner on this device, shared by every tab, and never crosses owners. It
 * lasts until the owner disconnects the page or signs out; both end it at the bot first.
 */
export const grant_store = (storage: DappStorage | null, owner: string) => {
  const key = `${GRANT_KEY}:${owner}`
  const read = (): BotGrant | null => {
    const grant = grant_of(read_json(storage, key))
    return grant?.identity.owner === owner ? grant : null
  }
  const save = (grant: BotGrant | null): boolean => write(storage, key, grant)
  return {
    read,
    save,
    replace: (previous, next) => read()?.refresh_token === previous.refresh_token && save(next),
  } satisfies GrantStore & { save: typeof save }
}

/** The bot redirects consent to `/world`; only the tab that began this dapp request claims it. */
export const dapp_consent_requested = (
  location: Readonly<Pick<Location, 'pathname' | 'search'>>,
  pending: PendingAuthorization | null
): boolean => {
  const search = new URLSearchParams(location.search)
  return [
    location.pathname.replace(/\/+$/, '') === '/world',
    search.get('intent') === 'connect-agent',
    Boolean(search.get('authorization_id')),
    pending !== null,
  ].every(Boolean)
}

/** A consent callback carries a code or an error; any other page load is not one. */
export const is_callback = (search: string): boolean => {
  const params = new URLSearchParams(search)
  return params.has('code') || params.has('error')
}
/**
 * An approved redirect that names this origin's dapp page is taken without a page load: the result is
 * its path and query, for the address. Any other redirect is null, and the browser leaves for it.
 */
export const own_callback = (redirect: string, origin: string): string | null => {
  if (!URL.canParse(redirect)) return null
  const url = new URL(redirect)
  const own = [url.origin === origin, url.pathname === DAPP_ROUTE, is_callback(url.search)].every(Boolean)
  return own ? `${url.pathname}${url.search}` : null
}
export const without_callback = (href: string): string => {
  const url = new URL(href)
  for (const key of ['code', 'state', 'iss', 'error', 'error_description']) url.searchParams.delete(key)
  return `${url.pathname}${url.search}${url.hash}`
}
