// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// REJOIN-SPAWN regression (gate5 evidence): a character REJOINING a world while a
// ZOMBIE world fight (status PLACEMENT, placement window expired long ago — left by a dead session) is still
// on-chain got its whole boot HIJACKED: the one-shot boot resume (world_spawns → resume_world_fight) adopted
// the fight session as-is, the first refresh folded its snapshot, the fight-view edge flipped `fight_mode`,
// and the roam HUD (SelfPlate/CompassStrip/PromptStack) + the walker rig unmounted — with no presentable
// board behind it ("I see the spectate view"). Fresh joins were untouched (no fight → resume no-ops), and a
// rejoin with NO leftover fight passed end-to-end (deploy gate 10:32Z) — the receipt shape was never the root.
//
// THE INVARIANT under test: the boot resume adopts ONLY a presentable fight —
//   • ACTIVE                        → enter (the P0 mid-fight refresh law, byte-identical),
//   • PLACEMENT, window still OPEN  → enter (a genuine mid-placement refresh),
//   • PLACEMENT, window EXPIRED     → liquidate FIRST through the permissionless `turns::force_start` door
//     (the fight-liquidation embodiment law): certified force_start = receipt truth the fight is ACTIVE →
//     enter; a REFUSED liquidation → never adopt (the world session stays a world session; the marker's
//     discharge waits for a later pass / another watcher). Never a session the phase machine cannot present.
//
// Test seams (house idiom, mirrors fight_absence.test.js): /v1 via the fetch mock, the chain object read via
// the expedition SDK mock, and the liquidation door as an injected dep (character_selection.js precedent —
// bun `mock.module` is process-global, so module-mocking dungeon_actions here would leak into every file).

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../test_helpers/browser_globals.js'
import { reset_auth_mock } from '../test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../test_helpers/expedition_sdk_mock.js'
import de from '../i18n/locales/de.json'
import en from '../i18n/locales/en.json'
import es from '../i18n/locales/es.json'
import fr from '../i18n/locales/fr.json'
import ja from '../i18n/locales/ja.json'
import uk from '../i18n/locales/uk.json'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const FIGHT_ID = '0xzombiefight'
const WORLD_ID = '0xworld'
// CHAIN scalars (fight.move) — `fight_object` below is a raw Fight object read, so these must be the chain
// namespace, never the projected board-view one. Pinning them to the shared home keeps this fixture honest: it
// previously hard-coded placement as 5 (a VIEW scalar the chain can never emit), which is what let #932 ship
// green — every "zombie placement" case below was exercising a status that does not exist on chain.
const { CHAIN_STATUS_ACTIVE: STATUS_ACTIVE, CHAIN_STATUS_PLACEMENT: STATUS_PLACEMENT } =
  await import('./fight_chain_status.js')

let read_response = /** @type {(object_id:string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => read_response(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../auth')
const { default: i18n } = await import('../i18n')
const { _reset_rpc_client_for_test } = await import('../rpc/client')
const { use_dungeon } = await import('./dungeon_store.js')
const { recover_fight_entry_refusal } = await import('./dungeon_settlement.js')
const { fight_store } = await import('@aresrpg/fight/store')
const { board_view } = await import('@aresrpg/fight/project')
const { resume_world_fight } = await import('./world_fight.js')
const { resume_decision, sweep_expired_character_placement } = await import('./fight-liquidation.js')
const { humanize_tx_error, tx_error } = await import('../game/core/abort_copy.js')
const { run_fight_entry } = await import('../game/fight_engage.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

/** A `json:true`-flattened `fight::Fight` read, minimal but decode_fight-complete. */
const fight_object = (status, { placement_deadline_ms = 0, turn_deadline_ms = 0 } = {}) => ({
  object: {
    json: {
      id: FIGHT_ID,
      world: WORLD_ID,
      status,
      placement_deadline_ms: String(placement_deadline_ms),
      turn_deadline_ms: String(turn_deadline_ms),
      last_action_ms: '0',
      participants: [{ addr: OWNER, character: CHARACTER_ID, cell: 0, ready: false, hp: 30, alive: true }],
      mobs: [],
      queue: [],
      turn_ptr: 0,
      board: {},
      group: {},
    },
    version: '9',
  },
})

