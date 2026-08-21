// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, test } from 'bun:test'

import { create_seed_file_service } from '../../seed_dev_server.ts'

const temporary_directories: string[] = []

afterEach(async () => {
  await Promise.all(temporary_directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aresrpg-seed-editor-'))
  temporary_directories.push(directory)
  await writeFile(join(directory, 'items.json'), '{\n  "rows": [1]\n}\n')
  return directory
}

describe('development seed file service', () => {
  test('allows only named corpus files and detects concurrent edits', async () => {
    const directory = await fixture()
    const service = create_seed_file_service({
      content_dir: directory,
      files: ['items.json'],
      validate: async () => ({ reds: [], warns: [] }),
    })
    const loaded = await service.read('items.json')
    await expect(service.read('../items.json')).rejects.toThrow('not editable')
    await writeFile(join(directory, 'items.json'), '{\n  "rows": [2]\n}\n')
    await expect(service.write('items.json', loaded.revision, { rows: [3] })).rejects.toThrow('changed on disk')
  })

  test('allows existing red debt but refuses a new red finding', async () => {
    const directory = await fixture()
    const validate = async (candidate: Readonly<Record<string, unknown>>) => ({
      reds: ['RED EXISTING', ...(JSON.stringify(candidate).includes('forbidden') ? ['RED NEW'] : [])],
      warns: [],
    })
    const service = create_seed_file_service({ content_dir: directory, files: ['items.json'], validate })
    const loaded = await service.read('items.json')
    await service.write('items.json', loaded.revision, { rows: [2] })
    const next = await service.read('items.json')
    await expect(service.write('items.json', next.revision, { rows: ['forbidden'] })).rejects.toThrow('RED NEW')
    expect(JSON.parse(await readFile(join(directory, 'items.json'), 'utf8'))).toEqual({ rows: [2] })
  })
})
