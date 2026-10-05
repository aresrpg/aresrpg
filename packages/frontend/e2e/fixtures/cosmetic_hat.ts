// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_character_preview } from '@aresrpg/engine'

import { create_character_model, find_character_bone } from '../../../engine/src/character_model.ts'
import { load_character_appearance } from '../../src/game/character_entities.ts'

const appearance = await load_character_appearance({
  id: 'cosmetic-subject',
  classe: 'senshi',
  male: true,
  colors: ['#f3eadb', '#2f8fe8', '#d9af57'],
  loadout: { hat: 'coiffe_fuwa__white', cosmetic_hat: 'fud' },
})
const model = await create_character_model(appearance)
const head = find_character_bone(model.root, 'head')
const fud = head?.getObjectByName('Pug_Head')
document.querySelector('output')!.textContent = JSON.stringify({
  external_model: appearance.worn.head?.url.startsWith('/'),
  mounted: !!fud,
  visible: fud?.visible,
})
model.dispose()
const preview = await create_character_preview(document.querySelector('canvas')!, { pedestal: true })
await preview.set_appearance(appearance)
