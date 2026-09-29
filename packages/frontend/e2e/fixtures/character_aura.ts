// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

import { create_aura_probe } from '../../../engine/test/browser_character_aura.ts'
import { load_character_appearance, character_aura } from '../../src/game/character_entities.ts'

const appearance = await load_character_appearance({
  id: 'subject',
  classe: 'senshi',
  male: true,
  colors: ['#f3eadb', '#2f8fe8', '#d9af57'],
  loadout: {},
})
const probe = await create_aura_probe(document.querySelector('canvas')!, appearance, (equipped, admin) =>
  character_aura(equipped ? 'title_veteran' : null, admin ? DEFAULT_ADMIN_ADDRESS : null)
)
declare global {
  interface Window {
    aura_probe: typeof probe
  }
}
window.aura_probe = probe
