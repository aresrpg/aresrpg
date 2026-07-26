// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-SEARCH EFFECT EDGE — the driven unit gate for `perform`, the one function that turns a fold command row
// into a world effect (#1106). Headless: the sfx module is spied so the AUDIBLE half of a find is observable
// without a browser, and the command rows are hand-built exactly as the fold emits them.

import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

import * as sfx from '../core/audio/sfx.js'

const alarm = spyOn(sfx, 'play_fight_sfx').mockImplementation(() => {})

const { perform } = await import('./auto_search_adapter.js')

const name_of = (id) => id

describe('the find is AUDIBLE — an AFK player is summoned back by a soft alarm', () => {
  beforeEach(() => alarm.mockClear())

  test('a found row sounds the alarm exactly once', () => {
    perform({ seq: 1, kind: 'found', template_id: 'mob_a', name: 'Sewer Rat', x: 10, z: 0 }, name_of)
    expect(alarm).toHaveBeenCalledTimes(1)
    expect(alarm.mock.calls[0][0]).toBe('warn') // the registry's only restrained ATTENTION cue
  })

  test('the scouting beats stay silent — only the find speaks', () => {
    perform({ seq: 1, kind: 'walk', x: 0, z: 0 }, name_of)
    perform({ seq: 2, kind: 'approach', x: 0, z: 0, template_id: 'mob_a', name: 'Sewer Rat' }, name_of)
    perform({ seq: 3, kind: 'halt' }, name_of)
    expect(alarm).not.toHaveBeenCalled()
  })
})
