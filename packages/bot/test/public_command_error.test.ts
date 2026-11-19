// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { public_command } from '../src/command_admission.ts'
import type { Command } from '../src/control.ts'
import { public_command_error } from '../src/planning_failure.ts'

// Regression: a failed direct command stored `String(error)` and every client view returned it as is,
// to MCP clients and, through the pushed status, to the owner's page. Only a code may leave the service.
test('a stored domain code is shown as it is', () => {
  for (const code of ['bot_busy_or_paused', 'market_unavailable', 'illegal_fight_action:out_of_range'])
    expect(public_command_error('failed', code)).toBe(code)
})

test('implementation text leaves the service only as its classification', () => {
  expect(public_command_error('failed', 'Error: connect ECONNREFUSED 10.2.3.4:6379 redis://user:secret@host')).toBe(
    'command_failed'
  )
  expect(public_command_error('uncertain', 'Error: connection lost')).toBe('command_uncertain')
  expect(public_command_error('completed', undefined)).toBeUndefined()
})

test('the client view of a command never carries raw error text or its receipt', () => {
  const command = { id: 'c', status: 'failed', error: 'TypeError: secret is not a function', receipt: { digest: 'd' } }
  const shown = public_command(command as unknown as Command)
  expect(shown.error).toBe('command_failed')
  expect('receipt' in shown).toBe(false)
})
