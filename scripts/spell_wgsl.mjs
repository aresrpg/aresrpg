// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Compile at asset generation time. The browser receives native WGSL, never a compiler.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const TYPES = {
  float: 'f32',
  int: 'i32',
  bool: 'bool',
  vec2: 'vec2<f32>',
  vec3: 'vec3<f32>',
  vec4: 'vec4<f32>',
  mat4: 'mat4x4<f32>',
}

const explicit_lod = (source) => {
  let offset = 0
  while ((offset = source.indexOf('texture2D(', offset)) >= 0) {
    let end = offset + 'texture2D('.length
    let depth = 1
    while (depth && end < source.length) {
      depth += Number(source[end] === '(') - Number(source[end] === ')')
      end += 1
    }
    if (depth) throw new Error('Unclosed spell texture lookup')
    const arguments_text = source.slice(offset + 10, end - 1)
    const separator = arguments_text.indexOf(',')
    const name = arguments_text.slice(0, separator).trim()
    const point = arguments_text.slice(separator + 1).trim()
    const coordinate = ['aresScene', 'aresActors', 'aresOriginal'].includes(name)
      ? `vec2((${point}).x, 1. - (${point}).y)`
      : point
    const lookup = ['aresActors', 'aresCells'].includes(name)
      ? `texelFetch(${name}, clamp(ivec2((${coordinate}) * vec2(textureSize(${name}, 0))), ivec2(0), textureSize(${name}, 0) - 1), 0)`
      : `textureLod(${name}, ${coordinate}, 0.)`
    source = source.slice(0, offset) + lookup + source.slice(end)
    offset += lookup.length
  }
  return source
}

export const compile_spell_wgsl = (fragment) => {
  const uniforms = []
  const textures = []
  let binding = 0
  const source = explicit_lod(
    fragment.replace(/precision highp float;/u, '').replace(/uniform (\w+) ([^;]+);/gu, (_, type, names) =>
      names
        .split(',')
        .map((declaration) => {
          const name = declaration.trim()
          if (type === 'sampler2D') {
            textures.push(name)
            return `layout(set=0,binding=${binding++}) uniform texture2D ${name}_texture;\nlayout(set=0,binding=${binding++}) uniform sampler ${name}_sampler;\n#define ${name} sampler2D(${name}_texture, ${name}_sampler)\n`
          }
          if (!TYPES[type]) throw new Error(`Unsupported spell input: ${type}`)
          uniforms.push({ name: name.replace(/\[.*\]/u, ''), type, count: Number(name.match(/\[(\d+)\]/u)?.[1] ?? 1) })
          return `${type} ${name};`
        })
        .join('\n')
    )
  ).replaceAll('gl_FragColor', 'out_color')
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'ares-spell-'))
  let wgsl
  try {
    writeFileSync(join(directory, 'spell.frag'), '#version 450\nlayout(location=0) out vec4 out_color;\n' + source)
    execFileSync(
      'node',
      [
        '--disable-warning=ExperimentalWarning',
        require.resolve('naga-wasi-cli/bin/naga.mjs'),
        '--input-kind',
        'glsl',
        '--shader-stage',
        'frag',
        '--compact',
        'spell.frag',
        'spell.wgsl',
      ],
      { cwd: directory, stdio: 'pipe' }
    )
    wgsl = readFileSync(join(directory, 'spell.wgsl'), 'utf8')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  // Three owns resource bindings. Turn compiler resource globals into ordinary function parameters.
  const resources = []
  wgsl = wgsl.replace(/@group\(0\) @binding\(\d+\)\s+var (\w+): ([^;]+);/gu, (_, name, type) => {
    if (!['aresActors_sampler', 'aresCells_sampler'].includes(name)) resources.push({ name, type })
    return ''
  })
  const entry = wgsl.match(
    /@fragment\s+fn main\(@builtin\(position\) gl_FragCoord: vec4<f32>\) -> FragmentOutput \{\s*(\w+) = gl_FragCoord;\s*(\w+)\(\);[^]*$/u
  )
  if (!entry) throw new Error('Naga spell entry point changed')
  const [, position, main] = entry
  wgsl = wgsl.slice(0, entry.index).replace(/struct FragmentOutput \{[^}]+\}/u, '')
  const functions = [...wgsl.matchAll(/\bfn (\w+)\(/gu)].map((match) => match[1])
  const arguments_list = resources.map(({ name }) => name).join(', ')
  const parameters = resources.map(({ name, type }) => `${name}: ${type}`).join(', ')
  for (const name of functions) {
    wgsl = wgsl.replace(
      new RegExp(`\\b${name}\\(([^)]*)\\)`, 'gu'),
      (_, args) => `${name}(${arguments_list}${args.trim() ? ', ' + args : ''})`
    )
    wgsl = wgsl.replace(`fn ${name}(${arguments_list}`, `fn ${name}(${parameters}`)
  }
  const inputs = uniforms.flatMap(({ name, type, count }) =>
    Array.from({ length: count }, (_, index) => ({
      name: count === 1 ? name : `${name}_${index}`,
      type,
      source: name,
      index,
      count,
    }))
  )
  const assignments = uniforms.map(({ name, count }) => {
    const actual = wgsl.match(new RegExp(`var<private> (${name}_*):`))?.[1]
    if (!actual) throw new Error(`Missing compiled spell input: ${name}`)
    const value =
      count === 1
        ? `input_${name}`
        : `array(${Array.from({ length: count }, (_, index) => `input_${name}_${index}`).join(', ')})`
    return `${actual} = ${value};`
  })
  const signature = [
    ...inputs.map(({ name, type }) => `input_${name}: ${TYPES[type]}`),
    `pixel: vec4<f32>`,
    parameters,
  ].join(', ')
  const code = `fn spell_effect(${signature}) -> vec4<f32> {\n${assignments.join('\n')}\n${position} = pixel;\n${main}(${arguments_list});\nreturn out_color;\n}\n${wgsl}`
  return { code, inputs, textures }
}
