// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

const engine_source = readFileSync(new URL('../../src/engine.js', import.meta.url), 'utf8')
const engine_src_dir = fileURLToPath(new URL('../../src/', import.meta.url))

function focus_ready_prewarm_block() {
  const start = engine_source.indexOf('[D221 —')
  const end = engine_source.indexOf('if (resident >= ring_total', start)
  if (start < 0 || end < 0) throw new Error('focus-ready pipeline prewarm block not found')
  return engine_source.slice(start, end)
}

function hack_mode_prewarm_block() {
  const start = engine_source.indexOf('function emit_hack_boot_signals')
  const end = engine_source.indexOf('async function init', start)
  if (start < 0 || end < 0) throw new Error('hack-mode pipeline prewarm block not found')
  return engine_source.slice(start, end)
}

/** Drops block + line comments so a source gate convicts CALL SITES, never prose about them. */
function strip_comments(/** @type {string} */ source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** @param {string} [dir] @param {string[]} [out] @returns {string[]} every .js file under engine/src */
function engine_sources(dir = engine_src_dir, out = /** @type {string[]} */ ([])) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) engine_sources(path, out)
    else if (entry.name.endsWith('.js')) out.push(path)
  }
  return out
}

describe('streaming pipeline prewarm integration', () => {
  test('WEBGPU DEPTH FLOOD — the post-stack warm renders once and never leaks PassNode compile state', () => {
    const source = strip_comments(focus_ready_prewarm_block())
    expect(source).toContain('rh?.render_frame?.()')
    expect(source).not.toContain('rh.post.compile(rh.renderer)')
  })

  // [#1869] Both pre-warms drive the LIVE frame path — renderer.js's render_frame is the one home for
  // "how this engine renders a frame", and it already falls back to the bare render when the post stack
  // degraded. The old `post ? post.render_frame() : renderer.compileAsync(scene, camera)` ternary sent
  // the DEGRADED boot warm through three's async compile instead.
  test('[#1869] the hack-mode pre-warm drives the live frame path, never an async compile', () => {
    const source = strip_comments(hack_mode_prewarm_block())
    expect(source).toContain('rh?.render_frame?.()')
    expect(source).not.toMatch(/compileAsync/)
  })

  // CLASS GATE — three only reaches `device.createRenderPipelineAsync` from `Renderer.compileAsync`
  // (PassNode.compileAsync forwards to it). That path binds a render target at the top and creates the
  // pipelines many awaits later, so a concurrent live frame can destroy the bound depth texture in
  // between; `getCurrentDepthStencilFormat` then answers undefined ⇒ "Async render pipeline creation
  // failed … 'format' … Required member is undefined". Zero call sites ⇒ the class is unreachable.
  test('[#1869] no engine source calls compileAsync — the async pipeline path is unreachable', () => {
    const offenders = engine_sources()
      .filter((path) => /\.compileAsync\s*(\?\.)?\s*\(/.test(strip_comments(readFileSync(path, 'utf8'))))
      .map((path) => path.slice(engine_src_dir.length))
    expect(offenders).toEqual([])
  })
})
