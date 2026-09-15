// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import { content_catalog } from '../../src/content/catalog.ts'
import { SpellCard } from '../../src/encyclopedia/SpellCard.tsx'
import { load_app_copy, spell_name } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

const locale = new URLSearchParams(location.search).get('locale') === 'fr' ? 'fr' : 'en'
const copy = await load_app_copy(locale)
dispatch_app({ type: 'locale/changed', locale })
dispatch_app({ type: 'locale/loaded', locale, copy })
const spell = content_catalog.spells.find(({ name }) => name === 'Critical Shooting')!
createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-bg p-6 text-text">
    <SpellCard spell={spell} display_name={spell_name(copy, spell.name)} />
  </main>
)
