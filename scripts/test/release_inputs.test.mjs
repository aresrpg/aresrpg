import { readFileSync } from 'node:fs'

import { test, expect } from 'bun:test'

import { classify_release, runtime_package_json, fingerprint_runtime_files } from '../release_inputs.mjs'

test('engine is frontend-owned and server/indexer releases stay independent', () => {
  expect(classify_release(['packages/engine/src/terrain.ts'])).toEqual({
    frontend: true,
    server: false,
    indexer: false,
  })
  expect(classify_release(['packages/indexer/src/main.rs'])).toEqual({ frontend: false, server: false, indexer: true })
  expect(classify_release(['packages/server/src/index.ts'])).toEqual({ frontend: false, server: true, indexer: false })
})

test('pins and SDK changes require new frontend artifacts', () => {
  expect(classify_release(['pins.json']).frontend).toBe(true)
  expect(classify_release(['packages/sdk/src/client.ts']).frontend).toBe(true)
})

test('browser deployment pin selection invalidates the frontend artifact', () => {
  const path = 'scripts/browser_pins.ts'
  expect(classify_release([path]).frontend).toBe(true)
  expect(fingerprint_runtime_files([[path, 'before']], '{}').frontend).not.toBe(
    fingerprint_runtime_files([[path, 'after']], '{}').frontend
  )
})

test('every workspace manifest copied into the server and its context policy invalidate that image', () => {
  const dockerfile = readFileSync(new URL('../../packages/server/Dockerfile', import.meta.url), 'utf8')
  const manifests = [...dockerfile.matchAll(/^COPY (packages\/[^ ]+\/package\.json) /gm)].map((match) => match[1])
  expect(manifests.length).toBeGreaterThan(0)
  for (const path of ['.dockerignore', ...manifests]) {
    expect(classify_release([path]).server).toBe(true)
    expect(fingerprint_runtime_files([[path, 'before']], '{}').server).not.toBe(
      fingerprint_runtime_files([[path, 'after']], '{}').server
    )
  }
})

test('a version bump alone does not rebuild runtime packages', () => {
  expect(runtime_package_json('{"version":"1.0.0","dependencies":{"x":"1"}}')).toBe(
    runtime_package_json('{"version":"1.0.1","dependencies":{"x":"1"}}')
  )
})

test('local backend recovery ignores frontend edits while full release fingerprints retain them', () => {
  const files = [
    ['packages/frontend/src/app.tsx', 'before'],
    ['packages/server/src/index.ts', 'server'],
  ]
  const changed = [['packages/frontend/src/app.tsx', 'after'], files[1]]
  expect(fingerprint_runtime_files(files, '{}', 'local')).toEqual(fingerprint_runtime_files(changed, '{}', 'local'))
  expect(fingerprint_runtime_files(files, '{}')).not.toEqual(fingerprint_runtime_files(changed, '{}'))
})

test('local recovery still guards backend, SDK, engine, content, and dependency inputs', () => {
  for (const path of [
    'packages/server/src/index.ts',
    'packages/indexer/src/main.rs',
    'packages/sdk/src/operator_auth.ts',
    'packages/engine/src/worldgen.ts',
    'seed/content/items.json',
    'bun.lock',
    'packages/frontend/package.json',
  ]) {
    expect(fingerprint_runtime_files([[path, 'before']], '{}', 'local')).not.toEqual(
      fingerprint_runtime_files([[path, 'after']], '{}', 'local')
    )
  }
  expect(fingerprint_runtime_files([], '{"dependencies":{"a":"1"}}', 'local')).not.toEqual(
    fingerprint_runtime_files([], '{"dependencies":{"a":"2"}}', 'local')
  )
})
