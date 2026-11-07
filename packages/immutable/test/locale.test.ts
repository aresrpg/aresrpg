// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { allocation_locale, notification_locale } from '../src/locale.ts'

test('backend locale projections include only the fields their consumers use', () => {
  const document = {
    allocation_page: { title: 'Allocation' },
    discord_marketplace: { title: 'Market' },
    simulator_page: { stat_health: 'Health', unused_label: 'Browser only' },
    ui: { agent_pair_no_assets: 'Browser only' },
  }
  expect(allocation_locale(document)).toEqual({ title: 'Allocation' })
  expect(notification_locale(document)).toEqual({ copy: { title: 'Market' }, stats: { health: 'Health' } })
})

test('Bun merge aliases and duplicate keys have the same projection in runtime and release planning', () => {
  const document = Bun.YAML.parse(`copy: &copy
  title: Original
allocation_page:
  <<: *copy
discord_marketplace:
  title: Shadowed
  title: Actual
simulator_page:
  stat_health: Health
`) as Parameters<typeof notification_locale>[0] & { allocation_page: { title: string } }
  expect(allocation_locale(document)).toEqual({ title: 'Original' })
  expect(notification_locale(document)).toEqual({ copy: { title: 'Actual' }, stats: { health: 'Health' } })
})
