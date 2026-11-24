// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The address bar has one owner. Views read the address from state and ask for a change with `location/open`;
// no page calls `pushState` or `replaceState`, or listens to `popstate` and `hashchange`, by itself.
import type { SiteModule } from '../store.ts'

export type LocationState = Readonly<{ pathname: string; search: string; hash: string }>

export type LocationInput =
  /** Go to an address of this origin. `replace` corrects the current entry and adds none. */
  | Readonly<{ type: 'location/open'; href: string; replace?: boolean }>
  | Readonly<{ type: 'location/changed'; location: LocationState }>

const without_trailing_slash = (pathname: string): string => pathname.replace(/\/+$/, '') || '/'

export const read_location = ({ pathname, search, hash }: Readonly<LocationState>): LocationState =>
  Object.freeze({ pathname: without_trailing_slash(pathname), search, hash })

const reduce: NonNullable<SiteModule['reduce']> = (state, input) => {
  if (input.type !== 'location/changed') return state
  const { pathname, search, hash } = state.location
  const next = input.location
  return next.pathname === pathname && next.search === search && next.hash === hash
    ? state
    : Object.freeze({ ...state, location: next })
}

const observe: NonNullable<SiteModule['observe']> = ({ dispatch, events, signal }) => {
  const changed = (): void => dispatch({ type: 'location/changed', location: read_location(globalThis.location) })
  events.on('location/open', ({ href, replace }) => {
    const target = new URL(href, globalThis.location.href)
    if (target.origin !== globalThis.location.origin) return
    const address = `${target.pathname}${target.search}${target.hash}`
    if (replace) globalThis.history.replaceState(null, '', address)
    else if (target.href !== globalThis.location.href) globalThis.history.pushState(null, '', address)
    changed()
  })
  globalThis.addEventListener('popstate', changed, { signal })
  globalThis.addEventListener('hashchange', changed, { signal })
}

export default Object.freeze({
  name: 'location',
  initial: () => ({ location: read_location(globalThis.location) }),
  reduce,
  observe,
}) satisfies SiteModule
