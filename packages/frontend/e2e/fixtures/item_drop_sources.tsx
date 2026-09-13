// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { ItemContentEditor } from '../../src/editor/ItemContentEditor.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

const Fixture = () => {
  const [item_type, select] = useState('water')
  return (
    <main className="min-h-screen bg-bg p-6 font-mono text-white">
      <nav className="flex gap-4 text-xs">
        <button onClick={() => select('water')}>Water</button>
        <button onClick={() => select('wheat')}>Wheat</button>
        <button
          onClick={() =>
            dispatch_app({
              type: 'editor/value_changed',
              domain: 'mobs',
              path: [0, 'loot', 0, 'chance_bp'],
              value: 7500,
            })
          }
        >
          Change draft rate
        </button>
      </nav>
      <ItemContentEditor
        value={{ item_type, name: item_type === 'water' ? 'Water' : 'Wheat', category: 'resource', level: 1 }}
        on_change={() => {}}
        is_readonly={() => true}
        item_recipe={{ value: null, change: () => {}, category_changed: () => {}, create: () => {}, remove: () => {} }}
      />
    </main>
  )
}
const boot = async () => {
  const requested = new URLSearchParams(location.search).get('locale')
  const locale = LOCALES.find(({ code }) => code === requested)?.code ?? 'en'
  dispatch_app({ type: 'locale/changed', locale })
  dispatch_app({ type: 'locale/loaded', locale, copy: await load_app_copy(locale) })
  dispatch_app({ type: 'editor/load' })
  dispatch_app({
    type: 'editor/loaded',
    token: '',
    validation: { reds: [], warns: [] },
    files: [
      {
        file: 'mobs.json',
        revision: 'fixture',
        value: [
          {
            mob_type: 'nook',
            name: 'Nook',
            level_min: 1,
            level_max: 5,
            loot: [{ item_type: 'water', chance_bp: 1234, min_qty: 1, max_qty: 3 }],
          },
          {
            mob_type: 'tinker',
            name: 'Tinker',
            level_min: 5,
            level_max: 10,
            loot: [{ item_type: 'water', chance_bp: 10000, min_qty: 2, max_qty: 2 }],
          },
        ],
      },
    ],
  })
  createRoot(document.getElementById('root')!).render(<Fixture />)
}
void boot().catch(console.error)
