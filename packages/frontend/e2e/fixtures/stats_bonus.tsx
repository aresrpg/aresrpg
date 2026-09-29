// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { item_stat_center } from '@aresrpg/immutable'

import StatsTab from '../../src/characters/StatsTab.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import { character } from '../../test/modules/automation_fixture.ts'
import '../../src/tailwind.css'

const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
createRoot(document.getElementById('root')!).render(
  <main
    style={{ position: 'fixed', inset: 0, container: 'aui-viewport / size', display: 'grid', placeItems: 'center' }}
  >
    <div className="game-character-window--stats">
      <StatsTab
        copy={copy}
        character={{
          ...character(),
          vitality: 1100,
          strength: 100,
          wisdom: 30,
          available_points: 12,
          folded_stats: {
            strength: item_stat_center + 857,
            wisdom: item_stat_center - 8,
            vitality: item_stat_center + 1500,
          },
        }}
        raise_stats={() => {}}
      />
    </div>
  </main>
)
