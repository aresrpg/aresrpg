// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

import { expect, test } from 'bun:test'

import { fragment as FRAGMENT } from '../../packages/engine/test/fixtures/claude_spell_fragment.json'
import { SOURCE_SHA256 } from '../../packages/engine/src/generated/claude_spell_source.js'
import reference from '../../packages/engine/test/fixtures/spell_game_shader.json'
import { SPELL_SHADER } from '../../packages/engine/src/generated/claude_spell_wgsl.js'
import { compile_spell_wgsl } from '../spell_wgsl.mjs'
import { compile_spell_shader } from '../spell_shader.mjs'

test('offline integration produces the shipped gameplay artifact', () => {
  expect(compile_spell_wgsl(compile_spell_shader(FRAGMENT))).toEqual(SPELL_SHADER)
  expect(SPELL_SHADER.code).not.toMatch(/@group|@binding|@fragment/)
  expect(SPELL_SHADER.textures).toHaveLength(8)
})

test('changed or ambiguous preview boundaries stop generation', () => {
  expect(() => compile_spell_shader(FRAGMENT.replace('void dummy(', 'void renamed_dummy('))).toThrow('section changed')
  expect(() => compile_spell_shader(`${FRAGMENT}\nvoid dummy(`)).toThrow('section changed')
})

test('new references to removed preview helpers require an explicit integration update', () => {
  const changed = FRAGMENT.replace('  gl_FragColor =', '  box();\n  gl_FragColor =')
  expect(() => compile_spell_shader(changed)).toThrow('Preview shader dependencies remain')
})

test('unsupported shader input types fail asset generation', () => {
  expect(() => compile_spell_wgsl('uniform samplerCube unsupported;')).toThrow('Unsupported spell input')
})

const GAME_FRAGMENT = compile_spell_shader(FRAGMENT)

test('the approved source is preserved byte-for-byte and every original effect function remains', () => {
  const source = readFileSync(new URL('../../seed/content/spell_effects/source.html', import.meta.url), 'utf8')
  expect(createHash('sha256').update(source).digest('hex')).toBe(SOURCE_SHA256)
  expect(source).toContain(FRAGMENT)
  expect(reference.source_sha256).toBe(SOURCE_SHA256)
  expect(GAME_FRAGMENT).not.toMatch(/aresGame|\bdummy\s*\(|\bbox\s*\(|\bin_area\s*\(|\buCam\b|\buLook\b|\buDum2\b/)
  const integrated = new Set(['prj', 'box', 'in_area', 'spot', 'spot_on', 'ground', 'dummy', 'main'])
  for (const match of FRAGMENT.matchAll(/^(?:float|vec[234]|void) (\w+)\([^{}]*\{/gm)) {
    if (integrated.has(match[1])) continue
    let end = match.index + match[0].length
    let depth = 1
    while (depth > 0 && end < FRAGMENT.length) {
      depth += Number(FRAGMENT[end] === '{') - Number(FRAGMENT[end] === '}')
      end += 1
    }
    expect(depth).toBe(0)
    expect(GAME_FRAGMENT).toContain(FRAGMENT.slice(match.index, end))
  }
})