/** /v1 fights mock: the discovery list (?character=) and the by-id validation both serve `doc`. */
const serve_v1_fight = (doc) => {
  globalThis.fetch = mock(async (input) => {
    const query = new URL(String(input)).searchParams
    const fights = query.has('id') ? [doc].filter((f) => f.fight_id === query.get('id')) : [doc]
    return new Response(JSON.stringify({ fights }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

const settle_tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const locale_value = (bundle, key) => key.split('.').reduce((node, part) => node?.[part], bundle)

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null }) // reset the core — no view, no fight_mode edge
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  _reset_rpc_client_for_test()
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  fight_store.getState().input({ type: 'init', fight_id: null })
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

describe('boot resume vs a zombie world fight (REJOIN-SPAWN)', () => {
  test('an EXPIRED-placement fight whose liquidation is refused is NEVER adopted — the world session survives', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    read_response = async (object_id) => {
      if (object_id === FIGHT_ID) return fight_object(STATUS_PLACEMENT, { placement_deadline_ms: Date.now() - 180_000 })
      throw new Error(`unexpected object read: ${object_id}`)
    }
    const force_start_door = mock(async () => {
      throw new Error('pre-flight refused (test)')
    })

    // #1751/#2122: the entry consents before it liquidates — this row measures the liquidation mechanics, so it
    // answers directly rather than depending on which way the consent lands (autonomous on a fight's first pass
    // this session, the modal after that). The consent's own behaviour: test/world-shell/world_fight_resume_offer.test.js.
    await resume_world_fight(CHARACTER_ID, { force_start_door, consent: () => 'rejoin' })
    await settle_tick()

    // The hijack of record (gate5): the session was adopted as-is → fight_id set, the snapshot folded, the
    // fight-view edge flipped fight_mode, SelfPlate/PromptStack unmounted, no board behind it. The fix: no
    // adoption without a presentable fight — the store stays out of session, the core view stays null.
    expect(use_dungeon.getState().fight_id).toBeNull()
    expect(use_dungeon.getState().dungeon_id).toBeNull()
    expect(board_view(fight_store.getState())).toBeNull()
  })

  test('an EXPIRED-placement fight is liquidated FIRST, then resumed — certified force_start is receipt truth', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    let liquidated = false
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      // gate read pre-liquidation: expired placement; refresh's post-enter read: the force-started ACTIVE fight
      return liquidated
        ? fight_object(STATUS_ACTIVE, { turn_deadline_ms: Date.now() + 60_000 })
        : fight_object(STATUS_PLACEMENT, { placement_deadline_ms: Date.now() - 180_000 })
    }
    const force_start_door = mock(async () => {
      liquidated = true
      return { digest: '0xforcestart' }
    })

    // #1751/#2122: the entry consents before it liquidates — this row measures the liquidation mechanics, so it
    // answers directly rather than depending on which way the consent lands (autonomous on a fight's first pass
    // this session, the modal after that). The consent's own behaviour: test/world-shell/world_fight_resume_offer.test.js.
    await resume_world_fight(CHARACTER_ID, { force_start_door, consent: () => 'rejoin' })

    expect(force_start_door).toHaveBeenCalledTimes(1)
    expect(force_start_door.mock.calls[0]).toEqual([FIGHT_ID, true]) // the silent janitor door, not a toast path
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().fight_fresh).toBe(false) // resumed — the entry cinematic never replays
    expect(use_dungeon.getState().character_id).toBe(CHARACTER_ID)
  })

  test('a placement fight inside its OPEN window resumes directly — no liquidation fired', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      return fight_object(STATUS_PLACEMENT, { placement_deadline_ms: Date.now() + 25_000 })
    }
    const force_start_door = mock(async () => ({ digest: '0xnever' }))

    await resume_world_fight(CHARACTER_ID, { force_start_door })

    expect(force_start_door).not.toHaveBeenCalled()
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().fight_fresh).toBe(false)
  })

  test('an ACTIVE fight resumes byte-identically — no gate, no liquidation (the P0 mid-fight refresh law)', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'active' })
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      return fight_object(STATUS_ACTIVE, { turn_deadline_ms: Date.now() + 60_000 })
    }
    const force_start_door = mock(async () => ({ digest: '0xnever' }))

    await resume_world_fight(CHARACTER_ID, { force_start_door })

    expect(force_start_door).not.toHaveBeenCalled()
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().fight_fresh).toBe(false)
  })
})

