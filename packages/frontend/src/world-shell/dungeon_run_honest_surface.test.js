// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RIDER B(a) — the FRESH-ROOM-FIGHT collapse (BACKLOG adoption-seam NEEDS-LEAD #1) + RIDER A — the honest
// surface on a foreground commit refusal (the "turn couldn't be committed" wedge).
//
// B(a): start_when_ready / join_shared_dungeon mint or join a room fight and set the id, but they set only
// `fight_fresh: true` — NOT `fight_syncing: true`. On a read-after-write miss of a just-minted fight
// should_hold_receipt_fight() is then false, so refresh takes _collapse_terminal_ghost (a full session
// teardown) instead of the world leg's receipt-first HOLD. The fix: both legs mark `fight_syncing: true`, so
// the fresh id qualifies for the same hold. These tests drive the REAL legs with the two room-fight txs
// injected (house `force_start_door` precedent — bun `mock.module` on dungeon_actions is process-global and
// leaks across files) and `refresh` stubbed (its read-chain is exercised elsewhere; here we pin the LEG's flag
// contract), then assert the fresh state now passes the hold gate.
//
// A: a FOREGROUND End-Turn press dropped for `busy` used to emit only a dev-gated fight_state_trace + a
// swallowed `return false` — invisible in ordinary play, so the player thought the button did nothing. The fix
// pushes one honest info toast.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'

import { should_hold_receipt_fight } from './world_fight_receipt.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

// join_shared_dungeon sets `in_session: true`, whose store subscriber fires the dungeon music (`new Audio()`).
// bun has no Audio — stub it (house idiom, mirrors voxel_fight_beat_playback.test.js) so the leg runs headless.
function AudioStub() {
  this.play = () => Promise.resolve()
  this.pause = () => {}
  this.addEventListener = () => {}
  this.removeEventListener = () => {}
}
const had_audio = 'Audio' in globalThis
// @ts-expect-error test shim
if (!had_audio) globalThis.Audio = AudioStub

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const RUN_PASS_ID = '0xrunpass'
const CREATOR_PASS_ID = '0xcreatorpass'
const WORLD_ID = '0xworld'
const MOB_TEMPLATE_ID = '0xmob'
const NEXT_MOB_TEMPLATE_ID = '0xnextmob'
const MINTED_FIGHT_ID = '0xfreshfight'
const JOIN_FIGHT_ID = '0xjoinfight'

const { use_auth } = await import('../auth')
const { use_dungeon } = await import('./dungeon_store.js')
const { event_toast_store, dismiss_event_toast } = await import('../game/core/toast.js')
const { default: i18n } = await import('../i18n')

const COMMIT_BUSY = i18n.t('dungeons.commit_busy')
const initial_dungeon = use_dungeon.getInitialState()

/** The event-toast stack is a capped (EVENT_CAP=3) module-global; clear it so a full-suite run starts empty. */
const clear_event_toasts = () => [...event_toast_store.get()].forEach((t) => dismiss_event_toast(t.id))
const has_busy_toast = () => event_toast_store.get().some((t) => t.title === COMMIT_BUSY)

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  use_auth.setState({ address: OWNER })
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  clear_event_toasts()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  reset_auth_mock()
})

afterAll(() => {
  // Sibling files (voxel_fight_beat_playback.test.js et al.) restore this; this file never did — a leaked
  // globalThis.Audio (missing .load) survived into later files in the same bun test process and broke any
  // other suite whose in_session:true transition reaches ambient_music.js's track-swap .load() call.
  // @ts-expect-error test shim
  if (!had_audio) delete globalThis.Audio
  restore_browser_globals()
})

