// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

import { expect, test } from 'bun:test'

const SOURCE = resolve(import.meta.dir, '../src')
const EXTERNAL = ['react', 'react-dom']

const is_inside = (directory: string, path: string) => path.startsWith(`${directory}${sep}`)

const source_imports = () =>
  readdirSync(SOURCE, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.tsx?$/.test(name))
    .flatMap((name) => {
      const file = resolve(SOURCE, name)
      const source = readFileSync(file, 'utf8')
      return [...source.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)/g)].map((match) => ({
        file,
        name: match[1],
        target: resolve(dirname(file), match[1]),
      }))
    })

test('the UI package has no app, data, wallet, or engine dependency', () => {
  const foreign = source_imports().filter(
    ({ name, target }) => !EXTERNAL.includes(name) && !(/^\.\.?\//.test(name) && is_inside(SOURCE, target))
  )
  expect(foreign).toEqual([])
})

test('raw components never import a prebuilt game surface', () => {
  const inverted = source_imports().filter(
    ({ file, target }) =>
      is_inside(resolve(SOURCE, 'components'), file) && is_inside(resolve(SOURCE, 'prebuilt'), target)
  )
  expect(inverted).toEqual([])
})
