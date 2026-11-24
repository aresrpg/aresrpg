// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A `packet/fight_state` frame as the server sends it as JSON: hero `0xa` (team 0, owned by `owner`) against `0xb`.
// Synthetic values; the fight runtime normalizes them as it normalizes the wire.

const fighter = (character: string, owner: string, team: number, cell: number, ready: boolean) => ({
  team,
  kind: { type: 'player', character, owner, level: '10' },
  cell,
  ready,
  dead: false,
  settled: false,
  forfeited: false,
  hp: 100,
  ap: 6,
  mp: 3,
  drops: [],
  effects: [],
  cooldowns: [],
})
const player = () => ({
  name: 'Fighter',
  classe: 'senshi',
  level: 10,
  experience: '0',
  vitality: 50,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  spell_levels: {},
  folded_stats: {},
  weapon: null,
})

/** `placement` is the round-zero board before both sides are ready; otherwise the first turn of `0xa` has begun. */
export const fight_state = (
  owner: string,
  {
    placement = false,
    kolizeum = null,
  }: Readonly<{ placement?: boolean; kolizeum?: Readonly<{ id: string; pledge_mist: string }> | null }> = {}
) => ({
  type: 'packet/fight_state',
  fight: '0xf1',
  seats: { '0xa': 0 },
  state: {
    kolizeum,
    players: { '0xa': player(), '0xb': player() },
    contract: {
      id: '0xf1',
      world: 'overworld',
      x: 120,
      z: 120,
      board: {
        width: 8,
        height: 8,
        shape_mask: ['0'],
        obstacles: [],
        holes: [],
        start_cells_a: [1],
        start_cells_b: [62],
      },
      closed: [],
      access_a: 1,
      access_b: 1,
      opener_a: '0xa',
      opener_b: '0xb',
      fighters: [fighter('0xa', owner, 0, 1, !placement), fighter('0xb', '0xher', 1, 62, true)],
      zones: [],
      queue: placement ? [] : [0, 1],
      turn_ptr: 0,
      round: placement ? 0 : 1,
      ended: false,
      winner: null,
      dungeon: null,
      managed: kolizeum !== null,
      wagered: kolizeum !== null,
      drops_rolled: false,
      turn_seed: '12345',
      turn_slot: 0,
      turn_casts: [],
      placement_ms: 0,
      turn_started_ms: 0,
    },
  },
})
