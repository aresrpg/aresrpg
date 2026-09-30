// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { InspectionWindow } from '../../src/components/ItemDetailView.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'
import '@aresrpg/ui/styles.css'

const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
createRoot(document.getElementById('root')!).render(
  <>
    <InspectionWindow
      entry={{ kind: 'item', id: 'water' }}
      props={{
        labels: { characteristics: 'Characteristics', damages: 'Damage', level_short: 'Lv. 1', range_to: 'to' },
      }}
      close={() => {}}
      open={() => () => {}}
    />
  </>
)
