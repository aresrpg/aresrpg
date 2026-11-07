import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test, expect } from 'bun:test'

import {
  classify_release,
  runtime_package_json,
  runtime_fingerprints,
  fingerprint_runtime_files,
  SCENE_COMPILER_FILES,
} from '../release_inputs.mjs'

test('scene compiler inputs invalidate the frontend artifact', () => {
  for (const path of ['seed/scenes/main_menu.recipe.json', 'seed/scenes/main_menu.json', ...SCENE_COMPILER_FILES])
    expect(classify_release([path])).toEqual({ frontend: true, server: false, indexer: false, discord: false })
})

test('engine is frontend-owned and server/indexer releases stay independent', () => {
  expect(classify_release(['packages/engine/src/terrain.ts'])).toEqual({
    frontend: true,
    server: false,
    indexer: false,
    discord: false,
  })
  expect(classify_release(['packages/indexer/src/main.rs'])).toEqual({
    frontend: false,
    server: false,
    indexer: true,
    discord: false,
  })
  expect(classify_release(['packages/server/src/index.ts'])).toEqual({
    frontend: false,
    server: true,
    indexer: false,
    discord: false,
  })
})

test('journal prose and artwork do not invalidate game artifacts', () => {
  const paths = [
    'packages/journal/content/article.md',
    'packages/journal/artwork/cover.png',
    'packages/journal/src/pages.tsx',
  ]
  expect(classify_release(paths)).toEqual({ frontend: false, server: false, indexer: false, discord: false })
  expect(
    fingerprint_runtime_files(
      paths.map((path) => [path, 'before']),
      '{}'
    )
  ).toEqual(
    fingerprint_runtime_files(
      paths.map((path) => [path, 'after']),
      '{}'
    )
  )
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
    'packages/sdk/src/admin_auth.ts',
    'packages/engine/src/worldgen.ts',
    'seed/content/items.json',
    'bun.lock',
    'patches/vite@8.3.0.patch',
    'packages/frontend/package.json',
    'packages/frontend/src/i18n/locales/en.yaml',
  ]) {
    expect(fingerprint_runtime_files([[path, 'before']], '{}', 'local')).not.toEqual(
      fingerprint_runtime_files([[path, 'after']], '{}', 'local')
    )
  }
  expect(fingerprint_runtime_files([], '{"dependencies":{"a":"1"}}', 'local')).not.toEqual(
    fingerprint_runtime_files([], '{"dependencies":{"a":"2"}}', 'local')
  )
})

test('mobile presentation changes invalidate the shared frontend artifact', () => {
  expect(classify_release(['packages/mobile/src/MobileApp.tsx'])).toEqual({
    frontend: true,
    server: false,
    indexer: false,
    discord: false,
  })
})

test('shared UI changes invalidate browser artifacts and its manifest participates in frozen server installs', () => {
  expect(classify_release(['packages/ui/src/controls.tsx'])).toEqual({
    frontend: true,
    server: false,
    indexer: false,
    discord: false,
  })
  expect(classify_release(['packages/ui/package.json'])).toEqual({
    frontend: true,
    server: true,
    indexer: false,
    discord: true,
  })
})

test('Discord artwork, typography, and identity changes rebuild the backend image', () => {
  for (const path of [
    'packages/ui/src/base.css',
    'packages/ui/src/visual_identity.ts',
    'packages/ui/src/sui.ts',
    'packages/ui/src/assets/stat_critical.png',
    'seed/icons/items/gnawed_branch.png',
    'seed/icons/mobs/golden_lorito.png',
  ]) {
    expect(classify_release([path])).toEqual({ frontend: true, server: false, indexer: false, discord: true })
  }
})

test('notification implementation changes rebuild only the independently deployed bot', () => {
  expect(classify_release(['packages/discord/src/render.ts'])).toEqual({
    frontend: false,
    server: false,
    indexer: false,
    discord: true,
  })
  expect(classify_release(['packages/server/src/suins.ts'])).toEqual({
    frontend: false,
    server: true,
    indexer: false,
    discord: true,
  })
})

test('allocation preview copy and artwork invalidate the server image', () => {
  expect(classify_release(['packages/frontend/public/branding/helmet-favicon.png']).frontend).toBe(true)
  expect(classify_release(['packages/journal/public/assets/jetbrains-mono.woff2']).frontend).toBe(true)
  for (const path of [
    'packages/frontend/src/i18n/locales/en.yaml',
    'packages/ui/src/assets/font/nunito-800.ttf',
    'packages/frontend/public/branding/kares/card-relief.webp',
    'packages/frontend/public/branding/kares/card-veteran.webp',
    'packages/frontend/public/branding/kares/card-member.webp',
    'seed/icons/currency/kares.png',
    'packages/frontend/public/branding/helmet-favicon.png',
  ]) {
    expect(classify_release([path]).server).toBe(true)
    expect(fingerprint_runtime_files([[path, 'before']], '{}').server).not.toBe(
      fingerprint_runtime_files([[path, 'after']], '{}').server
    )
  }
})

