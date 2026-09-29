// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import { PlayerContextMenu } from '../../src/components/PlayerContextMenu.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

const copy = await load_app_copy('en')
createRoot(document.getElementById('root')!).render(
  <>
    <button
      style={{ position: 'fixed', right: 0, bottom: 0 }}
      onClick={(event) =>
        dispatch_app({
          type: 'world/player_menu',
          menu: {
            character_id: 'target',
            name: 'lgctaffa',
            owner: '0xtarget',
            source: 'chat',
            x: event.clientX,
            y: event.clientY,
          },
        })
      }
    >
      lgctaffa
    </button>
    <PlayerContextMenu copy={copy} />
  </>
)
