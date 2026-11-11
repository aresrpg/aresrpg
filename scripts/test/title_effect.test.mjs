// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
const content = join(root, 'seed/content')
const items = JSON.parse(await readFile(join(content, 'items.json'), 'utf8'))
const validate = async (change) => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-title-effect-'))
  try {
    await Promise.all(
      (await readdir(content))
        .filter((name) => name !== 'items.json')
        .map((name) => symlink(join(content, name), join(directory, name)))
    )
    await writeFile(
      join(directory, 'items.json'),
      JSON.stringify(items.map((item) => (item.item_type === 'title_veteran' ? { ...item, ...change } : item)))
    )
    const child = Bun.spawn([process.execPath, 'scripts/validate_seed.mjs', '--json', '--content-dir', directory], {
      cwd: root,
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

test.each(['senshi_female', 'blast_girl'])(
  'a title may select the existing %s body with its ordinary equipment sockets',
  async (model) => {
    const result = await validate({ title_model: model })
    expect(result.reds).toEqual([])
    expect(result.code).toBe(0)
  }
)

test.each([
  { title_model: 'missing_body' },
  { title_model: '../characters/blast_girl' },
  { title_model: 'senshi_female_hair' },
  { title_model: 123 },
  { title_model: { model: 'senshi_female', typo: true } },
  { title_model: null },
  { category: 'hat', title_model: 'senshi_female' },
])('invalid title presentation fails the seed gate: %j', async (change) => {
  const result = await validate(change)
  expect(result.code).toBe(1)
  expect(result.reds.some((message) => message.includes('I-TITLE-MODEL'))).toBeTrue()
})

test.each([
  { title_nameplate: 'missing' },
  { title_nameplate: '../admin_dragon_plate' },
  { title_nameplate: null },
  { category: 'hat', title_nameplate: 'aeon_plate' },
])('invalid title artwork fails seed validation: %j', async (change) => {
  const result = await validate(change)
  expect(result.code).toBe(1)
  expect(result.reds.some((message) => message.includes('I-TITLE-NAMEPLATE'))).toBeTrue()
})
