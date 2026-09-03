// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Rebuilds the canonical authored character portraits from the composed GLBs. Run from this
// package: `bun run portraits`. Production maps the remaining classes to the Senshi fallback.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { createServer, type Plugin } from 'vite'

import { authored_character_model_classes } from '../src/content/character_model_catalog.ts'

const EXPECTED = new Set(
  authored_character_model_classes.flatMap((classe) => ['male', 'female'].map((sex) => `${classe}_${sex}.jpg`))
)
const frontend_dir = resolve(import.meta.dir, '..')
const repo_dir = resolve(frontend_dir, '../..')
const output_dir = resolve(repo_dir, 'seed/icons/characters')

const chrome_path = (): string => {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((candidate): candidate is string => !!candidate)
  const found = candidates.find(existsSync)
  if (!found) throw new Error('Chrome was not found. Set CHROME_BIN to a Chromium-compatible executable.')
  return found
}

const body_bytes = async (request: import('node:http').IncomingMessage): Promise<Buffer> =>
  Buffer.concat((await Array.fromAsync(request)).map((chunk) => Buffer.from(chunk)))

await mkdir(output_dir, { recursive: true })
const completed = new Set<string>()
const completion = Promise.withResolvers<void>()
const output_plugin: Plugin = {
  name: 'aresrpg-character-portrait-output',
  configureServer: (server) => {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
      if (request.method === 'GET' && url.pathname === '/__character_portraits') {
        response.setHeader('content-type', 'text/html; charset=utf-8')
        response.end(
          '<!doctype html><html><body style="margin:0;background:#09090e"><script type="module" src="/packages/frontend/scripts/character_portrait_scene.ts"></script></body></html>'
        )
        return
      }
      if (request.method !== 'POST' || url.pathname !== '/__portrait_output') return next()
      const name = url.searchParams.get('name') ?? ''
      if (!EXPECTED.has(name)) {
        response.writeHead(400)
        response.end('Unexpected portrait name.')
        return
      }
      const bytes = await body_bytes(request)
      if (bytes.length < 1_000 || bytes.subarray(0, 2).toString('hex') !== 'ffd8') {
        response.writeHead(400)
        response.end('Portrait is not a valid JPEG payload.')
        return
      }
      await writeFile(join(output_dir, name), bytes)
      completed.add(name)
      response.end('ok')
      if (completed.size === EXPECTED.size) completion.resolve()
    })
  },
}

const server = await createServer({
  configFile: false,
  plugins: [output_plugin],
  root: repo_dir,
  server: { host: '127.0.0.1', port: 0 },
})
const profile_dir = await mkdtemp(join(tmpdir(), 'aresrpg-portraits-'))
try {
  await server.listen()
  const address = server.httpServer?.address()
  if (!address || typeof address === 'string') throw new Error('Portrait server did not bind a TCP port.')
  const browser = spawn(
    chrome_path(),
    [
      '--headless=new',
      '--disable-background-networking',
      '--enable-unsafe-swiftshader',
      '--no-first-run',
      '--use-angle=swiftshader',
      `--user-data-dir=${profile_dir}`,
      `http://127.0.0.1:${address.port}/__character_portraits`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  )
  try {
    const timeout = Promise.withResolvers<never>()
    const timeout_id = setTimeout(() => timeout.reject(new Error('Portrait rendering timed out.')), 90_000)
    await Promise.race([completion.promise, timeout.promise])
    clearTimeout(timeout_id)
    console.log(`Rendered ${completed.size} character portraits into ${output_dir}`)
  } finally {
    browser.kill('SIGTERM')
  }
} finally {
  await server.close()
  await rm(profile_dir, { recursive: true, force: true })
}
