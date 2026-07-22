// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { execute_character_delete_once } from './character-delete-execution.js'

describe('execute_character_delete_once — destructive transaction boundary', () => {
  test('routes the transaction through the named standard pipeline exactly once', async () => {
    const transaction = { kind: 'character-delete-ptb' }
    const outcome = { result: { digest: '0xd1' } }
    const calls = []
    const execute = async (label, tx) => {
      calls.push([label, tx])
      return outcome
    }

    await expect(execute_character_delete_once(transaction, execute)).resolves.toBe(outcome)
    expect(calls).toEqual([['character_delete', transaction]])
  })

  test('propagates an executed failure after one attempt and never auto-retries it', async () => {
    const transaction = { kind: 'character-delete-ptb' }
    const executed_failure = Object.assign(new Error('executed failure'), { digest: '0xf1' })
    let calls = 0
    const execute = async () => {
      calls += 1
      throw executed_failure
    }

    await expect(execute_character_delete_once(transaction, execute)).rejects.toBe(executed_failure)
    expect(calls).toBe(1)
  })
})
