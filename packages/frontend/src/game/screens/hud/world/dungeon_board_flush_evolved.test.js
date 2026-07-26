// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ⑭ FLUSH VALIDATES THE EVOLVED SEQUENCE (regression: a turn could commit without the spell — a trap placed
// behind a mob then pushed onto it made the cast look invalid when everything was actually valid). The chain commits ONE PTB in D99
// order, each action reading LIVE evolved state — so a drafted cast MUST be judged against the board the chain
// sees WHEN IT FIRES (the committed base folded through the PRIOR casts' displacements/kills), never the
// optimistic end-state where THIS cast's own push already moved its target and made its own valid cast look
// stale. The evolved-sequence DECISION is unit-driven in @aresrpg/fight (predict_cast.test.js →
// evolve_flush_casts, the sim door). This locks the WIRING, exactly like dungeon_board_walk_from.test.js pins an
// un-driveable render binding: flush_commit lives inside a browser-only component (DungeonBoard.jsx imports the
// 3D engine → not headless-importable, no jsdom), so a source-contract is the red at HEAD.

import { describe, expect, test } from 'bun:test'

describe('DungeonBoard flush — each cast validated against the evolved sequence, not the optimistic occupancy', () => {
  test('RED-FIRST #398: flush composes and evolves the one ordered staged stream, including moves', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)

    // One composition seam owns the draft order. The same full action stream (move/cast interleaved) drives
    // validation, so a cast snapshot naturally observes every preceding move before that exact stream ships.
    expect(body).toMatch(/compose_staged_turn\(/)
    const evolve_start = body.indexOf('evolve_flush_casts({')
    const evolve_end = body.indexOf('\n    })', evolve_start)
    expect(evolve_start).toBeGreaterThan(-1)
    expect(evolve_end).toBeGreaterThan(evolve_start)
    const evolve_call = body.slice(evolve_start, evolve_end)
    expect(evolve_call).toMatch(/\bactions\s*[:,]/)
    expect(evolve_call).not.toMatch(/\bcasts\s*:/)
    expect(src).toMatch(/kind:\s*0,\s*target:\s*cell,\s*landed:\s*!bite/)
    expect(src).toMatch(/landed:\s*entry\.landed/)

    // The old binary approximation destroyed interleaving by rebuilding two blocks. It must not remain as a
    // fallback after ordered composition lands.
    expect(body).not.toMatch(/cast_first\s*\?\s*\[\.\.\.cast_actions,\s*\.\.\.move_actions\]/)
    expect(body).not.toMatch(/\[\.\.\.move_actions,\s*\.\.\.cast_actions\]/)
  })

  test('flush_commit sources per-cast occupancy from evolve_flush_casts (committed base + prior displacements)', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const body = src.slice(start, end)
    // the flush evolves the COMMITTED chain state through the drafted casts (the sim door), keyed PER cast…
    expect(body).toMatch(/evolve_flush_casts\(/)
    expect(body).toMatch(/committed:\s*committed_truth\(/)
    expect(body).toMatch(/evolved\[cast_i\]/)
    // …and the per-cast evolved occupancy `occ` — NEVER the eye-state `occupied` — feeds strike LEGALITY
    // (target_is_mob / committed_target_alive / occupied_alive), keyed on `target_cell` (LEG 0a: entry.cell unless
    // txs.retarget_cast recomposed it against the target's moved committed cell — see the test below).
    expect(body).toMatch(/const tgt = occ\.get\(target_cell\)/)
    expect(body).toMatch(/occupied_alive: !!occ\.get\(target_cell\)\?\.alive/)
    expect(body).not.toMatch(/target_is_mob:\s*occupied\.get/)
    expect(body).not.toMatch(/occupied_alive:\s*!!occupied\.get/)
  })

  test('#398: a cast after a trap-killed move is dropped before it can revert the PTB', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    const body = src.slice(start, end)

    // evolve_flush_casts marks the caster row dead at this cast's exact slot. The flush must consume that snapshot
    // before geometry/composition; shipping act_cast after act_move killed the actor aborts EActorDead on-chain.
    expect(body).toMatch(/const caster_alive = \[\.\.\.occ\.values\(\)\]/)
    expect(body).toMatch(/if \(caster_alive === false\) \{[\s\S]{0,180}drop_entry\([\s\S]{0,180}continue/)
  })
})

describe('DungeonBoard auto-pass toast policy', () => {
  test('the lost-turn edge keeps its trace but emits no toast', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('subscribe_turn_lost(fight_store')
    const end = src.indexOf('// The pick decision', start)
    const body = src.slice(start, end)

    expect(body).toContain("fight_state_trace('turn_lost_toast', { reason })")
    expect(body).not.toMatch(/push_event_toast|dungeons\.turn_lost/)
  })
})

