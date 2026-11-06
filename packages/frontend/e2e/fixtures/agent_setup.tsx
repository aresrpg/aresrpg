// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AgentSetupButton } from '../../src/agents/AgentSetup.tsx'
import { CharacterTab } from '../../src/components/CharacterTab.tsx'
import { CharacterTabs } from '../../src/components/CharacterTabs.tsx'
import { adventure_character, adventure_companion } from '../../src/adventure/character.ts'
import { adventure_character_row } from '../../src/adventure/projection.ts'
import { load_app_copy, type AppCopy } from '../../src/i18n/copy.ts'
import '../../src/tailwind.css'

const rows = [adventure_character_row(adventure_character()), adventure_character_row(adventure_companion())]
const Fixture = ({ copy }: Readonly<{ copy: AppCopy }>) => {
  const [selected, select] = useState(rows[0]!.id)
  return (
    <main className="min-h-screen bg-bg p-4 text-text">
      <AgentSetupButton copy={copy} />
      <div className="mt-8">
        <CharacterTabs
          characters={rows}
          copy={copy}
          selected_character_id={selected}
          select_character={select}
          create_character={() => undefined}
        />
      </div>
      <section className="mt-12" data-ornament-specimens="">
        <p>Presentation specimens only — no connected agents or delegated characters.</p>
        <div className="character-tabs mt-4">
          <CharacterTab
            character={rows[0]!}
            selected
            agent={{ status: 'agent', label: 'Agent controlled · read-only specimen' }}
          />
          <CharacterTab
            character={rows[1]!}
            agent={{ status: 'recall', label: 'Recall pending · read-only specimen' }}
          />
        </div>
      </section>
    </main>
  )
}
void load_app_copy('en')
  .then((copy) => {
    createRoot(document.getElementById('root')!).render(<Fixture copy={copy} />)
  })
  .catch(console.error)
