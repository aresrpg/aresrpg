// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, CombatHud } from '@aresrpg/ui'

import { ModalFrame } from '../../src/components/ModalFrame.tsx'
import { load_game_settings } from '../../src/game/core/settings.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { dispatch_app, initialize_app_store, observe_app, useAppStore } from '../../src/store.ts'
import { CraftFailureNotice } from '../../src/tutorial/CraftFailureNotice.tsx'
import { completed_tutorials_from } from '../../src/tutorial/tutorial.ts'
import '../../src/tailwind.css'
import '@aresrpg/ui/styles.css'

const copy = await load_app_copy('en')
initialize_app_store(load_game_settings('medium', null))
observe_app(['settings'])
const fail = (digest: string) =>
  dispatch_app({
    type: 'character/crafted',
    digest,
    successes: 0,
    attempts: 1,
    output_type: 'old_hoe',
    character_id: 'fixture',
    job: 'HANDYMAN',
    xp: 10,
  })
const Fixture = () => {
  const settings = useAppStore(({ settings }) => settings)
  const [overworld, set_overworld] = useState(true)
  const [menu, set_menu] = useState(false)
  return (
    <LocaleScope locale="en">
      <main className="min-h-screen space-y-4 bg-[#15101f] p-8 text-white">
        <h1>Feedback guidance</h1>
        <p>{overworld ? 'Overworld active' : 'Combat active'}</p>
        <Button onClick={() => set_overworld(!overworld)}>Toggle combat</Button>
        <Button onClick={() => set_menu(true)}>Open menu</Button>
        <Button onClick={() => fail('first')}>Fail craft</Button>
        <Button onClick={() => fail('second')}>Fail another craft</Button>
        <Button
          onClick={() => dispatch_app({ type: 'settings/changed', settings: { ...settings, completed_tutorials: [] } })}
        >
          Reset tutorials
        </Button>
        <output>{settings.completed_tutorials?.join(', ')}</output>
        <CombatHud
          label="Combat preview"
          vitals={null}
          spells={null}
          controls={null}
          timer={{ label: copy.fight_hud.end_turn!, remaining: 0, duration: 45, hint: copy.fight_hud.turn_timer_hint }}
        />
        <CraftFailureNotice
          copy={copy}
          completed={completed_tutorials_from(settings.completed_tutorials).includes('craft_failure')}
          complete={() =>
            dispatch_app({
              type: 'settings/changed',
              settings: {
                ...settings,
                completed_tutorials: [...completed_tutorials_from(settings.completed_tutorials), 'craft_failure'],
              },
            })
          }
          available={overworld}
        />
        {menu && (
          <ModalFrame label="Fixture menu" close={() => set_menu(false)} close_label="Close menu">
            <p>Guidance waits behind this menu.</p>
          </ModalFrame>
        )}
      </main>
    </LocaleScope>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
