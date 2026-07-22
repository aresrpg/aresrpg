// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE stale-fight recovery contract for the gold fixture boot (fight_mouse_helpers.ts boot_fixture_world) —
// zero Playwright, zero I/O, unit-tested by fight_recovery_test.ts (the click_verify.ts precedent). Extends the
// D767 CLAIM recovery (unfinished_result_pending / open_pending_result) with the FORFEIT case the engage path
// never handled: the fixture character can carry a still-LIVE fight orphaned by an interrupted run, so the client
// mounts THAT fight and the roam-world engage never finds a claimable spawn (its 90s pixel poll starves).
//
// ONE decision function owns the three-way verdict, reading the SAME two /v1 leaves unfinished_result_pending
// reads (rpc.get_fights rows + a find_pending_outcome row):
//   · forfeit_active — a LIVE (placement|active) fight THE FIXTURE CHARACTER PARTICIPATES IN (the ownership
//     guard, seat money-lens rider #1): the only fight we may forfeit; never one another character/run holds.
//   · claim_result  — a TERMINAL (victory|defeat) fight, or an unopened outcome row: the character is MARKED
//     (abort-111) and the existing engage-loop D767 open_pending_result discharges it — NOT the forfeit door.
//   · none          — nothing to recover.
//
// run_fight_recovery is the effect-injected orchestrator: it fires the forfeit tx door AT MOST ONCE, only on
// forfeit_active. The door is injected so the unit COUNTS invocations against a mock (rider #3) — the real door
// (abandon_fight, a gas-burning chain tx) is single-shot and never retried (rider #2 / tx-retry-burn law).

export type FightRecoveryVerdict = 'none' | 'claim_result' | 'forfeit_active'

/** The status + seat-sorted participants leaves this verdict reads off each rpc RpcFight row (rpc/views.ts). */
export type FightRecoveryFight = {
  readonly fight_id: string
  readonly status?: string | null
  readonly participants?: ReadonlyArray<{ readonly character?: string | null } | null | undefined> | null
}

export type FightRecoveryState = {
  /** the fixture character being booted — the ONLY character whose live fight we may forfeit (ownership guard). */
  readonly character_id: string
  /** rpc.get_fights({ character }) rows — the SAME /v1 leaf unfinished_result_pending reads. */
  readonly fights: ReadonlyArray<FightRecoveryFight | null | undefined>
  /** settlement.find_pending_outcome(address, character) present — an unopened FightOutcome row (the D767 leaf). */
  readonly pending_outcome: boolean
}

/** THE TX DOOR (injected so the unit counts invocations against a mock): the real forfeit is a gas-burning chain
 *  tx. Fired AT MOST ONCE per recovery, only on forfeit_active. */
export type FightRecoveryEffects = {
  readonly forfeit: (fight: FightRecoveryFight) => Promise<void> | void
}

export type FightRecoveryResult = {
  readonly verdict: FightRecoveryVerdict
  /** the forfeited fight's id, or null when no forfeit fired. */
  readonly forfeited: string | null
}

const is_live = (fight: FightRecoveryFight) => fight.status === 'placement' || fight.status === 'active'
const is_terminal = (fight: FightRecoveryFight) => fight.status === 'victory' || fight.status === 'defeat'
const participates = (fight: FightRecoveryFight, character_id: string) =>
  (fight.participants ?? []).some((seat) => seat != null && seat.character === character_id)
const present_fights = (state: FightRecoveryState): FightRecoveryFight[] =>
  (state.fights ?? []).filter((fight): fight is FightRecoveryFight => fight != null)

/** THE OWNERSHIP GUARD (seat money-lens rider #1): the live fight the fixture character genuinely participates in
 *  — the only one we may forfeit. Null when no live fight is ours (incl. a live fight another character holds). */
export function owned_live_fight(state: FightRecoveryState): FightRecoveryFight | null {
  return present_fights(state).find((fight) => is_live(fight) && participates(fight, state.character_id)) ?? null
}

/** The pure three-way recovery classifier. */
export function fight_recovery_verdict(state: FightRecoveryState): FightRecoveryVerdict {
  if (owned_live_fight(state)) return 'forfeit_active' // an owned LIVE fight blocks a fresh engage — forfeit it first
  if (present_fights(state).some(is_terminal)) return 'claim_result'
  return state.pending_outcome ? 'claim_result' : 'none'
}

/** The effect-injected orchestrator: forfeit the owned live fight EXACTLY ONCE (rider #3), else no-op. */
export async function run_fight_recovery(
  state: FightRecoveryState,
  effects: FightRecoveryEffects
): Promise<FightRecoveryResult> {
  const verdict = fight_recovery_verdict(state)
  if (verdict !== 'forfeit_active') return { verdict, forfeited: null }
  const live = owned_live_fight(state)
  if (!live) return { verdict, forfeited: null } // defensive: forfeit_active implies an owned live fight
  await effects.forfeit(live)
  return { verdict, forfeited: live.fight_id }
}
