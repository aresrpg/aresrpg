// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { expect, test } from '@playwright/test'
import { build } from 'vite'

import { deployment_build_config } from '../../deployment_assets.ts'

test('an open page loads its lazy JavaScript and CSS from the original deployment after promotion', async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'ares-deployment-assets-'))
  let current = 'a'
  const requests: string[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, 'http://localhost')
      const deployment = url.searchParams.get('dpl') ?? current
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1)
      const directory = join(root, `dist-${deployment}`)
      const file = resolve(directory, relative)
      if (!file.startsWith(`${directory}/`)) throw new Error('Invalid path')
      requests.push(`${deployment}:${relative}`)
      response.setHeader(
        'Content-Type',
        relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : 'text/html'
      )
      response.end(await readFile(file))
    })().catch(() => {
      response.statusCode = 404
      response.end('missing')
    })
  })
  try {
    await writeFile(
      join(root, 'index.html'),
      '<html><body><button id="load">Load panel</button><script type="module" src="/main.js"></script></body></html>'
    )
    await writeFile(
      join(root, 'main.js'),
      'document.getElementById("load").onclick = () => import("./panel.js").then(m => m.render())'
    )
    for (const id of ['a', 'b']) {
      await writeFile(
        join(root, 'panel.js'),
        `import './panel.css'; export const render = () => { document.body.dataset.panel = '${id}'; document.body.className = 'panel' }`
      )
      await writeFile(join(root, 'panel.css'), `.panel { color: ${id === 'a' ? 'rgb(1, 2, 3)' : 'rgb(4, 5, 6)'}; }`)
      await build({
        configFile: false,
        root,
        logLevel: 'silent',
        ...deployment_build_config({ ARES_DEPLOYMENT_ID: id }),
        build: { outDir: `dist-${id}` },
      })
    }
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    await page.goto(`http://127.0.0.1:${address.port}/`)
    current = 'b'
    await page.getByRole('button', { name: 'Load panel' }).click()
    await expect(page.locator('body')).toHaveAttribute('data-panel', 'a')
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(1, 2, 3)')
    expect(requests.some((request) => request.startsWith('a:assets/panel-') && request.endsWith('.css'))).toBe(true)
    await page.reload()
    await page.getByRole('button', { name: 'Load panel' }).click()
    await expect(page.locator('body')).toHaveAttribute('data-panel', 'b')
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(4, 5, 6)')
  } finally {
    await page.close()
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
    await rm(root, { recursive: true, force: true })
  }
})
