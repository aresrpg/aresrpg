// FIGHT ENGINE · W4 phase.js — unit coverage: every transition + every unmet-precondition HOLD.
// The live half (driven Playwright) proves the mount decisions on the real dev server; this proves the pure
// derivation exhaustively, including the D81 terminal latch (out-of-fight leave NEVER reaches TERMINAL).
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

// The adapter's REAL mount/teardown verdict (headless-safe pure fold) — composed with derive_phase below so the
// terminal-exemption test proves the frozen board actually SURVIVES the reconcile, not just the phase label.
import { board_lifecycle_decision } from '../world-shell/voxel_fight_folds.js'

import {
  derive_phase,
  PHASE,
  STATUS_OPEN,
  STATUS_ACTIVE,
  STATUS_ROOM_CLEARED,
  STATUS_WON,
  STATUS_FAILED,
  STATUS_PLACEMENT,
  mark_active_seat,
  had_active_seat,
  session_reset,
  _active_seat,
  should_mount_board,
  is_placement,
  is_active,
  should_show_result,
  result_outcome,
  is_exit,
  _reset_warn_dedup,
} from './phase.js'
// D153 keystone: derive_phase defers to the fight-END machine (is_ending forces ROAM across the whole cycle).
// Drive it through its real driver API so these tests prove the ACTUAL wiring, not a re-implementation.
import { note_victory, note_claimed, note_player_advance, is_ending, _fe_reset_for_test } from './fight_end_machine.js'

// ── builders — the minimal shapes derive_phase reads (mirrors the real dungeon/fight/seat fields). ──
const ADDR = '0xME00000000000000000000000000000000000000000000000000000000000me'
const seat = (over = {}) => ({ addr: ADDR, alive: true, cell: 5, hp: 100, max_hp: 100, ...over })
const dungeon = (status, over = {}) => ({
  id: '0xDUNGEON00000000000000000000000000000000000000000000000000000dgn', // === DID (fight_id) → slice_here
  status,
  room_index: 0,
  escrow: [seat()],
  mobs: [{ cell: 44, hp: 30, max_hp: 30, alive: true }],
  ...over,
})
const DID = '0xDUNGEON00000000000000000000000000000000000000000000000000000dgn'
/** A coherent ACTIVE fight slice (all preconditions met, keyed to the default dungeon id). `placement:false`. */
const fight = (over = {}) => ({
  fight_id: DID, // MUST equal dungeon().id so the machine recognises the slice as THIS dungeon's (slice_here)
  arena: { width: 10, height: 10, cells: new Uint8Array(100) },
  my_entity_id: ADDR,
  fighters: new Map([[ADDR, { id: ADDR, cell: { x: 5, y: 0 }, dead: false }]]),
  placement_cells: {
    0: [
      { x: 3, y: 0 },
      { x: 4, y: 0 },
    ],
    1: [],
  },
  hand: ['fire_strike'],
  turn_order: [ADDR, 'mob-0'],
  active_entity_id: ADDR,
  placement: false,
  winner: -1,
  ...over,
})
/** A coherent PLACEMENT slice (placement:true, no active turn yet) — the presence-truth of a spawned board. */
const placement_fight = (over = {}) => fight({ placement: true, active_entity_id: null, ...over })

beforeEach(() => {
  session_reset()
  _reset_warn_dedup()
  _fe_reset_for_test() // derive_phase reads the fight-end machine's module cell (is_ending) — keep it IDLE per test
})
afterEach(() => {
  session_reset()
  _fe_reset_for_test()
})

describe('the session latch (D81 generalisation)', () => {
  it('marks / reads / resets, keyed per dungeon id', () => {
    expect(had_active_seat('0xAAA')).toBe(false)
    mark_active_seat('0xAAA')
    expect(had_active_seat('0xAAA')).toBe(true)
    expect(had_active_seat('0xBBB')).toBe(false) // a DIFFERENT dungeon never inherits the latch
    expect(_active_seat()).toBe('0xAAA')
    session_reset()
    expect(had_active_seat('0xAAA')).toBe(false)
    expect(_active_seat()).toBe(null)
  })
  it('mark is idempotent and ignores empty ids', () => {
    mark_active_seat('')
    expect(_active_seat()).toBe(null)
    mark_active_seat('0xAAA')
    mark_active_seat('0xAAA')
    expect(_active_seat()).toBe('0xAAA')
  })
})

