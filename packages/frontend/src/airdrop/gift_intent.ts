// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A printed card's link (`/gift#$<key>` or `/claim#$<key>`) is read here and claimed on the gift page alone.
// The tab keeps the link until the flow settles it, so the Google sign-in and a reload never lose it.
const GIFT_LINK_STORAGE_KEY = 'aresrpg:gift-link'
const GIFT_ROUTE_STORAGE_KEY = 'aresrpg:gift-route'

const gift_link_from_url = (href: string): string | null => {
  const url = new URL(href)
  return ['/gift', '/claim'].includes(url.pathname) && url.hash.startsWith('#$') && url.hash.length > 2
    ? url.toString()
    : null
}

export const is_gift_entry = (pathname: string, hash: string, saved_path: string | null = null): boolean => {
  const path = pathname.replace(/\/+$/, '')
  return path === '/gift' || (path === '/claim' && (hash.startsWith('#$') || saved_path === '/claim'))
}

export const saved_gift_route = (): string | null => {
  try {
    return globalThis.sessionStorage?.getItem(GIFT_ROUTE_STORAGE_KEY) ?? null
  } catch (error) {
    console.warn('Gift route storage is unavailable.', error)
    return null
  }
}

/** The fragment remains browser-only, including while Google opens its separate callback window. */
export const capture_gift_intent = (): string | null => {
  const scanned = gift_link_from_url(globalThis.location.href)
  try {
    const storage = globalThis.sessionStorage
    if (scanned) storage.setItem(GIFT_LINK_STORAGE_KEY, scanned)
    storage.setItem(GIFT_ROUTE_STORAGE_KEY, globalThis.location.pathname.replace(/\/+$/, ''))
    const saved = storage.getItem(GIFT_LINK_STORAGE_KEY)
    return scanned ?? (saved ? gift_link_from_url(saved) : null)
  } catch (error) {
    console.warn('Gift link storage is unavailable.', error)
    return scanned
  } finally {
    globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}`)
  }
}

/** The link has done its job: it was claimed, or found already spent. Its bearer key leaves the tab. The route
 * stays, so a reload of a printed `/claim` address still opens the gift page, which then reads the account's gift. */
export const forget_gift_link = (): void => {
  try {
    globalThis.sessionStorage.removeItem(GIFT_LINK_STORAGE_KEY)
  } catch (error) {
    console.warn('The saved gift link could not be cleared.', error)
  }
}

/** The player leaves the gift page for the game: nothing of the flow stays in the tab. */
export const clear_gift_intent = (): void => {
  try {
    globalThis.sessionStorage.removeItem(GIFT_LINK_STORAGE_KEY)
    globalThis.sessionStorage.removeItem(GIFT_ROUTE_STORAGE_KEY)
  } catch (error) {
    console.warn('Gift intent storage could not be cleared.', error)
  }
}
