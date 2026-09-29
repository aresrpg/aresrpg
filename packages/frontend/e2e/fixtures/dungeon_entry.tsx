// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { DungeonPortalPrompt } from '../../src/components/DungeonPortalPrompt.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { publish_dungeon_portal_prompt } from '../../src/game/core/dungeon_portal_feed.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app, initialize_app_store } from '../../src/store.ts'
import { character } from '../../test/modules/automation_fixture.ts'
import '../../src/tailwind.css'

initialize_app_store({ quality: 'high', music_enabled: false, render_distance: 2 })
const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character()] } })
dispatch_app({ type: 'character/select', character_id: 'alice' })
const portal = { id: 'gate', world: 'nauvis', city: 'thebes', dungeon: 'gilded_lorito', x: 512, z: 0, zx: 98, zz: 97 }
const dungeon = content_catalog.dungeon(portal.dungeon)!
publish_dungeon_portal_prompt({
  roots: { gate: document.getElementById('prompt')! },
  portals: { gate: portal },
  focused_id: 'gate',
  speak: (_id, speech) => {
    document.getElementById('speech')!.textContent = speech ?? ''
  },
})
const grant_key = () =>
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/inventory',
      items: [
        {
          id: 'key',
          item_type: dungeon.key,
          name: content_catalog.item(dungeon.key)!.item.name,
          category: 'key',
          level: 1,
          kiosk: 'kiosk',
          amount: 1,
        },
      ],
    },
  })
createRoot(document.getElementById('root')!).render(
  <>
    <button onClick={grant_key} type="button">
      Give required key
    </button>
    <DungeonPortalPrompt copy={copy} />
  </>
)