describe('ROAM', () => {
  it('no dungeon → ROAM (the base lobby state), zero unmet', () => {
    const r = derive_phase(null, null, null)
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.unmet).toEqual([])
    expect(r.desired).toBe(PHASE.ROAM)
  })
  it('OPEN waiting room → ROAM (in the plane, no board)', () => {
    expect(derive_phase(dungeon(STATUS_OPEN), null, seat()).phase).toBe(PHASE.ROAM)
  })
  it('ROOM_CLEARED (between rooms) → ROAM', () => {
    expect(derive_phase(dungeon(STATUS_ROOM_CLEARED), null, seat()).phase).toBe(PHASE.ROAM)
  })
})

describe('D107 boot reconciliation — app open NEVER presents a fight (only reconciles)', () => {
  // A player might reopen the app while their character sits at ROOM_CLEARED (a cleared room). Boot must land them
  // in the waiting PLANE (ROAM = free-roam, next cluster clickable), never a board/card, and the room-start txs
  // fire ONLY from an explicit click (guarded in dungeon_store.start_next_room/start_when_ready with { user }).
  // These assert the phase-machine half: a fresh boot into a cleared/terminal dungeon derives a NON-fighting
  // phase, so nothing mounts a board or a result card off the boot read alone.
  beforeEach(() => session_reset()) // a fresh app open has never latched an ACTIVE seat this session

  it('boot into a ROOM_CLEARED dungeon (no local latch) → ROAM: waiting plane, no board, no card, no start', () => {
    const r = derive_phase(dungeon(STATUS_ROOM_CLEARED), null, seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(should_mount_board(r)).toBe(false)
    expect(should_show_result(r)).toBe(false)
  })

  it('boot into a WON dungeon the client did NOT fight this session → EXIT, never a phantom result card', () => {
    // On boot the D81 latch is clear (session_reset), so a terminal chain status the client never fought routes
    // to EXIT (clean leave), NOT TERMINAL — no unearned Victory card slammed over a boot.
    const r = derive_phase(dungeon(STATUS_WON), null, seat())
    expect(r.phase).toBe(PHASE.EXIT)
    expect(should_mount_board(r)).toBe(false)
    expect(should_show_result(r)).toBe(false)
  })

  it('boot into an OPEN (idle) dungeon → ROAM: the waiting room, never an auto-started board', () => {
    const r = derive_phase(dungeon(STATUS_OPEN), null, seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(should_mount_board(r)).toBe(false)
  })
})

describe('PLACEMENT', () => {
  it('status PLACEMENT + all preconditions → PLACEMENT', () => {
    const r = derive_phase(dungeon(STATUS_PLACEMENT), placement_fight(), seat())
    expect(r.phase).toBe(PHASE.PLACEMENT)
    expect(r.unmet).toEqual([])
  })
  it('HOLDS at ROAM when the fight slice has not spawned yet (names no_fight_slice)', () => {
    const r = derive_phase(dungeon(STATUS_PLACEMENT), null, seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.desired).toBe(PHASE.PLACEMENT)
    expect(r.unmet).toContain('no_fight_slice')
  })
  it('HOLDS when the placement cells are missing (half-init board)', () => {
    const r = derive_phase(dungeon(STATUS_PLACEMENT), placement_fight({ placement_cells: { 0: [], 1: [] } }), seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.unmet).toContain('no_placement_cells')
  })
  it('HOLDS when my entity is not yet keyed into the fighters map', () => {
    const r = derive_phase(dungeon(STATUS_PLACEMENT), placement_fight({ fighters: new Map() }), seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.unmet).toContain('my_entity_missing_from_fighters')
  })
  it('does NOT block on an empty hand (the cosmetic deck fills after the board mounts — no deadlock)', () => {
    const r = derive_phase(dungeon(STATUS_PLACEMENT), placement_fight({ hand: [] }), seat())
    expect(r.phase).toBe(PHASE.PLACEMENT) // the hand is not a mount precondition
    expect(r.unmet).toEqual([])
  })
  it('HOLDS when I hold no seat at all', () => {
    const r = derive_phase(dungeon(STATUS_PLACEMENT, { escrow: [] }), placement_fight(), null)
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.unmet).toContain('no_my_seat')
  })
})

describe('D89 PRESENCE-TRUTH RECONCILIATION (the chain-proved divergence: slice placement vs stale dungeon.status)', () => {
  it('slice in placement while dungeon.status is a STALE OPEN → PLACEMENT (presence-truth wins)', () => {
    // the exact qa divergence: fight.placement=true, fighters+zones present, but dungeon.status still OPEN.
    const r = derive_phase(dungeon(STATUS_OPEN), placement_fight(), seat())
    expect(r.phase, 'presence-truth: a spawned placement slice IS placement, never ROAM/OPEN').toBe(PHASE.PLACEMENT)
    expect(r.unmet).toEqual([])
  })
  it('slice active (started, unresolved) while dungeon.status is a stale non-ACTIVE → ACTIVE', () => {
    const r = derive_phase(dungeon(STATUS_OPEN), fight(), seat())
    expect(r.phase).toBe(PHASE.ACTIVE)
  })
  it('STEER 2 (forward lag): chain ACTIVE while the slice placement flag is STALE-TRUE → ACTIVE (chain wins)', () => {
    // the D77 recurrence: place_at landed, dungeon.status=ACTIVE (seat + turn + deadline), but fight.placement
    // stayed true (the respawn-flip never fired). The machine must NOT stay in placement — take the furthest-along.
    const r = derive_phase(
      dungeon(STATUS_ACTIVE),
      placement_fight({ active_entity_id: ADDR }), // stale placement:true BUT the chain says ACTIVE
      seat()
    )
    expect(r.phase, 'the chain-ACTIVE read overrides the stale placement flag').toBe(PHASE.ACTIVE)
    expect(r.desired).toBe(PHASE.ACTIVE)
  })
  it('slice resolved a winner before the terminal chain read lands → TERMINAL (with the latch)', () => {
    const d = dungeon(STATUS_ACTIVE) // chain not yet WON, but the slice already shows a winner
    mark_active_seat(d.id)
    const r = derive_phase(d, fight({ winner: 1 }), seat())
    expect(r.phase).toBe(PHASE.TERMINAL)
    expect(r.outcome).toBe('defeat')
  })
  it('a slice for a DIFFERENT fight_id does NOT hijack this dungeon (slice_here guard)', () => {
    // a stale slice from a prior dungeon must not drive THIS dungeon's phase.
    const r = derive_phase(dungeon(STATUS_OPEN), fight({ fight_id: '0xOTHERFIGHT', placement: true }), seat())
    expect(r.phase, 'a foreign slice is ignored — the OPEN dungeon is ROAM').toBe(PHASE.ROAM)
  })
})

describe('ACTIVE', () => {
  it('status ACTIVE + my entity ∈ fighters + turn data → ACTIVE', () => {
    const r = derive_phase(dungeon(STATUS_ACTIVE), fight(), seat())
    expect(r.phase).toBe(PHASE.ACTIVE)
    expect(r.unmet).toEqual([])
  })
  it('HOLDS at ROAM when the slice has not re-synced (status ACTIVE, no fighters) — the D77 stuck-flip', () => {
    const r = derive_phase(dungeon(STATUS_ACTIVE), fight({ fighters: new Map() }), seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.desired).toBe(PHASE.ACTIVE)
    expect(r.unmet).toContain('my_entity_missing_from_fighters')
  })
  it('HOLDS when turn_order is empty', () => {
    const r = derive_phase(dungeon(STATUS_ACTIVE), fight({ turn_order: [] }), seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.unmet).toContain('no_turn_order')
  })
  it('HOLDS when no active entity is resolved', () => {
    const r = derive_phase(dungeon(STATUS_ACTIVE), fight({ active_entity_id: null }), seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.unmet).toContain('no_active_entity')
  })
})

describe('TERMINAL (the D81 rule as a machine invariant)', () => {
  it('WON after an ACTIVE-seated session → TERMINAL victory', () => {
    const d = dungeon(STATUS_WON)
    mark_active_seat(d.id) // I fought this dungeon
    const r = derive_phase(d, fight({ winner: 0 }), seat())
    expect(r.phase).toBe(PHASE.TERMINAL)
    expect(r.outcome).toBe('victory')
    expect(should_show_result(r)).toBe(true)
    expect(result_outcome(r)).toBe('victory')
  })
  it('FAILED after an ACTIVE-seated session → TERMINAL defeat', () => {
    const d = dungeon(STATUS_FAILED)
    mark_active_seat(d.id)
    const r = derive_phase(d, fight({ winner: 1 }), seat())
    expect(r.phase).toBe(PHASE.TERMINAL)
    expect(r.outcome).toBe('defeat')
  })
  it('WON but NEVER ACTIVE-seated this session → EXIT, NO card (the out-of-fight leave / observer)', () => {
    const d = dungeon(STATUS_WON) // latch NOT set → never fought it
    const r = derive_phase(d, fight({ winner: 0 }), seat())
    expect(r.phase).toBe(PHASE.EXIT)
    expect(r.outcome).toBe(null)
    expect(should_show_result(r)).toBe(false)
    expect(is_exit(r)).toBe(true)
    expect(r.desired).toBe(PHASE.TERMINAL) // it WANTED terminal; the latch denied it
    expect(r.unmet).toContain('never_active_seated_this_session')
  })
  it('FAILED but not escrowed (already left) → EXIT, no card', () => {
    const d = dungeon(STATUS_FAILED, { escrow: [] })
    mark_active_seat(d.id)
    const r = derive_phase(d, fight({ winner: 1 }), null)
    expect(r.phase).toBe(PHASE.EXIT)
    expect(r.unmet).toContain('not_escrowed')
  })
  it("a DIFFERENT dungeon's latch does not unlock this terminal", () => {
    mark_active_seat('0xSOMEOTHERDUNGEON')
    const r = derive_phase(dungeon(STATUS_WON), fight({ winner: 0 }), seat())
    expect(r.phase).toBe(PHASE.EXIT) // the latch is per-id — this dungeon was never fought
  })
})

describe('mount-decision predicates (the machine owns mounts)', () => {
  it('board mounts in PLACEMENT, ACTIVE, and earned TERMINAL — never ROAM', () => {
    const active = derive_phase(dungeon(STATUS_ACTIVE), fight(), seat())
    const place = derive_phase(dungeon(STATUS_PLACEMENT), placement_fight(), seat())
    const roam = derive_phase(dungeon(STATUS_OPEN), null, seat())
    const won = dungeon(STATUS_WON)
    mark_active_seat(won.id)
    const terminal = derive_phase(won, fight({ winner: 0 }), seat())
    expect(should_mount_board(active)).toBe(true)
    expect(should_mount_board(place)).toBe(true)
    expect(should_mount_board(terminal)).toBe(true) // frozen board behind the card + claim host
    expect(should_mount_board(roam)).toBe(false)
    // but only ACTIVE/PLACEMENT render INTERACTIVE chrome — TERMINAL renders neither
    expect(is_active(active)).toBe(true)
    expect(is_placement(place)).toBe(true)
    expect(is_active(terminal)).toBe(false)
    expect(is_placement(terminal)).toBe(false)
    expect(is_active(place)).toBe(false)
    expect(is_placement(active)).toBe(false)
  })
  it('EXIT mounts NO board and NO card (kills the ghost-board class)', () => {
    const d = dungeon(STATUS_WON) // unearned terminal → EXIT
    const r = derive_phase(d, fight({ winner: 0 }), seat())
    expect(should_mount_board(r)).toBe(false)
    expect(should_show_result(r)).toBe(false)
    expect(is_exit(r)).toBe(true)
  })
})

describe('the full session path ROAM→PLACEMENT→ACTIVE→TERMINAL→(reset)ROAM', () => {
  it('walks every legal transition with the latch gating terminal', () => {
    const d = { id: '0xRUN000000000000000000000000000000000000000000000000000000000run' }
    const fid = { fight_id: d.id } // keep the slice keyed to THIS run so slice_here (presence-truth) engages
    // ROAM (OPEN)
    expect(derive_phase({ ...dungeon(STATUS_OPEN), id: d.id }, null, seat()).phase).toBe(PHASE.ROAM)
    // PLACEMENT
    expect(derive_phase({ ...dungeon(STATUS_PLACEMENT), id: d.id }, placement_fight(fid), seat()).phase).toBe(
      PHASE.PLACEMENT
    )
    // ACTIVE — and the store would latch here
    const active = derive_phase({ ...dungeon(STATUS_ACTIVE), id: d.id }, fight(fid), seat())
    expect(active.phase).toBe(PHASE.ACTIVE)
    mark_active_seat(d.id)
    // TERMINAL (now earned)
    expect(derive_phase({ ...dungeon(STATUS_WON), id: d.id }, fight({ ...fid, winner: 0 }), seat()).phase).toBe(
      PHASE.TERMINAL
    )
    // EXIT teardown resets the latch; a re-entered fresh dungeon starts clean at ROAM
    session_reset()
    expect(had_active_seat(d.id)).toBe(false)
  })
})

// ── D153/D37 KEYSTONE (C6): the fight-end machine OUTRANKS the phase — while a non-terminal fight-end cycle is
//    in flight for THIS dungeon, derive_phase is FORCED to ROAM no matter how the (respawned next-room) slice
//    ranks. THIS is what kills the "auto-started the next room" ghost board / the 30s zombie board (D37): the
//    next room's fresh slice can rank ACTIVE all it likes; the machine remembers the victory and holds the plane
//    until the player's explicit advance unparks it. phase.test only ever proved the raw ladder; this proves the
//    machine override that the D153 module exists to provide. Driven through the REAL machine drivers.
describe('D153/D37 keystone — a live fight-end cycle FORCES ROAM (no ghost / zombie board)', () => {
  it('an ACTIVE-ranking slice is still held at ROAM while a victory cycle is in flight', () => {
    const d = dungeon(STATUS_ACTIVE) // the next room already re-spawned an ACTIVE board at the SAME dungeon id
    // ...but the machine resolved THIS room's victory (the prior room cleared) and is mid-cycle.
    note_victory(d.id, 0, 'non_terminal')
    const r = derive_phase(d, fight(), seat())
    expect(r.phase).toBe(PHASE.ROAM) // forced ROAM despite an ACTIVE chain+slice
    expect(r.unmet).toContain('fight_end_parked')
    expect(should_mount_board(r)).toBe(false) // the ghost board is unrepresentable while the cycle is live
  })
  it('the force-ROAM holds across the WHOLE cycle: resolved → claimed(parked) → and only releases on advance', () => {
    const d = dungeon(STATUS_ACTIVE)
    note_victory(d.id, 0, 'non_terminal')
    expect(derive_phase(d, fight(), seat()).phase).toBe(PHASE.ROAM) // VICTORY_RESOLVED
    note_claimed() // → PARKED (AWAIT_PLAYER_ADVANCE)
    expect(derive_phase(d, fight(), seat()).phase).toBe(PHASE.ROAM) // still parked → still ROAM
    expect(note_player_advance()).toBe(true) // the player's explicit engage gesture unparks
    // unparked: the SAME ACTIVE slice now mounts the next room's board (the machine no longer overrides).
    const after = derive_phase(d, fight(), seat())
    expect(after.phase).toBe(PHASE.ACTIVE)
    expect(should_mount_board(after)).toBe(true)
  })
  it('the override is per-dungeon: a cycle on dungeon A never forces ROAM on dungeon B', () => {
    note_victory('0xAAA', 0, 'non_terminal') // a cycle in flight for A
    const b = dungeon(STATUS_ACTIVE) // a DIFFERENT dungeon, genuinely active
    mark_active_seat(b.id)
    expect(derive_phase(b, fight(), seat()).phase).toBe(PHASE.ACTIVE) // B is unaffected by A's park
  })
  it('a TERMINAL end is NOT force-held to ROAM even while note_victory(terminal) has the machine mid-cycle', () => {
    // Regression guard (design ruling 2026-07-13) — the regression THIS proves ("if I'm killed during the turn I never see the mob
    // play, the fight is just removed"). claim() fires note_victory(dungeon.id, room, 'terminal') SYNCHRONOUSLY
    // (is_ending → TRUE) and only calls fight_end_reset() LATER, inside the death-beat-gated present() (~8s away).
    // So for the WHOLE hold the machine is MID-CYCLE. The OLD is_ending-first force returned {ROAM, fight_end_parked}
    // for the terminal read, and the adapter's use_dungeon.subscribe(reconcile) — fired by claim's OWN _stop_polling
    // set() — tore the frozen board down UNGATED, before the killing wave / defeat card. Reproduce that exact
    // state: arm the machine, THEN derive. (The prior version left the machine IDLE, so it never reproduced the bug.)
    const d = dungeon(STATUS_FAILED)
    mark_active_seat(d.id)
    note_victory(d.id, 0, 'terminal') // claim()'s synchronous first act — is_ending is now TRUE for this dungeon
    expect(is_ending(d.id)).toBe(true) // the machine really is mid-cycle (the bug's precondition)
    const r = derive_phase(d, fight({ winner: 1 }), seat())
    expect(r.phase).toBe(PHASE.TERMINAL) // the terminal read OUTRANKS the park — the frozen board survives to the card
    expect(r.outcome).toBe('defeat')
    expect(should_mount_board(r)).toBe(true)
    // and the adapter's OWN mount/teardown verdict agrees: the built board is re-WIRED, never torn down (the fix
    // is at the phase layer — board_lifecycle_decision is unchanged; feeding it TERMINAL keeps the board alive).
    const KEY = `${DID}#0`
    const decide = (result) =>
      board_lifecycle_decision({
        phase: result.phase,
        desired: result.desired,
        unmet: result.unmet,
        has_dungeon: true,
        has_fight: true,
        built_for: KEY,
        build_key: KEY,
        building: false,
      })
    expect(decide(r)).toBe('wire') // NOT 'teardown' — the death-beat gate (present) owns the eventual teardown
  })

  it('WORLD-fight flavor: end-turn death (MY seat DEAD, no RunPass context) still ranks TERMINAL mid-cycle → wire', () => {
    // The ACTUAL scenario (10 reports) was a WORLD fight: end turn → the mob's response kills the player. The
    // world lane reuses this SAME store/authority (world_fight.js, run_pass_id null) — fight_view maps
    // ENGINE_DEFEAT → STATUS_FAILED identically for both flavors (fight_bridge.js:273), so the machine sees the
    // same shape. The world-specific traits this arms: MY escrow seat is DEAD (hp 0, alive:false — a dead seat
    // is still a seat; terminal_unmet checks presence only) and the slice resolved winner=1 with my fighter
    // dead. claim() has fired note_victory(terminal) (machine mid-cycle) — the exemption must hold TERMINAL for
    // the world flavor too, or the 11th report is the world board torn down mid-wave.
    const d = dungeon(STATUS_FAILED, { escrow: [seat({ alive: false, hp: 0 })] })
    mark_active_seat(d.id) // sync_engine latched ACTIVE turns during the fight (fight_bridge.js:452)
    note_victory(d.id, 0, 'terminal') // claim()'s synchronous first act
    const [my_dead_seat] = d.escrow
    const slice = fight({
      winner: 1,
      fighters: new Map([[ADDR, { id: ADDR, cell: { x: 5, y: 0 }, dead: true }]]),
    })
    const r = derive_phase(d, slice, my_dead_seat)
    expect(r.phase).toBe(PHASE.TERMINAL)
    expect(r.outcome).toBe('defeat')
    const KEY = `${DID}#0`
    expect(
      board_lifecycle_decision({
        phase: r.phase,
        desired: r.desired,
        unmet: r.unmet,
        has_dungeon: true,
        has_fight: true,
        built_for: KEY,
        build_key: KEY,
        building: false,
      })
    ).toBe('wire') // the world board survives to its death-beat-gated card, same as the dungeon flavor
  })

  it('the terminal exemption is TERMINAL-ONLY: a NON-terminal park still forces ROAM→teardown (no D153 regression)', () => {
    // The exemption keys on rank===TERMINAL, so a room-cleared cycle whose next room already re-spawned an ACTIVE
    // slice is STILL force-held to ROAM (the ghost-board prevention the keystone exists for) and the between-rooms
    // board is torn down as designed. Guards the fix's blast radius — the park path is byte-for-byte unchanged.
    const d = dungeon(STATUS_ACTIVE)
    note_victory(d.id, 0, 'non_terminal')
    const r = derive_phase(d, fight(), seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.unmet).toContain('fight_end_parked')
    const KEY = `${DID}#0`
    expect(
      board_lifecycle_decision({
        phase: r.phase,
        desired: r.desired,
        unmet: r.unmet,
        has_dungeon: true,
        has_fight: true,
        built_for: KEY,
        build_key: KEY,
        building: false,
      })
    ).toBe('teardown') // a non-terminal park IS a designed exit (unchanged behaviour)
  })
})

// ── #33 ALL-CLIENTS VICTORY MODAL — the linchpin. The terminal card mounts on the TERMINAL phase, which is
//    gated by the D81 latch (had_active_seat). The latch is set (dungeon_store.sync_engine) on ANY poll that
//    derives PHASE.ACTIVE — and active_unmet does NOT require it to be MY turn. So a co-op BYSTANDER (a peer
//    who was in the fight but whose turn never came) still latches while the fight is ACTIVE, and therefore
//    still EARNS the terminal card when the killer's cast ends the run. This proves the modal is NOT killer-only.
describe('#33 all-clients modal — a bystander (never their turn) still earns the terminal card', () => {
  const PEER = '0xPEER0000000000000000000000000000000000000000000000000000000peer'
  // A fight slice where it is ANOTHER player's (the peer's) turn — the local player is present but not active.
  const bystander_fight = (over = {}) =>
    fight({
      turn_order: [PEER, ADDR, 'mob-0'],
      active_entity_id: PEER, // it is the PEER's turn, not mine
      ...over,
    })
  it("derive_phase is ACTIVE for a participant on a peer's turn (active_unmet is turn-agnostic)", () => {
    const r = derive_phase(dungeon(STATUS_ACTIVE), bystander_fight(), seat())
    expect(r.phase).toBe(PHASE.ACTIVE) // ACTIVE even though it is NOT my turn — this is what latches the bystander
    expect(r.unmet).toEqual([])
  })
  it('having polled ACTIVE as a bystander, a WON end resolves to TERMINAL (the card), not EXIT', () => {
    const d = dungeon(STATUS_WON)
    // replicate the store: the bystander's poll saw ACTIVE (someone else's turn) and latched...
    mark_active_seat(d.id) // == sync_engine's `if (verdict === PHASE.ACTIVE) mark_active_seat` for the bystander
    // ...then the killer's cast flips WON; the bystander's next poll folds it → TERMINAL card, same as the killer.
    const r = derive_phase(d, bystander_fight({ winner: 0 }), seat())
    expect(r.phase).toBe(PHASE.TERMINAL)
    expect(should_show_result(r)).toBe(true)
    expect(result_outcome(r)).toBe('victory')
  })
})

// ── W2 — the active-seat latch SURVIVES A RELOAD (sessionStorage read-through) ─────────────────────────────
// The refresh leg of the eaten-win-card class: the module cell dies with the page, so a reload between the
// chain flipping WON and the card resolving used to EXIT ('never_active_seated_this_session') and the boot-
// rescue silently ate the receipt. A "reload" here = a CLEAN module cell + seeded storage — exactly what a
// fresh import sees after a refresh (no module-cache busting needed; the cell IS the only volatile part).
describe('W2 — active-seat latch survives reload (sessionStorage read-through)', () => {
  const KEY = 'ares:active_seat_dungeon'
  const make_storage = () => {
    const m = new Map()
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    }
  }
  beforeEach(() => {
    globalThis.sessionStorage = /** @type {any} */ (make_storage())
    session_reset() // clean module cell AND clean storage per test
  })
  afterEach(() => {
    delete globalThis.sessionStorage
  })

  it('mark_active_seat persists the latch per tab (storage written)', () => {
    mark_active_seat(DID)
    expect(sessionStorage.getItem(KEY)).toBe(DID)
  })

  it('a reload (clean module cell, seeded storage) still answers had_active_seat', () => {
    sessionStorage.setItem(KEY, DID) // the pre-reload page marked it; the module cell died with that page
    expect(_active_seat()).toBe(null) // proves the answer comes from the read-through, never the cell
    expect(had_active_seat(DID)).toBe(true)
    expect(had_active_seat('0xOTHER')).toBe(false) // keyed — a different dungeon never inherits the latch
  })

  it('post-reload, a WON dungeon reaches TERMINAL (the win card) instead of EXIT', () => {
    sessionStorage.setItem(KEY, DID)
    const r = derive_phase(dungeon(STATUS_WON), fight({ winner: 0 }), seat())
    expect(r.phase).toBe(PHASE.TERMINAL)
    expect(should_show_result(r)).toBe(true)
    expect(result_outcome(r)).toBe('victory')
  })

  it('session_reset clears the persisted latch too (no cross-session leak)', () => {
    mark_active_seat(DID)
    session_reset()
    expect(sessionStorage.getItem(KEY)).toBe(null)
    expect(had_active_seat(DID)).toBe(false)
  })
})

