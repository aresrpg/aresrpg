// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Issue #1865 RED-FIRST — A REFRESH RENAMED THE ROSTER.
//
// Live testnet: a running fight held two distinct mobs (a rat and a Bonelet). After a page refresh BOTH rendered
// as "Bonelet". Two homes resolved the same fact and only one of them knew about members:
//   · the LIVE-SPAWN path composes the seated roster in the world (`world_spawns.js` → `seated_roster`) and
//     carries it into the fight through `ctx.mob_roster`, keyed by fold fighter id — per-member identity;
//   · the REHYDRATION path has no claim to carry. It rebuilt from chain reads alone, and the only species fact
//     those reads carry is the Fight's shared `GroupContent.template` — deliberately the PRIMARY's block
//     (fight.move `create_members`), while every `FightMob` is minted `template: @0x0`. So `board_state` keyed
//     every mob by that one id and the projection resolved one name for the whole pack.
//
// The fork the row named split HERE: `/v1/fights` is not serving a wrong roster — it serves no member roster at
// all (`RpcFight` carries `group_template`, one id). Neither does the Fight object. The per-member fact is on
// chain the whole time, as one indexed dynamic field per seated mob (`MemberContentKey { index }` →
// `GroupContent { template: committed[i] }`), so the client half is recoverable without touching the read layer.
//
// This drives that recovery over a fake gRPC core (the field shapes are the ones `create_members` attaches) and
// then the projection it feeds, which is the surface the player actually read wrong.

import { describe, expect, test } from 'bun:test'
import { engine_view } from '@aresrpg/fight/project'
import { create_fight_store } from '@aresrpg/fight/store'
import { get_member_templates } from '@aresrpg/sdk/fight'

import { merge_mob_roster } from '../../src/world-shell/dungeon_fight_sync.js'

const FIGHT = '0xf1865'
const RAT = '0xrat'
const BONELET = '0xbonelet'
const PKG = '0xengine'

/** `Field<MemberContentKey, GroupContent>` as `json:true` flattens it. */
const member_field = (index, template) => ({
  json: { name: { index: String(index) }, value: { template, xp: '10', loot: [], kit: {} } },
})

/** A gRPC core that answers the two calls the reader makes, and nothing else. */
const fake_grpc = (fields) => ({
  core: {
    listDynamicFields: async () => ({
      dynamicFields: [
        // A real Fight carries other keys too — the reader must pick its own by type suffix.
        { fieldId: 'weapons-0', name: { type: `${PKG}::fight::WeaponLinesKey` } },
        ...fields.map((_, index) => ({
          fieldId: `member-${index}`,
          name: { type: `${PKG}::fight::MemberContentKey` },
        })),
      ],
      hasNextPage: false,
      cursor: null,
    }),
    getObjects: async ({ objectIds }) => ({ objects: objectIds.map((id) => fields[Number(String(id).split('-')[1])]) }),
  },
})

/** The rehydrated chain read: ONE group template, every FightMob minted template @0x0, two different levels. */
const fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [],
  group_template: BONELET, // the PRIMARY's block — the only species id the object carries
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [
    { template: '0x0', level: 2, hp: 20, max_hp: 20, cell: 45, ap: 6, mp: 3 },
    { template: '0x0', level: 9, hp: 30, max_hp: 30, cell: 46, ap: 6, mp: 3 },
  ],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: 0,
  turn_entropy: null,
  turn_ordinal: null,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

/** The names the board renders, in fold order. */
const rendered_names = (ctx) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, ctx })
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 1 })
  const { fighters } = engine_view(store.getState())
  return ['mob-0', 'mob-1'].map((id) => fighters.get(id)?.name)
}

// Both species, resolved into the tab's shared template→name map exactly as `_resolve_mob_identities` writes it.
const mob_names = { [RAT]: 'Rat', [BONELET]: 'Bonelet' }

describe('#1865 a refresh must not rename the roster', () => {
  test('RED: rehydrating on the group template alone renders ONE name for a mixed pack', () => {
    // This is the reported screen: no carried roster, so every mob resolves through `group_template`.
    expect(rendered_names({ mob_names })).toEqual(['Bonelet', 'Bonelet'])
  })

  test('the per-member templates are recoverable from the Fight s own dynamic fields', async () => {
    const by_index = await get_member_templates({
      grpc_client: fake_grpc([member_field(0, RAT), member_field(1, BONELET)]),
    })(FIGHT)
    expect(by_index).toEqual({ 0: RAT, 1: BONELET })
  })

  test('GREEN: the recovered roster renders each member under its own species', () => {
    const recovered = [
      { id: 'mob-0', template_id: RAT },
      { id: 'mob-1', template_id: BONELET },
    ]
    expect(rendered_names({ mob_names, mob_roster: merge_mob_roster(null, recovered) })).toEqual(['Rat', 'Bonelet'])
  })

  test('a homogeneous pack reads no member fields and keeps the group fallback untouched', async () => {
    const by_index = await get_member_templates({ grpc_client: fake_grpc([]) })(FIGHT)
    expect(by_index).toEqual({})
    // Nothing recovered ⇒ nothing published ⇒ the pre-existing group resolution still names both mobs.
    expect(rendered_names({ mob_names })).toEqual(['Bonelet', 'Bonelet'])
  })

  test('a CLAIMED row still wins its entity — the recovery only fills what the claim never covered', () => {
    const claimed = [{ id: 'mob-0', template_id: RAT, name: 'Rapido the Plague King', min_level: 5, element: 3 }]
    const recovered = [
      { id: 'mob-0', template_id: RAT },
      { id: 'mob-1', template_id: BONELET },
    ]
    expect(rendered_names({ mob_names, mob_roster: merge_mob_roster(claimed, recovered) })).toEqual([
      'Rapido the Plague King',
      'Bonelet',
    ])
  })

  test('an unreadable node degrades to the group fallback rather than inventing a roster', async () => {
    const broken = {
      core: {
        listDynamicFields: async () => {
          throw new Error('node down')
        },
        getObjects: async () => ({}),
      },
    }
    expect(await get_member_templates({ grpc_client: broken })(FIGHT)).toEqual({})
  })
})
