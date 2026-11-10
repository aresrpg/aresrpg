// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HostedChallengeInput, HostedBotDescriptor } from '@aresrpg/protocol'
import { parse_agent_pairing_request } from '@aresrpg/sdk/agent-pairing'

import type { Bot, BotConfig, BotPolicy, OwnerChallenge } from './model.ts'
import { public_bot } from './model.ts'
import type { ControlStore } from './store.ts'
import type { OwnerVerifier } from './owner_proof.ts'
import { create_connect_service } from './connect.ts'
import { read_owner_status } from './owner_status.ts'
import { create_oauth_service } from './oauth.ts'
import { create_control_service, type Observe } from './control.ts'
import { create_mcp_handler } from './mcp.ts'
import { require_string } from './security.ts'
import { request_pairing_proof, request_owner_provisioning } from './provisioning.ts'

const response = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
const cookie_name = (id: string) => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error('invalid_session')
  return `__Host-ares-bot-${id}`
}
const cookie_header = (id: string, secret: string, expires_at: number) =>
  `${cookie_name(id)}=${secret}; Path=/; HttpOnly; Secure; SameSite=None; Expires=${new Date(expires_at).toUTCString()}`
const session_cookie = (request: Request, id?: string) => {
  if (!id) return ''
  const name = cookie_name(id)
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? ''
  )
}

export const create_ingress = (
  options: Readonly<{
    store: ControlStore
    config: BotConfig
    verify_owner: OwnerVerifier
    policy: BotPolicy
    observation_freshness_ms: number
    provision_enabled: boolean
    play_enabled: boolean
    ready?: () => boolean
    observe?: Observe
  }>
) => {
  const { store, config } = options
  const oauth = create_oauth_service(store, config)
  const connect = create_connect_service(store, config, options.verify_owner)
  const control = create_control_service(store, config, options.observation_freshness_ms, Date.now, options.observe)
  const mcp = create_mcp_handler(control, options.play_enabled, `${config.issuer}/.well-known/oauth-protected-resource`)
  type PostHandler = (request: Request, body: Readonly<Record<string, unknown>>) => Promise<Response>
  // The stored challenge selects its own request binding; a caller cannot substitute another cookie.
  const proof_session = async (request: Request, id: string) => {
    const proof = await store.read<OwnerChallenge>(`challenge:${id}`)
    return session_cookie(request, proof?.authorization_id)
  }
  const provision: PostHandler = async (request, body) => {
    if (Object.keys(body).some((key) => key !== 'authorization_id')) throw new Error('invalid_request')
    const id = require_string(body.authorization_id)
    const owner = await connect.owner_session(id, session_cookie(request, id))
    if (config.recovery_mode || !options.provision_enabled) throw new Error('managed_signer_unconfigured')
    const pending = await request_owner_provisioning(store, owner, options.policy)
    const bot = await store.read<Bot>(`bot:${pending.id}`)
    return bot
      ? response({ status: bot.status, bot: public_bot(bot) })
      : response({ status: 'pending', request_id: pending.id }, 202)
  }
  const pairing_proof: PostHandler = async (request, body) => {
    const id = require_string(body.authorization_id)
    const owner = await connect.owner_session(id, session_cookie(request, id))
    if (config.recovery_mode || !options.provision_enabled) throw new Error('managed_signer_unconfigured')
    const proof = await request_pairing_proof(store, {
      authorization_id: id,
      bot_id: require_string(body.bot_id),
      owner: owner.owner,
      request: parse_agent_pairing_request(body.request),
    })
    return proof.status === 'ready'
      ? response({ status: 'ready', proof: proof.proof })
      : response({ status: 'pending' }, 202)
  }
  const return_action =
    (operation: typeof connect.begin_return): PostHandler =>
    async (request, body) => {
      const id = require_string(body.authorization_id)
      const bot = body.bot as HostedBotDescriptor | undefined
      if (!bot || typeof bot !== 'object') throw new Error('invalid_request')
      require_string(bot.id)
      return response(await operation(id, session_cookie(request, id), bot))
    }
  const post_routes = new Map<string, PostHandler>([
    ['/connect/disconnect', return_action(connect.begin_return)],
    ['/connect/return-complete', return_action(connect.complete_return)],
    [
      '/connect/challenge',
      async (request, body) => {
        const input = body as HostedChallengeInput
        const challenge = await connect.challenge(input, session_cookie(request, input.authorization_id))
        const reply = response(challenge.result)
        reply.headers.set(
          'Set-Cookie',
          cookie_header(challenge.result.authorization_id, challenge.session, challenge.expires_at)
        )
        return reply
      },
    ],
    [
      '/connect/verify',
      async (request, body) => {
        const id = require_string(body.challenge_id)
        return response(await connect.verify(id, require_string(body.signature), await proof_session(request, id)))
      },
    ],
    [
      '/connect/authorize',
      async (request, body) => {
        const id = require_string(body.challenge_id)
        return response(await connect.authorize(id, require_string(body.signature), await proof_session(request, id)))
      },
    ],
    [
      '/connect/cancel',
      async (request, body) => {
        const id = require_string(body.authorization_id)
        await connect.cancel(id, session_cookie(request, id))
        const reply = response({ cancelled: true })
        reply.headers.set('Set-Cookie', `${cookie_header(id, '', 0)}; Max-Age=0`)
        return reply
      },
    ],
    ['/connect/bots', provision],
    ['/connect/proof', pairing_proof],
    ['/oauth/register', async (_request, body) => response(await oauth.register(body), 201)],
    ['/oauth/token', async (_request, body) => response(await oauth.exchange(body))],
    [
      '/oauth/revoke',
      async (_request, body) => {
        await oauth.revoke(body)
        return response({})
      },
    ],
    [
      '/mcp',
      async (request, body) => {
        const version = request.headers.get('mcp-protocol-version')
        if (version && !['2025-03-26', '2025-06-18', '2025-11-25'].includes(version))
          throw new Error('unsupported_protocol_version')
        const token = request.headers.get('authorization')
        if (!token?.startsWith('Bearer ')) throw new Error('invalid_token')
        const grant = await oauth.authenticate(token.slice(7))
        const result = await mcp(grant, body)
        return result === null ? new Response(null, { status: 202 }) : response(result)
      },
    ],
  ])
  const get_routes = new Map<string, (request: Request, url: URL) => Promise<Response>>([
    [
      '/health',
      async () => {
        if (options.ready && !options.ready()) return response({ error: 'observation_unavailable' }, 503)
        try {
          // Exercise the same durable connection actors require, without writing or replaying work.
          await store.read('health')
          return response({ role: 'service', recovery_mode: config.recovery_mode })
        } catch (error) {
          console.error('Hosted storage health check failed', error instanceof Error ? error.message : 'unknown')
          return response({ error: 'storage_unavailable' }, 503)
        }
      },
    ],
    [
      '/authorize',
      async (_request, url) => {
        const authorization = await oauth.begin(url.searchParams)
        return new Response(null, {
          status: 302,
          headers: {
            Location: authorization.location,
            'Set-Cookie': cookie_header(
              authorization.authorization_id,
              authorization.session,
              authorization.expires_at
            ),
            'Cache-Control': 'no-store',
          },
        })
      },
    ],
    [
      '/connect/status',
      async (request, url) => {
        const id = require_string(url.searchParams.get('authorization_id'))
        const owner = await connect.owner_session(id, session_cookie(request, id))
        return response(await read_owner_status(store, config, owner))
      },
    ],
    [
      '/connect/request',
      async (request, url) => {
        const id = require_string(url.searchParams.get('authorization_id'))
        return response(await connect.details(id, session_cookie(request, id)))
      },
    ],
    [
      '/connect/bots',
      async (request, url) => {
        const id = require_string(url.searchParams.get('authorization_id'))
        return response(await connect.list_bots(id, session_cookie(request, id)))
      },
    ],
  ])
  const route = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (request.method === 'GET') {
      const metadata = discovery(config, url.pathname)
      if (metadata) return response(metadata)
      const handler = get_routes.get(url.pathname)
      return handler ? handler(request, url) : response({ error: 'method_not_allowed' }, 405)
    }
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405)
    const handler = post_routes.get(url.pathname)
    return handler
      ? handler(request, await read_body(request, config.max_body_bytes))
      : response({ error: 'not_found' }, 404)
  }
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin')
    const is_connect = new URL(request.url).pathname.startsWith('/connect/')
    if ((origin && origin !== config.web_origin) || (is_connect && origin !== config.web_origin))
      return response({ error: 'invalid_origin' }, 403)
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), config.web_origin)
    try {
      return cors(await route(request), origin)
    } catch (error) {
      const failure = request_error(error, config, new URL(request.url).pathname)
      console.error(
        'Hosted request rejected',
        JSON.stringify({
          path: new URL(request.url).pathname,
          status: failure.status,
          code: public_error_code(error),
        })
      )
      return cors(failure, origin)
    }
  }
}

