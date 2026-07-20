// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { select_online_count } from '../../../core/presence_count.js'

const WORLD_CHAT = new URL('./WorldChat.jsx', import.meta.url)
const FRIENDS_PANEL = new URL('./OnlinePlayers.jsx', import.meta.url)
const FRONTEND_SRC = fileURLToPath(new URL('../../../../', import.meta.url))

const source = (url) => readFileSync(url, 'utf8')
const source_paths = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return source_paths(path)
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [path] : []
  })

describe('aggregate presence count SSOT', () => {
  test('chat selector counts p2p peers plus self', () => {
    expect(select_online_count({ visible_characters: new Map() })).toBe(1)
    expect(select_online_count({ visible_characters: new Map([['peer-a', {}], ['peer-b', {}]]) })).toBe(3)
  })

  test('only WorldChat reads and displays an aggregate presence count', () => {
    const chat = source(WORLD_CHAT)
    const friends = source(FRIENDS_PANEL)
    const aggregate_reads = source_paths(FRONTEND_SRC).flatMap((path) =>
      (source(path).match(/visible_characters\??\.size/g) ?? []).map(() => relative(FRONTEND_SRC, path))
    )

    expect(aggregate_reads).toEqual(['game/core/presence_count.js'])
    expect(chat).toContain('use_game_state(select_online_count)')
    expect(chat).toContain('<b>{online_count}</b>')
    expect(friends).not.toContain('party.online_here')
    expect(friends).not.toContain('gw-players__fcount')
  })
})
