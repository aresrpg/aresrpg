// RED-FIRST regression (v1.12.31 ② "cosmetics are not rendering in fights"): the engine fight-rig now mounts
// worn cosmetics (board_entities' create_worn_cosmetics per player) and voxel_fight_folds forwards
// `worn: fighter.worn ?? null` — but the fighter payload NEVER carries `worn`. The ADAPTER is the last seam: it
// must resolve MY character's equipped hat/cloak off ctx.roster (the fighter row carries only character_id) and
// attach the resolved { head, back } to the upserted spec. At HEAD the adapter drops it → spec.worn is null →
// the cosmetics never board. This mounts the REAL adapter and drives its REAL sync_entities upsert seam.

import { afterAll, describe, expect, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'

const restore_browser_globals = install_browser_globals()

function AudioStub() {
  this.play = () => Promise.resolve()
  this.pause = () => {}
  this.addEventListener = () => {}
  this.removeEventListener = () => {}
}

const had_audio = 'Audio' in globalThis
// @ts-expect-error test shim
if (!had_audio) globalThis.Audio = AudioStub

const { fight_store, fight_view } = await import('@aresrpg/fight')
const { use_dungeon } = await import('./dungeon_store.js')
const { use_dungeon_turn } = await import('../game/screens/dungeon-turn.js')
const { create_voxel_fight_adapter } = await import('./voxel_fight_adapter.js')

const FIGHT = '0xworn-fight'
const CHAR = '0xc1'
const CHAIN_CELL = 100
const MOB_CELL = 105

const FIGHT_OBJECT = {
  id: FIGHT,
  width: 20,
  height: 19,
  status: 0,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: CHAIN_CELL,
      ready: false,
    },
  ],
  mobs: [{ template: '0xabc', level: 1, hp: 30, max_hp: 30, cell: MOB_CELL, ap: 4, mp: 3 }],
  group_template: '0xgroup',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  start_cells_a: [CHAIN_CELL, 101],
  start_cells_b: [MOB_CELL],
  queue: [],
  turn_ptr: 0,
  turn_deadline_ms: 0,
  placement_deadline_ms: 90_000,
  world_seed: 1,
  spawn_id: 1,
  anchor_x: 0,
  anchor_z: 0,
  shape_mask: [],
  invisibility_statuses: [],
}

// MY roster character wears an explicit-appearance hat + cloak. The `appearance` shape resolves through
// resolve_worn_cosmetics WITHOUT the /v1 encyclopedia template catalog (worn_model_of takes item.appearance as
// the quilt key directly) — so the unit is deterministic regardless of the adapter's one-shot async template
// load (which, with no rpc endpoint, just rejects into worn_templates staying empty). `id` MUST equal the
// participant's `character` — that is the character_id → roster join the adapter performs.
const ROSTER = [
  {
    id: CHAR,
    worn: {
      cosmetic_helmet: { appearance: 'sui_helmet' },
      cosmetic_cloak: { appearance: 'cape_fuwa', variant: 'black' },
    },
  },
]

const make_board = () => {
  const handlers = new Map()
  const calls = { upserts: [] }
  return {
    calls,
    emit: (kind, value) => handlers.get(kind)?.(value),
    on: (kind, handler) => {
      handlers.set(kind, handler)
      return () => handlers.delete(kind)
    },
    build: async () => {},
    teardown: () => {},
    entity_upsert: (spec) => calls.upserts.push(spec),
    entity_remove: () => {},
    entity_move: () => Promise.resolve(),
    entity_beat: () => {
      const beat = Promise.resolve()
      beat.done = Promise.resolve()
      beat.duration_ms = 300
      return beat
    },
    flash_cell: () => {},
    flash_entity: () => {},
    pulse_cells: () => {},
    ripple: () => {},
    set_cell_state: () => {},
    clear_states: () => {},
    render_position_of: () => null,
    set_entity_anchor: () => {},
    clear_entity_anchor: () => {},
    entity_height_of: () => 2,
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const poll = async (predicate, timeout = 2_000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (predicate()) return true
    await sleep(20)
  }
  return predicate()
}

describe('voxel fight adapter — worn cosmetics on the fight rig', () => {
  const board = make_board()
  const adapter_handle = { current: null }

  afterAll(() => {
    adapter_handle.current?.destroy()
    fight_store.getState().input({ type: 'init', fight_id: null })
    use_dungeon_turn.getState().clear_picks()
    use_dungeon.setState({ fight_id: null, fight_fresh: false })
    // @ts-expect-error test shim
    if (!had_audio) delete globalThis.Audio
    restore_browser_globals()
  })

  test('a player fighter upserts a spec carrying its resolved worn hat/cloak; a mob stays worn-less', async () => {
    fight_store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    fight_store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 })
    // ctx.roster — the ONE home the adapter joins character_id against (pumped by the fight edge on sui_data).
    fight_store.getState().input({ type: 'ctx', ctx: { roster: ROSTER } })
    adapter_handle.current = create_voxel_fight_adapter(board)

    // the player IS upserted (this happens at HEAD too — the join is the delta, not the upsert itself).
    expect(await poll(() => board.calls.upserts.some((row) => row.id === CHAR))).toBe(true)
    expect(fight_view().fighters.get(CHAR)?.character_id).toBe(CHAR) // the join key the adapter resolves against

    // THE ASSERTION (fails at HEAD — spec.worn is null): the resolved hat/cloak reach the upserted spec.
    const last_player = [...board.calls.upserts].reverse().find((row) => row.id === CHAR)
    expect(last_player.worn?.head?.url).toMatch(/sui_helmet/)
    expect(last_player.worn?.back?.url).toMatch(/cape_fuwa/)
    expect(last_player.worn?.back?.variant).toBe('black')

    // a MOB never carries worn (mobs get no cosmetic join — the fold's worn:null stands).
    const mob = [...board.calls.upserts].reverse().find((row) => row.kind === 'mob')
    expect(mob).toBeDefined()
    expect(mob.worn ?? null).toBeNull()
  })
})
