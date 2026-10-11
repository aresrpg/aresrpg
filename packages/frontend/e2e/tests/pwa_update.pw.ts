// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { expect, test } from '@playwright/test'

const build_dir = resolve(import.meta.dirname, '../../../../test-results/browser-build')

test('a service-worker-controlled reload gets the new release and its model URL', async ({ page }) => {
  let release = 'a'
  // Serve the real production worker and its precache. Only the app shell and one lazy model
  // change between releases, reproducing an old tab after its asset disappears from the host.
  const server = createServer((request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname
    response.setHeader('Cache-Control', 'no-cache')
    if (path === '/' || path === '/index.html') {
      response.setHeader('Content-Type', 'text/html')
      response.end(`<html><body data-release="${release}"><script>
        fetch('/assets/release-${release}.glb').then(response => document.body.dataset.asset = response.status);
        navigator.serviceWorker.register('/sw.js');
      </script></body></html>`)
      return
    }
    if (path.startsWith('/assets/release-')) {
      response.statusCode = path === `/assets/release-${release}.glb` ? 200 : 404
      response.end()
      return
    }
    const file = resolve(build_dir, `.${path}`)
    if (!file.startsWith(`${build_dir}/`) || !existsSync(file)) {
      response.statusCode = 404
      response.end()
      return
    }
    if (path.endsWith('.js')) response.setHeader('Content-Type', 'application/javascript')
    response.end(readFileSync(file))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  try {
    await page.goto(`http://127.0.0.1:${address.port}/`)
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    await expect(page.locator('body')).toHaveAttribute('data-release', 'a')
    await expect(page.locator('body')).toHaveAttribute('data-asset', '200')
    release = 'b'
    await page.reload()
    await expect(page.locator('body')).toHaveAttribute('data-release', 'b')
    await expect(page.locator('body')).toHaveAttribute('data-asset', '200')
  } finally {
    await page.close()
    server.closeAllConnections()
    await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())))
  }
})
