import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('the frozen server image includes every workspace manifest before installation', () => {
  const { workspaces } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const dockerfile = readFileSync(new URL('../../packages/server/Dockerfile', import.meta.url), 'utf8')
  const [before_install] = dockerfile.split('RUN bun install')
  const copied = new Set(
    [...before_install.matchAll(/^COPY (packages\/[^ ]+\/package\.json) /gm)].map((match) => match[1])
  )
  const manifests = workspaces.flatMap((workspace) => globSync(`${workspace}/package.json`, { cwd: root }))
  expect(manifests.length).toBeGreaterThan(0)
  expect(manifests.filter((manifest) => !copied.has(manifest))).toEqual([])
})

test('the server image uses the repository Bun version and an immutable image digest', () => {
  const { packageManager } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/)
  const version = packageManager.slice('bun@'.length)
  const dockerfile = readFileSync(new URL('../../packages/server/Dockerfile', import.meta.url), 'utf8')
  const image = dockerfile.match(/^FROM (\S+) AS runtime$/m)?.[1]
  expect(image?.split('@')[0]).toBe(`oven/bun:${version}-slim`)
  expect(image?.split('@')[1]).toMatch(/^sha256:[a-f0-9]{64}$/)
})

test('indexer dependency cooking and final builds both preserve the committed Cargo resolution', () => {
  const dockerfile = readFileSync(new URL('../../packages/indexer/Dockerfile', import.meta.url), 'utf8')
  expect(dockerfile).toMatch(/^RUN cargo install cargo-chef --version \d+\.\d+\.\d+ --locked$/m)
  expect(dockerfile).not.toContain('Cargo.lock*')
  for (const command of ['cargo chef cook', 'cargo build']) {
    const line = dockerfile.split('\n').find((row) => row.startsWith(`RUN ${command} `))
    expect(line?.split(' ')).toContain('--locked')
  }
})