test('SDK sources copied into the server image invalidate its release and local recovery fingerprint', () => {
  const dockerfile = readFileSync(new URL('../../packages/server/Dockerfile', import.meta.url), 'utf8')
  const sources = [...dockerfile.matchAll(/^COPY (packages\/sdk\/src\/[^\n]+)$/gm)].flatMap((match) =>
    match[1].split(' ').slice(0, -1)
  )
  expect(sources.length).toBeGreaterThan(0)
  for (const path of sources) {
    expect(classify_release([path]).server).toBe(true)
    for (const scope of ['all', 'local'])
      expect(fingerprint_runtime_files([[path, 'before']], '{}', scope).server).not.toBe(
        fingerprint_runtime_files([[path, 'after']], '{}', scope).server
      )
  }
  expect(classify_release(['packages/sdk/src/auth.ts']).server).toBe(false)
})

const with_locales = async (run) => {
  const directory = mkdtempSync(join(tmpdir(), 'ares-locale-inputs-'))
  const path = join(directory, 'packages/frontend/src/i18n/locales/en.yaml')
  const original =
    'allocation_page:\n  title: Allocation\ndiscord_marketplace:\n  title: Market\nsimulator_page:\n  stat_health: Health\n  unused_label: Browser only\nui:\n  agent_pair_no_assets: Pairing alone moves no assets\n'
  const git = (...args) => execFileSync('git', args, { cwd: directory, stdio: 'pipe' })
  try {
    mkdirSync(join(directory, 'packages/frontend/src/i18n/locales'), { recursive: true })
    writeFileSync(join(directory, 'package.json'), '{"version":"1.0.0"}')
    writeFileSync(path, original)
    git('init', '-q')
    git('add', '.')
    git(
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'fixture'
    )
    await run({ directory, path, original })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('browser-only locale changes reuse both backends, while each consumed section invalidates its owner', async () => {
  await with_locales(async ({ directory, path, original }) => {
    const before = await runtime_fingerprints(directory, 'HEAD')
    for (const [from, to, expected] of [
      ['  agent_pair_no_assets: Pairing alone moves no assets\n', '', []],
      ['unused_label: Browser only', 'unused_label: New browser copy', []],
      ['title: Allocation', 'title: New allocation', ['server']],
      ['title: Market', 'title: New notification', ['discord']],
      ['stat_health: Health', 'stat_health: Hit points', ['discord']],
    ]) {
      writeFileSync(path, original.replace(from, to))
      const after = await runtime_fingerprints(directory)
      expect(after.frontend).not.toBe(before.frontend)
      for (const component of ['server', 'discord', 'indexer'])
        expect(after[component] !== before[component]).toBe(expected.includes(component))
    }
  })
})

test('locale creation and deletion invalidate both backend locale sets', async () => {
  await with_locales(async ({ directory, path, original }) => {
    const before = await runtime_fingerprints(directory, 'HEAD')
    const french = path.replace('en.yaml', 'fr.yaml')
    writeFileSync(french, original)
    const added = await runtime_fingerprints(directory)
    for (const component of ['frontend', 'server', 'discord']) expect(added[component]).not.toBe(before[component])
    rmSync(french)
    rmSync(path)
    const removed = await runtime_fingerprints(directory)
    for (const component of ['frontend', 'server', 'discord']) expect(removed[component]).not.toBe(before[component])
  })
})

test('invalid locale YAML cannot produce a reusable runtime fingerprint', async () => {
  await with_locales(async ({ directory, path }) => {
    writeFileSync(path, 'allocation_page: [unterminated')
    await expect(runtime_fingerprints(directory)).rejects.toThrow()
  })
})

test('YAML aliases from browser copy still invalidate the backend that consumes their values', async () => {
  await with_locales(async ({ directory, path, original }) => {
    const aliased = original.replace(
      'allocation_page:\n  title: Allocation',
      'ui_copy: &copy\n  title: Allocation\nallocation_page:\n  <<: *copy'
    )
    writeFileSync(path, aliased)
    const before = await runtime_fingerprints(directory)
    writeFileSync(path, aliased.replace('title: Allocation', 'title: Updated allocation'))
    const after = await runtime_fingerprints(directory)
    expect(after.server).not.toBe(before.server)
    expect(after.discord).toBe(before.discord)
  })
})

test('locale fingerprints and both consumers use the same Bun parser semantics', () => {
  const server = readFileSync(new URL('../../packages/server/src/allocation/preview.ts', import.meta.url), 'utf8')
  const discord = readFileSync(new URL('../../packages/discord/src/copy.ts', import.meta.url), 'utf8')
  for (const consumer of [server, discord]) expect(consumer).toContain('Bun.YAML.parse(')
  expect(server).toContain('allocation_locale(')
  expect(discord).toContain('notification_locale(')
})
