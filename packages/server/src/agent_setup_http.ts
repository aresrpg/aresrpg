// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { create_pairing_exchange } from './agent_pairing.ts'

const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
const guide_pointer = 'Setup guide: https://aresrpg.world/agents/client.txt\n'

/** Mounted on the existing HTTP server. Creation and status require the game-session door. */
export const serve_agent_setup = async (
  request: Request,
  exchange: ReturnType<typeof create_pairing_exchange>
): Promise<Response> => {
  if (!['GET', 'POST'].includes(request.method)) return new Response(null, { status: 405, headers })
  const authorization = request.headers.get('authorization') ?? ''
  if ([!authorization, request.method === 'GET'].every(Boolean))
    return new Response(guide_pointer, { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' } })
  const token = authorization.slice(7)
  if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)) return new Response(null, { status: 403, headers })
  try {
    const id = new URL(request.url).searchParams.get('id') ?? ''
    const result =
      request.method === 'GET'
        ? await exchange.setup(id, token)
        : await exchange.complete(id, token, await request.json())
    return Response.json(result, { headers })
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- HTTP 403 explicitly reports failure without exposing capability or proof details.
  } catch {
    return Response.json({ ok: false, error: 'PAIRING_UNAVAILABLE' }, { status: 403, headers })
  }
}