describe('RIDER B(a) — a fresh room fight is HELD, never collapsed, through the read-after-write gap', () => {
  test('start_when_ready (ENGAGE) marks the fresh mint fight_syncing → the receipt hold gate passes', async () => {
    const refresh = mock(async () => {}) // the read-chain is tested elsewhere; pin the leg's flag contract here
    use_dungeon.setState({
      run_pass_id: RUN_PASS_ID,
      owned_run_pass_ids: {},
      owned_team_entry_blocked: false,
      owned_team_settlement_blocked: false,
      world_id: WORLD_ID,
      rooms: [[MOB_TEMPLATE_ID]], // room 1's roster
      run: { room: 1, world: WORLD_ID },
      busy: false,
      _settling: false,
      character_id: CHARACTER_ID,
      fight_id: null,
      refresh,
    })

    await use_dungeon.getState().start_when_ready({
      user: true,
      mint_room_fight: mock(async () => ({ fight_id: MINTED_FIGHT_ID })),
      join_team: mock(async () => {}),
    })

    expect(use_dungeon.getState().fight_id).toBe(MINTED_FIGHT_ID)
    expect(use_dungeon.getState().fight_fresh).toBe(true)
    // THE FIX: without fight_syncing:true this is false and refresh would _collapse_terminal_ghost the fresh mint.
    expect(use_dungeon.getState().fight_syncing).toBe(true)
    expect(should_hold_receipt_fight(use_dungeon.getState(), MINTED_FIGHT_ID)).toBe(true)
  })

  test('#660 a code-111 room engage repairs through the entry reducer, then retries exactly once', async () => {
    const refusal = Object.assign(new Error('fight::ECharacterMarked'), { code: 111, module: 'fight' })
    let attempts = 0
    const mint_room_fight = mock(async () => {
      attempts += 1
      if (attempts === 1) throw refusal
      return { fight_id: MINTED_FIGHT_ID }
    })
    const recover_refusal = mock(async () => {
      // Opening the pending result advances the RunPass. The reducer's authorized retry must compose from the
      // refreshed room, not replay the stale first attempt's roster.
      use_dungeon.setState({ run: { room: 2, world: WORLD_ID } })
      return { digest: '0xopen-receipt' }
    })
    use_dungeon.setState({
      run_pass_id: RUN_PASS_ID,
      owned_run_pass_ids: {},
      owned_team_entry_blocked: false,
      owned_team_settlement_blocked: false,
      world_id: WORLD_ID,
      rooms: [[MOB_TEMPLATE_ID], [NEXT_MOB_TEMPLATE_ID]],
      run: { room: 1, world: WORLD_ID },
      busy: false,
      _settling: false,
      character_id: CHARACTER_ID,
      fight_id: null,
      refresh: mock(async () => {}),
    })

    await use_dungeon.getState().start_when_ready({
      user: true,
      mint_room_fight,
      join_team: mock(async () => {}),
      recover_refusal,
    })

    expect(mint_room_fight).toHaveBeenCalledTimes(2)
    expect(recover_refusal).toHaveBeenCalledTimes(1)
    expect(recover_refusal).toHaveBeenCalledWith(refusal)
    expect(mint_room_fight.mock.calls[1][0].mob_template_id).toBe(NEXT_MOB_TEMPLATE_ID)
    expect(use_dungeon.getState().fight_id).toBe(MINTED_FIGHT_ID)
    expect(use_dungeon.getState().error).toBeNull()
  })

  test('join_shared_dungeon (co-op JOIN) marks the fresh join fight_syncing → the receipt hold gate passes', async () => {
    const refresh = mock(async () => {})
    use_dungeon.setState({
      run_pass_id: RUN_PASS_ID,
      busy: false,
      run: { room: 1, world: WORLD_ID },
      rooms: [[MOB_TEMPLATE_ID]],
      mob_names: {},
      mob_levels: {},
      mob_elements: {},
      refresh,
      _start_polling: mock(() => {}),
    })

    await use_dungeon
      .getState()
      .join_shared_dungeon(CREATOR_PASS_ID, JOIN_FIGHT_ID, CHARACTER_ID, { join: mock(async () => {}) })

    expect(use_dungeon.getState().fight_id).toBe(JOIN_FIGHT_ID)
    expect(use_dungeon.getState().fight_syncing).toBe(true)
    expect(should_hold_receipt_fight(use_dungeon.getState(), JOIN_FIGHT_ID)).toBe(true)
  })
})

describe('RIDER A — a foreground commit refusal is surfaced, never swallowed', () => {
  test('a FOREGROUND End-Turn press dropped for busy pushes the honest commit_busy toast', async () => {
    use_dungeon.setState({ busy: true, fight_id: MINTED_FIGHT_ID, character_id: CHARACTER_ID })

    const ok = await use_dungeon.getState().commit_turn([], { background: false })

    expect(ok).toBe(false)
    expect(has_busy_toast()).toBe(true) // the player who pressed hears WHY, instead of a silent no-op
  })

  test('a BACKGROUND (auto) commit dropped for busy stays silent — no toast spam on the plane', async () => {
    use_dungeon.setState({ busy: true, fight_id: MINTED_FIGHT_ID, character_id: CHARACTER_ID })

    const ok = await use_dungeon.getState().commit_turn([], { background: true })

    expect(ok).toBe(false)
    expect(has_busy_toast()).toBe(false) // no player gesture ⇒ no toast (the trace/log still fire)
  })
})
