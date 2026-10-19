// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { spell_gl_program } from './fixtures/spell_gl_reference.ts'

const compiler = () => {
  let complete = false
  let linked = true
  const calls: string[] = []
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    LINK_STATUS: 3,
    ACTIVE_UNIFORMS: 4,
    createProgram: () => ({}),
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => calls.push('compile'),
    attachShader: () => {},
    deleteShader: () => calls.push('delete shader'),
    bindAttribLocation: () => {},
    linkProgram: () => calls.push('link'),
    getExtension: () => ({ COMPLETION_STATUS_KHR: 5 }),
    isContextLost: () => false,
    getProgramParameter: (_program: unknown, parameter: number) => {
      if (parameter === 5) return complete
      calls.push('blocking query')
      if (!complete) throw new Error('Queried a shader before the driver finished')
      return parameter === 3 ? linked : 0
    },
    getProgramInfoLog: () => 'invalid shader',
    getShaderParameter: () => {
      throw new Error('Shader status must not serialize parallel compilation')
    },
    deleteProgram: () => calls.push('delete program'),
  }
  return {
    gl: gl as unknown as WebGLRenderingContext,
    calls,
    finish: (success = true) => {
      complete = true
      linked = success
    },
  }
}

test('shader preparation yields until parallel linking finishes before querying uniforms', async () => {
  const driver = compiler()
  const pending = spell_gl_program(driver.gl, 'vertex', 'fragment')
  expect(driver.calls).toEqual(['compile', 'compile', 'link'])
  driver.finish()
  const program = await pending
  expect(driver.calls.filter((call) => call === 'blocking query')).toHaveLength(2)
  program.dispose()
  expect(driver.calls.filter((call) => call === 'delete shader')).toHaveLength(2)
  expect(driver.calls.filter((call) => call === 'delete program')).toHaveLength(1)
})

test('failed shader preparation releases its program and both shaders', async () => {
  const driver = compiler()
  driver.finish(false)
  await expect(spell_gl_program(driver.gl, 'vertex', 'fragment')).rejects.toThrow('invalid shader')
  expect(driver.calls.filter((call) => call === 'delete shader')).toHaveLength(2)
  expect(driver.calls.filter((call) => call === 'delete program')).toHaveLength(1)
})

test('disposing during parallel compilation cancels preparation and releases GPU handles', async () => {
  const driver = compiler()
  const lifetime = new AbortController()
  const pending = spell_gl_program(driver.gl, 'vertex', 'fragment', lifetime.signal)
  lifetime.abort(new Error('world disposed'))
  await expect(pending).rejects.toThrow('world disposed')
  expect(driver.calls).not.toContain('blocking query')
  expect(driver.calls.filter((call) => call === 'delete shader')).toHaveLength(2)
  expect(driver.calls.filter((call) => call === 'delete program')).toHaveLength(1)
})
