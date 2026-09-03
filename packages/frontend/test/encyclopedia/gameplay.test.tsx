// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { GameplayTab } from '../../src/encyclopedia/GameplayTab.tsx'
import { encyclopedia_text } from '../../src/encyclopedia/copy.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'

test('gameplay explains the chain Retro XP law and its six-player coefficient', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(<GameplayTab text={encyclopedia_text(copy)} />)

  expect(html).toContain('base-XP pool')
  expect(html).toContain('player level / party level')
  expect(html).toContain('×3.6')
  expect(html).toContain('Every point of effective Wisdom')
  expect(html).toContain('active effects, adds 1%')
  expect(html).toContain('(100 + WIS) / 100')
  expect(html).not.toContain('(600 + WIS) / 600')
  expect(html).not.toContain('splits evenly')
  expect(html).toContain('60% to 160%')
  expect(html).toContain('Negative resistance reverses that curve')
  expect(html).toContain('Each active fighter turn has its own cap')
  expect(html).toContain('Player-sourced damage and its cap are halved')
  expect(html).toContain('Ares does not use erosion')
  expect(html).toContain('80% to 120%')
  expect(html).toContain('including active effects')
  expect(html).toContain('(600 + average team Chance) / 600')
  expect(html).toContain('one shared loot roll')
  expect(html).not.toContain('700 Chance')
  expect(html).toContain('Each dungeon has one live staging lobby')
  expect(html).toContain('Dungeon lobby with public or group fights')
  expect(html).not.toContain('not playable yet')
  expect(html).not.toContain('converge')
  expect(html).not.toContain('from anywhere in the world')
  expect(html).toContain('100 − min(RES, 50)')
})
