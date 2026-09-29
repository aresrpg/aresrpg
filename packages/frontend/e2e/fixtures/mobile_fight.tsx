// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'
import { create_character_source, create_fight } from '@aresrpg/fight'

import { catalog_spell_sources } from '../../src/content/fight_sources.ts'
import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { TouchFightConfirmation } from '../../src/game/fight/TouchFightConfirmation.tsx'
import { FightHud } from '../../src/game/fight/FightHud.tsx'
import { FightTurnCard } from '../../src/game/fight/FightTurnCard.tsx'
import { select_fight_view } from '../../src/game/fight/fight_projection.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'
import '../../../mobile/src/mobile.css'

const copy = await load_app_copy('en')
dispatch_app({ type: 'locale/loaded', locale: 'en', copy })
const source = create_character_source({
  classe: 'senshi',
  sex: new URLSearchParams(location.search).get('sex') === 'female' ? 'female' : 'male',
  level: 200n,
  spell_levels: Object.fromEntries(encyclopedia_catalog.class('senshi')!.spells.map((spell) => [spell.name, 1n])),
})
const local = create_fight({
  mode: 'local',
  seed: 91n,
  setup: {
    fight_id: 'mobile-fight',
    board_seed: 1n,
    spells: { ...catalog_spell_sources() },
    players: [
      { character: 'player', owner: 'wallet', team: 0n, ready: true, hp: 100n, source },
      { character: 'enemy', owner: 'other', team: 1n, ready: true, hp: 100n, source },
    ],
    mobs: [],
  },
})
const checkpoint = local.apply({ type: 'start', observed_ms: 60_000n }).state
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: { address: 'wallet' } as never })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/characters',
    characters: [
      { id: 'player', name: 'Player', equipment: [], custody: 'fight', active_fight: { id: 'mobile-fight', seat: 0 } },
    ],
  },
} as never)
dispatch_app({ type: 'character/select', character_id: 'player' })
dispatch_app({
  type: 'fight/reconciled',
  mode: 'remote',
  checkpoint,
  zone_ids: [],
  events: [],
  presentation_batch: 0,
  error: null,
  awaiting_turn_witness: false,
})
dispatch_app({ type: 'clock/observed', chain_ms: 62_000, sample_age_ms: 0, received_ms: performance.now() })
createRoot(document.getElementById('root')!).render(
  <>
    {new URLSearchParams(location.search).has('intro') && (
      <FightTurnCard
        fighter={select_fight_view({ checkpoint, mode: 'local', owner: 'wallet', names: {} }).timeline[0]!}
        level_label="Level 200"
        mob_icon_for={() => null}
      />
    )}
    <FightHud
      confirmation={<TouchFightConfirmation visible copy={copy} cancel={() => {}} confirm={() => {}} />}
      copy={copy}
      focus_fighter={() => {}}
      target_fighter={() => {}}
      targetable_fighter_cells={[]}
      selected_action={null}
      select_action={() => {}}
      actions_locked={false}
      mob_icon_for={() => null}
    />
  </>
)
