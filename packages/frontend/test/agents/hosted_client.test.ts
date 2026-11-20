// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_hosted_client } from '../../src/agents/hosted_client.ts'
import { failure_reason } from '../../src/modules/suins.ts'

// Regression (edge, 2026-11-20): a deployment without a bot service address built its requests on an
// empty origin. `new URL(path, '')` threw "Invalid base URL", and the name change reported a
// generic write failure that told the player to refresh and try again.
test('a deployment without a bot service refuses every hosted request before it is built', async () => {
  const calls: unknown[] = []
  const fetcher = (async (...args: readonly unknown[]) => {
    calls.push(args)
    return Response.json({})
  }) as unknown as typeof fetch
  const app = { get_state: () => ({}) as never, dispatch: () => {} }
  const client = create_hosted_client('', new AbortController().signal, app, fetcher)
  const error = await client.request('/connect/request').catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).cause).toBe('unavailable')
  expect(calls).toEqual([])
})

test('the name change names that cause, so the player is not told to try again', () => {
  expect(failure_reason(new Error('Hosted service unavailable', { cause: 'unavailable' }))).toBe('unavailable')
  expect(failure_reason(new TypeError("Failed to construct 'URL': Invalid base URL"))).toBe('write_failed')
})