const cors = (reply: Response, origin: string | null) => {
  if (origin) {
    reply.headers.set('Access-Control-Allow-Origin', origin)
    reply.headers.set('Access-Control-Allow-Credentials', 'true')
    reply.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version')
    reply.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    reply.headers.set('Vary', 'Origin')
  }
  return reply
}
const discovery = (config: BotConfig, path: string) => {
  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp')
    return {
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: config.scopes,
      bearer_methods_supported: ['header'],
    }
  if (path !== '/.well-known/oauth-authorization-server') return null
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    registration_endpoint: `${config.issuer}/oauth/register`,
    revocation_endpoint: `${config.issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: config.scopes,
    authorization_response_iss_parameter_supported: true,
  }
}
const read_body = async (request: Request, limit: number): Promise<Readonly<Record<string, unknown>>> => {
  if (!request.body) throw new Error('invalid_request')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw new Error('request_too_large')
    }
    chunks.push(next.value)
  }
  return parse_body(Buffer.concat(chunks).toString('utf8'), request.headers.get('content-type') ?? '')
}
const parse_body = (text: string, content_type: string): Readonly<Record<string, unknown>> => {
  const body: unknown = content_type.startsWith('application/x-www-form-urlencoded')
    ? Object.fromEntries(new URLSearchParams(text))
    : JSON.parse(text)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid_request')
  return body as Readonly<Record<string, unknown>>
}
const public_error_code = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'request_failed'
  return /^[a-z_]+$/.test(message) ? message : 'request_failed'
}
const error_response = (error: unknown, config: BotConfig) => {
  const code = public_error_code(error)
  const auth = code === 'invalid_token' || code === 'insufficient_scope'
  const statuses: Readonly<Record<string, number>> = {
    invalid_token: 401,
    insufficient_scope: 403,
    managed_signer_unconfigured: 503,
    control_transaction_conflict: 409,
  }
  const status = statuses[code] ?? 400
  const reply = response({ error: code }, status)
  if (auth)
    reply.headers.set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${config.issuer}/.well-known/oauth-protected-resource", error="${code}"`
    )
  return reply
}

const request_error = (error: unknown, config: BotConfig, path: string) => {
  if (path === '/mcp' && error instanceof SyntaxError)
    return response({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
  return error_response(error, config)
}