// LEG 0a — CAST AUTO-RETARGET (a mob shifting one cell silently invalidated a drafted cast).
// The pure decision (follow a moved target to its committed cell when the draft's own footprint still reaches it,
// else report a domain drop) is unit-locked in @aresrpg/fight/test/cast_retarget_leg_0a.test.js. This locks the WIRING —
// same un-driveable-component rationale as the describe above (source-contract, no browser/jsdom).
describe('DungeonBoard flush — a drafted cast auto-retargets onto its moved target (txs.retarget_cast wiring)', () => {
  test('flush_commit resolves the target fighter through the EYE-STATE occupancy, calls retarget_cast, and ships the retargeted cell', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    const body = src.slice(start, end)
    // identity resolution: the ONLY sanctioned `occupied.get(entry.cell)` call — the eye-state still remembers the
    // click-time cell once a fresher committed/evolved read has moved the fighter on, which is exactly why it (and
    // not `occ`) is the right source for "who did I click on". #321: gated by ground_targeted (a free_cell cast
    // never resolves it at all — see the describe block below) but still the only call site.
    expect(body).toMatch(/const eye_target = ground_targeted \? null : occupied\.get\(entry\.cell\)/)
    expect((body.match(/occupied\.get\(entry\.cell\)/g) ?? []).length).toBe(1)
    // its committed cell (committed_truth, my drafts excluded) feeds txs.retarget_cast alongside the SAME
    // cast_range_set_dungeon footprint the legality check itself reaches through — one geometry home, never a
    // re-implementation — and the result REPLACES entry.cell for the rest of the entry (footprint/occupancy
    // checks + the shipped action target), not just the drop decision.
    expect(body).toMatch(/retarget_cast\(\{/)
    expect(body).toMatch(/target_cell:\s*entry\.cell/)
    expect(body).toMatch(/committed_cell:\s*target_committed_cell/)
    expect(body).toMatch(/reaches:\s*\(cell\)\s*=>\s*footprint\.has\(cell\)/)
    expect(body).toMatch(/target_cell = retargeted\.target/)
    expect(body).toMatch(/kind: 2, target: target_cell/)
    expect(body).toMatch(/kind: 1,\s*\n\s*target: target_cell/)
    // An unreachable retarget reports only a domain drop. Toast policy is absent from this re-validation pass;
    // the actual local commit-removal event is the sole feedback input (locked below).
    expect(body).toMatch(/if \(retargeted\.dropped\)/)
    expect(body).not.toMatch(/dungeons\.cast_target_unreachable/)
  })

  // #1027 — ONE COMMITTED FOLD. `docs/FIGHT_PIPELINE.md` §2: committed truth comes from the headless core fold "and
  // by nothing else". The cell this retarget puts in the PTB is the highest-stakes committed read in the client, so
  // the board must ask the core-backed door (project.committed_truth, the same one committed_mob_hp rides) — the
  // legacy settlement derivation has no reader in this file at all. Behavior is pinned in
  // @aresrpg/fight/test/truth_owner.test.js on a state where the two folds provably disagree.
  test('#1027: every committed read in the board goes through the core-backed door, never the legacy fold', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    expect(src).not.toMatch(/committed_state/)
    expect(src).toMatch(/target_committed_cell = eye_target[\s\S]{0,40}committed_truth\(fight_store\.getState\(\)\)/)
  })
})

