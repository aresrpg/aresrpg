// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

const run = async (scenario: string) => {
  const child = Bun.spawn(
    [process.execPath, new URL('./helpers/agent_return_fixture.ts', import.meta.url).pathname, scenario],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(error)
  return JSON.parse(output) as {
    ok: boolean
    calls: string[]
    batches: { kind: string; characters: number; items: number }[]
    balance: string
    error?: string
  }
}

test('return sequence confirms character+gear and item claims before the final SUI sweep', async () => {
  const result = await run('normal')
  expect(result).toMatchObject({
    ok: true,
    calls: ['agent:offer_batch', 'owner:claim_batch', 'agent:sweep'],
    balance: '0',
  })
})
test('interrupted character return resumes its cap without another offer', async () => {
  const result = await run('resume')
  expect(result.ok).toBe(true)
  expect(result.calls).toEqual(['owner:claim_batch', 'agent:offer_batch', 'owner:claim_batch', 'agent:sweep'])
})
test('uncertain submission stops the sequence before claim or money sweep', async () => {
  const result = await run('uncertain')
  expect(result.ok).toBe(false)
  expect(result.calls).toEqual(['agent:offer_batch'])
  expect(result.balance).toBe('1000000000')
})
test('unfunded wallets stop before any asset submission', async () => {
  const result = await run('unfunded')
  expect(result.ok).toBe(false)
  expect(result.calls).toEqual([])
  expect(result.error).toContain('More SUI')
})
test('remaining unsupported custody cannot be reported as a complete return', async () => {
  const result = await run('opaque')
  expect(result.ok).toBe(false)
  expect(result.error).toContain('Some assets could not be returned')
})

test('multiple equipped characters and items share one offer and one claim when limits allow', async () => {
  const result = await run('multi')
  expect(result.ok).toBe(true)
  expect(result.batches).toEqual([
    { kind: 'offer_batch', characters: 2, items: 3 },
    { kind: 'claim_batch', characters: 2, items: 3 },
  ])
})
test('both stages split at the protocol boundary without dropping assets or interleaving the sweep', async () => {
  const result = await run('split')
  expect(result.ok).toBe(true)
  expect(result.calls).toEqual([
    'agent:offer_batch',
    'agent:offer_batch',
    'owner:claim_batch',
    'owner:claim_batch',
    'agent:sweep',
  ])
})

for (const scenario of ['stake', 'stake_resume', 'stake_empty', 'stake_paid']) {
  test(`full return reconciles staking ${scenario} without treating its exhausted shell as assets`, async () => {
    const result = await run(scenario)
    expect(result.ok).toBe(true)
    expect(result.calls.filter((call) => call === 'agent:asset_unstake')).toHaveLength(
      ['stake_empty', 'stake_paid'].includes(scenario) ? 0 : 1
    )
    expect(result.calls.filter((call) => call === 'agent:asset_offer')).toHaveLength(scenario === 'stake_empty' ? 0 : 1)
    expect(result.calls.at(-1)).toBe('agent:sweep')
  })
}
test('uncertain staking recovery stops before transferring or sweeping; it is never retried automatically', async () => {
  const result = await run('stake_uncertain')
  expect(result.ok).toBe(false)
  expect(result.calls).toEqual(['agent:asset_unstake'])
})
