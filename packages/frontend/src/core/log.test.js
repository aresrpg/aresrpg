import { afterEach, describe, expect, it, mock } from 'bun:test'

import { game_log, log, get_log_buffer, set_breadcrumb_sink, is_debug, _reset_log_for_test } from './log.js'

afterEach(() => _reset_log_for_test())

describe('game_log ring buffer', () => {
  it('keeps the last 50 entries, oldest dropped', () => {
    for (let i = 0; i < 60; i++) game_log('test', `entry ${i}`)
    const buf = get_log_buffer()
    expect(buf.length).toBe(50)
    expect(buf[0].message).toBe('entry 10')
    expect(buf[49].message).toBe('entry 59')
  })

  it('stamps namespace + timestamp on every entry', () => {
    const before = Date.now()
    game_log('gas-guard', 'refused')
    const [e] = get_log_buffer()
    expect(e.ns).toBe('gas-guard')
    expect(e.message).toBe('refused')
    expect(e.t).toBeGreaterThanOrEqual(before)
  })

  it('stringifies objects/Errors safely — never [object Object]', () => {
    game_log('tx', 'failed', { digest: '0xabc' }, new Error('boom'), 42, undefined)
    const [e] = get_log_buffer()
    expect(e.message).toContain('{"digest":"0xabc"}')
    expect(e.message).toContain('Error: boom')
    expect(e.message).toContain('42')
    expect(e.message).not.toContain('[object Object]')
  })

  it('caps a single entry so a huge payload can never balloon the buffer', () => {
    game_log('DNG', 'x'.repeat(2000))
    expect(get_log_buffer()[0].message.length).toBeLessThanOrEqual(501)
  })

  it('get_log_buffer returns a copy (mutation-safe)', () => {
    game_log('a', 'one')
    get_log_buffer().pop()
    expect(get_log_buffer().length).toBe(1)
  })

  it('the log() curry binds the namespace', () => {
    log('join')('roster loaded', 3)
    expect(get_log_buffer()[0]).toMatchObject({ ns: 'join', message: 'roster loaded 3' })
  })
})

describe('breadcrumb sink forwarding', () => {
  it('hands every entry to the registered sink', () => {
    const sink = mock(() => {})
    set_breadcrumb_sink(sink)
    game_log('join', 'player joined', 7)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0]).toMatchObject({ ns: 'join', message: 'player joined 7' })
  })

  it('a throwing sink never breaks the log call (and the buffer still records)', () => {
    set_breadcrumb_sink(() => {
      throw new Error('sink exploded')
    })
    expect(() => game_log('cave', 'entered')).not.toThrow()
    expect(get_log_buffer()[0].message).toBe('entered')
  })

  it('a null sink detaches cleanly', () => {
    const sink = mock(() => {})
    set_breadcrumb_sink(sink)
    set_breadcrumb_sink(null)
    game_log('x', 'y')
    expect(sink).not.toHaveBeenCalled()
  })
})

describe('player-silent console', () => {
  it('debug is off under a non-dev, no-window run — console stays silent', () => {
    expect(is_debug()).toBe(false)
    const spy = mock(() => {})
    const orig = console.info
    console.info = spy
    try {
      game_log('voxel', 'should not print')
    } finally {
      console.info = orig
    }
    expect(spy).not.toHaveBeenCalled()
    expect(get_log_buffer().length).toBe(1) // buffered regardless of verbosity
  })
})
