// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1751 / #1757 → #2122 → D48 — FIGHT PRESENCE IS BINARY.
//
// Measured on served `15813ddb0`: every boot onto a chain-seated character re-entered through the dialog-less
// create-adopt path, and the liquidation door then committed the overdue turn — one real gas-burning transaction
// per boot, five boots in the leg, five transactions, no player action anywhere. The same mechanism resolved a
// stranded QA fight as a DEFEAT the player never chose. #1751's fix was a MODAL; #2122 kept it as the fallback
// behind ONE autonomous attempt per fight per session.
//
// D48 (owner ruling) supersedes both: a refresh AUTO-RESUMES, the only exits from a fight are death and
// surrender, and there are no dialogs, prompts or held states in between — a player standing in the overworld
// holding a question about a fight they are still in IS the held state the ruling abolishes. So the cap is gone
// with the modal it existed to route into: EVERY candidacy answers 'rejoin', and a candidacy that ends in no
// mounted session is retried by the next one. The burn is bounded by the CANDIDACY CADENCE instead of a counter
// (one deliberate re-entry ⇒ at most one liquidation transaction — fight_resume_auto.js states it in full).
//
// The two rows that carry the ruling: THE RETRY (a refused auto-rejoin is answered again on the next candidacy,
// and nothing is ever parked) and THE REACHABLE-STATE INVARIANT (no surface in the build can render a third
// state to be in). Both are red against the landed cap. Scoped to the ENTRY path only: the in-fight liquidation
// probes (maybe_liquidate / maybe_force_start) keep auto-advancing — there the player is present and watching.
//
// Harness idiom mirrors world_fight_gone_supersede.test.js: /v1 through the fetch mock, the chain read through
// the expedition SDK mock, the chain WRITES through the injected doors (nothing signs in a unit test).

import fs from 'node:fs'

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { install_browser_globals } from '../../src/test_helpers/browser_globals.js'
import { reset_auth_mock } from '../../src/test_helpers/auth_mock.js'
import { reset_expedition_sdk_mock, set_expedition_sdk_mock } from '../../src/test_helpers/expedition_sdk_mock.js'

const restore_browser_globals = install_browser_globals({ with_document: true })

const OWNER = '0xowner'
const CHARACTER_ID = '0xcharacter'
const FIGHT_ID = '0xstrandedfight'
const WORLD_ID = '0xworld'
const HOUR_MS = 3_600_000

/** The chain read the entry blocks on — the test decides what the Fight object says. */
let chain_read = /** @type {(object_id: string) => Promise<any>} */ (
  async () => {
    throw new Error('test read response was not configured')
  }
)
const get_object = mock(({ objectId }) => chain_read(objectId))
const get_sdk = async () => ({ grpc_client: { core: { getObject: get_object } } })
set_expedition_sdk_mock(get_sdk)

const { use_auth } = await import('../../src/auth')
const { _reset_rpc_client_for_test } = await import('../../src/rpc/client')
const { use_dungeon } = await import('../../src/world-shell/dungeon_store.js')
const { resume_world_fight } = await import('../../src/world-shell/world_fight.js')

const initial_dungeon = use_dungeon.getInitialState()
const real_fetch = globalThis.fetch

/** A Fight object read: ACTIVE, with its turn deadline an hour in the past (the stranded seat of record). */
const stranded_fight = (turn_deadline_ms) => ({
  object: {
    version: 7,
    json: {
      id: FIGHT_ID,
      world: WORLD_ID,
      status: 1, // fight.move ACTIVE
      turn_deadline_ms: String(turn_deadline_ms),
      participants: [],
      mobs: [],
      queue: [],
    },
  },
})

/** The same Fight object after its overdue turn was forfeited and the fight resolved TERMINAL (fight.move DEFEAT
 *  = 3) — nothing a session can mount, an outcome to recover. */
const settled_fight = () => ({ object: { version: 8, json: { ...stranded_fight(0).object.json, status: 3 } } })

/** A Fight object read: PLACEMENT, window closed — the zombie nothing can start (#932's shape). The one live
 *  status whose autonomous attempt can end in NO mounted session, which is what the retry row is about. */
