import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

import { expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../../', import.meta.url))

test.each(['server', 'discord'])(
  'the frozen %s image includes every workspace manifest before installation',
  (component) => {
    const { workspaces } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
    const dockerfile = readFileSync(new URL(`../../packages/${component}/Dockerfile`, import.meta.url), 'utf8')
    const [before_install] = dockerfile.split('RUN bun install')
    const copied = new Set(
      [...before_install.matchAll(/^COPY (packages\/[^ ]+\/package\.json) /gm)].map((match) => match[1])
    )
    const manifests = workspaces.flatMap((workspace) => globSync(`${workspace}/package.json`, { cwd: root }))
    expect(manifests.length).toBeGreaterThan(0)
    expect(manifests.filter((manifest) => !copied.has(manifest))).toEqual([])
    // The deny-by-default context needs the parent, contents exclusion, and manifest exception in order.
    const context = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8')
    for (const manifest of manifests) {
      const directory = dirname(manifest)
      expect(context).toContain(`\n!${directory}\n${directory}/*\n!${manifest}\n`)
    }
  }
)

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

test('server share artwork survives the deny-by-default Docker context', () => {
  const dockerfile = readFileSync(new URL('../../packages/server/Dockerfile', import.meta.url), 'utf8')
  const context = readFileSync(new URL('../../.dockerignore', import.meta.url), 'utf8')
  const assets = [...dockerfile.matchAll(/^COPY (seed\/icons\/\S+\.png) /gm)].map((match) => match[1])
  expect(assets.length).toBeGreaterThan(0)
  for (const asset of assets) {
    const directory = dirname(asset)
    expect(context).toContain(`\n!${directory}\n${directory}/*\n!${asset}\n`)
  }
})

test('release checkout materializes every explicitly copied server share image', () => {
  const release = Bun.YAML.parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'))
  const checkout = release.jobs['build-server'].steps.find((step) => step.uses?.startsWith('actions/checkout@'))
  const patterns = checkout.with['sparse-checkout'].trim().split('\n')
  const dockerfile = readFileSync(new URL('../../packages/server/Dockerfile', import.meta.url), 'utf8')
  const assets = [...dockerfile.matchAll(/^COPY (seed\/icons\/\S+\.png) /gm)].map((match) => match[1])
  expect(patterns).not.toContain('!seed/icons')
  expect(patterns).toContain('!seed/icons/*')
  for (const asset of assets) {
    expect(patterns).toContain(`/${dirname(asset)}/`)
    expect(patterns).toContain(`/${asset}`)
  }
})
