// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { MobsTab } from '../../src/encyclopedia/MobsTab.tsx'

test('mob browser exposes its search and authored catalogue', () => {
  const [mob] = encyclopedia_catalog.mobs
  const html = renderToStaticMarkup(
    <MobsTab
      select_item={() => undefined}
      select_mob={() => undefined}
      selected_id={mob?.mob_type ?? null}
      select_world={() => undefined}
      text={(key) => key}
    />
  )
  expect(html).toContain('type="search"')
  if (mob) expect(html).toContain(mob.name)
})
