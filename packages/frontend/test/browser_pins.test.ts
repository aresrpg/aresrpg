// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, test } from 'bun:test'
import { build } from 'vite'

import { browser_pins_plugin } from '../../../scripts/browser_pins.ts'

test('a testnet browser selects local deployment pins and never falls back to mainnet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-browser-target-'))
  const previous = process.env.ARES_PINS_FILE
  delete process.env.ARES_PINS_FILE
  try {
    await mkdir(join(directory, 'scripts'))
    await mkdir(join(directory, '.dev'))
    await writeFile(join(directory, 'pins.json'), '{"network":"mainnet","package":"production"}')
    await writeFile(join(directory, '.dev/pins.json'), '{"network":"testnet","package":"local"}')
    const plugin_path = join(directory, 'scripts/browser_pins.ts')
    await writeFile(plugin_path, await readFile(new URL('../../../scripts/browser_pins.ts', import.meta.url)))
    const { browser_pins_plugin: plugin } = (await import(pathToFileURL(plugin_path).href)) as {
      browser_pins_plugin: typeof browser_pins_plugin
    }
    const root = await realpath(join(directory, 'pins.json'))
    expect(JSON.parse((await plugin(undefined, 'testnet').load(root))!).package).toBe('local')
    expect(JSON.parse((await plugin(undefined, 'mainnet').load(root))!).package).toBe('production')
    await expect(plugin(root, 'testnet').load(root)).rejects.toThrow('do not match testnet')
    await rm(join(directory, '.dev/pins.json'))
    expect(() => plugin(undefined, 'testnet')).toThrow()
  } finally {
    if (previous === undefined) delete process.env.ARES_PINS_FILE
    else process.env.ARES_PINS_FILE = previous
    await rm(directory, { recursive: true, force: true })
  }
})

test('browser pin imports exclude reconciliation metadata without changing runtime pins or the source file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-browser-pins-'))
  const pins_path = join(directory, 'pins.json')
  const entry = join(directory, 'entry.js')
  const runtime = {
    network: 'testnet',
    package: 'testnet-package',
    content_root: { id: 'live-registry', shared_version: '42' },
    kares_offering: { id: 'live-offering', shared_version: '7' },
  }
  const source = JSON.stringify({ ...runtime, seed_ledger: { current: 'reconciliation-must-not-ship' } })
  try {
    await writeFile(pins_path, source)
    await writeFile(entry, 'import pins from "./pins.json"; export default pins;')
    const plugin = browser_pins_plugin(pins_path)
    const canonical_path = await realpath(pins_path)
    expect(await plugin.load(join(directory, 'another', 'pins.json'))).toBeNull()
    expect(JSON.parse((await plugin.load(canonical_path))!)).toEqual(runtime)
    const result = await build({
      configFile: false,
      root: directory,
      publicDir: false,
      logLevel: 'silent',
      plugins: [plugin],
      build: { write: false, lib: { entry, formats: ['es'] }, minify: false },
    })
    const outputs = Array.isArray(result) ? result : [result]
    const code = outputs
      .flatMap((result) => {
        if (!('output' in result)) throw new Error('Expected a completed Vite build')
        return result.output.flatMap((file) => (file.type === 'chunk' ? [file.code] : []))
      })
      .join('\n')
    expect(code).toContain('live-registry')
    expect(code).toContain('live-offering')
    expect(code).not.toContain('reconciliation-must-not-ship')
    expect(await readFile(pins_path, 'utf8')).toBe(source)
    await writeFile(pins_path, JSON.stringify({ ...runtime, package: 'new-publication' }))
    expect(JSON.parse((await plugin.load(canonical_path))!).package).toBe('new-publication')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
