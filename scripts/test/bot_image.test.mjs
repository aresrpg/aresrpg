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
