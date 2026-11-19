// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

import { component_owns_path } from '../release_inputs.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const workspaces = Object.fromEntries(
  globSync('packages/*/package.json', { cwd: root }).map((path) => {
    const { name, exports = {} } = JSON.parse(read(path))
    return [name, { directory: dirname(path), exports }]
  })
)
/** The repository file an import names; null for a runtime built-in or an installed dependency. */
const imported_file = (from, specifier) => {
  if (specifier.startsWith('.')) return relative(root, resolve(root, dirname(from), specifier))
  const name = specifier.split('/').slice(0, 2).join('/')
  const target = workspaces[name]?.exports[`.${specifier.slice(name.length)}`]
  return target ? relative(root, resolve(root, workspaces[name].directory, target)) : null
}
/** Every file the image executes: the value imports reachable from its three entries. Types are erased. */
const runtime_closure = () => {
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  const walk = (seen, path) => {
    if (seen.has(path)) return seen
    seen.add(path)
    if (!path.endsWith('.ts')) return seen
    return transpiler
      .scanImports(read(path))
      .map(({ path: specifier }) => imported_file(path, specifier))
      .filter(Boolean)
      .reduce(walk, seen)
  }
  return [
    ...['index', 'cleanup_main', 'waitlist_main']
      .map((entry) => `packages/telegram/src/${entry}.ts`)
      .reduce(walk, new Set()),
  ]
}
const locales = globSync('packages/frontend/src/i18n/locales/*.yaml', { cwd: root })
const manifests = ['package.json', 'bun.lock', ...globSync('packages/*/package.json', { cwd: root })]

/** Docker's context rule: the last pattern that matches a path or one of its parents decides. */
const context_admits = (patterns, path) => {
  const expression = (pattern) =>
    new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\/?|\*|\?/g, (wild) => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' })[wild])}$`
    )
  const parents = path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'))
  return patterns.reduce((admitted, line) => {
    const pattern = line.replace(/^!/, '').replace(/\/$/, '')
    return parents.some((parent) => expression(pattern).test(parent)) ? line.startsWith('!') : admitted
  }, true)
}

test('the Telegram entries reach a closure worth guarding', () => {
  const closure = runtime_closure()
  expect(closure).toContain('packages/protocol/src/hosted_bot_client.ts')
  expect(closure).toContain('packages/engine/src/world_catalog.ts')
  expect(closure).toContain('seed/content/strategies.json')
  expect(closure.length).toBeGreaterThan(50)
  expect(locales.length).toBeGreaterThan(5)
})

test('the telegram release component owns everything its image contains', () => {
  for (const path of [
    ...runtime_closure(),
    ...locales,
    ...manifests.filter((manifest) => manifest !== 'package.json'),
    'packages/telegram/Dockerfile',
    'packages/telegram/Dockerfile.dockerignore',
  ])
    expect({ path, owned: component_owns_path('telegram', path) }).toEqual({ path, owned: true })
})

test('the dedicated Telegram context admits its closure and its install, and nothing beside them', () => {
  const patterns = read('packages/telegram/Dockerfile.dockerignore')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
  for (const path of [...runtime_closure(), ...locales, ...manifests, 'patches/any.patch'])
    expect({ path, admitted: context_admits(patterns, path) }).toEqual({ path, admitted: true })
  for (const path of [
    'pins.json',
    '.env',
    '.git/config',
    'node_modules/three/package.json',
    'packages/telegram/README.md',
    'packages/telegram/.env.local',
    'packages/telegram/test/connected.test.ts',
    'packages/telegram/node_modules/x/index.js',
    'packages/bot/src/index.ts',
    'packages/sdk/src/client.ts',
    'packages/frontend/src/App.tsx',
    'packages/frontend/src/i18n/copy.ts',
    'packages/frontend/public/index.html',
    'seed/content/items.json',
    'seed/icons/items/wheat.png',
    'seed/models/character.glb',
    'packages/telegram/src/storage.key',
  ])
    expect({ path, admitted: context_admits(patterns, path) }).toEqual({ path, admitted: false })
  // The image runs from source: its entry and the operator commands are files of that same context.
  const image = read('packages/telegram/Dockerfile')
  expect(image).toContain('bun install --filter @aresrpg/telegram --frozen-lockfile --production --ignore-scripts')
  expect(image).toContain('ENTRYPOINT ["bun", "/app/packages/telegram/src/index.ts"]')
  const { scripts, dependencies } = JSON.parse(read('packages/telegram/package.json'))
  expect([scripts.waitlist, scripts.cleanup]).toEqual(['bun src/waitlist_main.ts', 'bun src/cleanup_main.ts'])
  // Every workspace package the closure imports is a declared runtime dependency, directly or through one.
  expect(Object.keys(dependencies).toSorted()).toEqual(['@aresrpg/engine', '@aresrpg/protocol'])
})