describe('#677 — a fight-entry busy refusal sweeps the character’s expired placement fight', () => {
  test('RED-FIRST: engage/join discovery composes the permissionless force-start before surfacing busy', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    let liquidated = false
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      return liquidated
        ? fight_object(STATUS_ACTIVE, { turn_deadline_ms: Date.now() + 60_000 })
        : fight_object(STATUS_PLACEMENT, { placement_deadline_ms: Date.now() - 180_000 })
    }
    const force_start_door = mock(async () => {
      liquidated = true
      return { digest: '0xentry-force-start' }
    })

    const result = await sweep_expired_character_placement(CHARACTER_ID, { force_start_door })

    expect(force_start_door).toHaveBeenCalledTimes(1)
    expect(force_start_door.mock.calls[0]).toEqual([FIGHT_ID, true])
    expect(result).toMatchObject({ state: 'started', fight_id: FIGHT_ID })
  })

  test('the shared engage/join recovery reports that the expired placement fight was started', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    let liquidated = false
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      return liquidated
        ? fight_object(STATUS_ACTIVE, { turn_deadline_ms: Date.now() + 60_000 })
        : fight_object(STATUS_PLACEMENT, { placement_deadline_ms: Date.now() - 180_000 })
    }
    const force_start_door = mock(async () => {
      liquidated = true
      return { digest: '0xentry-force-start' }
    })
    const busy_refusal = tx_error(
      { MoveAbort: { abortCode: 103, location: { module: 'fight_latch' } } },
      { preflight: true }
    )
    let submissions = 0

    const surfaced = await run_fight_entry({
      submit: async () => {
        submissions += 1
        throw busy_refusal
      },
      recover_refusal: (error) => recover_fight_entry_refusal(use_dungeon, CHARACTER_ID, error, { force_start_door }),
    }).catch((error) => error)

    expect(surfaced).toBeInstanceOf(Error)
    expect(humanize_tx_error(surfaced)).toBe(i18n.t('errors.fight_character_busy_expired_started'))
    expect(submissions).toBe(1) // the old fight remains live; never retry the doomed new entry
    expect(force_start_door).toHaveBeenCalledTimes(1)
  })

  test('a force-start refusal stays exact data and the toast says the fight is still expired', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      return fight_object(STATUS_PLACEMENT, { placement_deadline_ms: Date.now() - 180_000 })
    }
    const force_start_door = mock(async () => {
      throw new Error('pre-flight force-start refusal (test)')
    })
    const busy_refusal = tx_error(
      { MoveAbort: { abortCode: 103, location: { module: 'fight_latch' } } },
      { preflight: true }
    )

    const surfaced = await recover_fight_entry_refusal(use_dungeon, CHARACTER_ID, busy_refusal, {
      force_start_door,
    }).catch((error) => error)

    expect(humanize_tx_error(surfaced)).toBe(i18n.t('errors.fight_character_busy_expired_refused'))
    expect(surfaced.fight_liveness).toMatchObject({
      state: 'refused',
      fight_id: FIGHT_ID,
      reason: expect.stringContaining('force_start door did not land'),
    })
    expect(force_start_door).toHaveBeenCalledTimes(1)
  })

  test('an open placement window keeps the original busy truth and composes no janitor transaction', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'placement' })
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      return fight_object(STATUS_PLACEMENT, { placement_deadline_ms: Date.now() + 60_000 })
    }
    const force_start_door = mock(async () => ({ digest: '0xnever' }))
    const busy_refusal = tx_error(
      { MoveAbort: { abortCode: 103, location: { module: 'fight_latch' } } },
      { preflight: true }
    )

    const surfaced = await recover_fight_entry_refusal(use_dungeon, CHARACTER_ID, busy_refusal, {
      force_start_door,
    }).catch((error) => error)

    expect(surfaced).toBe(busy_refusal)
    expect(humanize_tx_error(surfaced)).toBe(i18n.t('errors.fight_character_busy'))
    expect(force_start_door).not.toHaveBeenCalled()
  })

  test('every truthful expired-placement outcome ships in all six locales', () => {
    const keys = [
      'errors.fight_character_busy_expired_started',
      'errors.fight_character_busy_expired_finished',
      'errors.fight_character_busy_expired_refused',
    ]
    for (const key of keys)
      for (const [locale, bundle] of Object.entries({ de, en, es, fr, ja, uk })) {
        const copy = locale_value(bundle, key)
        expect(typeof copy, `${key} missing from ${locale}.json`).toBe('string')
        expect(copy.length, `${key} is empty in ${locale}.json`).toBeGreaterThan(0)
      }
  })
})

