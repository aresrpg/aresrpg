import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const engine_source = readFileSync(new URL('../engine.js', import.meta.url), 'utf8')

function focus_ready_prewarm_block() {
  const start = engine_source.indexOf('[D221 —')
  const end = engine_source.indexOf('if (resident >= ring_total', start)
  if (start < 0 || end < 0) throw new Error('focus-ready pipeline prewarm block not found')
  return engine_source.slice(start, end)
}

describe('streaming pipeline prewarm integration', () => {
  test('WEBGPU DEPTH FLOOD — the post-stack warm renders once and never leaks PassNode compile state', () => {
    const source = focus_ready_prewarm_block()
    expect(source).toContain('rh.post.render_frame()')
    expect(source).not.toContain('rh.post.compile(rh.renderer)')
  })
})
