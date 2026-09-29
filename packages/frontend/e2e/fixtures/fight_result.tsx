// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'

import { create_app, dispatch_app } from '../../src/store.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import EquipmentTab from '../../src/characters/EquipmentTab.tsx'
import { ADVENTURE_INVENTORY, adventure_character_row } from '../../src/adventure/projection.ts'
import '../../src/characters/characters.css'
import { adventure_result } from '../../src/adventure/result.ts'
import { ADVENTURE_ITEMS, ADVENTURE_PET_ITEM, ADVENTURE_MOBS, adventure_item } from '../../src/adventure/content.ts'
import { MobDetailsDialog } from '../../src/game/hud/MobDetailsDialog.tsx'
import { CharacterLevelUpView } from '../../src/game/fight/CharacterLevelUpView.tsx'
import { FightResultCard } from '../../src/game/fight/FightResultCard.tsx'
import '../../src/tailwind.css'
import '@aresrpg/ui/styles.css'

const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
const app = create_app()
const stop = app.observe(['adventure', 'fight'])
app.dispatch({ type: 'adventure/entered' })
app.dispatch({ type: 'adventure/challenge' })
const state = app.store.getState(),
  checkpoint = state.fight.checkpoint!
const result = adventure_result(
  state,
  { ...checkpoint, contract: { ...checkpoint.contract, winner: 0n, ended: true, ended_ms: 10000n } },
  199
)
stop()
const Fixture = () => {
  const [open, set_open] = useState(true)
  if (new URLSearchParams(location.search).has('mob'))
    return (
      <LocaleScope locale="en">
        <MobDetailsDialog
          mob={ADVENTURE_MOBS[0]!}
          item_for={adventure_item}
          copy={copy}
          close={() => set_open(false)}
        />
      </LocaleScope>
    )
  if (new URLSearchParams(location.search).has('level'))
    return (
      <LocaleScope locale="en">
        <CharacterLevelUpView
          copy={copy}
          name="Senshi"
          classe="senshi"
          before={198}
          after={199}
          close={() => set_open(false)}
        />
      </LocaleScope>
    )
  if (new URLSearchParams(location.search).has('equipment'))
    return (
      <LocaleScope locale="en">
        <main className="game-character-body" style={{ position: 'fixed', inset: 0 }}>
          <EquipmentTab
            copy={copy}
            character={adventure_character_row({ ...state.adventure.character!, level: 199 })}
            session={{ inventory: ADVENTURE_INVENTORY, commit: () => undefined, raise_stats: () => undefined }}
          />
        </main>
      </LocaleScope>
    )
  return (
    <LocaleScope locale="en">
      {open ? (
        <FightResultCard
          copy={copy}
          result={result}
          items={[...ADVENTURE_ITEMS, ADVENTURE_PET_ITEM]}
          on_close={() => set_open(false)}
        />
      ) : (
        <p>Closed</p>
      )}
    </LocaleScope>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
