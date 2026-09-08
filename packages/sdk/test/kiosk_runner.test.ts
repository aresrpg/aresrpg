// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_kiosk_runner, resolve_kiosk_cap, retry_stale_kiosk_ref } from '../src/kiosk_runner.ts'

test('a cached kiosk cap retries one fresh lookup only when another tab advanced it', async () => {
  const refreshes: boolean[] = []
  const result = await retry_stale_kiosk_ref(async (fresh) => {
    refreshes.push(fresh)
    if (!fresh) throw new Error('NOT submitted: provided version does not match, provided: 8 actual: 0x9')
    return 'submitted'
  })

  expect(result).toBe('submitted')
  expect(refreshes).toEqual([false, true])
})

test('encoded resolver errors use the same stale-cap classifier', async () => {
  const refreshes: boolean[] = []
  await retry_stale_kiosk_ref(async (fresh) => {
    refreshes.push(fresh)
    if (!fresh)
      throw new Error('NOT%20submitted:%20provided%20version%20does%20not%20match,%20provided:%208%20actual:%200x9')
    return 'submitted'
  })
  expect(refreshes).toEqual([false, true])
})

test('wire custody refreshes the mutable PersonalKioskCap before composition', async () => {
  const personal = `0x${'1'.repeat(64)}`
  const kiosk = `0x${'2'.repeat(64)}`
  let fallback_calls = 0
  const exact = {
    objectId: personal,
    kioskId: kiosk,
    isPersonal: true,
    version: '997314902',
    digest: '4ptWTLDJMjxgm48JivnNQppZ8vqFR28ewDkWR8nYYY4y',
  }
  const cap = await resolve_kiosk_cap(
    async (requested_kiosk) => {
      fallback_calls += 1
      expect(requested_kiosk).toBe(kiosk)
      return exact
    },
    { kiosk, kiosk_cap: personal }
  )

  expect(fallback_calls).toBe(1)
  expect(cap).toMatchObject({
    objectId: personal,
    kioskId: kiosk,
    isPersonal: true,
    version: '997314902',
  })
})

test('missing wire cap uses the kiosk-specific loader', async () => {
  const requested: (string | undefined)[] = []
  const expected = {
    objectId: '0xcap',
    kioskId: '0xkiosk',
    isPersonal: true,
    version: '1',
    digest: '11111111111111111111111111111111',
  }
  const cap = await resolve_kiosk_cap(
    async (kiosk) => {
      requested.push(kiosk)
      return expected
    },
    { kiosk: '0xkiosk' }
  )

  expect(requested).toEqual(['0xkiosk'])
  expect(cap).toBe(expected)
})

test('a loader result for another kiosk is refused', async () => {
  await expect(
    resolve_kiosk_cap(
      async () => ({
        objectId: '0xcap',
        kioskId: '0xother',
        isPersonal: true,
        version: '1',
        digest: '11111111111111111111111111111111',
      }),
      { kiosk: '0xwanted' }
    )
  ).rejects.toThrow('The requested PersonalKioskCap is unavailable')
})

test('a terminal kiosk action hydrates its kiosk and game inputs in one batch', async () => {
  const hydrated: string[][] = []
  const cap = {
    objectId: '0xcap',
    kioskId: '0xkiosk',
    isPersonal: true,
    version: '1',
    digest: '11111111111111111111111111111111',
  }
  const sdk = {
    tx: () => ({}),
    hydrate_unknown: async (ids: readonly string[]) => void hydrated.push([...ids]),
    execute: async () => ({ Transaction: { digest: 'done' } }),
  }
  const { with_terminal_kiosk } = create_kiosk_runner(sdk as never, async () => cap)

  await with_terminal_kiosk(() => undefined, { inputs: ['0xzone', '0xcontent'] })

  expect(hydrated).toEqual([['0xkiosk', '0xzone', '0xcontent']])
})

test('client-side merges precede a Random door, with the cap returned before that final command', async () => {
  const calls: string[][] = []
  const cap = { objectId: 'cap', kioskId: 'kiosk', isPersonal: true }
  const sdk = {
    tx: () => ({ commands: [] as string[] }),
    hydrate_unknown: async () => undefined,
    with_owner_kiosk: (tx: { commands: string[] }, _cap: unknown, compose: (kiosk: never, cap: never) => void) => {
      tx.commands.push('borrow')
      compose('kiosk' as never, 'cap' as never)
      tx.commands.push('return')
    },
    doors: {
      merge_stacks: (tx: { commands: string[] }, { source_id }: { source_id: string }) =>
        tx.commands.push('merge:' + source_id),
    },
    execute: async (tx: { commands: string[] }) => {
      calls.push(tx.commands)
      return { Transaction: { digest: 'done' } }
    },
  }
  const runner = create_kiosk_runner(sdk as never, async () => cap as never)
  await runner.with_terminal_kiosk(
    (tx) => {
      ;(tx as never as { commands: string[] }).commands.push('random')
    },
    { merges: [{ target_id: 'target', source_ids: ['a', 'b'] }] }
  )
  await runner.with_terminal_kiosk(
    (tx) => {
      ;(tx as never as { commands: string[] }).commands.push('random')
    },
    { merges: [{ target_id: 'target', source_ids: [] }] }
  )
  expect(calls).toEqual([['borrow', 'merge:a', 'merge:b', 'return', 'random'], ['random']])
})

test('optional merge preflight may fall back once, but an executed failure never retries', async () => {
  for (const preflight of [true, false]) {
    let tries = 0
    const commands: string[][] = []
    const sdk = {
      tx: () => ({ commands: [] as string[] }),
      with_owner_kiosk: (_tx: unknown, _cap: unknown, compose: (kiosk: never, cap: never) => void) =>
        compose('k' as never, 'c' as never),
      doors: { merge_stacks: (tx: { commands: string[] }) => tx.commands.push('merge') },
      execute: async (tx: { commands: string[] }) => {
        tries++
        commands.push(tx.commands)
        if (tries === 1)
          throw new Error(
            preflight
              ? '[sdk] transaction resolution failed — NOT submitted: missing merge source'
              : 'failed on-chain: receipt digest is known'
          )
        return { Transaction: { digest: 'done' } }
      },
    }
    const runner = create_kiosk_runner(sdk as never, async () => ({ objectId: 'c', kioskId: 'k' }) as never)
    const result = runner.with_kiosk(
      (tx) => {
        ;(tx as never as { commands: string[] }).commands.push('use')
      },
      { merges: [{ target_id: 'target', source_ids: ['source'] }] }
    )
    if (preflight) {
      await result
      expect(commands).toEqual([['merge', 'use'], ['use']])
    } else {
      await expect(result).rejects.toThrow('failed on-chain')
      expect(tries).toBe(1)
    }
  }
})
