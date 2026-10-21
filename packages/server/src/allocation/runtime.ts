// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Redis } from 'ioredis'
import type { AllocationRequest, AllocationResult } from '@aresrpg/protocol'

import { connect_redis } from './store.ts'
import { allocation_request, allocation_error, type AllocationOptions } from './service.ts'
import { serve_allocation } from './api.ts'

/** One optional database connection per server process; failure cannot stop game boot. */
export const create_allocation = (options: AllocationOptions) => {
  let connection: Promise<Redis> | null = null
  const database = (): Promise<Redis> => {
    connection ??= connect_redis(options.redis_url)
      .then((redis) => {
        redis.once('end', () => {
          connection = null
        })
        return redis
      })
      .catch((error: unknown) => {
        connection = null
        throw error
      })
    return connection
  }
  return {
    request: async (owner: string, request: AllocationRequest): Promise<AllocationResult> => {
      try {
        return await allocation_request(await database(), owner, request, options)
      } catch (error) {
        return { action: 'error', error: allocation_error(error) }
      }
    },
    http: async (request: Request): Promise<Response> => {
      try {
        return await serve_allocation(request, await database(), options)
      } catch {
        console.warn('Allocation database unavailable')
        return Response.json({ error: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
      }
    },
  }
}
export type Allocation = ReturnType<typeof create_allocation>
