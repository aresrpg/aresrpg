// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import SettingsPage from '../../src/settings/SettingsPage.tsx'
import { dispatch_app, observe_app, read_app_state } from '../../src/store.ts'

import '../../src/tailwind.css'

// Synthetic wallet effects only. This fixture never registers a wallet or submits a transaction.
const locale = LOCALES.find(({ code }) => code === new URLSearchParams(location.search).get('locale'))?.code ?? 'en'
const copy = await load_app_copy(locale)
let writes = 0
dispatch_app({ type: 'locale/loaded', locale, copy })
dispatch_app({ type: 'auth/connecting' })
dispatch_app({
  type: 'auth/connected',
  session: {
    address: '0x1',
    suins: {
      snapshot: async () => ({ default_name: null, names: [{ name: 'mine.sui', object_id: '0x2', subname: false }] }),
      set_default: async (name: string) => {
        writes += 1
        document.body.dataset.nameWrites = String(writes)
        await new Promise((resolve) => setTimeout(resolve, 200))
        return name === 'foreign.sui'
          ? { ok: false, reason: 'not_targeted' }
          : { ok: true, name: name === 'sceat@sceat' ? 'sceat.sceat.sui' : name, digest: 'fixture-only' }
      },
    },
  } as never,
})
observe_app(['suins'])
dispatch_app({ type: 'page/open', page: 'settings' })
createRoot(document.getElementById('root')!).render(<SettingsPage copy={copy} settings={read_app_state().settings} />)