const held_placement = (placement_deadline_ms) => ({
  object: {
    version: 7,
    json: {
      id: FIGHT_ID,
      world: WORLD_ID,
      status: 0, // fight.move PLACEMENT
      placement_deadline_ms: String(placement_deadline_ms),
      turn_deadline_ms: '0',
      participants: [],
      mobs: [],
      queue: [],
    },
  },
})

/** /v1 lists the character's live seat (the serving node's projection — how the candidate reaches the door). */
const serve_live_seat = (status = 'active') => {
  globalThis.fetch = mock(async (input) => {
    const body = new URL(String(input)).pathname.endsWith('/fights')
      ? { fights: [{ fight_id: FIGHT_ID, world: WORLD_ID, status }] }
      : { characters: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
}

const settle_tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))
const trace_rows = () => /** @type {any[]} */ (globalThis.window?.__ARES_FIGHT_TRACE ?? [])
const traced = (event) => trace_rows().filter((row) => row.event === event)
/** Park until the entry has answered its own consent for the Nth time (the two /v1 hops sit 750ms apart). */
const until_auto = async (n) => {
  for (let i = 0; i < 400 && traced('fight_resume_auto').length < n; i += 1) await settle_tick(10)
}
/** Capture the by-law-loud refusal (#932) of a pass that is SETUP rather than the row's subject. */
const without_console_error = async (run) => {
  const real_console_error = console.error
  console.error = mock(() => {})
  try {
    return await run()
  } finally {
    console.error = real_console_error
  }
}

beforeEach(() => {
  reset_auth_mock({ address: OWNER })
  set_expedition_sdk_mock(get_sdk)
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  use_auth.setState({ address: OWNER })
  get_object.mockClear()
  _reset_rpc_client_for_test()
  serve_live_seat()
  const target = /** @type {any} */ (globalThis.window)
  target.__ARES_FIGHT_TRACE_ENABLED = true // the trace rail is dev-gated; these rows assert on it
  target.__ARES_FIGHT_TRACE = []
  chain_read = async (object_id) => {
    if (object_id !== FIGHT_ID) throw new Error(`unexpected object read: ${object_id}`)
    return stranded_fight(Date.now() - HOUR_MS)
  }
})

afterEach(() => {
  use_dungeon.getState()._stop_polling()
  use_dungeon.setState(initial_dungeon, true)
  globalThis.fetch = real_fetch
  _reset_rpc_client_for_test()
  reset_expedition_sdk_mock()
  reset_auth_mock()
})

afterAll(restore_browser_globals)

const THREE_PASS_MS = 30_000 // an entry pass is seconds of mocked reads; the retry row drives three of them

describe('D48 — a held fight is retried on every candidacy, and nothing is ever parked', () => {
  test('the happy path: one candidacy, one autonomous answer, one transaction, mounted', async () => {
    const crank_door = mock(async () => {
      chain_read = async () => stranded_fight(Date.now() + HOUR_MS) // the crank advanced the turn
      return { digest: '0xcrank' }
    })

    const entry = resume_world_fight(CHARACTER_ID, { crank_door })
    await until_auto(1)

    // Pre-#2122: the entry parked on the modal here and NOTHING happened until a human answered it.
    expect(traced('fight_resume_auto')).toHaveLength(1)
    expect(traced('fight_resume_auto')[0]).toMatchObject({
      fight_id: FIGHT_ID,
      character_id: CHARACTER_ID,
      action: 'crank',
      deadline_ms: expect.any(Number),
    })

    await entry
    await settle_tick()

    expect(crank_door).toHaveBeenCalledTimes(1) // ONE autonomous transaction, and it is the player's own rejoin
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
    expect(use_dungeon.getState().fight_fresh).toBe(false) // resumed — the entry cinematic never replays
  })

  test(
    'RED-FIRST: a REFUSED auto-rejoin is answered again on the NEXT candidacy — no cap, no parked offer',
    async () => {
      // The unstartable zombie (#932): an expired PLACEMENT window whose permissionless force_start does not
      // land. It is the one shape whose autonomous attempt ends in NO mounted session — pre-D48 the fight was
      // then out of autonomous attempts forever and the SECOND pass parked the modal instead of retrying.
      serve_live_seat('placement')
      chain_read = async () => held_placement(Date.now() - HOUR_MS)
      const force_start_door = mock(async () => {
        throw new Error('pre-flight refused (test)')
      })

      await without_console_error(() => resume_world_fight(CHARACTER_ID, { force_start_door }))
      expect(traced('fight_resume_auto')).toHaveLength(1)
      expect(force_start_door).toHaveBeenCalledTimes(1)
      expect(use_dungeon.getState().fight_id).toBe(null) // the attempt ended in NO mounted session

      // THE NEXT CANDIDACY (a re-entry / world bind / character switch). Pre-D48 this traced NO second
      // `fight_resume_auto` and raised an offer instead; under the binary law it simply asks the chain again.
      await without_console_error(() => resume_world_fight(CHARACTER_ID, { force_start_door }))

      expect(traced('fight_resume_auto')).toHaveLength(2) // pre-D48: 1 — the cap had been spent
      expect(traced('fight_resume_auto')[1]).toMatchObject({ fight_id: FIGHT_ID, character_id: CHARACTER_ID })
      expect(force_start_door).toHaveBeenCalledTimes(2) // one transaction per candidacy — never two in one
      expect(use_dungeon.getState().fight_id).toBe(null)

      // …and the third candidacy is the one that heals it: retrying is the whole point of retrying.
      const healing_door = mock(async () => {
        chain_read = async () => stranded_fight(Date.now() + HOUR_MS)
        return { digest: '0xforcestart' }
      })
      await resume_world_fight(CHARACTER_ID, { force_start_door: healing_door })
      await settle_tick()

      expect(traced('fight_resume_auto')).toHaveLength(3)
      expect(healing_door).toHaveBeenCalledTimes(1)
      expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
      // Nothing anywhere in the run asked the player anything.
      expect(traced('fight_resume_offer')).toHaveLength(0)
      expect(traced('fight_resume_choice')).toHaveLength(0)
    },
    THREE_PASS_MS
  )

  test('the autonomous answer is only ever REJOIN — no automatic path abandons a seat', async () => {
    const forfeit_door = mock(async () => ({ digest: '0xabandon' }))
    const crank_door = mock(async () => {
      chain_read = async () => settled_fight() // the forfeited turn resolved the fight on chain
      return { digest: '0xcrank' }
    })
    const recover = mock(() => {})
    use_dungeon.setState({ _recover_dead_fight_reference: recover })

    await resume_world_fight(CHARACTER_ID, { crank_door, forfeit_door })
    await settle_tick()

    // #1751's defect was a seat resolving as a DEFEAT nobody chose. Under D48 the machine may spend a rejoin
    // per candidacy; it may never choose the seat's DEATH — `actions::abandon` stays a player-only door, and
    // the only place it can be pressed is inside the mounted board (FightControls.jsx).
    expect(forfeit_door).not.toHaveBeenCalled()
    expect(crank_door).toHaveBeenCalledTimes(1)
    expect(traced('fight_resume_choice')).toHaveLength(0) // nothing answered anything — nothing was asked
    expect(recover).toHaveBeenCalledTimes(1) // terminal on chain ⇒ routed out honestly, never re-captured
    expect(recover.mock.calls[0][0]).toMatchObject({ character_id: CHARACTER_ID, state: 'settled' })
  })

  test('a HEALTHY seat inside its deadline mounts straight away — no consent, no transaction', async () => {
    const crank_door = mock(async () => ({ digest: '0xcrank' }))
    chain_read = async () => stranded_fight(Date.now() + HOUR_MS)

    await resume_world_fight(CHARACTER_ID, { crank_door })
    await settle_tick()

    expect(traced('fight_resume_auto')).toHaveLength(0) // nothing to consent to: no transaction is composed
    expect(crank_door).not.toHaveBeenCalled()
    expect(use_dungeon.getState().fight_id).toBe(FIGHT_ID)
  })
})

// ── D48 · THE REACHABLE-STATE INVARIANT ───────────────────────────────────────────────────────────────────────
// The rows above prove the client always retries. These prove there is no third state for it to retry FROM: from
// a held-fight seat the reachable presence states are exactly {mounted fight, auto-resume in flight}, and the way
// to keep that true forever is to assert that NOTHING in the shipped source can render a resume question. The
// scanner is an instrument, so it carries a positive control — a scan that can only ever return zero proves
// nothing (the instruments-throw law).

const SRC = new URL('../../src/', import.meta.url).pathname
const LOCALES = new URL('../../src/i18n/locales/', import.meta.url).pathname

/** Every JS/JSX source file the frontend ships. Throws if the walk finds nothing — an empty population is a
 *  broken instrument, never a pass. */
const source_files = () => {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${full}/`)
      else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full)
    }
  }
  walk(SRC)
  if (out.length < 100) throw new Error(`source walk found only ${out.length} files — the scanner is broken`)
  return out
}

/**
 * THE CONVICTION RUBRIC — three independent forms a resume QUESTION can take in this codebase, matching what
 * #1751's door actually looked like: a store of pending offers, a call that answers one, and the copy a dialog
 * would render. `consent_fight_resume` is deliberately NOT convicted: it is the auto-answer, not a question.
 * @param {string} source @returns {string[]} the convicted forms
 */
const convict = (source) => {
  const hits = []
  if (/fight_resume_offer_store|resume_offer_store/.test(source)) hits.push('offer-store')
  if (/choose_fight_resume|fight_resume_offer\.js|FightResumeOffer/.test(source)) hits.push('answer-door')
  if (/resume_offer_(title|message|rejoin|forfeit|later)/.test(source)) hits.push('dialog-copy')
  return hits
}

describe('D48 — the reachable presence states are exactly {mounted fight, auto-resume in flight}', () => {
  test('the scanner convicts a resume question when there is one (positive control)', () => {
    // Verbatim shapes from the deleted door — if the rubric stops matching these, the rows below are theater.
    expect(
      convict('const o = useSyncExternalStore(fight_resume_offer_store.subscribe, fight_resume_offer_store.get)')
    ).toContain('offer-store')
    expect(convict("on_confirm={() => choose_fight_resume('rejoin')}")).toContain('answer-door')
    expect(convict("title={i18n.t('fights.resume_offer_title')}")).toContain('dialog-copy')
    expect(convict('export function consent_fight_resume(candidacy) {')).toEqual([]) // an answer is not a question
  })

  test('RED-FIRST: no shipped source can render a resume question', () => {
    const convicted = source_files()
      .map((file) => ({ file, forms: convict(fs.readFileSync(file, 'utf8')) }))
      .filter(({ forms }) => forms.length)
      .map(({ file, forms }) => `${file.slice(SRC.length)} · ${forms.join('+')}`)

    // Pre-D48 this listed the door itself (game/screens/hud/world/FightResumeOffer.jsx,
    // world-shell/fight_resume_offer.js) and its mount site (game/screens/hud/world/GameWorldHud.jsx). Under the
    // binary law the set is empty: a held seat has no question to be the subject of, so nothing can hold one.
    expect(convicted).toEqual([])
  })

  test.each(['en', 'fr', 'de', 'es', 'ja', 'uk'])('%s.json carries no resume-question copy', (lang) => {
    const raw = fs.readFileSync(`${LOCALES}${lang}.json`, 'utf8')
    const json = JSON.parse(raw)
    expect(json.fights).toBeTruthy() // positive control: the namespace those keys lived in still exists
    expect(convict(raw)).toEqual([])
    expect(json.characters?.resume_fight).toBeUndefined() // the orphaned "Resume fight" label went with them
  })

  test(
    'a held seat is never observed in a state that holds a question',
    async () => {
      serve_live_seat('placement')
      chain_read = async () => held_placement(Date.now() - HOUR_MS)
      const force_start_door = mock(async () => {
        throw new Error('pre-flight refused (test)')
      })

      let answered = 0
      /** The observable presence state, sampled as a label. `held` is the state D48 abolishes — pre-D48 the
       *  second candidacy sat in it, parked on the modal, and `fight_resume_auto` never incremented. */
      const presence = () =>
        use_dungeon.getState().fight_id != null
          ? 'mounted'
          : traced('fight_resume_auto').length > answered
            ? 'resuming'
            : 'held'
      const observed = new Set()

      for (let candidacy = 0; candidacy < 2; candidacy += 1) {
        const pass = without_console_error(() => resume_world_fight(CHARACTER_ID, { force_start_door }))
        await until_auto(candidacy + 1)
        observed.add(presence()) // mid-flight: the client is answering, never asking
        await pass
        answered = traced('fight_resume_auto').length
      }

      expect(observed).toEqual(new Set(['resuming']))
      expect(traced('fight_resume_auto')).toHaveLength(2) // every candidacy answered — none of them asked
    },
    THREE_PASS_MS
  )
})
