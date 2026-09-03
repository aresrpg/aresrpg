// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  create_single_flight,
  pre_submission_version_race,
  retry_close_after_projection_lag,
  retry_after_version_race,
} from '../../src/transaction_guard.ts'
import { fight_result_error_text } from '../../src/modules/fight_result_error.ts'

test('one synchronous flight rejects rapid repeats and unlocks after settlement', async () => {
  const run = create_single_flight()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const first = run(async () => {
    calls += 1
    await pending
  })
  expect(first).not.toBeNull()
  expect(run(async () => void (calls += 1))).toBeNull()
  await Promise.resolve()
  expect(calls).toBe(1)
  release()
  await first
  await run(async () => void (calls += 1))
  expect(calls).toBe(2)
})

test('a rejected transaction also releases the flight', async () => {
  const run = create_single_flight()
  await expect(run(async () => Promise.reject(new Error('nope')))).rejects.toThrow('nope')
  expect(run(async () => 'retry')).not.toBeNull()
})

test('a compound action retries one pre-submission object-version race after its first receipt', async () => {
  const waits: number[] = []
  let attempts = 0
  const result = await retry_after_version_race(
    async () => {
      attempts += 1
      if (attempts === 1)
        throw new Error(
          "[sdk] dry run failed — transaction NOT submitted (zero gas): provided version doesn't match for object 0x1"
        )
      return 'crafted'
    },
    async (milliseconds) => void waits.push(milliseconds)
  )

  expect({ attempts, result, waits }).toEqual({ attempts: 2, result: 'crafted', waits: [250] })
  await expect(
    retry_after_version_race(async () =>
      Promise.reject(new Error("[sdk] transaction abc failed on-chain: provided version doesn't match"))
    )
  ).rejects.toThrow('failed on-chain')
})

test('URL-encoded unavailable object versions rebuild before submission', () => {
  const error =
    'NOT%20submitted:%20Error%20checking%20transaction%20input%20objects:%20Transaction%20needs%20to%20be%20rebuilt%20because%20object%200x1%20version%200x2%20is%20unavailable%20for%20consumption,%20current%20version:%200x3'
  expect(pre_submission_version_race(new Error(error))).toBeTrue()
  expect(fight_result_error_text({ result_version_changed: 'Retry safely.' }, error)).toBe('Retry safely.')
})

test('fight cleanup waits through bounded pre-submission 1712 projection lag', async () => {
  const waits: number[] = []
  let attempts = 0
  const result = await retry_close_after_projection_lag(
    async () => {
      attempts += 1
      if (attempts < 3)
        throw new Error("Transaction resolution failed: MoveAbort abort code: 1712 in '0x1::combat::assert_closable'")
      return 'closed'
    },
    async (milliseconds) => void waits.push(milliseconds)
  )

  expect({ attempts, result, waits }).toEqual({ attempts: 3, result: 'closed', waits: [250, 500] })
  let executed_attempts = 0
  await expect(
    retry_close_after_projection_lag(async () => {
      executed_attempts += 1
      throw new Error("[sdk] transaction abc failed on-chain: abort code: 1712 in '0x1::fight::close'")
    })
  ).rejects.toThrow('failed on-chain')
  expect(executed_attempts).toBe(1)
})
