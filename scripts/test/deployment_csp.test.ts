// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../../', import.meta.url))
test.each([
  ['deploy.yml', 'vercel', 'preview'],
  ['release.yml', 'prepare-production', 'production'],
])('the %s finalizer uses its pulled environment for generated CSP', async (workflow, job, target) => {
  const directory = await mkdtemp(join(tmpdir(), 'ares-csp-'))
  const config = {
    version: 3,
    routes: [
      {
        src: '/(.*)',
        headers: {
          'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:",
        },
      },
    ],
  }
  try {
    await mkdir(join(directory, '.vercel/output'), { recursive: true })
    await writeFile(join(directory, '.vercel/output/config.json'), JSON.stringify(config))
    await writeFile(
      join(directory, `.vercel/.env.${target}.local`),
      `VITE_BOT_SERVICE_URL="https://bot-${target}.example.test"\n`
    )
    const document = Bun.YAML.parse(await readFile(join(root, '.github/workflows', workflow!), 'utf8')) as {
      jobs: Record<string, { steps: { run?: string }[] }>
    }
    const command = document.jobs[job!]!.steps.find(
      ({ run }) => run?.includes('bun --env-file=') && run.includes('scripts/pin_vercel_deployment.ts')
    )!.run!.split(' ')
    const process_result = Bun.spawn([process.execPath, ...command.slice(1, -1), join(root, command.at(-1)!)], {
      cwd: directory,
      env: { ...process.env, VITE_BOT_SERVICE_URL: undefined, ARES_DEPLOYMENT_ID: 'ares-fixture' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const error = await new Response(process_result.stderr).text()
    expect({ exit: await process_result.exited, error }).toEqual({ exit: 0, error: '' })
    const generated = JSON.parse(await readFile(join(directory, '.vercel/output/config.json'), 'utf8'))
    expect(generated.deploymentId).toBe('ares-fixture')
    expect(generated.routes[0].headers['Content-Security-Policy']).toBe(
      `default-src 'self'; connect-src 'self' https://bot-${target}.example.test; img-src 'self' data:`
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.each([undefined, 'http://bot-invalid.example.test'])(
  'finalizer CLI handles missing or invalid bot origin without broadening CSP: %s',
  async (origin) => {
    const directory = await mkdtemp(join(tmpdir(), 'ares-csp-invalid-'))
    const config = {
      version: 3,
      routes: [{ headers: { 'Content-Security-Policy': "default-src 'self'; connect-src 'self'" } }],
    }
    const original = JSON.stringify(config)
    try {
      await mkdir(join(directory, '.vercel/output'), { recursive: true })
      await writeFile(join(directory, '.vercel/output/config.json'), original)
      await writeFile(
        join(directory, '.vercel/.env.production.local'),
        origin ? `VITE_BOT_SERVICE_URL=${origin}\n` : ''
      )
      const child = Bun.spawn(
        [process.execPath, '--env-file=.vercel/.env.production.local', join(root, 'scripts/pin_vercel_deployment.ts')],
        {
          cwd: directory,
          env: { ...process.env, VITE_BOT_SERVICE_URL: undefined, ARES_DEPLOYMENT_ID: 'ares-fixture' },
          stdout: 'pipe',
          stderr: 'pipe',
        }
      )
      const error = await new Response(child.stderr).text()
      const exit = await child.exited
      const result = await readFile(join(directory, '.vercel/output/config.json'), 'utf8')
      if (origin) {
        expect(exit).not.toBe(0)
        expect(error).toContain('VITE_BOT_SERVICE_URL must be a public HTTPS origin')
        expect(result).toBe(original)
      } else {
        expect({ exit, error }).toEqual({ exit: 0, error: '' })
        expect(JSON.parse(result)).toEqual({ ...config, deploymentId: 'ares-fixture' })
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)
