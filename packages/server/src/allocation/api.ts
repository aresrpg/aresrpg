// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Redis } from 'ioredis'

import { allocation_error, type AllocationOptions } from './service.ts'
import { start_x, finish_x, redirect } from './x.ts'
import { share_preview } from './preview.ts'

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  })
/** Public reads and X account-link callback only. No cookie authenticates campaign requests. */
export const serve_allocation = async (
  request: Request,
  redis: Redis,
  options: AllocationOptions
): Promise<Response> => {
  const params = new URL(request.url).searchParams
  const action = params.get('action') ?? 'status'
  try {
    if (request.method !== 'GET') throw new Error('unauthorized')
    const routes = new Map([
      ['oauth', () => start_x(request, redis, options)],
      ['callback', () => finish_x(request, redis, options)],
      ['preview', () => share_preview(request, redis, options.origin)],
      ['image', () => share_preview(request, redis, options.origin)],
    ])
    const route = routes.get(action)
    if (!route) throw new Error('invalid_request')
    return await route()
  } catch (error) {
    const code = allocation_error(error)
    console.warn('Allocation HTTP refused', { code })
    if (action === 'callback') return redirect(`${options.origin}/allocation?error=${code}`)
    return json({ error: code }, code === 'unavailable' || code === 'x_unavailable' ? 503 : 400)
  }
}