// ── #882 · THE ACTIVE SIBLING: re-entry must not adopt a fight whose TURN deadline expired hours ago ─────────
// The reported loop: "a later session re-mounted the SAME fight id instead of reaching a claimable world — the
// zombie fight captures the character indefinitely". The gate that already protected an expired PLACEMENT window
// now covers the ACTIVE fight too, through ITS permissionless door (`turns::crank`): fire it BEFORE adoption and
// let the RE-READ decide. A fight the crank resolved terminal is routed OUT (character freed + outcome
// recovered), never mounted. A fight that survives it stays enterable — an ACTIVE board is presentable and holds
// the ONLY working exit (forfeit), and the expiry gate surfaces its honest state there.
describe('boot resume vs an EXPIRED-turn zombie (#882)', () => {
  test('RED-FIRST: an expired ACTIVE fight is no longer adopted blind — the crank door fires FIRST', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'active' })
    let cranked = false
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      // the crank forfeited the overdue turn and resolved the fight terminal (chain DEFEAT) — nothing to mount
      return cranked ? fight_object(3) : fight_object(STATUS_ACTIVE, { turn_deadline_ms: Date.now() - 6 * 3_600_000 })
    }
    const crank_door = mock(async () => {
      cranked = true
      return { digest: '0xcrank' }
    })

    // #1751/#2122: the entry consents before it liquidates — this row measures the liquidation mechanics, so it
    // answers directly rather than depending on which way the consent lands (autonomous on a fight's first pass
    // this session, the modal after that). The consent's own behaviour: test/world-shell/world_fight_resume_offer.test.js.
    await resume_world_fight(CHARACTER_ID, { crank_door, consent: () => 'rejoin' })
    await settle_tick()

    expect(crank_door).toHaveBeenCalledTimes(1)
    expect(crank_door.mock.calls[0]).toEqual([FIGHT_ID, true, expect.any(Number)]) // silent janitor + deadline scope
    // The loop of record: the session was adopted as-is and the zombie re-captured the character.
    expect(use_dungeon.getState().fight_id).toBeNull()
    expect(use_dungeon.getState().dungeon_id).toBeNull()
    expect(board_view(fight_store.getState())).toBeNull()
  })

  test('a fight the crank could not advance still ENTERS — the forfeit exit lives on the board', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'active' })
    read_response = async (object_id) => {
      if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
      return fight_object(STATUS_ACTIVE, { turn_deadline_ms: Date.now() - 6 * 3_600_000 })
    }
    const crank_door = mock(async () => {
      throw new Error('executed abort (test)')
    })

    // #1751/#2122: the entry consents before it liquidates — this row measures the liquidation mechanics, so it
    // answers directly rather than depending on which way the consent lands (autonomous on a fight's first pass
    // this session, the modal after that). The consent's own behaviour: test/world-shell/world_fight_resume_offer.test.js.
    await resume_world_fight(CHARACTER_ID, { crank_door, consent: () => 'rejoin' })

    expect(crank_door).toHaveBeenCalledTimes(1) // ONE attempt — the tx-retry burn law, never a loop
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().fight_fresh).toBe(false)
  })

  test('a TRANSIENT read failure claims nothing — no door, no adoption, no "your fight was cleared"', async () => {
    serve_v1_fight({ fight_id: FIGHT_ID, world: WORLD_ID, status: 'active' })
    read_response = async () => {
      throw new Error('fullnode unavailable (test)') // NOT a gone-error: we do not know anything yet
    }
    const crank_door = mock(async () => ({ digest: '0xnever' }))

    await resume_world_fight(CHARACTER_ID, { crank_door })
    await settle_tick()

    expect(crank_door).not.toHaveBeenCalled() // never spend gas on a fight we could not read
    expect(use_dungeon.getState().fight_id).toBeNull() // held for a later boot pass, exactly as before
  })
})

describe('resume_decision (pure)', () => {
  const NOW = 1_000_000
  test('placement rules: open window enters · expired force_starts · terminal/unreadable skip', () => {
    expect(resume_decision({ status: STATUS_PLACEMENT, placement_deadline_ms: NOW + 1 }, NOW)).toBe('enter')
    expect(resume_decision({ status: STATUS_PLACEMENT, placement_deadline_ms: 0 }, NOW)).toBe('enter') // windowless — defensive, never wedge on absent data
    expect(resume_decision({ status: STATUS_PLACEMENT, placement_deadline_ms: NOW }, NOW)).toBe('force_start')
    expect(resume_decision({ status: STATUS_PLACEMENT, placement_deadline_ms: 12n }, NOW)).toBe('force_start') // bigint decode shape
    expect(resume_decision({ status: 2 }, NOW)).toBe('skip') // VICTORY — pending-outcome recovery owns the discharge
    expect(resume_decision({ status: 3 }, NOW)).toBe('skip') // DEFEAT
    expect(resume_decision(null, NOW)).toBe('skip') // unreadable — never adopt on hope
  })

  test('active rules (#882): a live turn enters · an EXPIRED turn cranks first', () => {
    expect(resume_decision({ status: STATUS_ACTIVE, turn_deadline_ms: NOW + 1 }, NOW)).toBe('enter')
    expect(resume_decision({ status: STATUS_ACTIVE, turn_deadline_ms: 0 }, NOW)).toBe('enter') // no deadline stamped yet
    expect(resume_decision({ status: STATUS_ACTIVE }, NOW)).toBe('enter') // the P0 mid-fight refresh law, untouched
    expect(resume_decision({ status: STATUS_ACTIVE, turn_deadline_ms: NOW }, NOW)).toBe('crank')
    expect(resume_decision({ status: STATUS_ACTIVE, turn_deadline_ms: BigInt(NOW - 60_000) }, NOW)).toBe('crank')
  })
})
