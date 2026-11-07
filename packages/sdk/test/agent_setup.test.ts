// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { bootstrap_setup_link } from '../examples/agent_setup.ts'

test('missing host signer fails before requesting or consuming a setup capability', async () => {
  let requests = 0
  await expect(
    bootstrap_setup_link('invalid secret input', {
      fetch: (async () => {
        requests += 1
        return Response.json({})
      }) as unknown as typeof fetch,
    })
  ).rejects.toThrow('PERSISTENT_SIGNER_REQUIRED')
  expect(requests).toBe(0)
})
