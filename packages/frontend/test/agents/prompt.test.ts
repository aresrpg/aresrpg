// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

test('clipboard success is out of document flow while copy failures remain visible and recoverable', async () => {
  const source = await Bun.file(new URL('../../src/agents/AgentHandoff.tsx', import.meta.url)).text()
  expect(source).toContain("className={status === 'copied' ? 'sr-only' : undefined}")
  expect(source).toContain("hidden={status === 'idle'}")
  expect(source).toContain("status === 'failed' ? text('agent_copy_failed')")
  expect(source).toContain('className="agent-prompt"')
  expect(source).not.toContain('<textarea')
})
