// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { env } from '../env.ts'

const AGENT_CONNECT_INTENT = 'connect-agent'
const LEGACY_AGENT_PATH = '/connect-agent'

/** Public entry intent only. Authentication and pairing keep their existing owners. */
export const agent_connect_url = (app_url = env.app_url): string => {
  const url = new URL(app_url)
  // eslint-disable-next-line functional/immutable-data -- this fresh URL is the configured public entry destination.
  url.pathname = '/world'
  url.searchParams.set('intent', AGENT_CONNECT_INTENT)
  return url.href
}

/** Null means leave the URL alone; preserve unrelated query fields and the fragment. */
export const consumed_agent_entry_url = (
  location: Readonly<Pick<Location, 'pathname' | 'search' | 'hash'>>
): string | null => {
  const search = new URLSearchParams(location.search)
  const legacy = location.pathname.replace(/\/+$/, '') === LEGACY_AGENT_PATH
  if (!legacy && search.get('intent') !== AGENT_CONNECT_INTENT) return null
  if (search.get('intent') === AGENT_CONNECT_INTENT) search.delete('intent')
  const query = search.toString()
  const pathname = legacy ? '/world' : location.pathname
  return `${pathname}${query ? `?${query}` : ''}${location.hash ?? ''}`
}
