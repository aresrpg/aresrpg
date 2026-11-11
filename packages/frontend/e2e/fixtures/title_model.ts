// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, ServerPacket } from '@aresrpg/protocol'

import { create_title_model_probe } from '../../../engine/test/browser_title_model.ts'
import { load_pet_model_url } from '../../src/content/pet_models.ts'
import { items_by_type, items } from '../../src/content/items.ts'
import { load_worn_equipment_model_url } from '../../src/content/character_models.ts'
import world from '../../src/modules/world.ts'
import { initial_app_state } from '../../src/store.ts'
import { load_character_appearance, presence_render_source } from '../../src/game/character_entities.ts'

import { run_title_presence_probe } from './title_presence_probe.ts'
import { create_title_fight_probe } from './title_fight_probe.tsx'

// Isolated browser fixture: an authored model title, without minting or changing seed files.
Reflect.set(items_by_type.title_veteran!, 'title_model', 'blast_girl')
const title_appearance = (title: string, hat = 'solomonk', cloak = 'cape_fuwa__black') =>
  load_character_appearance({
    id: 'hero',
    classe: 'senshi',
    male: true,
    colors: ['#f3eadb', '#2f8fe8', '#d9af57'],
    loadout: { title, cosmetic_hat: hat, cosmetic_cloak: cloak },
  })
const probe = await create_title_model_probe(
  document.querySelector('canvas')!,
  (title, hat, cloak) => title_appearance(title ? 'title_veteran' : '', hat, cloak),
  await load_pet_model_url('suicune')
)
const community_title = async (title: string) => probe.show(await title_appearance(title))
const community_titles = items.filter(
  (item) => item.category === 'title' && item.title_model && item.item_type !== 'title_veteran'
)
const equipment = (
  await Promise.all(
    items
      .filter(({ category }) => ['hat', 'cloak', 'cosmetic_hat', 'cosmetic_cloak'].includes(category))
      .map(async (item) => ({
        item_type: item.item_type,
        category: item.category,
        model: await load_worn_equipment_model_url(item),
      }))
  )
).filter(({ model }) => model !== null)
const from_packets = async (packets: ServerPacket[]) => {
  const initial = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null, fight_access: 0 })
  const tracked = packets.find((packet) => packet.type === 'packet/tracked_zones')
  if (tracked?.type !== 'packet/tracked_zones') throw new Error('Socket capture has no tracked world')
  const seed: ReturnType<typeof initial_app_state> = {
    ...initial,
    session: {
      ...initial.session,
      selected_character_id: tracked.character_id,
      characters: [{ id: tracked.character_id, world: tracked.world }] as CharacterRow[],
    },
  }
  const accepted = packets.filter(({ type }) =>
    [
      'packet/tracked_zones',
      'packet/player_appeared',
      'packet/player_equipment',
      'packet/players_moved',
      'packet/player_left',
    ].includes(type)
  )
  const state = accepted.reduce((state, packet) => world.reduce!(state, { type: 'server/packet', packet }), seed)
  const remote = state.world.players.hero
  if (!remote) throw new Error('Remote hero missing after socket packet reduction')
  const appearance = await load_character_appearance(presence_render_source(remote))
  await probe.show(appearance)
  return { title: remote.title, appearance }
}
window.title_model_probe = {
  ...probe,
  community_title,
  community_titles,
  equipment,
  from_packets,
  fight: create_title_fight_probe(),
  presence: run_title_presence_probe,
}
declare global {
  interface Window {
    title_model_probe: Awaited<ReturnType<typeof create_title_model_probe>> & {
      community_title: typeof community_title
      community_titles: typeof community_titles
      fight: ReturnType<typeof create_title_fight_probe>
      presence: typeof run_title_presence_probe
      equipment: typeof equipment
      from_packets: typeof from_packets
    }
  }
}
