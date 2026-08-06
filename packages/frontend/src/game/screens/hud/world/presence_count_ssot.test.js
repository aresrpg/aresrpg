// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { fileURLToPath } from 'node:url'
import { relative } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { select_observed_count } from '../../../core/presence_count.js'
import { production_source_paths } from '../../../../test_helpers/production_source_paths.js'

const WORLD_CHAT = new URL('./WorldChat.jsx', import.meta.url)
const FRIENDS_PANEL = new URL('./OnlinePlayers.jsx', import.meta.url)
const FRONTEND_SRC = fileURLToPath(new URL('../../../../', import.meta.url))

const source = (url) => Bun.file(url).text()
// The SSOT claim concerns code that can ship. Colocated tests and test_helpers cannot render an aggregate count,
// so excluding them bounds this contention-sensitive scan from 1,236 files to the production surface alone.
const SOURCE_PATHS = production_source_paths(FRONTEND_SRC)

describe('aggregate observation count SSOT', () => {
  test('chat selector counts peer observations plus self', () => {
    expect(select_observed_count({ observed_peers: new Map() })).toBe(1)
    expect(
      select_observed_count({
        observed_peers: new Map([
          ['peer-a', {}],
          ['peer-b', {}],
        ]),
      })
    ).toBe(3)
  })

  // It counts OBSERVATIONS, so it reads the observations home alone. My own party followers used to land in
  // the same Map and silently inflate this number into a claim about how many players were around — the
  // realtime constitution's advisory-only law, broken by a count (they now live in owned_follow_render_rows).
  test('my own followers never inflate the observation count', () => {
    const state = {
      observed_peers: new Map([['peer-a', {}]]),
      owned_follow_render_rows: new Map([
        ['alt-1', {}],
        ['alt-2', {}],
      ]),
    }
    expect(select_observed_count(state)).toBe(2)
  })

  test('only WorldChat reads and displays an aggregate observation count', async () => {
    expect(SOURCE_PATHS.length).toBeGreaterThan(500) // still a frontend-wide production scan, not a hand-picked list
    const [chat, friends, ...sources] = await Promise.all([
      source(WORLD_CHAT),
      source(FRIENDS_PANEL),
      ...SOURCE_PATHS.map(source),
    ])
    const aggregate_reads = SOURCE_PATHS.flatMap((path, index) =>
      (sources[index].match(/observed_peers\??\.size/g) ?? []).map(() => relative(FRONTEND_SRC, path))
    )

    expect(aggregate_reads).toEqual(['game/core/presence_count.js'])
    expect(chat).toContain('useGameState(select_observed_count)')
    expect(chat).toContain('use_presence((state) => state.link_status)')
    expect(chat).toContain('world_chat.link_${link_status}')
    expect(chat).toContain('<b>{observed_count}</b>')
    expect(friends).not.toContain('party.online_here')
    expect(friends).not.toContain('gw-players__fcount')
  })
})
