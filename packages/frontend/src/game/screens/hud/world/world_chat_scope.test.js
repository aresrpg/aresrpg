import { describe, expect, it } from 'bun:test'

import { chat_line_in_scope } from './world_chat_scope.js'

const channels = { group: 'group', combat: 'combat' }

describe('fight chat scope', () => {
  it('keeps client-local combat lines visible inside a dungeon despite having no peer state', () => {
    expect(chat_line_in_scope({ channel: 'combat' }, channels, 'fight-dungeon', null)).toBe(true)
  })

  it('keeps the same existing general log while a fight is active', () => {
    expect(chat_line_in_scope({ channel: 'general' }, channels, 'fight-dungeon', null, true)).toBe(true)
  })

  it('retains peer instance scoping for ordinary world lines', () => {
    expect(chat_line_in_scope({ channel: 'general' }, channels, 'mine', 'mine')).toBe(true)
    expect(chat_line_in_scope({ channel: 'general' }, channels, 'mine', 'theirs')).toBe(false)
  })

  it('keeps own and party lines across instance boundaries', () => {
    expect(chat_line_in_scope({ channel: 'general', from_me: true }, channels, 'mine', 'theirs')).toBe(true)
    expect(chat_line_in_scope({ channel: 'group' }, channels, 'mine', 'theirs')).toBe(true)
  })
})
