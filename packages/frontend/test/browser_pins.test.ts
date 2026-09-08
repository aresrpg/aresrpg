// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'
import { build } from 'vite'

import { browser_pins_plugin } from '../../../scripts/browser_pins.ts'

test('browser pin imports exclude publication history without changing runtime pins or the source file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-browser-pins-'))
  const pins_path = join(directory, 'pins.json')
  const entry = join(directory, 'entry.js')
  const runtime = {
    testnet: {
      package: 'testnet-package',
      content_root: { id: 'live-registry', shared_version: '42' },
      future_pin: 'retained',
    },
    mainnet: { package: 'mainnet-package', kares_offering: { id: 'live-offering', shared_version: '7' } },
  }
  const source = JSON.stringify({
    testnet: {
      ...runtime.testnet,
      seed_ledgers: { retired: 'publication-ledger-must-not-ship' },
      seed_addresses: { retired: 'address-history-must-not-ship' },
    },
    mainnet: { ...runtime.mainnet, seed_ledgers: {}, seed_addresses: {} },
  })
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
    expect(code).not.toContain('publication-ledger-must-not-ship')
    expect(code).not.toContain('address-history-must-not-ship')
    expect(await readFile(pins_path, 'utf8')).toBe(source)
    await writeFile(pins_path, JSON.stringify({ testnet: { ...runtime.testnet, package: 'new-publication' } }))
    expect(JSON.parse((await plugin.load(canonical_path))!).testnet.package).toBe('new-publication')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
