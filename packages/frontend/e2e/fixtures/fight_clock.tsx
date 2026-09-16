// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'
import { create_character_source, create_fight } from '@aresrpg/fight'

import { FightHud } from '../../src/game/fight/FightHud.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dispatch_app } from '../../src/store.ts'
import '../../src/tailwind.css'

declare global {
  interface Window {
    sample_fight_clock: (chain_ms: number, sample_age_ms?: number) => void
  }
}

const copy = await load_app_copy('en')
const source = create_character_source({ classe: 'senshi', level: 1n })
const local = create_fight({
  mode: 'local',
  seed: 91n,
  setup: {
    fight_id: 'clock-ui',
    board_seed: 1n,
    players: [
      { character: 'player', owner: 'wallet', team: 0n, ready: true, hp: 100n, source },
      { character: 'enemy', owner: 'other', team: 1n, ready: true, hp: 100n, source },
    ],
    mobs: [],
  },
})
local.apply({ type: 'start', observed_ms: 60_000n })
const checkpoint = local.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n }).state
// No wallet or server observers: clock samples and the opponent's checkpoint are deterministic.
dispatch_app({ type: 'auth/connecting' })
dispatch_app({ type: 'auth/connected', session: { address: 'wallet' } as never })
dispatch_app({
  type: 'server/packet',
  packet: {
    type: 'packet/characters',
    characters: [
      { id: 'player', name: 'Player', equipment: [], custody: 'fight', active_fight: { id: 'clock-ui', seat: 0 } },
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
window.sample_fight_clock = (chain_ms, sample_age_ms = 0) =>
  dispatch_app({ type: 'clock/observed', chain_ms, sample_age_ms, received_ms: performance.now() })
window.sample_fight_clock(65_000)
createRoot(document.getElementById('root')!).render(
  <FightHud
    copy={copy}
    focus_fighter={() => {}}
    target_fighter={() => {}}
    targetable_fighter_cells={[]}
    selected_action={null}
    select_action={() => {}}
    actions_locked={false}
    mob_icon_for={() => null}
  />
)
