// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { item_stat_center } from '@aresrpg/immutable'

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
import { content_catalog } from '../../src/content/catalog.ts'
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
const preview_result = adventure_result(
  state,
  { ...checkpoint, contract: { ...checkpoint.contract, winner: 0n, ended: true, ended_ms: 10000n } },
  199
)
stop()
const rolled = new URLSearchParams(location.search).has('rolled')
const character = adventure_character_row(state.adventure.character!)
const seed = content_catalog.item('gravebrand')!.item
const received = [
  { id: 'old-sword', strength: 99, agility: 99 },
  { id: 'new-sword-a', strength: 2, agility: 4 },
  { id: 'new-sword-b', strength: 5, agility: 1 },
].map(({ id, strength, agility }) => ({
  id,
  item_type: seed.item_type,
  name: seed.name,
  category: seed.category,
  level: seed.level,
  amount: 1,
  kiosk: character.kiosk,
  stats: { strength: item_stat_center + strength, agility: item_stat_center + agility },
  damages: [...(seed.damages ?? [])],
}))
const result = rolled
  ? {
      ...preview_result,
      loot_item_ids: ['new-sword-a', 'new-sword-b'],
      participants: preview_result.participants.map((participant) => ({
        ...participant,
        loot: participant.character_id === character.id ? [{ item_type: seed.item_type, qty: 2 }] : [],
      })),
    }
  : preview_result
if (rolled) {
  dispatch_app({ type: 'server/packet', packet: { type: 'packet/characters', characters: [character] } })
  dispatch_app({
    type: 'server/packet',
    packet: {
      type: 'packet/inventory',
      items: new URLSearchParams(location.search).has('pending') ? received.slice(0, 1) : received,
    },
  })
  window.addEventListener('fixture-loot-arrived', () =>
    dispatch_app({ type: 'server/packet', packet: { type: 'packet/inventory', items: received } })
  )
}
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
