// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Redis } from 'ioredis'

import { allocation_preview } from '../share_preview.ts'

import { allocation_error, type AllocationOptions } from './service.ts'

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  })
/** Public card previews only. No cookie authenticates campaign requests. */
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
      ['preview', () => allocation_preview(request, redis, options.origin)],
      ['image', () => allocation_preview(request, redis, options.origin)],
    ])
    const route = routes.get(action)
    if (!route) throw new Error('invalid_request')
    return await route()
  } catch (error) {
    const code = allocation_error(error)
    console.warn('Allocation HTTP refused', { code })
    return json({ error: code }, code === 'unavailable' ? 503 : 400)
  }
}
