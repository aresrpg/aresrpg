// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_ingress } from '../../src/http.ts'
import type { Observe } from '../../src/control.ts'
import type { ControlStore } from '../../src/store.ts'
import type { BotConfig } from '../../src/model.ts'
import { hash_secret } from '../../src/security.ts'

import { fixture_config, memory_store } from './control_fixture.ts'

/** Synthetic zkLogin verification seam only; real provider proofs remain a live release gate. */
export const create_http_fixture = (
  store: ControlStore = memory_store(),
  config: BotConfig = fixture_config,
  observe?: Observe
) => {
  const ingress = create_ingress({
    store,
    config,
    observe,
    verify_owner: async (challenge, signature) => {
      if (signature !== `fixture:${hash_secret(challenge.message)}`) throw new Error('invalid_owner_signature')
    },
    policy: { revision: 1, scopes: config.scopes },
    observation_freshness_ms: config.observation_freshness_ms,
    provision_enabled: true,
    play_enabled: true,
  })
  const cookies = new Map<string, string>()
  const cookie = () => [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  const request = async (path: string, body?: unknown, bearer?: string) => {
    const browser = path.startsWith('/connect/')
    const headers = new Headers({ 'content-type': 'application/json' })
    if (browser) {
      headers.set('origin', config.web_origin)
      headers.set('cookie', cookie())
    }
    if (bearer) headers.set('authorization', `Bearer ${bearer}`)
    const response = await ingress(
      new Request(`${config.issuer}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    )
    const set_cookie = response.headers.get('set-cookie')
    if (set_cookie) {
      const [name, value] = set_cookie.split(';')[0]!.split('=')
      if (set_cookie.includes('Max-Age=0')) cookies.delete(name!)
      else cookies.set(name!, value!)
    }
    return response
  }
  const json = async <T>(path: string, body?: unknown, bearer?: string): Promise<T> => {
    const response = await request(path, body, bearer)
    const value = (await response.json()) as T
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`)
    return value
  }
  return {
    store,
    config,
    ingress,
    request,
    json,
    cookie,
    signature: (message: string) => `fixture:${hash_secret(message)}`,
  }
}
