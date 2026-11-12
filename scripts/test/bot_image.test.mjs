import { globSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../../', import.meta.url))

test('the dedicated bot image admits every imported seed JSON in its source dependencies', () => {
  const context = readFileSync(new URL('../../packages/bot/Dockerfile.dockerignore', import.meta.url), 'utf8').split(
    '\n'
  )
  const files = ['bot', 'sdk', 'protocol', 'immutable', 'fight'].flatMap((component) =>
    globSync(`packages/${component}/src/**/*.ts`, { cwd: root })
  )
  const assets = new Set(
    files.flatMap((file) =>
      [
        ...readFileSync(resolve(root, file), 'utf8').matchAll(/^import .* from ['"]([^'"]*seed\/[^'"]+\.json)['"]/gm),
      ].map((match) => relative(root, resolve(root, dirname(file), match[1])))
    )
  )
  expect(assets.size).toBeGreaterThan(0)
  for (const asset of assets) {
    expect(context).toContain(`!${asset}`)
    for (let parent = dirname(asset); parent !== '.'; parent = dirname(parent)) expect(context).toContain(`!${parent}/`)
  }
})

test('the dedicated bot context excludes siblings reopened by parent directory exceptions', () => {
  const context = readFileSync(new URL('../../packages/bot/Dockerfile.dockerignore', import.meta.url), 'utf8')
  expect(context).toContain('!packages/*/\npackages/*/**\n!packages/*/package.json')
  expect(context).toContain('!seed/\nseed/*\n')
  for (const directory of ['content', 'portraits'])
    expect(context).toContain(`!seed/${directory}/\nseed/${directory}/*\n`)
})

test('the bot bundle carries readable city collision artifacts outside the source tree', async () => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { execFileSync } = await import('node:child_process')
  const directory = await mkdtemp(resolve(tmpdir(), 'ares-bot-package-'))
  try {
    execFileSync(process.execPath, ['packages/bot/build.ts', directory], { cwd: root })
    const probe = resolve(directory, 'probe.ts')
    await writeFile(
      probe,
      `import { load_generated_city_artifacts } from ${JSON.stringify(resolve(root, 'packages/engine/src/data.ts'))}; await load_generated_city_artifacts(); console.log('loaded')`
    )
    execFileSync(process.execPath, ['build', probe, '--target=bun', `--outfile=${directory}/probe.js`], { cwd: root })
    expect(
      execFileSync(process.execPath, [resolve(directory, 'probe.js')], { cwd: directory, encoding: 'utf8' }).trim()
    ).toBe('loaded')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('bot image admits shared locomotion and its authored collision inputs', () => {
  const context = readFileSync(new URL('../../packages/bot/Dockerfile.dockerignore', import.meta.url), 'utf8').split(
    '\n'
  )
  for (const path of [
    'packages/bot/build.ts',
    'packages/engine/src/**',
    'seed/content/worlds.json',
    'seed/content/structure_packs.json',
    'seed/structures/**',
    'seed/scenes/thebes.recipe.json',
  ])
    expect(context).toContain(`!${path}`)
})
