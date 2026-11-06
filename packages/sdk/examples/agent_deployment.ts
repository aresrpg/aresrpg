// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import deployment from '../../frontend/vercel.json' with { type: 'json' }
import { DEFAULT_NETWORK } from '../src/pins.ts'

/** The deployed allocation HTTP route and WebSocket door share the same realtime service.
 * Reuse that checked-in deployment route; do not maintain a second hostname list here. */
export const mainnet_agent_endpoint = (): string => {
  if (DEFAULT_NETWORK !== 'mainnet') throw new Error('MAINNET_DEPLOYMENT_REQUIRED')
  const route = deployment.rewrites.find(({ source }) => source === '/api/allocation')
  if (!route) throw new Error('MAINNET_ENDPOINT_UNAVAILABLE')
  const url = new URL(route.destination)
  if (url.protocol !== 'https:') throw new Error('MAINNET_ENDPOINT_UNAVAILABLE')
  return `wss://${url.host}/`
}

export const assert_agent_endpoint = (endpoint: string, injected_transport = false): void => {
  const url = new URL(endpoint)
  if (url.href === mainnet_agent_endpoint()) return
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    [
      injected_transport,
      loopback,
      url.protocol === 'ws:',
      url.pathname === '/',
      !url.username,
      !url.password,
      !url.search,
      !url.hash,
    ].every(Boolean)
  )
    return
  throw new Error('MAINNET_ENDPOINT_REQUIRED')
}
