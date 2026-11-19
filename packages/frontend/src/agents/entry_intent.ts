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

/** The public entry link, an assistant's consent link and the old `/connect-agent` path all name this page. */
export const is_agent_entry = (location: Readonly<Pick<Location, 'pathname' | 'search'>>): boolean =>
  location.pathname.replace(/\/+$/, '') === LEGACY_AGENT_PATH ||
  new URLSearchParams(location.search).get('intent') === AGENT_CONNECT_INTENT