// #321 THE COMMIT-TIME CAST FOOTPRINT ANCHOR — the same wrong-anchor disease as #300 (the movement-draft cost
// anchor), but on the FLUSH side: the footprint origin for cast N must be the caster's cell evolved through casts
// 1..N-1's OWN displacement effects (a drafted teleport/dash among them), never one static pre-loop anchor — that
// staleness dropped valid STATIONARY targets ("Turn committed without the spell — its target was no longer
// valid") the instant any earlier drafted cast relocated the caster. A free_cell (ground-targeted) cast — trap,
// glyph, teleport — additionally never enters the fighter retarget/drop path at all: cells don't move. The pure
// per-cast evolution is unit-locked in @aresrpg/fight (predict_cast.test.js → evolve_flush_casts's `caster_cell`);
// the ground-target null-input behavior is unit-locked in cast_retarget_leg_0a.test.js. This locks the WIRING —
// same un-driveable-component rationale as the describe blocks above.
describe('DungeonBoard flush — the footprint anchor evolves PER CAST, and ground-targeted casts never target-revalidate (#321)', () => {
  test('flush_commit seeds evolve_flush_casts at the sequence anchor and reads its per-cast caster_cell as EVERY cast’s footprint origin', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    const body = src.slice(start, end)
    // evolve_flush_casts receives the whole ordered action sequence. It starts from committed truth internally,
    // then each drafted move/cast evolves the caster before the next cast snapshot.
    expect(body).toMatch(/actions:\s*evolution_actions,/)
    expect(body).not.toMatch(/caster_seed_cell:/)
    // every cast reads ITS OWN evolved cell — never falls back to silently re-reading the raw pre-loop anchor
    // while some other cast in the SAME queue relocates the caster.
    expect(body).toMatch(/const cast_anchor = evolved\[cast_i\]\?\.caster_cell \?\? committed_caster_cell/)
    // BOTH footprint constructions (weapon + spell) anchor on the per-cast cell — the bare pre-loop `anchor` is
    // never decoded as a footprint origin any more (that was the drop-valid-stationary-targets bug). The spell
    // footprint also spreads `active_fighter` ahead of `cell` (#481 folded range buffs), so assert the `cell:`
    // binding itself rather than the object's exact literal shape.
    expect((body.match(/cell:\s*decode\(cast_anchor\)/g) ?? []).length).toBe(2)
    expect(body).not.toMatch(/cell:\s*decode\(anchor\)/)
  })

  test('a free_cell (ground-targeted) cast never resolves eye_target — cells do not retarget or drop on account of who now stands there', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    const body = src.slice(start, end)
    // `level_row` is the board's ONE seat-rank reader (#1077) — the drafted spell's flags come off the level the
    // seat actually casts at, never a hardcoded rank 1.
    expect(body).toMatch(/const ground_targeted = !is_weapon && level_row\(drafted_spell\)\?\.free_cell === true/)
  })

  test('only the successful local commit-drop event can emit the named out-of-reach toast', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const start = src.indexOf('const flush_commit = async')
    const end = src.indexOf('auto_submit_ref.current =', start)
    const body = src.slice(start, end)
    const committed = body.indexOf('const ok = await commit_turn(actions')
    const emitted = body.indexOf('emit_local_cast_drop_toast({')

    // The cancellation record is created exactly where drop_entry omits the cast from cast_actions.
    expect((body.match(/cast_drops\.push\(local_commit_cast_drop\(/g) ?? []).length).toBe(1)
    expect((body.match(/drop_entry\(CAST_DROP_TARGET_OUT_OF_REACH\)/g) ?? []).length).toBe(2)
    // Consumption is downstream of the real commit result and explicitly gated/scoped by it.
    expect(committed).toBeGreaterThan(-1)
    expect(emitted).toBeGreaterThan(committed)
    expect((body.match(/emit_local_cast_drop_toast\(\{/g) ?? []).length).toBe(1)
    expect(body).toMatch(/commit_succeeded:\s*ok/)
    expect(body).toMatch(/drops:\s*cast_drops/)
    expect(body).toMatch(/local_actor_id:\s*entity_id/)
    // The board no longer emits this i18n key from validation/counters; the dedicated helper owns the one push.
    expect(body).not.toMatch(/dungeons\.cast_target_unreachable/)
    // The unrelated stale-target notice remains named too.
    expect(body).toMatch(
      /title:\s*t\('dungeons\.cast_dropped_stale',\s*\{\s*spell:\s*stale_spell_names\.join\(', '\)\s*\}\)/
    )
  })
})

describe('DungeonBoard fight toast policy', () => {
  test('turn completion stays silent and prediction reconciliation logs without a toast', async () => {
    const src = await Bun.file(new URL('./DungeonBoard.jsx', import.meta.url)).text()
    const flush_start = src.indexOf('const flush_commit = async')
    const flush_end = src.indexOf('auto_submit_ref.current =', flush_start)
    const flush_body = src.slice(flush_start, flush_end)
    const divergence_start = src.indexOf('subscribe_divergence(fight_store')
    const divergence_end = src.indexOf('subscribe_turn_lost(fight_store', divergence_start)
    const divergence_body = src.slice(divergence_start, divergence_end)

    expect(flush_body).not.toMatch(/dungeons\.(auto_commit_fired|auto_pass_fired)/)
    expect(divergence_body).toContain("game_log('board', 'fight prediction diverged; authoritative action adopted'")
    expect(divergence_body).not.toMatch(/push_event_toast|dungeons\.prediction_reconciled/)
  })
})
