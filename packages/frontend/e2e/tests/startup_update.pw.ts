// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

const build = resolve(import.meta.dirname, '../../../../test-results/browser-build')
const worker_version = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((done) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = (event) => {
          channel.port1.close()
          done(String(event.data))
        }
        navigator.serviceWorker.controller!.postMessage('version', [channel.port2])
      })
  )

for (const busy of [false, true]) {
  test(`missing startup asset ${busy ? 'preserves an active transaction' : 'loads the activated update once'}`, async ({
    page,
  }) => {
    let version = 'one'
    const server = createServer((request, response) => {
      void (async () => {
        const path = new URL(request.url!, 'http://localhost').pathname
        response.setHeader('Cache-Control', 'no-store')
        if (path === '/sw.js') {
          response.setHeader('Content-Type', 'text/javascript')
          response.end(
            `const version=${JSON.stringify(version)};self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));self.addEventListener('message',event=>event.ports[0].postMessage(version));`
          )
          return
        }
        const file = resolve(build, `.${path === '/' ? '/e2e/fixtures/startup_update.html' : path}`)
        if (!file.startsWith(`${build}/`)) throw new Error('Invalid path')
        response.setHeader(
          'Content-Type',
          path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html'
        )
        const content = await readFile(file)
        response.end(path === '/' ? content.toString().replace('__VERSION__', version) : content)
      })().catch(() => {
        response.statusCode = 404
        response.end('missing')
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server address')
    try {
      await page.goto(`http://127.0.0.1:${address.port}/`)
      await page.evaluate(async () => {
        sessionStorage.setItem('wallet-recovery', 'preserve-me')
        await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready
      })
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
      await page.reload()
      await page.evaluate(async () => {
        await (await navigator.serviceWorker.getRegistration())!.update()
      })
      if (busy) await page.getByRole('checkbox').check()
      version = 'two'
      await page.getByRole('button', { name: 'Missing asset' }).click()
      await expect(page.locator('body')).toHaveAttribute('data-version', busy ? 'one' : 'two')
      await expect.poll(() => worker_version(page)).toBe('two')
      expect(await page.evaluate(() => sessionStorage.getItem('wallet-recovery'))).toBe('preserve-me')
      expect(await page.evaluate(() => sessionStorage.getItem('fixture-visits'))).toBe(busy ? '2' : '3')
      if (!busy) {
        await page.getByRole('button', { name: 'Missing asset' }).click()
        expect(await page.evaluate(() => sessionStorage.getItem('fixture-visits'))).toBe('3')
      }
    } finally {
      await page.close()
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    }
  })
}
