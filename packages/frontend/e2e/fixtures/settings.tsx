// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { effective_flattened } from '@aresrpg/engine'

import { FpsPanel } from '../../src/components/FpsPanel.tsx'
import { load_game_settings } from '../../src/game/core/settings.ts'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import { dispatch_app, initialize_app_store, observe_app, useAppStore } from '../../src/store.ts'
import '../../src/tailwind.css'

// The real settings lifecycle and controls, without a renderer, wallet, or network observer.
initialize_app_store(load_game_settings('medium'))
observe_app(['settings'])
const backend = new URLSearchParams(location.search).has('fallback') ? 'grid' : 'webgpu'

const Fixture = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const settings = useAppStore((state) => state.settings)
  return (
    <main className="min-h-screen bg-bg p-6 font-mono text-text">
      <FpsPanel
        active={false}
        copy={copy}
        quality={settings.quality}
        flattened={effective_flattened(settings.flat_mode, backend)}
        flatten_locked={backend === 'grid'}
        fight_access={null}
        party_available={false}
        change_quality={(quality) => dispatch_app({ type: 'settings/changed', settings: { ...settings, quality } })}
        toggle_flattened={() =>
          dispatch_app({ type: 'settings/changed', settings: { ...settings, flat_mode: !settings.flat_mode } })
        }
        toggle_fight_access={() => {}}
      />
    </main>
  )
}

void load_app_copy('en')
  .then((copy) => createRoot(document.getElementById('root')!).render(<Fixture copy={copy} />))
  .catch((error: unknown) => console.error('Settings fixture failed.', error))