// ── P0 STRANDED WORLD FIGHT ("phase HELD at ROAM with a LIVE on-chain fight … no fight UI"). When a live
//    world fight's board can't mount (the coords guard refused an unplaceable anchor, or a slice half-inits), the
//    machine CORRECTLY holds at ROAM — it must never mount a half-init board. This locks the CONTRACT the stranded
//    escape (DungeonLeaveButton) reads off that ROAM verdict: no board and no result card own the screen, so its
//    `!should_mount_board && !should_show_result` gate opens and the forfeit stays reachable. No phase.js LOGIC
//    change is needed — the hold is right; the escape was simply gated out for world fights (its own in_session
//    fix). These prove the ROAM verdict the fix depends on. ──
describe('P0 stranded world fight — a live fight with an incoherent slice HOLDS at ROAM (the escape contract)', () => {
  it('status ACTIVE + a NULL slice ⇒ ROAM (no_fight_slice); NO board, NO result card own the screen', () => {
    const r = derive_phase(dungeon(STATUS_ACTIVE), null, seat()) // the refused-board / not-yet-synced hold
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.desired).toBe(PHASE.ACTIVE)
    expect(r.unmet).toContain('no_fight_slice')
    expect(should_mount_board(r)).toBe(false) // ⇒ the stranded escape's gate opens (forfeit reachable)
    expect(should_show_result(r)).toBe(false)
  })

  it('status ACTIVE + a slice with NO turn_order ⇒ ROAM (no_turn_order); still no board, no result card', () => {
    const r = derive_phase(dungeon(STATUS_ACTIVE), fight({ turn_order: [], active_entity_id: null }), seat())
    expect(r.phase).toBe(PHASE.ROAM)
    expect(r.unmet).toContain('no_turn_order')
    expect(should_mount_board(r)).toBe(false)
    expect(should_show_result(r)).toBe(false)
  })
})
