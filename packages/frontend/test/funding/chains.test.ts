// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { EVM_CHAINS } from '../../src/funding/chains.ts'
import deployment from '../../vercel.json' with { type: 'json' }

test('every balance-discovery RPC is permitted by the production connection policy', () => {
  const policy = deployment.headers
    .flatMap(({ headers }) => headers)
    .find(({ key }) => key === 'Content-Security-Policy')!.value
  const allowed = policy
    .split(';')
    .find((directive) => directive.trim().startsWith('connect-src '))!
    .trim()
    .split(/\s+/)
  for (const chain of Object.values(EVM_CHAINS))
    expect(allowed).toContain(new URL(chain.rpcUrls.default.http[0]).origin)
})
