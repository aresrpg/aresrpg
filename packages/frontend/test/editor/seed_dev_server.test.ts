// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { afterEach, describe, expect, test } from 'bun:test'

import { create_seed_file_service, read_seed_icon, seed_dev_plugin } from '../../seed_dev_server.ts'

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
  test('suppresses HMR for atomic seed-file creates and sends only the store refresh signal', async () => {
    const directory = await fixture()
    const plugin = seed_dev_plugin({ repo_dir: directory, content_dir: directory })
    const hot_update = plugin.hotUpdate
    if (typeof hot_update !== 'function') throw new TypeError('seed plugin hotUpdate hook is missing')
    const payloads: unknown[] = []
    const context = {
      environment: {
        name: 'client',
        hot: { send: (payload: unknown): number => payloads.push(payload) },
      },
    }
    const modules = await hot_update.call(
      context as never,
      {
        type: 'create',
        file: join(directory, 'items.json'),
        timestamp: 1,
        modules: [],
        read: async () => '',
        server: {},
      } as never
    )

    expect(modules).toEqual([])
    expect(payloads).toEqual([{ type: 'custom', event: 'aresrpg:seed-changed' }])
  })

  test('reads newly added content icons without rebuilding the Vite asset manifest', async () => {
    const directory = await fixture()
    const mob_dir = join(directory, 'seed', 'icons', 'mobs')
    const item_dir = join(directory, 'seed', 'icons', 'items')
    const spell_dir = join(directory, 'seed', 'icons', 'spells')
    await Promise.all([
      mkdir(mob_dir, { recursive: true }),
      mkdir(item_dir, { recursive: true }),
      mkdir(spell_dir, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(mob_dir, 'new_mob.png'), Buffer.from([1, 2, 3])),
      writeFile(join(item_dir, 'new_item.png'), Buffer.from([4, 5, 6])),
      writeFile(join(spell_dir, 'yogan_adder_shaft.webp'), Buffer.from([7, 8, 9])),
    ])

    expect(await read_seed_icon(directory, 'mobs', 'new_mob')).toEqual(Buffer.from([1, 2, 3]))
    expect(await read_seed_icon(directory, 'items', 'new_item')).toEqual(Buffer.from([4, 5, 6]))
    expect(await read_seed_icon(directory, 'spells', 'yogan_adder_shaft')).toEqual(Buffer.from([7, 8, 9]))
    expect(await read_seed_icon(directory, 'mobs', '../pins')).toBeNull()
    expect(await read_seed_icon(directory, 'mobs', 'missing')).toBeNull()
  })

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
