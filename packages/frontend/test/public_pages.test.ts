// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { resolve } from 'node:path'

import { expect, test } from 'bun:test'
import { createServer } from 'vite'

import { public_pages_plugin } from '../public_pages.ts'

test('public directory URLs serve their static index instead of the game shell', async () => {
  const server = await createServer({
    configFile: false,
    root: resolve(import.meta.dir, '..'),
    plugins: [public_pages_plugin()],
    server: { host: '127.0.0.1', port: 0, watch: null },
  })
  try {
    await server.listen()
    const origin = server.resolvedUrls!.local[0]!
    for (const page of ['links', 'agents']) {
      const expected = await fetch(`${origin}${page}/index.html`).then((response) => response.text())
      for (const path of [page, `${page}/`, `${page}?source=test`]) {
        const response = await fetch(`${origin}${path}`)
        expect(response.status).toBe(200)
        expect(await response.text()).toBe(expected)
      }
    }
    const game = await fetch(`${origin}inventory`).then((response) => response.text())
    expect(game).toContain('/src/')
    const guide = await fetch(`${origin}llms.txt`).then((response) => response.text())
    expect(guide).toStartWith('# AresRPG')
  } finally {
    await server.close()
  }
})
