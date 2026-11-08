// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { pre_submission_failure } from '@aresrpg/sdk/transaction-error'
import type { AgentTransferActions } from '@aresrpg/sdk/agent-transfer-actions'

import { execute_agent_transfer } from '../../src/agents/agent_transaction.ts'

const intent = {
  kind: 'asset_offer' as const,
  items: [],
  recipient: 'agent',
  sui_mist: '1',
  kares_mist: '0',
  reserve_mist: '1',
}

test('one explicit action prepares and confirms exactly once, with no automatic claim', async () => {
  const calls: string[] = []
  const actions = {
    prepare: async () => {
      calls.push('prepare')
      return {
        confirm: async () => {
          calls.push('confirm')
          return { digest: 'receipt' }
        },
      }
    },
  } as unknown as AgentTransferActions
  await expect(
    execute_agent_transfer({
      actions,
      intent,
      is_current: () => true,
      prepared: () => {
        calls.push('prepared')
      },
    })
  ).resolves.toMatchObject({ digest: 'receipt' })
  expect(calls).toEqual(['prepare', 'prepared', 'confirm'])
})
test('identity changes during preparation fail before signature, and execution errors retain uncertainty', async () => {
  let current = true,
    confirmed = false
  const actions = {
    prepare: async () => {
      current = false
      return {
        confirm: async () => {
          confirmed = true
        },
      }
    },
  } as unknown as AgentTransferActions
  const error = await execute_agent_transfer({ actions, intent, is_current: () => current }).catch(
    (error: unknown) => error
  )
  expect(pre_submission_failure(error)).toBe(true)
  expect(confirmed).toBe(false)
  const uncertain = new Error('[sdk] transaction outcome unknown: digest')
  const failing = {
    prepare: async () => ({
      confirm: async () => {
        throw uncertain
      },
    }),
  } as unknown as AgentTransferActions
  expect(
    await execute_agent_transfer({ actions: failing, intent, is_current: () => true }).catch((error: unknown) => error)
  ).toBe(uncertain)
  expect(pre_submission_failure(uncertain)).toBe(false)
})

test('dismissed preparation never requests a late signature', async () => {
  let mounted = true
  let finish!: () => void
  let signatures = 0
  const prepared = new Promise<void>((resolve) => {
    finish = resolve
  })
  const actions = {
    prepare: async () => {
      await prepared
      return {
        confirm: async () => {
          signatures += 1
          return { digest: 'never' }
        },
      }
    },
  } as unknown as AgentTransferActions
  const operation = execute_agent_transfer({ actions, intent, is_current: () => mounted })
  mounted = false
  finish()
  const error = await operation.catch((reason: unknown) => reason)
  expect(pre_submission_failure(error)).toBe(true)
  expect(signatures).toBe(0)
})

test('the operation guard also reaches the final SDK signing boundary', async () => {
  let current = true
  let signatures = 0
  const actions = {
    prepare: async () => ({
      confirm: async ({ before_sign }: { before_sign: () => void }) => {
        await Promise.resolve()
        current = false
        before_sign()
        signatures += 1
        return { digest: 'never' }
      },
    }),
  } as unknown as AgentTransferActions
  await expect(execute_agent_transfer({ actions, intent, is_current: () => current })).rejects.toThrow('changed')
  expect(signatures).toBe(0)
})
