// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { resolve } from 'node:path'
import { pathToFileURL as path_to_file_url } from 'node:url'

import { AGENT_SETUP_PATH, type AgentSignerMode } from '@aresrpg/protocol'

import { assert_agent_endpoint } from './agent_deployment.ts'
import { bootstrap_disposable_agent } from './agent_bootstrap.ts'

const parse_setup_link = (link: string) => {
  const url = new URL(link)
  const token = url.hash.slice(1)
  const id = url.searchParams.get('id') ?? ''
  const checks = [
    /^[A-Za-z0-9_-]{43}$/.test(token),
    /^[0-9a-f-]{36}$/.test(id),
    url.pathname === AGENT_SETUP_PATH,
    !url.username,
    !url.password,
    [...url.searchParams.keys()].length === 1,
    ['https:', 'http:'].includes(url.protocol),
  ]
  if (!checks.every(Boolean)) throw new Error('INVALID_SETUP_LINK')
  return { url, token }
}

type PairingClient = Omit<Awaited<ReturnType<typeof bootstrap_disposable_agent>>, 'response'> & {
  response: { agent_public_key: string; signature: string; signer_mode: AgentSignerMode }
}
type PairingBootstrap = (input: unknown) => Promise<PairingClient>

/** Complete a one-prompt setup without printing its capability or public proof.
 * An explicit fetch injection permits loopback fixtures; the CLI uses the deployment endpoint. */
export const bootstrap_setup_link = async (
  link: string,
  options: Readonly<{
    fetch?: typeof fetch
    signal?: AbortSignal
    local_preview?: boolean
    bootstrap?: PairingBootstrap
  }> = {}
) => {
  const { url, token } = parse_setup_link(link)
  const socket_origin = url.origin.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')
  assert_agent_endpoint(
    `${socket_origin}/`,
    [options.fetch !== undefined, options.local_preview === true].some(Boolean)
  )
  url.hash = ''
  const request = options.fetch ?? fetch
  const init = { headers: { authorization: `Bearer ${token}` }, redirect: 'error' as const, signal: options.signal }
  const pending = await request(url, init)
  if (!pending.ok) throw new Error('SETUP_UNAVAILABLE')
  const bootstrap = options.bootstrap ?? bootstrap_disposable_agent
  const client = await bootstrap(await pending.json())
  const response = await request(url, { ...init, method: 'POST', body: JSON.stringify(client.response) })
  if (!response.ok) throw new Error('SETUP_COMPLETION_FAILED')
  const result = (await response.json()) as { address?: unknown; multisig_public_key?: unknown; signer_mode?: unknown }
  if (
    ![
      result.address === client.signer.address,
      result.signer_mode === client.response.signer_mode,
      result.multisig_public_key === client.signer.public_key.toBase64(),
    ].every(Boolean)
  )
    throw new Error('SETUP_IDENTITY_MISMATCH')
  return client.signer
}

const load_pairing_adapter = async (path: string | undefined): Promise<PairingBootstrap> => {
  if (!path) return bootstrap_disposable_agent
  if (!path.endsWith('.ts') || /^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error('INVALID_PAIRING_ADAPTER')
  const adapter = await import(path_to_file_url(resolve(path)).href)
  if (typeof adapter.create_pairing_client !== 'function') throw new Error('INVALID_PAIRING_ADAPTER')
  return adapter.create_pairing_client
}

export const create_signer = async () => {
  const link = process.env.ARESRPG_SETUP_LINK
  if (!link) throw new Error('SETUP_LINK_REQUIRED')
  const bootstrap = await load_pairing_adapter(process.env.ARESRPG_PAIRING_ADAPTER)
  const signer = await bootstrap_setup_link(link, {
    bootstrap,
    local_preview: process.env.ARESRPG_LOCAL_PREVIEW === '1',
  })
  console.log(JSON.stringify({ type: 'pairing_verified', address: signer.address }))
  return signer
}
