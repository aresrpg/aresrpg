// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

type Result = Readonly<{
  ok: boolean
  calls: string[]
  progress: { signer: string; moved: number; total: number }[]
  remaining: { characters: string[]; items: string[] }
  assets?: number
  royalty_mist?: string
  left?: { roster: number; listed: number }
  error?: string
  payer?: string | null
  after_offer?: boolean
  claim_kiosks: (string | null)[]
}>

const run = async (scenario: string): Promise<Result> => {
  const child = Bun.spawn(
    [process.execPath, new URL('./helpers/wallet_import_fixture.ts', import.meta.url).pathname, scenario],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(error)
  return JSON.parse(output) as Result
}

test('the game wallet cannot import from itself', async () => {
  const result = await run('same_wallet')
  expect(result).toMatchObject({ ok: false, calls: [] })
  expect(result.error).toContain('other than your game wallet')
})

test('an unfunded source wallet stops before any signature and names the payer', async () => {
  const result = await run('source_unfunded')
  expect(result).toMatchObject({ ok: false, calls: [], payer: 'source' })
})

test('an unfunded game wallet stops at its claim; the offers stay as resumable caps', async () => {
  const result = await run('owner_unfunded')
  expect(result).toMatchObject({ ok: false, calls: ['source:offer_batch'], payer: 'owner', after_offer: true })
  expect(result.remaining.characters).toEqual(['character-a', 'character-b'])
})

test('an interrupted import claims its pending offer first and offers only the rest', async () => {
  const result = await run('resume')
  expect(result.ok).toBe(true)
  expect(result.calls).toEqual(['owner:claim_batch', 'source:offer_batch', 'owner:claim_batch'])
  expect(result.remaining).toEqual({ characters: [], items: [] })
})

test('characters beyond the free roster places stay in the source wallet', async () => {
  const result = await run('roster')
  expect(result).toMatchObject({ ok: true, left: { roster: 1, listed: 0 } })
  expect(result.remaining).toEqual({ characters: ['character-b'], items: [] })
})

test('an asset on public sale stays in the source wallet and is counted', async () => {
  const result = await run('listed')
  expect(result).toMatchObject({ ok: true, left: { roster: 0, listed: 1 } })
  expect(result.remaining.items).toEqual(['item-c'])
})

test('every moved object pays one royalty floor: two characters, their gear and three items', async () => {
  const result = await run('normal')
  expect(result).toMatchObject({ ok: true, assets: 7, royalty_mist: '7000000' })
  expect(result.calls).toEqual(['source:offer_batch', 'owner:claim_batch'])
  expect(result.progress.at(-1)).toEqual({ signer: 'owner', moved: 7, total: 7 })
})

test('a selection above the transaction limits splits without dropping an asset', async () => {
  const result = await run('split')
  expect(result.ok).toBe(true)
  expect(result.calls.filter((call) => call === 'source:offer_batch').length).toBeGreaterThan(1)
  expect(result.calls.filter((call) => call === 'owner:claim_batch').length).toBeGreaterThan(1)
  expect(result.remaining).toEqual({ characters: [], items: [] })
  expect(result.progress.map(({ moved }) => moved)).toEqual(result.progress.map(({ moved }) => moved).toSorted())
})

test('an earlier submission with an unknown outcome stops the import before any read or signature', async () => {
  const result = await run('recovered')
  expect(result).toMatchObject({ ok: false, calls: [], progress: [] })
  expect(result.error).toContain('previous transaction recovered')
})

test('every claim asks the session kiosk loader, which owns the kiosk created by a first claim', async () => {
  const result = await run('split')
  expect(result.claim_kiosks.length).toBeGreaterThan(1)
  expect(new Set(result.claim_kiosks)).toEqual(new Set(['0xsession']))
})
