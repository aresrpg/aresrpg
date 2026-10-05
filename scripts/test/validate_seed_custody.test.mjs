// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const airdrop = JSON.parse(await readFile(join(root, 'seed/content/airdrop.json'), 'utf8'))
const [{ custody }] = airdrop.giftcards

const validate = async (pins) => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-seed-custody-'))
  try {
    const pins_file = join(directory, 'pins.json')
    await writeFile(pins_file, JSON.stringify({ network: 'mainnet', ...pins }))
    const child = Bun.spawn([process.execPath, 'scripts/validate_seed.mjs', '--json'], {
      cwd: root,
      env: { ...process.env, ARES_PINS_FILE: pins_file },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(stderr).toBe('')
    return { code, ...JSON.parse(stdout) }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('a configured treasury remains valid gift custody after rewards publication', async () => {
  const result = await validate({ kares_treasury: custody })
  expect(result.reds).toEqual([])
  expect(result.code).toBe(0)
})

test.each(['package', 'package_original', 'kares_rewards_upgrade_cap', 'kares_rewards_setup', 'publisher'])(
  'gift custody cannot target the pinned %s object',
  async (name) => {
    const result = await validate({ [name]: custody })
    expect(result.code).toBe(1)
    expect(result.reds.some((message) => message.includes('L4-CUSTODY-OBJECT'))).toBeTrue()
  }
)

test('gift custody cannot target a shared deployment object', async () => {
  const result = await validate({ kares_economy: { id: custody, shared_version: '1' } })
  expect(result.code).toBe(1)
  expect(result.reds.some((message) => message.includes('L4-CUSTODY-OBJECT'))).toBeTrue()
})
